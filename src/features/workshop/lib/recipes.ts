import type { Item, Quality } from "../../../shared/contracts";
import {
  combineQualities,
  roundMetric,
  clampMetric,
  fmt,
} from "../../../shared/quality";

/** 混料加权方式：按真实数量加权，或每份原料等权。 */
export type Blend = "quantity" | "equal";

export interface Recipe {
  id: string;
  name: string;
  input: Item;
  amount: number;
  output: Item;
  quantity: number;
  duration: number;
  cost: number;
  /** 混料时各原料的加权方式。 */
  blend: Blend;
  /** 加工失水：水分按百分比下降，糖度相应浓缩。 */
  dehydration: number;
  /** 成品纯净度上限：超过则被过滤提纯到此值，过低则整批不合格。 */
  purityCap: number;
  /** 纯净度低于此值视为加工失败（原料污染无法挽回）。 */
  purityFloor: number;
}

export const recipes: Recipe[] = [
  {
    id: "jam",
    name: "莓果酱",
    input: "berry",
    amount: 3,
    output: "jam",
    quantity: 2,
    duration: 8,
    cost: 4,
    blend: "quantity",
    /** 熬煮浓缩：失水较多，糖度上升、水分显著下降。 */
    dehydration: 70,
    purityCap: 92,
    purityFloor: 35,
  },
  {
    id: "flour",
    name: "玉米粉",
    input: "corn",
    amount: 4,
    output: "flour",
    quantity: 3,
    duration: 6,
    cost: 3,
    blend: "equal",
    dehydration: 52,
    purityCap: 96,
    purityFloor: 30,
  },
];
export const recipeById = (id: string) => recipes.find((r) => r.id === id);

export interface ProcessResult {
  ok: true;
  quality: Quality;
  note: string;
}
export interface ProcessFailure {
  ok: false;
  error: string;
}

/**
 * 按配方分别处理混料、失水与纯净度上限。
 * 旧档区间可以参与推导，但结果只能以区间呈现，不能伪造实测值。
 */
export function processQuality(
  recipe: Recipe,
  inputs: readonly { quality: Quality; quantity: number }[],
): ProcessResult | ProcessFailure {
  if (!inputs.length) return { ok: false, error: "没有可用的原料证书" };
  const blend = recipe.blend;
  const blended = combineQualities(inputs, blend);
  const base =
    blended.kind === "measured"
      ? { ...blended.values }
      : {
          sugar: (blended.interval.sugar[0] + blended.interval.sugar[1]) / 2,
          moisture:
            (blended.interval.moisture[0] + blended.interval.moisture[1]) / 2,
          purity:
            (blended.interval.purity[0] + blended.interval.purity[1]) / 2,
        };

  /**
   * 纯净度过低：整批原料被污染，不能靠失水“洗白”。
   * 旧档只知区间，只有区间上限都不达标才判失败，否则以区间如实产出。
   */
  const purityCeiling =
    blended.kind === "measured"
      ? blended.values.purity
      : blended.interval.purity[1];
  if (purityCeiling < recipe.purityFloor)
    return {
      ok: false,
      error:
        blended.kind === "measured"
          ? `原料纯净度 ${roundMetric(base.purity)}% 低于工艺下限 ${recipe.purityFloor}%，整批无法加工`
          : `旧档原料纯净度上限 ${fmt(blended.interval.purity[1])}% 仍低于工艺下限 ${recipe.purityFloor}%，整批无法加工`,
    };

  /**
   * 按质量守衡失水：水分按占总质量的比例下降，干物质不变，
   * 因此糖度只按剩余质量的比例浓缩，而不是简单除以新水分。
   */
  const waterLost = (base.moisture / 100) * (recipe.dehydration / 100);
  const massLeft = Math.max(0.05, 1 - waterLost);
  const moisture = clampMetric(
    ((base.moisture / 100) * (1 - recipe.dehydration / 100) * 100) / massLeft,
  );
  const concentration = 1 / massLeft;
  const sugar = clampMetric(base.sugar * concentration);
  const purity = Math.min(base.purity, recipe.purityCap);

  const values = {
    sugar: roundMetric(sugar),
    moisture: roundMetric(moisture),
    purity: roundMetric(purity),
  };
  const notes: string[] = [
    `混料${blend === "quantity" ? "按数量加权" : "按每份等权"}`,
    `失水 ${recipe.dehydration}%`,
  ];
  if (base.purity > recipe.purityCap)
    notes.push(`纯净度 ${roundMetric(base.purity)}% 已按工序上限提纯至 ${recipe.purityCap}%`);
  else notes.push(`纯净度 ${recipe.purityCap}% 上限内保留`);

  if (blended.kind === "legacy")
    return {
      ok: true,
      quality: {
        kind: "legacy",
        interval: {
          sugar: [
            roundMetric(blended.interval.sugar[0] * concentration),
            roundMetric(blended.interval.sugar[1] * concentration),
          ],
          moisture: [
            roundMetric(
              (blended.interval.moisture[0] * (1 - recipe.dehydration / 100)) /
                massLeft,
            ),
            roundMetric(
              (blended.interval.moisture[1] * (1 - recipe.dehydration / 100)) /
                massLeft,
            ),
          ],
          purity: [
            roundMetric(Math.min(blended.interval.purity[0], recipe.purityCap)),
            roundMetric(Math.min(blended.interval.purity[1], recipe.purityCap)),
          ],
        },
        stars: blended.stars,
        note: `${notes.join(" · ")} · 由旧档区间推导`,
      },
      note: `${notes.join(" · ")}（旧档区间推导）`,
    };

  return {
    ok: true,
    quality: { kind: "measured", values, note: notes.join(" · ") },
    note: notes.join(" · "),
  };
}

export const blendLabel: Record<Blend, string> = {
  quantity: "按数量加权",
  equal: "每份等权",
};
