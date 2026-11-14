import type {
  Item,
  Metric,
  Quality,
  QualityInterval,
  QualityRange,
  QualityReading,
  Inspection,
} from "./contracts";

export const metrics: readonly Metric[] = ["sugar", "moisture", "purity"];

export const metricInfo: Record<
  Metric,
  { name: string; unit: string; short: string; better: "high" | "low" }
> = {
  sugar: { name: "糖度", unit: "°Bx", short: "糖", better: "high" },
  moisture: { name: "水分", unit: "%", short: "水", better: "low" },
  purity: { name: "纯净度", unit: "%", short: "净", better: "high" },
};

/** 旧星级没有实测数据，只能给出明确的默认区间。 */
export const starIntervals: Record<number, QualityInterval> = {
  1: {
    sugar: [15, 45],
    moisture: [45, 85],
    purity: [30, 70],
  },
  2: {
    sugar: [40, 70],
    moisture: [30, 65],
    purity: [55, 90],
  },
  3: {
    sugar: [65, 95],
    moisture: [15, 45],
    purity: [80, 100],
  },
};

export const clampMetric = (n: number) =>
  Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));

export const roundMetric = (n: number) => Math.round(clampMetric(n));

export const clampStars = (stars: number) =>
  Math.max(1, Math.min(3, Math.round(stars || 1)));

export const baseReading: Record<Item, QualityReading> = {
  carrot: { sugar: 30, moisture: 68, purity: 78 },
  corn: { sugar: 34, moisture: 55, purity: 80 },
  berry: { sugar: 38, moisture: 62, purity: 74 },
  jam: { sugar: 52, moisture: 45, purity: 78 },
  flour: { sugar: 30, moisture: 32, purity: 76 },
};

export const measuredQuality = (values: QualityReading): Quality => ({
  kind: "measured",
  values: {
    sugar: roundMetric(values.sugar),
    moisture: roundMetric(values.moisture),
    purity: roundMetric(values.purity),
  },
});

export const legacyQuality = (stars: number, note?: string): Quality => ({
  kind: "legacy",
  interval: starIntervals[clampStars(stars)]!,
  stars: clampStars(stars),
  ...(note ? { note } : {}),
});

/** 订单的“2★起”等旧要求迁移为三项指标上的保守区间。 */
export function legacyInspection(stars: number): Inspection {
  const band = starIntervals[clampStars(stars)]!;
  return {
    sugar: { min: band.sugar[0], max: 100 },
    moisture: { min: 0, max: band.moisture[1] },
    purity: { min: band.purity[0], max: 100 },
  };
}

export function qualityInterval(quality: Quality): QualityInterval {
  if (quality.kind === "measured")
    return {
      sugar: [quality.values.sugar, quality.values.sugar],
      moisture: [quality.values.moisture, quality.values.moisture],
      purity: [quality.values.purity, quality.values.purity],
    };
  return quality.interval;
}

export const midQuality = (quality: Quality): QualityReading => {
  const interval = qualityInterval(quality);
  return {
    sugar: (interval.sugar[0] + interval.sugar[1]) / 2,
    moisture: (interval.moisture[0] + interval.moisture[1]) / 2,
    purity: (interval.purity[0] + interval.purity[1]) / 2,
  };
};

export const fmt = (n: number) =>
  Number.isInteger(n) ? String(n) : n.toFixed(1);

export function metricText(quality: Quality, metric: Metric) {
  const info = metricInfo[metric];
  if (quality.kind === "measured")
    return `${info.name} ${fmt(quality.values[metric])}${info.unit}`;
  const [lo, hi] = quality.interval[metric];
  return `${info.name} ${fmt(lo)}–${fmt(hi)}${info.unit}`;
}

export function qualitySummary(quality: Quality) {
  if (quality.kind === "legacy")
    return `旧档 ${quality.stars}★ · ${metrics.map((m) => metricText(quality, m)).join(" · ")}`;
  return metrics.map((m) => metricText(quality, m)).join(" · ");
}

/** 用于排序 / 展示的综合分，仅作参考，不替代三项检验。 */
export function qualityScore(quality: Quality) {
  const values = midQuality(quality);
  return Math.round((values.sugar + (100 - values.moisture) + values.purity) / 3);
}

