<script setup lang="ts">
import { ref, watchEffect } from 'vue';
import MapView from './views/MapView.vue';
import DiagnosticView from './views/DiagnosticView.vue';
import { useFixtureData } from './composables/useFixturePort';
import { PRECISION_NOTICE } from './fixture-port';

const fixture = useFixtureData();
const tab = ref<'map' | 'diag'>('map');

const THEME_KEY = 'campus-drill-theme';
const theme = ref<'ops' | 'daylight'>(localStorage.getItem(THEME_KEY) === 'daylight' ? 'daylight' : 'ops');
watchEffect(() => {
  document.documentElement.dataset.theme = theme.value;
  localStorage.setItem(THEME_KEY, theme.value);
});
function toggleTheme(): void {
  theme.value = theme.value === 'ops' ? 'daylight' : 'ops';
}
</script>

<template>
  <div class="deck">
    <header class="topbar">
      <div class="brand">
        <h1 class="brand-title">校园应急桌面推演 <span class="accent">· {{ tab === 'map' ? '指挥舱' : '接口诊断台' }}</span></h1>
        <span class="brand-sub">NJIT 江宁 · D1-v2 FIXTURE PORT · READONLY</span>
      </div>
      <nav class="topnav" aria-label="视图切换">
        <button class="btn" :class="{ 'btn-primary': tab === 'map' }" @click="tab = 'map'">指挥舱</button>
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
      <div class="topbar-badges">
        <span class="badge badge-amber" id="badge-replay">示例回放</span>
        <span class="badge badge-red" id="badge-training">训练模拟数据</span>
      </div>
    </header>

    <!-- 首屏精度声明（逐字常量） -->
    <div class="ribbon" id="first-screen-notice">
      <span class="ribbon-tag">精度声明</span>
      <p class="ribbon-text">{{ PRECISION_NOTICE }}</p>
    </div>

    <main class="deck-main">
      <MapView v-if="tab === 'map'" />
      <div v-else class="diag-scroll">
        <div class="shell">
          <DiagnosticView />
        </div>
      </div>
    </main>

    <!-- 地图页脚：同一声明 + 水印同屏 -->
    <footer class="statusbar" id="map-footer-notice">
      <div class="statusbar-badges">
        <span class="badge badge-amber">示例回放</span>
        <span class="badge badge-red">训练模拟数据</span>
      </div>
      <p class="statusbar-notice">{{ PRECISION_NOTICE }}</p>
      <p class="statusbar-meta">fixtures/canonical-run.json · fixture-port.ts<br />D2 点选 + 图层 · 寻路待 A · 实时评分 D4</p>
    </footer>
  </div>
</template>

<style scoped>
.topnav { display: flex; gap: 8px; }
.topnav .btn { min-height: 44px; padding: 6px 14px; }
</style>