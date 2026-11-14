import { ref } from "vue";
import { createClock, createEngine } from "../features/clock";
import { createFields } from "../features/fields";
import { createWarehouse } from "../features/warehouse";
import { createWorkshop } from "../features/workshop";
import { createOrders, salePrice } from "../features/orders";
import { items } from "../shared/catalog";
import { measuredQuality } from "../shared/quality";
import { saveFarm, loadFarm } from "./persistence";
import { migrateSnapshot } from "./migration";
export function createWorkspace() {
  const notices = ref<string[]>(["欢迎回到青禾农场。先备一份胡萝卜订单吧。"]);
  const notice = (message: string) => {
    notices.value = [message, ...notices.value].slice(0, 12);
  };
  const clock = createClock();
  const warehouse = createWarehouse(() => clock.state.hour, notice);
  const orders = createOrders(warehouse, notice, clock.state.hour);
  const fields = createFields(
    orders.spend,
    (item, n, quality, source) =>
      warehouse.add(item, n, measuredQuality(quality), clock.state.hour, source),
    notice,
  );
  const workshop = createWorkshop(
    { ...warehouse, spend: orders.spend },
    notice,
  );
  const engine = createEngine(
    () => clock.state.hour,
    clock.setHour,
    (t) => {
      const dropped = warehouse.tick(t.to);
      for (const reservation of dropped)
        orders.onReservationLost(reservation.id);
      fields.tick(t);
      workshop.tick(t.to);
      orders.tick(t.to);
    },
  );
  const snapshot = () => ({
    clock: clock.snapshot(),
    warehouse: warehouse.snapshot(),
    fields: fields.snapshot(),
    workshop: workshop.snapshot(),
    orders: orders.snapshot(),
  });
  return {
    clock,
    warehouse,
    fields,
    workshop,
    orders,
    engine,
    notices,
    sell(id: string) {
      const item = warehouse.sell(id, 1);
      if (item) {
        orders.earn(salePrice(items[item].value));
        notice(`出售${items[item].name} 1 份`);
      }
    },
    save() {
      try {
        saveFarm(snapshot());
        notice("已保存到本机");
      } catch {
        notice("保存失败，本机空间不足");
      }
    },
    load() {
      try {
        const stored = loadFarm<ReturnType<typeof snapshot>>();
        if (!stored) {
          notice("还没有本机存档");
          return;
        }
        const migrated = migrateSnapshot(stored.data);
        clock.restore(migrated.clock);
        warehouse.restore(migrated.warehouse);
        fields.restore(migrated.fields);
        workshop.restore(migrated.workshop);
        orders.restore(migrated.orders);
        notice(
          migrated.migrated
            ? "已恢复存档，旧星级批次已迁移为未检验区间"
            : "已恢复保存时刻",
        );
      } catch {
        notice("存档损坏，无法恢复");
      }
    },
  };
}