export function describeRange(metric: Metric, range: QualityRange) {
  const info = metricInfo[metric];
  if (range.min > 0 && range.max < 100)
    return `${info.name} ${fmt(range.min)}–${fmt(range.max)}${info.unit}`;
  if (range.min > 0)
    return `${info.name} ≥ ${fmt(range.min)}${info.unit}`;
  if (range.max < 100)
    return `${info.name} ≤ ${fmt(range.max)}${info.unit}`;
  return `${info.name} 不限`;
}

export function describeInspection(spec: Inspection) {
  const parts = metrics
    .filter((metric) => spec[metric])
    .map((metric) => describeRange(metric, spec[metric]!));
  return parts.length ? parts.join(" · ") : "无品质要求";
}

/** 返回不合格原因；null 表示符合要求。旧档区间必须整体落在要求内。 */
export function inspectionFailure(
  quality: Quality,
  spec: Inspection,
): string | null {
  const interval = qualityInterval(quality);
  const problems: string[] = [];
  for (const metric of metrics) {
    const range = spec[metric];
    if (!range) continue;
    const [lo, hi] = interval[metric];
    const info = metricInfo[metric];
    if (quality.kind === "measured") {
      if (lo < range.min)
        problems.push(
          `${info.name} ${fmt(lo)}${info.unit} 低于要求 ≥${fmt(range.min)}${info.unit}`,
        );
      else if (hi > range.max)
        problems.push(
          `${info.name} ${fmt(hi)}${info.unit} 超出上限 ≤${fmt(range.max)}${info.unit}`,
        );
      continue;
    }
    if (hi < range.min) {
      problems.push(
        `${info.name}旧档区间上限 ${fmt(hi)}${info.unit} 低于要求 ≥${fmt(range.min)}${info.unit}`,
      );
    } else if (lo > range.max) {
      problems.push(
        `${info.name}旧档区间下限 ${fmt(lo)}${info.unit} 高于要求 ≤${fmt(range.max)}${info.unit}`,
      );
    } else if (lo < range.min || hi > range.max) {
      problems.push(
        `${info.name}旧档区间 ${fmt(lo)}–${fmt(hi)}${info.unit} 无法确认符合 ${fmt(Math.max(0, range.min))}–${fmt(range.max)}${info.unit}`,
      );
    }
  }
  return problems.length ? problems.join("；") : null;
}

export function passesInspection(quality: Quality, spec?: Inspection) {
  return !spec || inspectionFailure(quality, spec) === null;
}

/**
 * 按数量或等权合并多份品质。
 * 旧档参与合并时只能得到区间推导结果，不能冒充实测。
 */
export function combineQualities(
  parts: readonly { quality: Quality; quantity: number }[],
  blend: "quantity" | "equal" = "quantity",
): Quality {
  if (!parts.length)
    return measuredQuality({ sugar: 0, moisture: 0, purity: 0 });
  const hasLegacy = parts.some((p) => p.quality.kind === "legacy");
  const weights = parts.map((p) =>
    blend === "equal" ? 1 : Math.max(0, p.quantity),
  );
  const total = weights.reduce((n, w) => n + w, 0) || 1;
  const result: Record<Metric, [number, number]> = {
    sugar: [0, 0],
    moisture: [0, 0],
    purity: [0, 0],
  };
  for (const metric of metrics) {
    let lo = 0;
    let hi = 0;
    parts.forEach((part, i) => {
      const [a, b] = qualityInterval(part.quality)[metric];
      lo += a * weights[i]!;
      hi += b * weights[i]!;
    });
    result[metric] = [clampMetric(lo / total), clampMetric(hi / total)];
  }
  if (!hasLegacy)
    return measuredQuality({
      sugar: result.sugar[0],
      moisture: result.moisture[0],
      purity: result.purity[0],
    });
  return {
    kind: "legacy",
    interval: {
      sugar: [roundMetric(result.sugar[0]), roundMetric(result.sugar[1])],
      moisture: [roundMetric(result.moisture[0]), roundMetric(result.moisture[1])],
      purity: [roundMetric(result.purity[0]), roundMetric(result.purity[1])],
    },
    stars: Math.min(
      ...parts
        .filter((p) => p.quality.kind === "legacy")
        .map((p) => (p.quality as Extract<Quality, { kind: "legacy" }>).stars),
    ),
    note: "由旧档区间合并推导，未重新检验",
  };
}
