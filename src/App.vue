<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue';
import MapView from './views/MapView.vue';
import DrillView from './views/DrillView.vue';
import DiagnosticView from './views/DiagnosticView.vue';
import { PRECISION_NOTICE } from './fixture-port';
import { DRILL_MODE_BADGE } from './config/rounds';

type Mode = 'drill' | 'map' | 'diag';
const tab = ref<Mode>('drill');

const MODE_TITLE: Record<Mode, string> = {
  drill: '推演舱',
  map: '指挥舱 · 示例回放',
  diag: '接口诊断台',
};
const MODE_SUB: Record<Mode, string> = {
  drill: 'NJIT 江宁 · 预置剧本，实时判定与评分',
  map: 'NJIT 江宁 · 训练地图与示例回放',
  diag: 'NJIT 江宁 · 引擎接口与测试数据',
};
const MODE_META: Record<Mode, string> = {
  drill: 'D4 学员流水与实时评分',
  map: 'D2 训练路网 · 阻断后自动改道',
  diag: 'D1～D3 接口核对',
};
const modeTitle = computed(() => MODE_TITLE[tab.value]);
const modeSub = computed(() => MODE_SUB[tab.value]);
const modeMeta = computed(() => MODE_META[tab.value]);

const THEME_KEY = 'campus-drill-theme';
const theme = ref<'ops' | 'daylight'>(localStorage.getItem(THEME_KEY) === 'daylight' ? 'daylight' : 'ops');
watchEffect(() => {
  document.documentElement.dataset.theme = theme.value;
  localStorage.setItem(THEME_KEY, theme.value);
});
watchEffect(() => {
  document.title = `校园应急桌面推演 · ${modeTitle.value}`;
});
function toggleTheme(): void {
  theme.value = theme.value === 'ops' ? 'daylight' : 'ops';
}
</script>

<template>
  <div class="deck">
    <header class="topbar">
      <div class="brand">
        <h1 class="brand-title">校园应急桌面推演 <span class="accent">· {{ modeTitle }}</span></h1>
        <span class="brand-sub">{{ modeSub }}</span>
      </div>
      <nav class="topnav" aria-label="模式切换">
        <button class="btn" :class="{ 'btn-primary': tab === 'drill' }" @click="tab = 'drill'">推演</button>
        <button class="btn" :class="{ 'btn-primary': tab === 'map' }" @click="tab = 'map'">示例回放</button>
        <button class="btn" :class="{ 'btn-primary': tab === 'diag' }" @click="tab = 'diag'">接口诊断</button>
      </nav>
      <button
        class="btn theme-toggle"
        id="theme-toggle"
        :aria-pressed="theme === 'daylight'"
        aria-label="切换配色主题"
        @click="toggleTheme"
      >
        <span class="orb" aria-hidden="true"></span>{{ theme === 'ops' ? '教室投影' : '夜航指挥' }}
      </button>
      <!-- 徽标按模式诚实区分：推演不标「示例回放」也不宣称实时评分（Q10 / FR-8.3） -->
      <div class="topbar-badges">
        <span v-if="tab === 'drill'" class="badge badge-blue" id="badge-drill">{{ DRILL_MODE_BADGE }}</span>
        <span v-else-if="tab === 'map'" class="badge badge-amber" id="badge-replay">示例回放</span>
        <span v-else class="badge badge-muted" id="badge-diag">构造 / 合成数据</span>
        <span class="badge badge-red" id="badge-training">训练模拟数据</span>
      </div>
    </header>

    <!-- 首屏精度声明（逐字常量） -->
    <div class="ribbon" id="first-screen-notice">
      <span class="ribbon-tag">精度声明</span>
      <p class="ribbon-text">{{ PRECISION_NOTICE }}</p>
    </div>

    <main class="deck-main">
      <DrillView v-if="tab === 'drill'" />
      <MapView v-else-if="tab === 'map'" />
      <div v-else class="diag-scroll">
        <div class="shell">
          <DiagnosticView />
        </div>
      </div>
    </main>

    <!-- 页脚：同一声明 + 模式徽标同屏 -->
    <footer class="statusbar" id="map-footer-notice">
      <div class="statusbar-badges">
        <span v-if="tab === 'drill'" class="badge badge-blue">{{ DRILL_MODE_BADGE }}</span>
        <span v-else-if="tab === 'map'" class="badge badge-amber">示例回放</span>
        <span v-else class="badge badge-muted">构造 / 合成数据</span>
        <span class="badge badge-red">训练模拟数据</span>
      </div>
      <p class="statusbar-notice">{{ PRECISION_NOTICE }}</p>
      <p class="statusbar-meta">fixtures/canonical-run.json · fixture-port.ts<br />{{ modeMeta }}</p>
    </footer>
  </div>
</template>

<style scoped>
.topnav { display: flex; gap: 8px; }
.topnav .btn { min-height: 44px; padding: 6px 14px; }
</style>
