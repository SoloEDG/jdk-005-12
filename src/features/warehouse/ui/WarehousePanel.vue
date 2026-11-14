<script setup lang="ts">
import type { Batch, Certificate, OriginShare } from "../../../shared/contracts";
import { items } from "../../../shared/catalog";
import QualityTag from "../../../shared/ui/QualityTag.vue";
defineProps<{
  batches: readonly Readonly<Batch>[];
  certificates: Readonly<Record<string, Certificate>>;
  hour: number;
  free: (id: string) => number;
  sharesOf: (id: string) => readonly OriginShare[];
  wasted: number;
}>();
defineEmits<{ sell: [id: string]; inspect: [id: string] }>();
</script>
<template>
  <section class="panel warehouse-panel">
    <div class="panel-heading">
      <h2>谷仓库存</h2>
      <span>{{ batches.length }} 批 · 损耗 {{ wasted }}</span>
    </div>
    <div class="inventory-list">
      <div
        v-for="batch in batches"
        :key="batch.id"
        class="inventory-row"
        @click="$emit('inspect', batch.id)"
      >
        <b class="item-icon">{{ items[batch.item].icon }}</b>
        <div>
          <strong>{{ items[batch.item].name }}</strong>
          <QualityTag
            v-if="certificates[batch.certificateId]"
            :quality="certificates[batch.certificateId]!.quality"
            compact
          />
          <small
            >{{ batch.id }} · {{ certificates[batch.certificateId]?.id }} ·
            {{ batch.expires - hour }}h 后到期</small
          >
          <small v-if="sharesOf(batch.id).length" class="source-line">
            来源 {{ sharesOf(batch.id).map((s) => `${s.source} ×${s.quantity}`).join(" / ") }}
          </small>
        </div>
        <div class="quantity">
          <strong>×{{ batch.quantity }}</strong
          ><small>可用 {{ free(batch.id) }}</small>
        </div>
        <button :disabled="!free(batch.id)" @click.stop="$emit('sell', batch.id)">
          卖 1
        </button>
      </div>
      <p v-if="!batches.length" class="empty">谷仓空了，去田里收获吧。</p>
    </div>
    <p class="hint">
      每批都挂着自己的检验证书 · 按先到期批次配货 · 拆包出售会同步扣减证书来源份额
    </p>
  </section>
</template>
