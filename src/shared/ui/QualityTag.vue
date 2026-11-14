<script setup lang="ts">
import type { Quality } from "../contracts";
import { metricInfo, metrics, fmt } from "../quality";
defineProps<{ quality: Quality; compact?: boolean }>();
</script>
<template>
  <span class="quality-tag" :class="quality.kind">
    <template v-if="quality.kind === 'measured'">
      <span v-for="metric in metrics" :key="metric" class="metric-chip">
        <em>{{ metricInfo[metric].short }}</em>{{ fmt(quality.values[metric]) }}
      </span>
    </template>
    <template v-else>
      <span class="legacy-label">旧档 {{ quality.stars }}★</span>
      <span v-for="metric in metrics" :key="metric" class="metric-chip legacy">
        <em>{{ metricInfo[metric].short }}</em>{{ fmt(quality.interval[metric][0]) }}–{{ fmt(quality.interval[metric][1]) }}
      </span>
    </template>
    <small v-if="!compact && quality.note" class="quality-note">{{ quality.note }}</small>
  </span>
</template>
