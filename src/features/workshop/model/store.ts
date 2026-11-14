import { reactive, readonly } from "vue";
import type {
  Inspection,
  Job,
  Item,
  Notice,
  OriginShare,
  Quality,
  Receipt,
  ReserveResult,
} from "../../../shared/contracts";
import { blendLabel, processQuality, recipeById } from "../lib/recipes";
import { itemName, items } from "../../../shared/catalog";
import { queueFinish } from "../lib/schedule";
import { qualitySummary } from "../../../shared/quality";
interface Ports {
  reserve: (
    owner: string,
    item: Item,
    n: number,
    spec?: Inspection,
  ) => ReserveResult;
  consume: (id: string) => Receipt | null;
  release: (id: string) => void;
  /** 预留的只读预览，用于开工前判断这批原料能否按工艺加工。 */
  peek: (id: string) => Receipt | null;
  add: (
    item: Item,
    n: number,
    quality: Quality,
    hour?: number,
    source?: string,
    options?: {
      derivedFrom?: readonly string[];
      note?: string;
      shares?: OriginShare[];
    },
  ) => unknown;
  spend: (n: number) => boolean;
}
export function createWorkshop(ports: Ports, notice: Notice) {
  const state = reactive({
    jobs: [] as Job[],
    serial: 0,
    /** 最近一次无法开工的原因（原料不足、纯净度不达标等）。 */
    lastError: "",
  });
  return {
    state: readonly(state),
    enqueue(recipe: string, hour: number) {
      const r = recipeById(recipe);
      if (!r || state.jobs.filter((j) => j.status === "queued").length >= 4) {
        notice("加工队列已满");
        return;
      }
      const reservation = ports.reserve("workshop", r.input, r.amount);
      if (!reservation.ok) {
        state.lastError = reservation.error;
        notice(`加工原料不足：${reservation.error}`);
        return;
      }
      /** 开工前先按配方试算：纯净度达不到工序下限就不锁料，免得白丢原料。 */
      const preview = ports.peek(reservation.id);
      if (preview) {
        const trial = processQuality(
          r,
          preview.shares.map((s) => ({
            quality: s.certificate.quality,
            quantity: s.quantity,
          })),
        );
        if (!trial.ok) {
          ports.release(reservation.id);
          state.lastError = trial.error;
          notice(`暂不能加工：${trial.error}`);
          return;
        }
      }
      if (!ports.spend(r.cost)) {
        ports.release(reservation.id);
        notice("加工费不足");
        return;
      }
      state.lastError = "";
      state.jobs.push({
        id: `j${++state.serial}`,
        recipe,
        reservation: reservation.id,
        finish: queueFinish(state.jobs, hour, r.duration),
        status: "queued",
      });
      notice("原料已锁定，加入加工队列");
    },
    tick(hour: number) {
      for (const job of state.jobs)
        if (job.status === "queued" && job.finish <= hour) {
          const preview = ports.peek(job.reservation);
          if (!preview) {
            ports.release(job.reservation);
            job.status = "failed";
            notice("原料已过期，本批加工终止");
            continue;
          }
          const r = recipeById(job.recipe)!;
          /** 完成前按当前原料再试算一次，避免先扣料再发现工艺不合格。 */
          const trial = processQuality(
            r,
            preview.shares.map((s) => ({
              quality: s.certificate.quality,
              quantity: s.quantity,
            })),
          );
          if (!trial.ok) {
            ports.release(job.reservation);
            job.status = "failed";
            notice(`加工失败：${trial.error}`);
            continue;
          }
          const receipt = ports.consume(job.reservation);
          if (!receipt) {
            job.status = "failed";
            notice("原料已过期，本批加工终止");
            continue;
          }
          job.receipt = receipt;
          const result = processQuality(
            r,
            receipt.shares.map((s) => ({
              quality: s.certificate.quality,
              quantity: s.quantity,
            })),
          );
          if (!result.ok) {
            job.status = "failed";
            notice(`加工失败：${result.error}`);
            continue;
          }
          job.output = result.quality;
          job.status = "ready";
        }
    },
    claim(id: string, hour: number) {
      const job = state.jobs.find((j) => j.id === id),
        r = job && recipeById(job.recipe);
      if (!job || job.status !== "ready" || !r) return;
      if (!job.receipt || !job.output) return;
      if (job.finish + items[r.output].life <= hour) {
        job.status = "failed";
        notice("成品存放过久，已变质");
        return;
      }
      /** 每个原料份额的来源原样带到成品证书，方便逐份追溯。 */
      const sources: OriginShare[] = [];
      for (const share of job.receipt.shares)
        for (const origin of share.certificate.shares)
          sources.push({
            source: `${origin.source} · ${share.certificate.id}`,
            quantity: origin.quantity,
            batch: share.batch,
          });
      const result = ports.add(
        r.output,
        r.quantity,
        job.output,
        hour,
        `工坊${job.id} · ${blendLabel[r.blend]}`,
        {
          derivedFrom: job.receipt.shares.map((s) => s.certificate.id),
          note: `${r.name}：${qualitySummary(job.output)}`,
          shares: sources,
        },
      );
      if (!result) {
        notice("成品入库失败");
        return;
      }
      job.status = "claimed";
      notice(`成品已入仓：${itemName(r.output)} ×${r.quantity}`);
    },
    snapshot: () => JSON.parse(JSON.stringify(state)) as typeof state,
    restore: (data: typeof state) => {
      Object.assign(state, data);
    },
  };
}
export type Workshop = ReturnType<typeof createWorkshop>;
