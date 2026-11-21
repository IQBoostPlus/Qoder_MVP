<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ text?: string }>();

const scene = computed(() => {
  const text = props.text;
  if (!text || /(?:未见|没有|没见|不见|未发现|不实)/.test(text)) return 'signal';
  if (/(?:积水|内涝|淹水|水淹)/.test(text)) return 'water';
  if (/(?:有烟|冒烟|烟味|浓烟|明火|着火|起火)/.test(text)) return 'smoke';
  if (/(?:异常气味|泄漏)/.test(text)) return 'air';
  if (/(?:拥堵|拥挤|出口排队)/.test(text)) return 'crowd';
  return 'signal';
});
</script>

<template>
  <div class="report-scene" :class="['scene-' + scene, { 'scene-intro': !text }]" aria-hidden="true">
    <svg v-if="scene === 'signal'" viewBox="0 0 260 82" fill="none">
      <path class="signal-idle" d="M0 20h260M0 41h260M0 62h260M43 0v82m43-82v82m44-82v82m44-82v82m43-82v82" />
      <path class="signal-wave-base" d="M0 41h54l9-5 10 10 12-14 10 18 14-9h16l8-21 9 40 11-32 10 19 9-6h88" />
      <path class="signal-wave" d="M0 41h54l9-5 10 10 12-14 10 18 14-9h16l8-21 9 40 11-32 10 19 9-6h88" pathLength="1" />
      <circle v-if="!text" cx="133" cy="20" r="7" class="signal-ring" />
      <circle cx="133" cy="20" r="2.5" class="signal-point" />
    </svg>
    <svg v-else-if="scene === 'smoke'" viewBox="0 0 260 82" fill="none">
      <path class="scene-distant" d="M22 76V56h30V39h26v37m112 0V42h23v15h25v19M0 76h260" />
      <path class="scene-facade" d="M81 75V27l99-7v55Z" />
      <path class="scene-detail" d="M81 44l99-5M81 60l99-3M106 26v49m24-51v51m25-53v53" />
      <path class="smoke-wisp" d="M146 43c-4-10 16-12 12-22s1-14 7-18" />
      <path class="smoke-wisp smoke-second" d="M153 44c-1-7 18-10 17-18s3-15 13-20" />
      <path class="scene-detail" d="M0 76h260" />
    </svg>
    <svg v-else-if="scene === 'water'" viewBox="0 0 260 82" fill="none">
      <path class="scene-distant" d="M0 33h260M10 19h47v14m16-1V13h40v20m77 0V18h43v15" />
      <path class="scene-facade" d="M12 82l88-49h61l89 49Z" />
      <path class="scene-detail" d="m40 74 64-38m112 38-55-38m-36 8h10m-13 12h18" />
      <path class="water-ripple" d="M44 65c20-5 36 5 58 0s31-5 50 0 40-5 64 0m-144 10c21-4 33 4 56 0s37-4 61 0" />
    </svg>
    <svg v-else-if="scene === 'air'" viewBox="0 0 260 82" fill="none">
      <path class="scene-detail" d="M0 71h260m-184 0V14h41v57m-38-50h35m50 50V14h38v57m-35-50h32" />
      <path class="air-trace" d="M27 56c24-13 50-13 77-2s72 11 114-11m-169-8c17-8 38-8 59 0s53 8 82-6" pathLength="1" />
    </svg>
    <svg v-else viewBox="0 0 260 82" fill="none">
      <path class="scene-detail" d="M0 16h116v17h35V16h109M0 67h116V50h35v17h109" />
      <path class="scene-distant" d="M172 41h40m-5-5 5 5-5 5" />
      <g class="crowd-move">
        <circle cx="63" cy="34" r="4" /><circle cx="70" cy="50" r="4" /><circle cx="84" cy="42" r="4" />
        <circle cx="97" cy="33" r="4" /><circle cx="102" cy="52" r="4" /><circle cx="118" cy="41" r="4" />
      </g>
    </svg>
  </div>
</template>

<style scoped>
.report-scene {
  overflow: hidden;
  border: 1px solid var(--work-border);
  border-radius: 7px;
  background: var(--work-panel);
  color: var(--work-accent);
}
.report-scene svg { display: block; width: 100%; height: 66px; }
.scene-intro svg { height: 100px; }
.signal-idle, .scene-distant { stroke: var(--work-border); }
.signal-wave-base { stroke: currentColor; stroke-width: 1.25; opacity: .27; }
.signal-wave { stroke: currentColor; stroke-width: 1.45; opacity: .86; animation: signal-arrival 780ms cubic-bezier(.22, 1, .36, 1) both; }
.signal-point { fill: currentColor; animation: scene-appear 220ms 310ms ease-out both; }
.signal-ring { stroke: currentColor; opacity: .4; transform-box: fill-box; transform-origin: center; animation: signal-pulse 920ms 250ms ease-out both; }
.scene-facade { fill: var(--work-accent-soft); stroke: var(--work-border); }
.scene-detail { stroke: var(--work-muted); opacity: .36; }
.smoke-wisp {
  stroke: var(--work-muted); stroke-width: 5; stroke-linecap: round; opacity: .48;
  animation: report-smoke 1150ms cubic-bezier(.18, .62, .27, 1) both;
}
.smoke-second { stroke-width: 2.6; opacity: .28; animation-delay: 140ms; }
.water-ripple {
  stroke: var(--blue); stroke-width: 1.65; stroke-linecap: round; opacity: .7;
  animation: report-water 760ms ease-out both;
}
.air-trace { stroke: var(--amber); stroke-width: 2; opacity: .68; animation: air-drift 930ms ease-out both; }
.crowd-move { fill: currentColor; opacity: .72; animation: crowd-arrival 820ms ease-out both; }
@keyframes signal-arrival { from { stroke-dasharray: 1; stroke-dashoffset: 1; } to { stroke-dasharray: 1; stroke-dashoffset: 0; } }
@keyframes signal-pulse { from { opacity: .85; transform: scale(.45); } to { opacity: 0; transform: scale(2.7); } }
@keyframes scene-appear { from { opacity: 0; } }
@keyframes report-smoke { from { transform: translate(-7px, 8px); opacity: .08; } }
@keyframes report-water { from { transform: translateY(-3px); opacity: .19; } }
@keyframes air-drift { from { stroke-dasharray: 1; stroke-dashoffset: 1; } to { stroke-dasharray: 1; stroke-dashoffset: 0; } }
@keyframes crowd-arrival { from { transform: translateX(-12px); opacity: .25; } }
@media (prefers-reduced-motion: reduce) {
  .signal-wave, .signal-point, .signal-ring, .smoke-wisp, .water-ripple, .air-trace, .crowd-move { animation: none; }
}
</style>
