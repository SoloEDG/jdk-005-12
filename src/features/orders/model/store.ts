import { reactive, readonly } from "vue";
import type {
  Item,
  Order,
  Notice,
  Receipt,
  Inspection,
  ReserveResult,
} from "../../../shared/contracts";
import { initialOrders, nextOrder } from "../lib/offers";
import { inspectionFailure } from "../../../shared/quality";
interface Ports {
  reserve: (
    owner: string,
    item: Item,
    n: number,
    spec?: Inspection,
  ) => ReserveResult;
  consume: (id: string) => Receipt | null;
  release: (id: string) => void;
  peek: (id: string) => Receipt | null;
}
export function createOrders(ports: Ports, notice: Notice, hour: number) {
  const state = reactive({
    coins: 180,
    xp: 0,
    delivered: 0,
    serial: 3,
    orders: initialOrders(hour),
  });
  const spend = (n: number) => {
    if (n < 0 || state.coins < n) return false;
    state.coins -= n;
    return true;
  };
  return {
    state: readonly(state),
    spend,
    earn: (n: number) => {
      state.coins += n;
    },
    reserve(id: string) {
      const o = state.orders.find((o) => o.id === id);
      if (!o || o.status !== "open") return;
      const result = ports.reserve(`order:${id}`, o.item, o.quantity, o.spec);
      if (!result.ok) {
        o.reject = result.error;
        notice(`备货失败：${result.error}`);
        return;
      }
      delete o.reject;
      o.reservation = result.id;
      o.status = "reserved";
      /** 备货后立刻展示这批货的三项实测指标与来源，交付前可复核。 */
      const preview = ports.peek(result.id);
      if (preview) {
        const failure = inspectionFailure(preview.quality, o.spec);
        if (failure) o.reject = failure;
      }
      notice("订单已备货，库存已按检验要求占用");
    },
    deliver(id: string, hour: number) {
      const o = state.orders.find((o) => o.id === id);
      if (!o || o.status !== "reserved" || !o.reservation) return;
      /** 先复检、后扣货：不合格时原样释放，绝不让货物凭空消失。 */
      const preview = ports.peek(o.reservation);
      if (!preview) {
        ports.release(o.reservation);
        o.status = "open";
        o.reject = "货物已失效（过期或数量变化），请重新备货";
        delete o.reservation;
        notice("货物已失效，无法交付");
        return;
      }
      const failure = inspectionFailure(preview.quality, o.spec);
      if (failure) {
        o.reject = failure;
        o.status = "open";
        ports.release(o.reservation);
        delete o.reservation;
        notice(`交付不合格：${failure}`);
        return;
      }
      /**
       * 预览与消耗用的是同一批证书与同一套加权规则，复检已在扣货前完成，
       * 因此这里只做一次防御性断言：不一致说明库存被并发改动，不再扣货。
       */
      const receipt = ports.consume(o.reservation);
      if (!receipt || inspectionFailure(receipt.quality, o.spec)) {
        ports.release(o.reservation);
        o.status = "open";
        o.reject = "货物已失效（过期或数量变化），请重新备货";
        delete o.reservation;
        notice("货物已失效，无法交付");
        return;
      }
      delete o.reject;
      o.status = "delivered";
      state.coins += o.reward;
      state.xp += o.rewardXp;
      state.delivered++;
      state.orders.push(nextOrder(++state.serial, hour));
      notice(`交付成功，收入 ¥${o.reward} / +${o.rewardXp} 经验`);
    },
    cancel(id: string) {
      const o = state.orders.find((o) => o.id === id);
      if (o?.status === "reserved" && o.reservation) {
        ports.release(o.reservation);
        o.status = "open";
        delete o.reservation;
      }
    },
    /** 备货后、交付前可查看这批货的真实证书与来源。 */
    preview(orderId: string): Receipt | null {
      const o = state.orders.find((o) => o.id === orderId);
      if (!o || o.status !== "reserved" || !o.reservation) return null;
      return ports.peek(o.reservation);
    },
    /** 库存过期导致预留被仓库取消时，把对应订单退回待备货并说明原因。 */
    onReservationLost(reservation: string) {
      const o = state.orders.find((o) => o.reservation === reservation);
      if (!o) return;
      o.status = "open";
      delete o.reservation;
      o.reject = "备货中有批次已过期，数量不足，请重新备货";
      notice(`${o.id} 的备货已因库存过期释放`);
    },
    tick(hour: number) {
      for (const o of state.orders)
        if (
          (o.status === "open" || o.status === "reserved") &&
          o.deadline <= hour
        ) {
          if (o.reservation) ports.release(o.reservation);
          o.status = "expired";
        }
    },
    snapshot: () => JSON.parse(JSON.stringify(state)) as typeof state,
    restore: (data: typeof state) => {
      Object.assign(state, data);
    },
  };
}
