<script setup lang="ts">
import { computed, ref, shallowRef, watchEffect } from 'vue';
import MapView from './views/MapView.vue';
import DrillView from './views/DrillView.vue';
import DiagnosticView from './views/DiagnosticView.vue';
import { PRECISION_NOTICE } from './fixture-port';
import ScenarioStart from './views/ScenarioStart.vue';
import { useFixtureData, useFixturePort } from './composables/useFixturePort';
import { createEnginePort, type EnginePort } from './engine-port';
import type { FallbackReason, GenerationResult, RoundData } from './scenario-generation/contracts';
import { campusMap } from './scenario-generation/templates';


type Mode = 'drill' | 'map' | 'diag';
const tab = ref<Mode>('drill');
const round = shallowRef<{ id: string; data: RoundData; port: EnginePort; result: GenerationResult | null } | null>(null);
function startRound(result: GenerationResult): void {
  round.value = { id: result.request.run_id, data: result.bundle, port: createEnginePort(result.bundle, campusMap), result };
}
function startCanonical(): void {
  round.value = { id: crypto.randomUUID(), data: useFixtureData(), port: useFixturePort(), result: null };
}
const fallbackLabels: Record<FallbackReason, string> = {
  not_configured: '生成服务未启用', unauthorized: '生成服务授权失败', network: '生成服务无法连接或结果未返回',
  timeout: '等待已达 15 秒', invalid_candidate: '生成结果校验失败', budget: '本轮调用预算不足', conflict: '请求标识冲突',
};
const sourceLabel = computed(() => {
  if (!round.value) return '选择训练模板';
  const result = round.value.result;
  if (!result) return 'D4 标准剧本 · 预置上报';
  if (result.selection === 'generated') return (result.provider === 'simulated' ? '模拟生成剧本' : 'AI 剧本') + ' · 预置上报';
  return (result.selection === 'preset' ? '预置剧本' : '预置回退') + ' · 预置上报';
});
const fallbackNote = computed(() => {
  const result = round.value?.result;
  if (!result?.fallback_reason) return '';
  const provider = result.provider === 'simulated' ? '模拟请求 · ' : '';
  const usage = result.calls === null ? '调用结果待查询' : '本轮调用 ' + result.calls + '/4';
  return provider + fallbackLabels[result.fallback_reason] + '。已载入同模板预置剧本。' + usage;
});

const modeNames: Record<Mode, string> = { drill: '推演', map: '示例回放', diag: '接口诊断' };
const themeKey = 'campus-training-theme';
const theme = ref<'ops' | 'daylight'>(localStorage.getItem(themeKey) === 'ops' ? 'ops' : 'daylight');
watchEffect(() => {
  document.documentElement.dataset.theme = theme.value;
  localStorage.setItem(themeKey, theme.value);
});
watchEffect(() => {
  document.title = `${modeNames[tab.value]} · 校园应急推演`;
});
</script>

<template>
  <div class="deck app-shell" :class="`app-mode-${tab}`">
    <a class="app-skip" href="#main-content">跳到主要内容</a>
    <header class="app-header">
      <div class="app-identity">
        <svg class="app-mark" viewBox="0 0 40 40" aria-hidden="true">
          <path d="M9 25.5 20 19l11 6.5L20 32 9 25.5Z M9 19l11-6.5L31 19 20 25.5 9 19Z M9 12.5 20 6l11 6.5L20 19 9 12.5Z" />
        </svg>
        <div>
          <h1>校园应急推演</h1>
          <span>南京工程学院</span>
        </div>
      </div>
      <nav class="app-nav" aria-label="模式切换">
        <button v-for="(label, mode) in modeNames" :key="mode" type="button"
          :aria-pressed="tab === mode" @click="tab = mode">{{ label }}</button>
      </nav>
      <div class="app-header-tools">
        <span class="training-label" id="badge-training">训练模拟数据</span>
        <button type="button" class="btn theme-toggle" id="theme-toggle"
          @click="theme = theme === 'daylight' ? 'ops' : 'daylight'">
          {{ theme === 'daylight' ? '夜间配色' : '浅色配色' }}
        </button>
      </div>
    </header>

    <div class="app-notice" id="first-screen-notice">
      <strong>精度声明</strong>
      <p>{{ PRECISION_NOTICE }}</p>
    </div>

    <main class="deck-main app-content" :class="{ 'drill-main': tab === 'drill', 'chooser-main': tab === 'drill' && !round }" id="main-content" tabindex="-1">
      <div v-if="tab === 'drill' && round" class="round-banner">
        <div><strong id="active-scenario">{{ round.data.scenario.title }}</strong><span class="round-source">{{ sourceLabel }}</span><p v-if="fallbackNote" role="status">{{ fallbackNote }}</p></div>
        <button type="button" class="btn" @click="round = null">&#26032;&#24320;&#25512;&#28436;</button>
      </div>
      <KeepAlive :max="1">
        <DrillView v-if="tab === 'drill' && round" :key="round.id" :port="round.port" :fixture="round.data" />
      </KeepAlive>
      <ScenarioStart v-if="tab === 'drill' && !round" @start="startRound" @canonical="startCanonical" />
      <MapView v-if="tab === 'map'" />
      <div v-if="tab === 'diag'" class="diag-scroll">
        <div class="shell"><DiagnosticView /></div>
      </div>
    </main>

    <footer class="app-footer" id="map-footer-notice">
      <span v-if="tab === 'drill'" id="badge-drill">{{ sourceLabel }}</span>
      <span v-else-if="tab === 'map'" id="badge-replay">示例回放</span>
      <span v-else id="badge-diag">构造与合成数据</span>
      <p>{{ PRECISION_NOTICE }}</p>
    </footer>

    <div class="training-watermark" id="page-watermark" aria-hidden="true">训练模拟数据</div>
  </div>
</template>

<style scoped>
.drill-main { display: flex; flex-direction: column; }
.drill-main :deep(.drill-workspace) { flex: 1; height: auto; min-height: 0; }
.app-shell .chooser-main { overflow-y: auto; }
.round-banner { display: flex; flex: none; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 14px; color: var(--work-ink); background: var(--work-panel); border-bottom: 1px solid var(--work-border); font-size: 12px; }
.round-banner > div { min-width: 0; }
.round-banner p { margin: 4px 0 0; }
.round-banner .btn { min-height: 44px; flex: none; }
.round-source { margin-left: 8px; color: var(--work-muted); }
</style>
