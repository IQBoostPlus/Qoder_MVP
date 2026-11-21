<script setup lang="ts">
import { computed, ref, shallowRef, watchEffect } from 'vue';
import MapView from './views/MapView.vue';
import DrillView from './views/DrillView.vue';
import DiagnosticView from './views/DiagnosticView.vue';
import { PRECISION_NOTICE } from './fixture-port';
import ScenarioStart from './views/ScenarioStart.vue';
import { useFixtureData } from './composables/useFixturePort';
import { createEnginePort, type EnginePort } from './engine-port';
import type { FallbackReason, GenerationResult, RoundData } from './scenario-generation/contracts';
import { campusMap } from './scenario-generation/templates';
import { createLocalRunStore, exportRun, importRun, newRun, updateRun } from './run-store/local';
import { cloudRunPath, syncRun } from './run-store/cloud';
import { RunStoreError, type RunProgress, type StoredRun } from './run-store/contracts';
import type { RunEvent } from './contracts';


type Mode = 'drill' | 'map' | 'diag';
const tab = ref<Mode>('drill');
const store = createLocalRunStore();
const round = shallowRef<{ id: string; data: RoundData; port: EnginePort; result: StoredRun['origin'] } | null>(null);
const saved = shallowRef<StoredRun | null>(null);
let persisted: StoredRun | null = null;
const saveStatus = ref('');
const importStatus = ref('');
const cloudPath = cloudRunPath();
const syncing = ref(false);
const syncedRevision = ref<number | null>(null);
const cloudError = ref('');
const cloudStatus = computed(() => cloudError.value || (syncedRevision.value === null ? ''
  : saved.value?.revision === syncedRevision.value ? '已同步云端' : '已同步云端 · 本机有更新，可再次同步'));
async function syncNow(): Promise<void> {
  if (!cloudPath || !saved.value || syncing.value) return;
  const run = saved.value;
  syncing.value = true;
  try {
    await syncRun(cloudPath, run);
    if (saved.value?.run_id === run.run_id) {
      syncedRevision.value = run.revision;
      cloudError.value = '';
    }
  } catch (error) {
    if (saved.value?.run_id === run.run_id) cloudError.value = (error instanceof RunStoreError && error.code === 'CONFLICT'
      ? '云端版本冲突，请先核对记录' : '云端未同步，可重试') + (persisted?.run_id === run.run_id ? ' · 本机记录已保留' : ' · 当前进度可导出');
  } finally { syncing.value = false; }
}

function explainStorage(error: unknown): string {
  if (error instanceof RunStoreError && error.code === 'CONFLICT') return '版本冲突，当前进度仅在内存；可先导出，再刷新读取';
  if (error instanceof RunStoreError && ['CORRUPT', 'VERSION'].includes(error.code)) return error.message;
  return '仅内存，尚未保存到本机；可导出 JSON';
}
function mount(run: StoredRun): void {
  saved.value = run;
  round.value = { id: run.run_id, data: run.bundle, port: createEnginePort(run.bundle, run.map), result: run.origin };
}
try {
  const active = store.active();
  if (active) {
    persisted = active;
    mount(active);
    saveStatus.value = '已从本机恢复';
  }
} catch (error) { saveStatus.value = explainStorage(error); }

function start(run: StoredRun): void {
  persisted = null;
  syncedRevision.value = null;
  cloudError.value = '';
  try {
    store.createRun(run);
    persisted = run;
    saveStatus.value = '已保存到本机';
  } catch (error) { saveStatus.value = explainStorage(error); }
  mount(run);
}
function startRound(result: GenerationResult): void {
  const { scenario, ugc_reports, action_catalog } = result.bundle;
  const { request, selection, provider, fallback_reason, report_source, calls, shared_retry_used, upstream_state, reports } = result;
  start(newRun({ bundle: { scenario: { ...scenario, id: 'd6-' + crypto.randomUUID() }, ugc_reports, action_catalog }, map: campusMap,
    origin: { request, selection, provider, fallback_reason, report_source, calls, shared_retry_used, upstream_state, reports } }));
}
function startCanonical(): void {
  const { scenario, ugc_reports, action_catalog } = useFixtureData();
  start(newRun({ bundle: { scenario, ugc_reports, action_catalog }, map: campusMap, origin: null }));
}
function restart(): void {
  if (!saved.value) return;
  const { bundle, map, origin } = saved.value;
  start(newRun({ bundle, map, origin }));
}
function checkpoint(runId: string, progress: RunProgress, events: RunEvent[], score: StoredRun['score']): void {
  const current = saved.value;
  if (!current || current.run_id !== runId) return;
  const base = persisted ?? current;
  const next = updateRun(base, progress, events, score);
  saved.value = next;
  if (!persisted || next === base) return;
  try {
    store.saveRun(next, persisted.revision);
    persisted = next;
    saveStatus.value = '已保存到本机';
  } catch (error) { saveStatus.value = explainStorage(error); }
}
function exitRound(): void {
  try { if (saved.value) store.clearActive(saved.value.run_id); }
  catch (error) { saveStatus.value = explainStorage(error); return; }
  round.value = null;
  saved.value = null;
  persisted = null;
  saveStatus.value = '';
  syncedRevision.value = null;
  cloudError.value = '';
}
function download(): void {
  if (!saved.value) return;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([exportRun(saved.value)], { type: 'application/json' }));
  link.download = saved.value.run_id + '.json';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
