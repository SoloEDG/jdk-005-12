import { reactive, readonly } from "vue";
import type {
  Item,
  Plot,
  Tick,
  Notice,
  QualityReading,
} from "../../../shared/contracts";
import { crops, grow, ready, startingQuality } from "../lib/crops";
export function createFields(
  spend: (amount: number) => boolean,
  harvest: (
    item: Item,
    n: number,
    quality: QualityReading,
    source: string,
  ) => void,
  notice: Notice,
) {
  const state = reactive({
    plots: Array.from({ length: 12 }, (_, id): Plot => ({ id, crop: null })),
    selected: "carrot" as Item,
  });
  return {
    state: readonly(state),
    select: (item: Item) => {
      state.selected = item;
    },
    plant(id: number, hour: number) {
      const plot = state.plots[id],
        seed = crops[state.selected];
      if (!plot || plot.crop || !seed) return;
      if (!spend(seed.cost)) {
        notice("资金不足，交付订单或出售库存后再试");
        return;
      }
      plot.crop = {
        item: state.selected,
        planted: hour,
        growth: 0,
        water: 70,
        stress: 0,
        harvests: 0,
        quality: startingQuality(state.selected),
      };
      notice("种下了新的希望");
    },
    water(id: number) {
      const c = state.plots[id]?.crop;
      if (c) c.water = 100;
    },
    harvest(id: number) {
      const plot = state.plots[id],
        crop = plot?.crop;
      if (!crop || !ready(crop)) return;
      const def = crops[crop.item]!;
      harvest(
        crop.item,
        def.yield,
        crop.quality,
        `土地${id + 1} · 第${crop.planted}时播种` +
          (crop.harvests ? ` · 第${crop.harvests + 1}茬` : ""),
      );
      if (crop.harvests < def.repeat) {
        /** 再生茬沿用当前三项数值继续累积，新一茬重新从幼苗阶段计时。 */
        crop.growth = 0;
        crop.harvests++;
      } else plot.crop = null;
      notice("收获已按实际检验数值入仓");
    },
    tick(tick: Tick) {
      for (const plot of state.plots)
        if (plot.crop)
          plot.crop = grow(plot.crop, tick.weather, tick.to - tick.from);
    },
    snapshot: () => JSON.parse(JSON.stringify(state)) as typeof state,
    restore: (data: typeof state) => {
      Object.assign(state, data);
    },
  };
}
