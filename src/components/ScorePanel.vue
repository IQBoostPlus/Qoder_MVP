<script setup lang="ts">
import type { ScoreResult } from '../contracts';
import { SCORE_PENDING_TEXT } from '../fixture-port';

defineProps<{ score: ScoreResult | null }>();
</script>

<template>
  <div class="score-panel">
    <!-- 偏离基线 → null：只显示待接入常量，绝不回退基线分数 -->
    <div v-if="score === null" class="empty-state" id="score-pending">
      <svg class="es-icon" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="3" cy="8" r="2" />
        <circle cx="13" cy="8" r="2" />
        <path d="M5.5 8h5" stroke-dasharray="2 2" />
      </svg>
      <span>{{ SCORE_PENDING_TEXT }}</span>
    </div>

    <!-- 完整匹配原始示例流水时才返回分数 -->
    <div v-else class="score-live" id="score-live">
      <div class="score-total ok">{{ score.total }}</div>
      <div class="score-metrics">
        <span><span class="m-k">甄别</span> <span class="m-v">{{ score.discrimination }}</span></span>
        <span><span class="m-k">响应</span> <span class="m-v">{{ score.response }}</span></span>
        <span><span class="m-k">命中</span> <span class="m-v">{{ score.coverage }}</span></span>
        <span><span class="m-k">违规</span> <span class="m-v">{{ score.violation }}</span></span>
      </div>
      <div class="score-detail">
        违规明细读 <span class="mono">details.violation_event_seqs</span>：
        <span class="mono">[{{ score.details.violation_event_seqs.join(', ') }}]</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.score-panel { display: flex; flex-direction: column; gap: 8px; }
.es-icon { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; }
.score-live { display: flex; flex-direction: column; gap: 6px; }
</style>