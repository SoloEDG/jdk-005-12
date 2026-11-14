<script setup lang="ts">
import type { Order, Receipt } from "../../../shared/contracts";
import { items } from "../../../shared/catalog";
import { describeInspection, qualitySummary } from "../../../shared/quality";
defineProps<{
  orders: readonly Readonly<Order>[];
  hour: number;
  preview: (id: string) => Receipt | null;
}>();
defineEmits<{
  reserve: [id: string];
  deliver: [id: string];
  cancel: [id: string];
}>();
const statusName = {
  open: "待备货",
  reserved: "已备货",
  delivered: "已交付",
  expired: "已过期",
};
</script>
<template>
  <section class="panel orders-panel">
    <div class="panel-heading">
      <h2>村庄订单</h2>
      <span>按检验区间收货，不合格会说明原因</span>
    </div>
    <article
      v-for="order in orders"
      :key="order.id"
      class="order-card"
      :class="order.status"
    >
      <div class="order-icon">{{ items[order.item].icon }}</div>
      <div class="order-info">
        <strong>{{ items[order.item].name }} ×{{ order.quantity }}</strong>
        <small class="spec-line">要求 {{ describeInspection(order.spec) }}</small>
        <small
          >{{ order.id }} · {{ statusName[order.status] }} ·
          {{ Math.max(0, order.deadline - hour) }}h</small
        >
        <small v-if="order.reject" class="reject-line">不合格：{{ order.reject }}</small>
        <div
          v-if="order.status === 'reserved' && preview(order.id)"
          class="order-preview"
        >
          <span>已锁定：{{ qualitySummary(preview(order.id)!.quality) }}</span>
          <small
            >来源 {{
              preview(order.id)!
                .shares.map((s) => `${s.certificate.id} ×${s.quantity}`)
                .join("、")
            }}</small
          >
          <small>{{
            preview(order.id)!
              .shares.flatMap((s) => s.certificate.shares)
              .map((s) => `${s.source} ×${s.quantity}`)
              .join(" / ")
          }}</small>
        </div>
      </div>
      <b class="reward">¥{{ order.reward }}</b>
      <div class="order-actions">
        <button
          v-if="order.status === 'open'"
          @click="$emit('reserve', order.id)"
        >
          备货</button
        ><template v-if="order.status === 'reserved'"
          ><button class="primary" @click="$emit('deliver', order.id)">
            交付</button
          ><button @click="$emit('cancel', order.id)">取消</button></template
        >
      </div>
    </article>
  </section>
</template>
