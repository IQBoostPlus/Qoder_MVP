<script setup lang="ts">
import { ref, watchEffect } from 'vue';
import MapView from './views/MapView.vue';
import DrillView from './views/DrillView.vue';
import DiagnosticView from './views/DiagnosticView.vue';
import { PRECISION_NOTICE } from './fixture-port';
import { DRILL_MODE_BADGE } from './config/rounds';

type Mode = 'drill' | 'map' | 'diag';
const tab = ref<Mode>('drill');
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

    <main class="deck-main app-content" id="main-content" tabindex="-1">
      <KeepAlive>
        <DrillView v-if="tab === 'drill'" />
      </KeepAlive>
      <MapView v-if="tab === 'map'" />
      <div v-if="tab === 'diag'" class="diag-scroll">
        <div class="shell"><DiagnosticView /></div>
      </div>
    </main>

    <footer class="app-footer" id="map-footer-notice">
      <span v-if="tab === 'drill'" id="badge-drill">{{ DRILL_MODE_BADGE }}</span>
      <span v-else-if="tab === 'map'" id="badge-replay">示例回放</span>
      <span v-else id="badge-diag">构造与合成数据</span>
      <p>{{ PRECISION_NOTICE }}</p>
    </footer>

    <div class="training-watermark" id="page-watermark" aria-hidden="true">训练模拟数据</div>
  </div>
</template>
