<script setup lang="ts">
import type { Certificate } from "../contracts";
import { itemName } from "../catalog";
import { qualitySummary } from "../quality";
import QualityTag from "./QualityTag.vue";
defineProps<{
  certificate: Certificate;
  certificates?: Readonly<Record<string, Certificate>>;
  quantity?: number;
}>();
const ancestors = (
  certificate: Certificate,
  registry?: Readonly<Record<string, Certificate>>,
): Certificate[] => {
  const seen = new Set<string>();
  const result: Certificate[] = [];
  const walk = (current: Certificate, depth: number) => {
    if (depth > 6) return;
    for (const id of current.derivedFrom ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      const parent = registry?.[id];
      if (parent) {
        result.push(parent);
        walk(parent, depth + 1);
      }
    }
  };
  walk(certificate, 0);
  return result;
};
</script>
<template>
  <div class="certificate-card">
    <div class="certificate-head">
      <strong>检验证书 {{ certificate.id }}</strong>
      <small>{{ itemName(certificate.item) }} · 签发于 {{ certificate.issued }}</small>
    </div>
    <QualityTag :quality="certificate.quality" />
    <p class="certificate-quantity">
      对应真实数量 ×{{ quantity ?? certificate.shares.reduce((n, s) => n + s.quantity, 0) }}
    </p>
    <div class="certificate-shares">
      <span>来源份额</span>
      <ul>
        <li v-for="(share, i) in certificate.shares" :key="i">
          {{ share.source }} · ×{{ share.quantity }}
        </li>
      </ul>
    </div>
    <div v-if="ancestors(certificate, certificates).length" class="certificate-derived">
      <span>可追溯原料</span>
      <ul>
        <li v-for="ancestor in ancestors(certificate, certificates)" :key="ancestor.id">
          {{ ancestor.id }} · {{ qualitySummary(ancestor.quality) }}
        </li>
      </ul>
    </div>
    <small v-if="certificate.note" class="certificate-note">{{ certificate.note }}</small>
  </div>
</template>
