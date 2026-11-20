<script setup lang="ts">
import type { ScoreResult } from '../contracts';
import { SCORE_PENDING_TEXT } from '../fixture-port';
import { seqLabel } from '../config/format';

defineProps<{ score: ScoreResult | null }>();
const formatMetric = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format;
</script>

<template>
  <div class="score-panel">
    <div v-if="score === null" class="empty-state" id="score-pending">
      <svg class="es-icon" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="3" cy="8" r="2" />
        <circle cx="13" cy="8" r="2" />
        <path d="M5.5 8h5" stroke-dasharray="2 2" />
      </svg>
      <span>{{ SCORE_PENDING_TEXT }}</span>
    </div>

    <div v-else class="score-live" id="score-live">
      <div class="score-total live-score-total">{{ score.total }} <span>/ 100</span></div>
      <div class="score-metrics">
        <span><span class="m-k">甄别</span> <span class="m-v">{{ formatMetric(score.discrimination) }}</span></span>
        <span><span class="m-k">响应</span> <span class="m-v">{{ formatMetric(score.response) }}</span></span>
        <span><span class="m-k">命中</span> <span class="m-v">{{ formatMetric(score.coverage) }}</span></span>
        <span><span class="m-k">合规得分</span> <span class="m-v">{{ formatMetric(score.violation) }}</span></span>
      </div>
      <div class="score-detail" id="score-breakdown">
        <div>判读正确 {{ score.details.correct_judgments }}/{{ score.details.total_reports }}</div>
        <div v-if="score.details.response_seconds !== null">
          首报 {{ score.details.first_real_report_id }} · 有效响应 {{ score.details.response_seconds }} 秒<template v-if="score.details.first_response_action_seq !== null"> · {{ seqLabel(score.details.first_response_action_seq) }}</template>
        </div>
        <div v-else>本轮无已完成的首报响应</div>
        <div>标准动作命中权重 {{ score.details.coverage_hit_weights }}/{{ score.details.coverage_total_weights }}</div>
        <div>重复违规 {{ score.details.violation_count }} 次<template v-if="score.details.violation_event_seqs.length > 0"> · {{ score.details.violation_event_seqs.map(seqLabel).join('、') }}</template></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.score-panel { display: flex; flex-direction: column; gap: 8px; }
.es-icon { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; }
.score-live { display: flex; flex-direction: column; gap: 6px; }
.live-score-total { color: var(--paper); }
.live-score-total span { color: var(--muted); font: 600 15px var(--font-sans); }
</style>
