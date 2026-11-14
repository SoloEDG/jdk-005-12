import type {
  Inspection,
  Metric,
  Order,
  QualityRange,
} from "../../../shared/contracts";
import { legacyInspection } from "../../../shared/quality";

const spec = (
  entries: Partial<Record<Metric, Partial<QualityRange>>>,
): Inspection => {
  const result: Inspection = {};
  for (const [metric, range] of Object.entries(entries) as [
    Metric,
    Partial<QualityRange>,
  ][]) {
    result[metric] = {
      min: Math.max(0, range.min ?? 0),
      max: Math.min(100, range.max ?? 100),
    };
  }
  return result;
};

export function initialOrders(hour: number): Order[] {
  return [
    {
      id: "o1",
      item: "carrot",
      quantity: 5,
      reward: 70,
      rewardXp: 40,
      spec: spec({ sugar: { min: 42 }, moisture: { max: 70 } }),
      deadline: hour + 36,
      status: "open",
    },
    {
      id: "o2",
      item: "jam",
      quantity: 2,
      reward: 120,
      rewardXp: 50,
      spec: spec({ sugar: { min: 58 }, moisture: { max: 32 }, purity: { min: 70 } }),
      deadline: hour + 48,
      status: "open",
    },
    {
      id: "o3",
      item: "flour",
      quantity: 3,
      reward: 100,
      rewardXp: 45,
      spec: spec({ moisture: { max: 32 }, purity: { min: 75 } }),
      deadline: hour + 60,
      status: "open",
    },
  ];
}

/**
 * 新订单一律使用三项实数区间。旧档“N★起”只在载入旧存档时通过
 * legacyInspection 迁移为保守区间，不会假装旧货经过检验。
 */
export function nextOrder(serial: number, hour: number): Order {
  const item = serial % 2 ? "corn" : "berry";
  const hard = serial % 3 === 0;
  return {
    id: `o${serial}`,
    item,
    quantity: 4,
    reward: 90 + serial * 3,
    rewardXp: hard ? 55 : 40,
    spec: hard
      ? spec({
          sugar: { min: item === "corn" ? 48 : 55 },
          moisture: { max: item === "corn" ? 40 : 50 },
          purity: { min: item === "corn" ? 80 : 76 },
        })
      : spec({
          sugar: { min: item === "corn" ? 32 : 38 },
          moisture: { max: item === "corn" ? 52 : 60 },
        }),
    deadline: hour + 48,
    status: "open",
  };
}
