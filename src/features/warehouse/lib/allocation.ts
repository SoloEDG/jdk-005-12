import type {
  Allocation,
  Batch,
  Certificate,
  Inspection,
  Item,
  OriginShare,
  Quality,
  Reservation,
} from "../../../shared/contracts";
import { items } from "../../../shared/catalog";
import { inspectionFailure, passesInspection } from "../../../shared/quality";

export function available(batch: Batch, reservations: readonly Reservation[]) {
  return (
    batch.quantity -
    reservations
      .flatMap((r) => r.allocations)
      .filter((a) => a.batch === batch.id)
      .reduce((n, a) => n + a.quantity, 0)
  );
}

/** 按比例把来源份额拆成指定数量，数量必须精确等于目标。 */
export function distributeShares(
  shares: readonly OriginShare[],
  quantity: number,
): OriginShare[] {
  if (quantity <= 0 || !shares.length) return [];
  const total = shares.reduce((n, s) => n + s.quantity, 0);
  if (total === quantity) return shares.map((s) => ({ ...s }));
  if (total <= 0) return [];
  const raw = shares.map((s) => (s.quantity * quantity) / total);
  const parts = raw.map(Math.floor);
  let left = quantity - parts.reduce((n, p) => n + p, 0);
  const order = raw
    .map((value, index) => ({ index, rest: value - parts[index]! }))
    .sort((a, b) => b.rest - a.rest);
  for (let i = 0; i < left; i++) parts[order[i % order.length]!.index]!++;
  return shares
    .map((s, i) => ({ ...s, quantity: parts[i]! }))
    .filter((s) => s.quantity > 0);
}

/** 拆一份证书：返回“被领走的部分”与“仍然真实存在的剩余部分”，逐来源互补。 */
export function sliceShares(
  shares: readonly OriginShare[],
  take: number,
): { taken: OriginShare[]; rest: OriginShare[] } {
  const total = shares.reduce((n, s) => n + s.quantity, 0);
  const clamped = Math.max(0, Math.min(total, Math.floor(take)));
  if (!clamped) return { taken: [], rest: shares.map((s) => ({ ...s })) };
  if (clamped === total) return { taken: shares.map((s) => ({ ...s })), rest: [] };
  const raw = shares.map((s) => (s.quantity * clamped) / total);
  const parts = raw.map(Math.floor);
  let left = clamped - parts.reduce((n, p) => n + p, 0);
  const order = raw
    .map((value, index) => ({ index, rest: value - parts[index]! }))
    .sort((a, b) => b.rest - a.rest);
  for (let i = 0; i < left; i++) parts[order[i % order.length]!.index]!++;
  const taken: OriginShare[] = [];
  const rest: OriginShare[] = [];
  shares.forEach((s, i) => {
    if (parts[i]! > 0) taken.push({ ...s, quantity: parts[i]! });
    if (s.quantity - parts[i]! > 0)
      rest.push({ ...s, quantity: s.quantity - parts[i]! });
  });
  return { taken, rest };
}

export function makeCertificate(input: {
  id: string;
  item: Item;
  quantity: number;
  quality: Quality;
  shares?: readonly OriginShare[];
  derivedFrom?: readonly string[];
  note?: string;
  issued: number;
}): Certificate {
  const shares =
    input.shares && input.shares.length
      ? distributeShares(input.shares, input.quantity)
      : [];
  return {
    id: input.id,
    item: input.item,
    quality: input.quality,
    shares: shares.length
      ? shares
      : [{ source: "未记录来源", quantity: input.quantity }],
    ...(input.derivedFrom?.length
      ? { derivedFrom: [...input.derivedFrom] }
      : {}),
    ...(input.note ? { note: input.note } : {}),
    issued: input.issued,
  };
}

export interface AllocateSuccess {
  ok: true;
  allocations: Allocation[];
  /** 备货时使用的检验要求，交付前会再次核对。 */
  spec?: Inspection;
}
export interface AllocateFailure {
  ok: false;
  error: string;
}
export type AllocateResult = AllocateSuccess | AllocateFailure;

/**
 * 只在真实存在、未过期且有剩余量的批次中配货。
 * 指定检验区间时，旧档证书必须整个区间落在要求内，不能靠“可能合格”占用。
 */
export function allocate(
  batches: readonly Batch[],
  certificates: Readonly<Record<string, Certificate>>,
  reservations: readonly Reservation[],
  item: Item,
  quantity: number,
  hour: number,
  spec?: Inspection,
): AllocateResult {
  const itemBatches = batches.filter((b) => b.item === item);
  if (!itemBatches.length) return { ok: false, error: `谷仓里没有${items[item].name}` };
  const fresh = itemBatches.filter((b) => b.expires > hour);
  if (!fresh.length)
    return { ok: false, error: `${items[item].name}的库存都已过保质期` };
  const freeFresh = fresh.reduce(
    (n, b) => n + Math.max(0, available(b, reservations)),
    0,
  );
  if (freeFresh < quantity)
    return {
      ok: false,
      error: `可用${items[item].name}只有 ${freeFresh} 份，需要 ${quantity} 份`,
    };

  const eligible: { batch: Batch; certificate: Certificate }[] = [];
  const unconfirmable: string[] = [];
  for (const batch of fresh) {
    const certificate = certificates[batch.certificateId];
    if (!certificate || available(batch, reservations) <= 0) continue;
    if (!passesInspection(certificate.quality, spec)) {
      if (
        certificate.quality.kind === "legacy" &&
        spec &&
        inspectionFailure(certificate.quality, spec)
      )
        unconfirmable.push(certificate.id);
      continue;
    }
    eligible.push({ batch, certificate });
  }
  eligible.sort((a, b) => a.batch.expires - b.batch.expires);

  let remaining = quantity;
  const result: Allocation[] = [];
  for (const { batch } of eligible) {
    const n = Math.min(remaining, Math.max(0, available(batch, reservations)));
    if (n > 0) {
      result.push({ batch: batch.id, quantity: n });
      remaining -= n;
    }
    if (!remaining) break;
  }
  if (remaining > 0) {
    const usable = quantity - remaining;
    const reasons = [`符合检验要求的可用批次只有 ${usable} 份（需要 ${quantity} 份）`];
    if (unconfirmable.length)
      reasons.push(
        `${unconfirmable.length} 批旧档证书区间无法确认符合要求，未参与配货`,
      );
    return { ok: false, error: reasons.join("；") };
  }
  return { ok: true, allocations: result, ...(spec ? { spec } : {}) };
}