async function checkExport(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > 2_000_000) throw new Error('存档文件过大');
    const run = importRun(await file.text());
    importStatus.value = '核验通过：' + run.events.length + ' 条事件' + (run.score ? '，复算 ' + run.score.total + ' 分' : '，尚未结算');
  } catch (error) { importStatus.value = error instanceof Error ? error.message : '存档无法核验'; }
  input.value = '';
}
const fallbackLabels: Record<FallbackReason, string> = {
  not_configured: '生成服务未启用', unauthorized: '生成服务授权失败', network: '生成服务无法连接或结果未返回',
  timeout: '等待已达 15 秒', invalid_candidate: '生成结果校验失败', budget: '本轮调用预算不足', conflict: '请求标识冲突',
};
const sourceLabel = computed(() => {
  if (!round.value) return '选择训练模板';
  const result = round.value.result;
  if (!result) return 'D4 标准剧本 · 预置上报';
  const scenario = result.selection === 'generated' ? (result.provider === 'simulated' ? '模拟生成剧本' : 'AI 剧本')
    : result.selection === 'preset' ? '预置剧本' : '预置回退';
  const reports = result.report_source === 'generated' ? (result.reports?.provider === 'simulated' ? '模拟生成上报' : 'AI 上报')
    : result.report_source === 'fallback' ? '预置上报回退' : '预置上报';
  return scenario + ' · ' + reports;
});
const fallbackNote = computed(() => {
  const result = round.value?.result;
  if (!result) return '';
  if (!result.fallback_reason) {
    return result.reports?.fallback_reason ? fallbackLabels[result.reports.fallback_reason] + '。已载入当前剧本的预置上报。' : '';
  }
  const provider = result.provider === 'simulated' ? '模拟请求 · ' : '';
  const usage = result.calls === null ? '调用结果待查询' : '本轮调用 ' + result.calls + '/4';
  return provider + fallbackLabels[result.fallback_reason] + '。已载入同模板预置剧本。' + usage;
});

const modeNames: Record<Mode, string> = { drill: '推演', map: '示例回放', diag: '接口诊断' };
const themeKey = 'campus-training-theme';
function initialTheme(): 'ops' | 'daylight' {
  try { return localStorage.getItem(themeKey) === 'ops' ? 'ops' : 'daylight'; } catch { return 'daylight'; }
}
const theme = ref(initialTheme());
watchEffect(() => {
  document.documentElement.dataset.theme = theme.value;
  try { localStorage.setItem(themeKey, theme.value); } catch { /* Training remains usable without storage. */ }
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
        <div class="round-file-tools">
          <span role="status" id="run-save-status">{{ saveStatus }}<template v-if="cloudStatus"> · {{ cloudStatus }}</template></span>
          <button v-if="cloudPath" type="button" class="btn" :disabled="syncing" @click="syncNow">{{ syncing ? '同步中' : '同步云端' }}</button>
          <button type="button" class="btn" @click="download">导出本轮 JSON</button>
          <button type="button" class="btn" @click="exitRound">新开推演</button>
        </div>
      </div>
      <KeepAlive v-if="round && saved" :key="round.id" :max="1">
        <DrillView v-if="tab === 'drill'" :key="round.id" :port="round.port" :fixture="round.data" :saved="saved"
          @checkpoint="checkpoint" @restart="restart" />
      </KeepAlive>
      <ScenarioStart v-if="tab === 'drill' && !round" @start="startRound" @canonical="startCanonical" />
      <section v-if="tab === 'drill' && !round" class="run-file-check">
        <p v-if="saveStatus" role="status">{{ saveStatus }}</p>
        <label>独立核验轮次 JSON <input type="file" accept=".json,application/json" @change="checkExport" /></label>
        <p v-if="importStatus" role="status">{{ importStatus }}</p>
      </section>
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
.round-file-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.run-file-check { padding: 12px; }
.run-file-check input { max-width: 100%; }
@media (max-width: 600px) { .round-banner { flex-wrap: wrap; } }
.round-banner > div { min-width: 0; }
.round-banner p { margin: 4px 0 0; }
.round-banner .btn { min-height: 44px; flex: none; }
.round-source { margin-left: 8px; color: var(--work-muted); }
</style>
