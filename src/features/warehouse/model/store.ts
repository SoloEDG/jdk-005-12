import { reactive, readonly } from "vue";
import type {
  Item,
  Batch,
  Certificate,
  Inspection,
  Reservation,
  Receipt,
  ReceiptShare,
  Notice,
  Quality,
  OriginShare,
  ReserveResult,
} from "../../../shared/contracts";
import {
  allocate,
  available,
  makeCertificate,
  sliceShares,
} from "../lib/allocation";
import { makeBatch } from "../lib/storage";
import { combineQualities, measuredQuality } from "../../../shared/quality";
interface AddOptions {
  /** 已有的证书 id：用于把拆出的部分挂回同一张证书的来源链。 */
  certificateId?: string;
  shares?: readonly OriginShare[];
  derivedFrom?: readonly string[];
  note?: string;
}

export function createWarehouse(now: () => number, notice: Notice) {
  const state = reactive({
    batches: [] as Batch[],
    /** 仓库存量证书：每一张都必须对应当前真实存在的批次与数量。 */
    certificates: {} as Record<string, Certificate>,
    /** 已随货物离仓的证书归档，仅用于追溯，不再代表任何可用库存。 */
    archive: {} as Record<string, Certificate>,
    reservations: [] as Reservation[],
    serial: 0,
    certificateSerial: 0,
    wasted: 0,
  });

  /**
   * 入库：数量必须同时写进一张证书的真实来源份额。
   * 证书不能凭空复制高品质资格——任何一次拆分都减少原证书份额。
   */
  const add = (
    item: Item,
    n: number,
    quality: Quality,
    hour = now(),
    source = "田间收获",
    options: AddOptions = {},
  ) => {
    if (n <= 0) return null;
    const certificateId = options.certificateId ?? `c${++state.certificateSerial}`;
    const shares = options.shares?.length
      ? options.shares
      : [{ source, quantity: n }];
    const certificate: Certificate = makeCertificate({
      id: certificateId,
      item,
      quantity: n,
      quality,
      shares,
      derivedFrom: options.derivedFrom,
      note: options.note,
      issued: hour,
    });
    if (!options.certificateId) state.certificates[certificate.id] = certificate;
    const batch = makeBatch({
      item,
      quantity: n,
      hour,
      id: `b${++state.serial}`,
      certificateId: certificate.id,
    });
    state.batches.push(batch);
    return { batch, certificate };
  };

  /** 从一整批真实库存中拆出一部分，剩余数量仍留在原证书下。 */
  const split = (batchId: string, take: number): ReceiptShare[] | null => {
    const batch = state.batches.find((b) => b.id === batchId);
    if (!batch) return null;
    const certificate = state.certificates[batch.certificateId];
    if (!certificate) return null;
    const { taken, rest } = sliceShares(certificate.shares, take);
    if (taken.reduce((n, s) => n + s.quantity, 0) !== take) return null;
    state.certificates[certificate.id] = {
      ...certificate,
      shares: rest,
    };
    /**
     * 整批被拆空时，原证书不再对应任何真实数量，必须从存量证书表注销。
     * 它拆出的每一份都在归档里各有对应证书，追溯链不会断。
     */
    if (!rest.length) delete state.certificates[certificate.id];
    const partId = `c${++state.certificateSerial}`;
    const part = makeCertificate({
      id: partId,
      item: certificate.item,
      quantity: take,
      quality: certificate.quality,
      shares: taken,
      /** 拆出的证书仍指回原证书，避免拆批后追溯链断裂。 */
      derivedFrom: [...(certificate.derivedFrom ?? []), certificate.id],
      note: `由 ${certificate.id} 拆出 · 数量 ${take}`,
      issued: now(),
    });
    /**
     * 转移证书登记到归档：它对应的数量已离开仓库，
     * 因此绝不能出现在存量证书表里冒充可用资格，但追溯链必须留档。
     */
    state.archive[partId] = part;
    return [
      {
        batch: batch.id,
        quantity: take,
        certificate: part,
      },
    ];
  };

  add(
    "carrot",
    8,
    measuredQuality({ sugar: 46, moisture: 61, purity: 82 }),
    now(),
    "农场首批",
  );
  add(
    "berry",
    6,
    measuredQuality({ sugar: 52, moisture: 58, purity: 79 }),
    now(),
    "农场首批",
  );
  add(
    "corn",
    8,
    measuredQuality({ sugar: 41, moisture: 47, purity: 84 }),
    now(),
    "农场首批",
  );

  return {
    state: readonly(state),
    certificate: (id: string) => state.certificates[id],
    /** 追溯用：含已离仓证书。不能用于配货。 */
    traceCertificate: (id: string) => state.archive[id] ?? state.certificates[id],
    traceRegistry: () => ({ ...state.archive, ...state.certificates }),
    add,
    free: (id: string) => {
      const b = state.batches.find((b) => b.id === id);
      return b ? available(b, state.reservations) : 0;
    },
    /**
     * 只预览一张预留当前会拆出的品质与数量，不改变库存。
     * 交付前用它复检，避免先扣货再发现不合格。
     */
    peek(id: string): Receipt | null {
      const reservation = state.reservations.find((r) => r.id === id);
      if (!reservation) return null;
      const shares: ReceiptShare[] = [];
      for (const allocation of reservation.allocations) {
        const batch = state.batches.find((b) => b.id === allocation.batch);
        const certificate = batch && state.certificates[batch.certificateId];
        if (!batch || !certificate || batch.expires <= now()) return null;
        const total = certificate.shares.reduce((n, s) => n + s.quantity, 0);
        if (total < allocation.quantity) return null;
        const { taken } = sliceShares(certificate.shares, allocation.quantity);
        if (taken.reduce((n, s) => n + s.quantity, 0) !== allocation.quantity)
          return null;
        shares.push({
          batch: batch.id,
          quantity: allocation.quantity,
          certificate: makeCertificate({
            id: `${certificate.id}·预览`,
            item: certificate.item,
            quantity: allocation.quantity,
            quality: certificate.quality,
            shares: taken,
            derivedFrom: certificate.derivedFrom,
            issued: now(),
          }),
        });
      }
      return {
        quantity: shares.reduce((n, s) => n + s.quantity, 0),
        quality: combineQualities(
          shares.map((s) => ({
            quality: s.certificate.quality,
            quantity: s.quantity,
          })),
          "quantity",
        ),
        shares,
      };
    },
    /** 某批当前对应证书的实时来源份额。 */
    sharesOf(batchId: string): OriginShare[] {
      const batch = state.batches.find((b) => b.id === batchId);
      return batch
        ? [...(state.certificates[batch.certificateId]?.shares ?? [])]
        : [];
    },
    reserve(
      owner: string,
      item: Item,
      n: number,
      spec?: Inspection,
    ): ReserveResult {
      const result = allocate(
        state.batches,
        state.certificates,
        state.reservations,
        item,
        n,
        now(),
        spec,
      );
      if (!result.ok) return result;
      const id = `r${++state.serial}`;
      state.reservations.push({
        id,
        owner,
        allocations: result.allocations,
        ...(spec ? { spec } : {}),
      });
      return { ok: true, id, allocations: result.allocations };
    },
    /**
     * 消耗一张预留：逐批拆出真实数量并生成对应的新证书。
     * 已经被别的预留占用、过期或数量不足时整体失败，不做部分扣减。
     */
    consume(id: string): Receipt | null {
      const reservation = state.reservations.find((r) => r.id === id);
      if (!reservation) return null;
      const checked: { allocation: (typeof reservation.allocations)[number]; batch: Batch; certificate: Certificate }[] = [];
      for (const allocation of reservation.allocations) {
        const batch = state.batches.find((b) => b.id === allocation.batch);
        const certificate = batch && state.certificates[batch.certificateId];
        if (!batch || !certificate) return null;
        if (batch.expires <= now()) return null;
        const others = state.reservations.filter((r) => r.id !== id);
        if (available(batch, others) < allocation.quantity) return null;
        checked.push({ allocation, batch, certificate });
      }

      const shares: ReceiptShare[] = [];
      for (const { allocation, batch } of checked) {
        const taken = split(batch.id, allocation.quantity);
        if (!taken) return null;
        batch.quantity -= allocation.quantity;
        shares.push(...taken);
      }
      state.batches = state.batches.filter((b) => b.quantity > 0);
      state.reservations = state.reservations.filter((r) => r.id !== id);

      const quality = combineQualities(
        shares.map((s) => ({
          quality: s.certificate.quality,
          quantity: s.quantity,
        })),
        "quantity",
      );
      return {
        quantity: shares.reduce((n, s) => n + s.quantity, 0),
        quality,
        shares,
      };
    },
    release: (id: string) => {
      state.reservations = state.reservations.filter((r) => r.id !== id);
    },
    /** 出售只允许实物批次；卖出的那份同样生成归档证书，份额逐份核销。 */
    sell(id: string, n: number) {
      const b = state.batches.find((b) => b.id === id);
      if (!b || n <= 0 || available(b, state.reservations) < n) return null;
      const taken = split(b.id, n);
      if (!taken) return null;
      b.quantity -= n;
      if (!b.quantity) state.batches = state.batches.filter((b) => b.id !== id);
      return b.item;
    },
    /** 过期：整批销毁，证书随之失效；与其相关的预留一并释放。 */
    tick(hour: number) {
      const expired = state.batches.filter((b) => b.expires <= hour);
      state.wasted += expired.reduce((n, b) => n + b.quantity, 0);
      const expiredIds = new Set(expired.map((b) => b.id));
      for (const b of expired) delete state.certificates[b.certificateId];
      state.batches = state.batches.filter((b) => b.expires > hour);
      const dropped = state.reservations.filter((r) =>
        r.allocations.some((a) => expiredIds.has(a.batch)),
      );
      state.reservations = state.reservations.filter(
        (r) => !r.allocations.some((a) => expiredIds.has(a.batch)),
      );
      if (expired.length) {
        notice(
          `${expired.length} 批库存已到保质期` +
            (dropped.length ? `，${dropped.length} 笔预留随之取消` : ""),
        );
      }
      return dropped;
    },
    /** 供 UI 检查：某批当前证书与可用数量。 */
    inspect(batchId: string) {
      const batch = state.batches.find((b) => b.id === batchId);
      if (!batch) return null;
      const certificate = state.certificates[batch.certificateId];
      return certificate
        ? { batch, certificate, free: available(batch, state.reservations) }
        : null;
    },
    snapshot: () => JSON.parse(JSON.stringify(state)) as typeof state,
    restore: (data: typeof state) => {
      Object.assign(state, data);
    },
  };
}

export type Warehouse = ReturnType<typeof createWarehouse>;
