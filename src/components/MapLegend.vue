<script setup lang="ts">
import { CATEGORY_ORDER, CATEGORY_STYLE } from '../config/categories';
import { LAYER_ORDER, LAYER_STYLE } from '../config/layers';
</script>

<template>
  <div class="legend">
    <div class="legend-group">
      <span class="legend-title">楼栋类别</span>
      <div class="legend-items">
        <span v-for="cat in CATEGORY_ORDER" :key="cat" class="legend-item">
          <span class="swatch" :style="{ background: CATEGORY_STYLE[cat].fill, borderColor: CATEGORY_STYLE[cat].color }"></span>
          {{ CATEGORY_STYLE[cat].label }}
        </span>
      </div>
    </div>

    <div class="legend-group">
      <span class="legend-title">道路双状态（可叠加）</span>
      <div class="legend-items column">
        <span class="legend-item">
          <span class="line-swatch hazard"></span>
          <span><b class="c-blue">自然灾情</b>：积水 / 火灾 / 瓦砾，蓝色波纹描边。由剧本灾情事件触发，是否可通行由引擎判定。</span>
        </span>
        <span class="legend-item">
          <span class="line-swatch closed"></span>
          <span><b class="c-red">正式封闭</b>：封路指令生效后显示红色路障，标注封闭时刻与对应操作。两者可同时存在。</span>
        </span>
        <span class="legend-item">
          <span class="gate-swatch"></span>
          <span><b class="c-amber">校门 / 路口</b>：路网节点，非楼栋，不计入楼栋数；可点选查看连接路段，但不进上报定位候选、不可作为动作对象。</span>
        </span>
      </div>
    </div>

    <div class="legend-group">
      <span class="legend-title">态势图层（可独立开关）</span>
      <div class="legend-items column">
        <span v-for="key in LAYER_ORDER" :key="key" class="legend-item">
          <span class="layer-swatch" :style="{ borderColor: LAYER_STYLE[key].color, background: LAYER_STYLE[key].soft }"></span>
          <span><b :style="{ color: LAYER_STYLE[key].color }">{{ LAYER_STYLE[key].label }}</b>：{{ LAYER_STYLE[key].desc }}</span>
        </span>
      </div>
    </div>

    <div class="legend-group">
      <span class="legend-title">路径与选中</span>
      <div class="legend-items column">
        <span class="legend-item">
          <span class="route-swatch"><i></i></span>
          <span><b>疏散路径</b>：亮色虚线 + 暗色包边，图上示意长度，非实际距离或耗时；引擎接入前显示待接入空态。</span>
        </span>
        <span class="legend-item">
          <span class="select-swatch">选中</span>
          <span><b class="c-amber">选中对象</b>：琥珀色标签 + 加粗描边；点选 / Tab+Enter 选中，Esc 或点空白取消。</span>
        </span>
      </div>
    </div>

    <p class="legend-note">容量均为估算口径（≈）；层数来自公开资料，不展示建筑高度；路段名为训练级内部命名，非官方路名。</p>
  </div>
</template>

<style scoped>
.legend { display: flex; flex-direction: column; gap: 12px; }
.legend-group { display: flex; flex-direction: column; gap: 6px; }
.legend-title { font-size: 11px; font-weight: 650; color: var(--muted); }
.legend-items { display: flex; flex-wrap: wrap; gap: 6px 14px; }
.legend-items.column { flex-direction: column; gap: 8px; }
.legend-item { display: flex; align-items: flex-start; gap: 8px; font-size: 12px; color: var(--paper); line-height: 1.5; }
.swatch { width: 14px; height: 14px; border-radius: var(--r-sm); border: 1.5px solid; flex: none; margin-top: 2px; }
.line-swatch { width: 26px; height: 0; border-top-width: 4px; border-top-style: solid; flex: none; margin-top: 8px; border-radius: 2px; }
.line-swatch.hazard { border-top-color: var(--blue); border-top-style: dashed; }
.line-swatch.closed { border-top-color: var(--red); }
.gate-swatch { width: 14px; height: 12px; border: 2px solid var(--amber); border-bottom: none; border-radius: 3px 3px 0 0; flex: none; margin-top: 3px; }
.layer-swatch { width: 14px; height: 14px; border-radius: 50%; border: 2px solid; flex: none; margin-top: 2px; }
.route-swatch { width: 26px; height: 8px; border-radius: 4px; background: var(--route-casing); border: 1px solid var(--line); flex: none; margin-top: 5px; display: flex; align-items: center; }
.route-swatch i { display: block; width: 100%; border-top: 3px dashed var(--route-line); }
.select-swatch {
  flex: none;
  margin-top: 2px;
  padding: 0 5px;
  font-size: 10px;
  font-weight: 800;
  line-height: 16px;
  color: var(--ink-950);
  background: var(--amber);
  border: 1px solid var(--ink-950);
  border-radius: var(--r-sm);
}
.c-blue { color: var(--blue); }
.c-red { color: var(--red); }
.c-amber { color: var(--amber); }
.legend-note { margin: 0; font-size: 11.5px; color: var(--muted); line-height: 1.6; }
</style>