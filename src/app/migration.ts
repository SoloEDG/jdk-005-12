import type {
  Batch,
  Certificate,
  Crop,
  Item,
  Job,
  Order,
  OriginShare,
  Quality,
  Reservation,
  Receipt,
} from "../shared/contracts";
import { legacyInspection, legacyQuality } from "../shared/quality";

interface LegacyBatch {
  id: string;
  item: Batch["item"];
  quantity: number;
  quality?: number;
  source?: string;
  expires: number;
  certificateId?: string;
}
interface LegacyReservation {
  id: string;
  owner: string;
  allocations: { batch: string; quantity: number }[];
  spec?: Reservation["spec"];
}
interface LegacyWarehouse {
  batches?: LegacyBatch[];
  certificates?: Record<string, Certificate>;
  archive?: Record<string, Certificate>;
  reservations?: LegacyReservation[];
  serial?: number;
  certificateSerial?: number;
  wasted?: number;
}
interface LegacyCrop extends Omit<Crop, "quality"> {
  quality?: Crop["quality"];
}
interface LegacyJob extends Omit<Job, "receipt" | "output"> {
  receipt?: {
    quality?: number;
    sources?: string[];
    quantity?: number;
    shares?: Receipt["shares"];
  };
  output?: Quality;
}
interface LegacyOrder extends Omit<Order, "spec" | "rewardXp"> {
  minQuality?: number;
  spec?: Order["spec"];
  rewardXp?: number;
}
interface LegacySnapshot {
  clock?: { hour?: number; paused?: boolean; speed?: number };
  warehouse?: LegacyWarehouse;
  fields?: { plots?: { id: number; crop: LegacyCrop | null }[]; selected?: Order["item"] };
  workshop?: { jobs?: LegacyJob[]; serial?: number; lastError?: string };
  orders?: { orders?: LegacyOrder[]; serial?: number; coins?: number; xp?: number; delivered?: number };
}

export interface MigratedSnapshot {
  clock: { hour: number; paused: boolean; speed: number };
  warehouse: {
    batches: Batch[];
    certificates: Record<string, Certificate>;
    archive: Record<string, Certificate>;
    reservations: Reservation[];
    serial: number;
    certificateSerial: number;
    wasted: number;
  };
  fields: { plots: { id: number; crop: Crop | null }[]; selected: Item };
  workshop: { jobs: Job[]; serial: number; lastError: string };
  orders: {
    orders: Order[];
    serial: number;
    coins: number;
    xp: number;
    delivered: number;
  };
  migrated: boolean;
}

/**
 * 把旧版星级存档迁移到三项检验。
 * 旧星级只转成明确的默认区间，绝不生成看似实测的数值；
 * 预留按真实剩余数量重新核对，重复占用的部分被裁掉。
 */
