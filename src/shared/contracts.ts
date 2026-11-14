export type Item = "carrot" | "corn" | "berry" | "jam" | "flour";
export type Weather = "sun" | "rain" | "wind";

/** 三项可检验品质：糖度、水分、纯净度，取值 0–100。 */
export type Metric = "sugar" | "moisture" | "purity";
export interface QualityReading {
  sugar: number;
  moisture: number;
  purity: number;
}
/** 旧星级存档迁移后只有区间，不能当作实测值。 */
export type QualityInterval = Record<Metric, readonly [number, number]>;
export type Quality =
  | { kind: "measured"; values: QualityReading; note?: string }
  | {
      kind: "legacy";
      interval: QualityInterval;
      stars: number;
      note?: string;
    };

/** 订单要求的检验区间（闭区间）。 */
export interface QualityRange {
  min: number;
  max: number;
}
export type Inspection = Partial<Record<Metric, QualityRange>>;

/** 证书上的来源份额：那批货实际来自哪里、有多少。 */
export interface OriginShare {
  source: string;
  quantity: number;
  batch?: string;
}
export interface Certificate {
  id: string;
  item: Item;
  quality: Quality;
  /** 来源份额之和必须等于这张证书当前对应的真实数量。 */
  shares: readonly OriginShare[];
  /** 加工成品的输入证书 id，用于追溯推导链。 */
  derivedFrom?: readonly string[];
  issued: number;
  note?: string;
}
export interface Crop {
  item: Item;
  planted: number;
  growth: number;
  water: number;
  stress: number;
  harvests: number;
  /** 本茬作物累积的糖度 / 水分 / 纯净度，收获时才成为检验值。 */
  quality: QualityReading;
}
export interface Plot {
  id: number;
  crop: Crop | null;
}
export interface Batch {
  id: string;
  item: Item;
  quantity: number;
  expires: number;
  certificateId: string;
}
export interface Allocation {
  batch: string;
  quantity: number;
}
export interface Reservation {
  id: string;
  owner: string;
  allocations: Allocation[];
  /** 备货时锁定的检验要求，交付时再次核对。 */
  spec?: Inspection;
}
/** 一次领料中，从某一批真实拆出的部分及其证书快照。 */
export interface ReceiptShare {
  batch: string;
  quantity: number;
  certificate: Certificate;
}
export interface Receipt {
  quantity: number;
  /** 本次领料按数量加权的综合品质。 */
  quality: Quality;
  shares: readonly ReceiptShare[];
}
export interface Job {
  id: string;
  recipe: string;
  reservation: string;
  receipt?: Receipt;
  /** 加工完成时按配方规则由原料推出的成品品质。 */
  output?: Quality;
  finish: number;
  status: "queued" | "ready" | "claimed" | "failed";
}
export interface Order {
  id: string;
  item: Item;
  quantity: number;
  reward: number;
  rewardXp: number;
  spec: Inspection;
  deadline: number;
  status: "open" | "reserved" | "delivered" | "expired";
  reservation?: string;
  /** 最近一次备货 / 交付被拒的检验原因。 */
  reject?: string;
}
export interface Tick {
  from: number;
  to: number;
  weather: Weather;
}
export interface ReserveFailure {
  ok: false;
  error: string;
}
export interface ReserveSuccess {
  ok: true;
  id: string;
  allocations: readonly Allocation[];
}
export type ReserveResult = ReserveSuccess | ReserveFailure;
export type Notice = (message: string) => void;
