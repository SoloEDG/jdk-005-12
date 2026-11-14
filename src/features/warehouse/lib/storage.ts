import type { Batch, Certificate, Item } from "../../../shared/contracts";
import { items } from "../../../shared/catalog";

export function makeBatch(input: {
  item: Item;
  quantity: number;
  hour: number;
  id: string;
  certificateId: string;
}): Batch {
  return {
    id: input.id,
    item: input.item,
    quantity: input.quantity,
    certificateId: input.certificateId,
    expires: input.hour + items[input.item].life,
  };
}

export function summarize(batches: readonly Readonly<Batch>[]) {
  return batches.reduce((n, b) => n + b.quantity, 0);
}

/** 每批库存都必须挂在自己的证书上；没有证书的批次不能出手或交付。 */
export function certificatesInUse(
  batches: readonly Batch[],
  certificates: Readonly<Record<string, Certificate>>,
) {
  return batches
    .map((b) => certificates[b.certificateId])
    .filter((c): c is Certificate => Boolean(c));
}

export function certificatesForItem(
  batches: readonly Batch[],
  certificates: Readonly<Record<string, Certificate>>,
  item: Item,
) {
  return certificatesInUse(
    batches.filter((b) => b.item === item),
    certificates,
  );
}