export function migrateSnapshot(raw: unknown): MigratedSnapshot {
  const source = (raw && typeof raw === "object" ? raw : {}) as LegacySnapshot;
  const hour = source.clock?.hour ?? 6;
  let migrated = false;

  const certificates: Record<string, Certificate> = {
    ...(source.warehouse?.certificates ?? {}),
  };
  /** 随货离仓的历史证书，只用于追溯，不能被配货逻辑取用。 */
  const archive: Record<string, Certificate> = {
    ...(source.warehouse?.archive ?? {}),
  };
  const batches: Batch[] = [];
  let certificateSerial = source.warehouse?.certificateSerial ?? 0;
  let batchSerial = source.warehouse?.serial ?? 0;

  for (const old of source.warehouse?.batches ?? []) {
    if (!old || old.quantity <= 0) continue;
    let certificate = old.certificateId
      ? certificates[old.certificateId]
      : undefined;
    if (!certificate) {
      const id = `c${++certificateSerial}`;
      const quality: Quality =
        typeof old.quality === "number"
          ? legacyQuality(
              old.quality,
              "旧存档星级迁移：默认区间，未重新检验",
            )
          : legacyQuality(1, "旧存档无品质记录：默认区间，未重新检验");
      migrated = true;
      certificate = {
        id,
        item: old.item,
        quality,
        shares: [{ source: old.source ?? "旧存档来源", quantity: old.quantity }],
        issued: hour,
        note: "旧存档补录，数量与来源按原样保留",
      };
      certificates[id] = certificate;
    }
    /** 证书份额之和不得超过批次真实数量。 */
    const declared = certificate.shares.reduce((n, s) => n + s.quantity, 0);
    if (declared > old.quantity) {
      migrated = true;
      certificates[certificate.id] = {
        ...certificate,
        shares: trimShares(certificate.shares, old.quantity),
      };
    }
    if (certificates[certificate.id]!.shares.length === 0)
      certificates[certificate.id] = {
        ...certificates[certificate.id]!,
        shares: [{ source: "旧存档来源", quantity: old.quantity }],
      };
    batches.push({
      id: old.id ?? `b${++batchSerial}`,
      item: old.item,
      quantity: old.quantity,
      expires: old.expires ?? hour,
      certificateId: certificate.id,
    });
  }

  /**
   * 清理不再对应任何真实批次的存量证书，避免旧档里残留“幽灵资格”。
   * 这些证书转入归档，保留追溯信息但无法再参与配货。
   */
  const liveCertificateIds = new Set(batches.map((b) => b.certificateId));
  for (const id of Object.keys(certificates)) {
    if (!liveCertificateIds.has(id)) {
      archive[id] = certificates[id]!;
      delete certificates[id];
      migrated = true;
    }
  }

  /**
   * 预留按顺序重新绑定：同一批库存只能被真实剩余数量占用，
   * 重复备货或已过期批次对应的部分会被裁掉，不足则整笔释放。
   */
  const used = new Map<string, number>();
  const reservations: Reservation[] = [];
  for (const old of source.warehouse?.reservations ?? []) {
    const allocations: Reservation["allocations"] = [];
    let valid = old.allocations?.length > 0;
    for (const allocation of old.allocations ?? []) {
      const batch = batches.find((b) => b.id === allocation.batch);
      if (!batch || batch.expires <= hour) {
        valid = false;
        continue;
      }
      const consumed = used.get(batch.id) ?? 0;
      const room = Math.max(0, batch.quantity - consumed);
      const wanted = Math.max(0, allocation.quantity);
      /** 留不齐整笔就不算有效预留，避免订单“备了货”却少交付。 */
      if (wanted <= 0 || room < wanted) {
        migrated = true;
        valid = false;
        continue;
      }
      used.set(batch.id, consumed + wanted);
      allocations.push({ batch: batch.id, quantity: wanted });
    }
    if (!valid || !allocations.length) {
      migrated = true;
      continue;
    }
    if (allocations.length !== old.allocations.length) migrated = true;
    reservations.push({
      id: old.id,
      owner: old.owner,
      allocations,
      ...(old.spec ? { spec: old.spec } : {}),
    });
  }

  const fields: MigratedSnapshot["fields"] = {
    selected: (source.fields?.selected as Item) ?? "carrot",
    plots: (source.fields?.plots ?? []).map((plot) => {
      if (!plot.crop) return { id: plot.id, crop: null };
      if (!plot.crop.quality) migrated = true;
      const crop: Crop = {
        ...plot.crop,
        /** 旧存档没有逐时品质记录，从恢复时刻起按新规则重新累积。 */
        quality: plot.crop.quality ?? { sugar: 30, moisture: 60, purity: 75 },
      };
      return { id: plot.id, crop };
    }),
  };

  const jobs: Job[] = (source.workshop?.jobs ?? []).map((job) => {
    if (!job.receipt || job.receipt.shares) return job as Job;
    migrated = true;
    const quantity = job.receipt.quantity ?? 0;
    const stars = job.receipt.quality ?? 1;
    const certificateId = `c${++certificateSerial}`;
    const quality = legacyQuality(stars, "旧存档加工记录：默认区间，未重新检验");
    const outputItem: Item =
      job.recipe === "jam" ? "jam" : job.recipe === "flour" ? "flour" : "carrot";
    certificates[certificateId] = {
      id: certificateId,
      item: outputItem,
      quality,
      shares: [{ source: "旧存档加工", quantity }],
      issued: hour,
      note: "旧加工记录补录",
    };
    const receipt: Receipt = {
      quantity,
      quality,
      shares: [
        {
          batch: "旧加工",
          quantity,
          certificate: certificates[certificateId]!,
        },
      ],
    };
    return { ...job, receipt, output: job.output ?? quality } as Job;
  });

  const keptReservationIds = new Set(
    reservations.map((reservation) => reservation.id),
  );
  const orders: Order[] = (source.orders?.orders ?? []).map((order) => {
    if (!order.spec && typeof order.minQuality === "number") migrated = true;
    const migratedOrder: Order = {
      ...order,
      rewardXp: order.rewardXp ?? 40,
      spec: order.spec ?? legacyInspection(order.minQuality ?? 1),
    } as Order;
    /** 预留已被裁掉的订单退回待备货，而不是假装仍然备好。 */
    if (
      migratedOrder.status === "reserved" &&
      (!migratedOrder.reservation ||
        !keptReservationIds.has(migratedOrder.reservation))
    ) {
      migrated = true;
      migratedOrder.status = "open";
      migratedOrder.reject = "旧存档的备货数量已不成立，请重新备货";
      delete migratedOrder.reservation;
    }
    return migratedOrder;
  });

  return {
    clock: {
      hour,
      paused: true,
      speed: source.clock?.speed ?? 1,
    },
    warehouse: {
      batches,
      certificates,
      archive,
      reservations,
      serial: Math.max(batchSerial, ...batches.map((b) => numericId(b.id))),
      /** 归档证书的编号也计入，避免新拆出的证书与历史证书撞号。 */
      certificateSerial: Math.max(
        certificateSerial,
        ...Object.keys(certificates).map(numericId),
        ...Object.keys(archive).map(numericId),
      ),
      wasted: source.warehouse?.wasted ?? 0,
    },
    fields,
    workshop: {
      jobs,
      serial: source.workshop?.serial ?? jobs.length,
      lastError: source.workshop?.lastError ?? "",
    },
    orders: {
      orders,
      serial: source.orders?.serial ?? orders.length,
      coins: source.orders?.coins ?? 180,
      xp: source.orders?.xp ?? 0,
      delivered: source.orders?.delivered ?? 0,
    },
    migrated,
  };
}

const numericId = (id: string) => {
  const match = /\d+/.exec(id ?? "");
  return match ? Number(match[0]) : 0;
};

function trimShares(shares: readonly OriginShare[], quantity: number) {
  let remaining = Math.max(0, quantity);
  const result: OriginShare[] = [];
  for (const share of shares) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, share.quantity);
    if (take > 0) result.push({ ...share, quantity: take });
    remaining -= take;
  }
  return result;
}
