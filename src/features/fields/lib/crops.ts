import type { Item, Weather, Crop, QualityReading } from "../../../shared/contracts";
import { baseReading, clampMetric } from "../../../shared/quality";
export const crops: Partial<
  Record<
    Item,
    { cost: number; duration: number; yield: number; repeat: number }
  >
> = {
  carrot: { cost: 5, duration: 12, yield: 3, repeat: 0 },
  corn: { cost: 9, duration: 18, yield: 4, repeat: 1 },
  berry: { cost: 12, duration: 24, yield: 3, repeat: 2 },
};

/** 各阶段对糖分 / 水分 / 纯净度的权重：阳光越多糖度越高，水分随雨上升、随日晒下降。 */
const stageWeights = [
  // 幼苗：水分与纯净度适应期
  { sugar: 0.5, moisture: 1, purity: 0.8 },
  // 生长：决定糖分积累的主体阶段
  { sugar: 1.3, moisture: 1.1, purity: 1 },
  // 成熟：日晒显著提糖降水分，但缺水与大风会损害纯净度
  { sugar: 1.8, moisture: 1, purity: 1.2 },
];

export const stageOf = (crop: Crop) => {
  const duration = crops[crop.item]!.duration;
  const progress = Math.min(0.999, crop.growth / duration);
  return Math.min(2, Math.floor(progress * 3));
};

/**
 * 依据逐小时实际天气与缺水经历推进三项品质。
 * 缺水既降低糖分积累又拖累纯净度（胁迫、裂果），雨天抬升水分。
 */
export function qualityFor(
  crop: Crop,
  weather: Weather,
  hours: number,
  water = crop.water,
): QualityReading {
  const stage = stageOf(crop);
  const weights = stageWeights[stage]!;
  const base = crop.quality;
  /** 用这一小时结束时的水分判断缺水，避免整点上的偏差。 */
  const dry = water <= 0;
  const damp = water < 25;
  let sugar = base.sugar;
  let moisture = base.moisture;
  let purity = base.purity;

  if (weather === "sun") {
    sugar += hours * 1.3 * weights.sugar;
    moisture -= hours * 1.1 * weights.moisture;
    purity += hours * 0.2 * weights.purity;
  } else if (weather === "rain") {
    sugar -= hours * 0.45 * weights.sugar;
    moisture += hours * 1.5 * weights.moisture;
    purity += hours * 0.15 * weights.purity;
  } else {
    sugar += hours * 0.4 * weights.sugar;
    moisture -= hours * 0.6 * weights.moisture;
    purity -= hours * 0.6 * weights.purity;
  }

  if (dry) {
    sugar -= hours * 1.6;
    purity -= hours * 1.8;
  } else if (damp) {
    sugar -= hours * 0.6;
    purity -= hours * 0.5;
  }

  return {
    sugar: clampMetric(sugar),
    moisture: clampMetric(moisture),
    purity: clampMetric(purity),
  };
}

export function grow(crop: Crop, weather: Weather, hours: number) {
  const water = Math.max(
    0,
    Math.min(100, crop.water + (weather === "rain" ? 15 : -8) * hours),
  );
  const rate = water > 0 ? (weather === "wind" ? 0.6 : 1) : 0.15;
  return {
    ...crop,
    water,
    stress: crop.stress + (water === 0 ? hours : 0),
    growth: crop.growth + hours * rate,
    quality: qualityFor(crop, weather, hours, water),
  };
}
export function ready(crop: Crop) {
  return crop.growth >= (crops[crop.item]?.duration ?? Infinity);
}
export const startingQuality = (item: Item): QualityReading => ({
  ...baseReading[item],
});
