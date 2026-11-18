<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { MapView, RoadStatus, RouteResult } from '../fixture-port';
import type { Point } from '../contracts';
import { CATEGORY_STYLE, HAZARD_LABEL, formatBuildingFloors } from '../config/categories';
import {
  EMPTY_OVERLAY,
  cordonText,
  rescueText,
  type MapOverlay,
  type LayerKey,
  type Selection,
  type SelectionKind,
} from '../config/layers';

const props = withDefaults(
  defineProps<{
    map: MapView;
    roads: readonly RoadStatus[];
    highlight?: Selection | null;
    selected?: Selection | null;
    overlay?: MapOverlay;
    layers?: Record<LayerKey, boolean>;
    route?: RouteResult | null;
  }>(),
  {
    highlight: null,
    selected: null,
    overlay: () => EMPTY_OVERLAY,
    layers: () => ({ disaster: true, cordon: true, rescue: true }),
    route: null,
  },
);

const emit = defineEmits<{
  (e: 'select', kind: SelectionKind, id: string): void;
  (e: 'clear'): void;
}>();

// ---- 视图缩放 / 平移（只改 viewBox，不改数据几何） ----
const wrapEl = ref<HTMLElement | null>(null);
const svgEl = ref<SVGSVGElement | null>(null);
const view = ref({ x: 0, y: 0, w: 1, h: 1 });
function resetView(): void {
  const b = props.map.view_box;
  view.value = { x: b.x, y: b.y, w: b.width, h: b.height };
}
resetView();
watch(() => props.map.view_box, resetView, { deep: true });
const viewString = computed(() => `${view.value.x} ${view.value.y} ${view.value.w} ${view.value.h}`);
const zoomLevel = computed(() => props.map.view_box.width / view.value.w);

function clientToMap(clientX: number, clientY: number): Point | null {
  const svg = svgEl.value;
  if (!svg) return null;
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}
function zoomAt(p: Point, factor: number): void {
  const base = props.map.view_box;
  const newW = Math.min(Math.max(view.value.w / factor, base.width / 4), base.width * 2);
  const actual = view.value.w / newW;
  const newH = view.value.h / actual;
  view.value = {
    x: p.x - (p.x - view.value.x) / actual,
    y: p.y - (p.y - view.value.y) / actual,
    w: newW,
    h: newH,
  };
}
function zoomCenter(factor: number): void {
  clearHover();
  zoomAt({ x: view.value.x + view.value.w / 2, y: view.value.y + view.value.h / 2 }, factor);
}
function resetViewClean(): void {
  clearHover();
  resetView();
}
function onWheel(e: WheelEvent): void {
  clearHover();
  const p = clientToMap(e.clientX, e.clientY);
  if (!p) return;
  zoomAt(p, e.deltaY < 0 ? 1.2 : 1 / 1.2);
}

let pan: { startX: number; startY: number; viewX: number; viewY: number } | null = null;
let movedRecently = false;
function onPointerDown(e: PointerEvent): void {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  movedRecently = false;
  clearHover();
  pan = { startX: e.clientX, startY: e.clientY, viewX: view.value.x, viewY: view.value.y };
}
function onPointerMove(e: PointerEvent): void {
  if (!pan) return;
  const dx = e.clientX - pan.startX;
  const dy = e.clientY - pan.startY;
  if (!movedRecently && Math.abs(dx) + Math.abs(dy) > 4) {
    movedRecently = true;
    // 仅在确认为拖拽后捕获指针；普通点击不捕获，否则 click 会被重定向到 svg 而丢失点选
    try {
      svgEl.value?.setPointerCapture(e.pointerId);
    } catch {
      /* 合成事件无有效 pointerId 时忽略 */
    }
  }
  if (!movedRecently) return;
  const rect = svgEl.value?.getBoundingClientRect();
  if (!rect || rect.width === 0) return;
  view.value = {
    ...view.value,
    x: pan.viewX - dx * (view.value.w / rect.width),
    y: pan.viewY - dy * (view.value.h / rect.height),
  };
}
function onPointerUp(e: PointerEvent): void {
  pan = null;
  if (svgEl.value?.hasPointerCapture(e.pointerId)) svgEl.value.releasePointerCapture(e.pointerId);
}
function onSvgClick(): void {
  if (movedRecently) {
    movedRecently = false;
    return;
  }
  emit('clear');
}

function isHl(kind: SelectionKind, id: string): boolean {
  return (
    (props.highlight?.kind === kind && props.highlight.id === id) ||
    (props.selected?.kind === kind && props.selected.id === id)
  );
}
function isSelected(kind: SelectionKind, id: string): boolean {
  return props.selected?.kind === kind && props.selected.id === id;
}
function pick(kind: SelectionKind, id: string): void {
  if (movedRecently) {
    movedRecently = false;
    return;
  }
  emit('select', kind, id);
}
function onKey(event: KeyboardEvent, kind: SelectionKind, id: string): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    pick(kind, id);
  } else if (event.key === 'Escape') {
    emit('clear');
  }
}

// ---- hover 信息卡 ----
interface HoverState {
  kind: SelectionKind;
  id: string;
  px: number;
  py: number;
}
const hover = ref<HoverState | null>(null);
function placeHover(kind: SelectionKind, id: string, clientX: number, clientY: number): void {
  const rect = wrapEl.value?.getBoundingClientRect();
  if (!rect) return;
  hover.value = { kind, id, px: clientX - rect.left, py: clientY - rect.top };
}
function onEnter(kind: SelectionKind, id: string, e: PointerEvent): void {
  placeHover(kind, id, e.clientX, e.clientY);
}
function onFocus(kind: SelectionKind, id: string, e: FocusEvent): void {
  const r = (e.target as Element).getBoundingClientRect();
  placeHover(kind, id, r.left + r.width / 2, r.top + r.height / 2);
}
function clearHover(): void {
  hover.value = null;
}
const hoverCardStyle = computed(() => {
  const h = hover.value;
  const rect = wrapEl.value?.getBoundingClientRect();
  if (!h || !rect) return {};
  const left = Math.min(h.px + 14, Math.max(8, rect.width - 232));
  const top = Math.min(h.py + 14, Math.max(8, rect.height - 150));
  return { left: `${left}px`, top: `${top}px` };
});
const hoverInfo = computed<{ title: string; tag: string; lines: string[] } | null>(() => {
  const h = hover.value;
  if (!h) return null;
  if (h.kind === 'building') {
    const b = props.map.buildings.find((x) => x.id === h.id);
    if (!b) return null;
    const lines = [
      `${CATEGORY_STYLE[b.category].label} · ${formatBuildingFloors(b)} · 容量≈${b.capacity}`,
    ];
    if (b.risk_tag) lines.push(`风险：${b.risk_tag}`);
    const d = props.overlay.disaster.find((m) => m.building_id === b.id);
    const c = props.overlay.cordons.find((m) => m.building_id === b.id);
    const r = props.overlay.rescues.find((m) => m.building_id === b.id);
    if (d) lines.push(`灾情：${d.title} @${d.at_sim}`);
    if (c) lines.push(cordonText(c));
    if (r) lines.push(rescueText(r));
    return { title: b.name, tag: '楼栋', lines };
  }
  if (h.kind === 'road') {
    const road = props.map.road_segments.find((x) => x.id === h.id);
    if (!road) return null;
    const st = statusById.value.get(road.id);
    const lines = [
      st?.hazard ? `自然灾情：${HAZARD_LABEL[st.hazard]} @${st.hazard_at_sim}` : '自然灾情：无',
      st?.formally_closed ? `正式封闭 @${st.closed_at_sim} · seq${st.closed_by_action_seq}` : '正式封闭：未封闭',
    ];
    return { title: road.name, tag: '路段', lines };
  }
  const j = props.map.junctions.find((x) => x.id === h.id);
  if (!j) return null;
  return { title: j.name, tag: j.kind === 'gate' ? '校门' : '路口', lines: ['路网节点 · 非楼栋', '可作路径起点 / 终点'] };
});

const statusById = computed(() => {
  const m = new Map<string, RoadStatus>();
  for (const r of props.roads) m.set(r.road_id, r);
  return m;
});

function pointsAttr(points: readonly Point[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}

function roadLength(id: string): string {
  const len = props.map.road_lengths_px[id];
  return len === undefined ? '—' : len.toFixed(1);
}

function centroid(points: readonly Point[]): Point {
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  const n = points.length || 1;
  return { x: sx / n, y: sy / n };
}

function midMarker(points: readonly Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  const seg = Math.floor((points.length - 1) / 2);
  const a = points[seg];
  if (!a) return { x: 0, y: 0 };
  const b = points[seg + 1] ?? a;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function ringPoints(points: readonly Point[], scale: number): string {
  const c = centroid(points);
  return pointsAttr(points.map((p) => ({ x: c.x + (p.x - c.x) * scale, y: c.y + (p.y - c.y) * scale })));
}

function extent(points: readonly Point[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

// 2.5D 体量：高度仅由层数做视觉比例（需求允许），不对外当实测高度。
function massHeight(floors: number | null): number {
  const f = floors === null ? 2 : Math.min(floors, 8);
  return 10 + f * 4;
}
function shiftUp(points: readonly Point[], h: number): Point[] {
  return points.map((p) => ({ x: p.x, y: p.y - h }));
}
// 竖直挤出下只有朝屏幕下方（外法线 y>0）的侧壁可见。
function wallFaces(points: readonly Point[], h: number): string[] {
  const c = centroid(points);
  const faces: string[] = [];
  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % n];
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    let nx = dy;
    let ny = -dx;
    if (nx * (mid.x - c.x) + ny * (mid.y - c.y) < 0) {
      nx = -dy;
      ny = dx;
    }
    if (ny > 0.0001) {
      faces.push(pointsAttr([a, b, { x: b.x, y: b.y - h }, { x: a.x, y: a.y - h }]));
    }
  }
  return faces;
}

const routeRoadIds = computed<readonly string[]>(() =>
  props.route?.status === 'ready' ? props.route.road_ids : [],
);

interface RoadView {
  id: string;
  name: string;
  points: string;
  length: string;
  mid: Point;
  hazardLabel: string | null;
  hazardAt: number | null;
  closed: boolean;
  closedAt: number | null;
  closedSeq: number | null;
  onRoute: boolean;
  aria: string;
}

const roadViews = computed<RoadView[]>(() =>
  props.map.road_segments.map((road) => {
    const st = statusById.value.get(road.id);
    const hazard = st?.hazard ?? null;
    const closed = st?.formally_closed ?? false;
    const hazardLabel = hazard === null ? null : HAZARD_LABEL[hazard];
    return {
      id: road.id,
      name: road.name,
      points: pointsAttr(road.geometry),
      length: roadLength(road.id),
      mid: midMarker(road.geometry),
      hazardLabel,
      hazardAt: st?.hazard_at_sim ?? null,
      closed,
      closedAt: st?.closed_at_sim ?? null,
      closedSeq: st?.closed_by_action_seq ?? null,
      onRoute: routeRoadIds.value.includes(road.id),
      aria: `${road.name}，路段，${hazardLabel === null ? '无自然灾情' : `自然灾情${hazardLabel}@${st?.hazard_at_sim}`}, ${closed ? `已正式封闭@${st?.closed_at_sim}` : '未封闭'}${isSelected('road', road.id) ? '，已选中' : ''}`,
    };
  }),
);

interface BuildingView {
  id: string;
  name: string;
  points: string;
  ring: string;
  c: Point;
  rc: Point;
  h: number;
  roof: string;
  roofInset: string;
  walls: string[];
  shadow: string;
  box: { minX: number; minY: number; maxX: number; maxY: number };
  floors: string;
  capacity: number;
  risk: string | null;
  categoryLabel: string;
  fill: string;
  color: string;
  disasterTitle: string | null;
  disasterAt: number | null;
  cordonLabel: string | null;
  rescueLabel: string | null;
  aria: string;
}

const buildingViews = computed<BuildingView[]>(() =>
  props.map.buildings.map((b) => {
    const c = centroid(b.polygon);
    const box = extent(b.polygon);
    const h = massHeight(b.floors);
    const roofPts = shiftUp(b.polygon, h);
    const rc = { x: c.x, y: c.y - h };
    const disaster = props.layers.disaster
      ? props.overlay.disaster.find((m) => m.building_id === b.id)
      : undefined;
    const cordon = props.layers.cordon ? props.overlay.cordons.find((m) => m.building_id === b.id) : undefined;
    const rescue = props.layers.rescue ? props.overlay.rescues.find((m) => m.building_id === b.id) : undefined;
    const floors = formatBuildingFloors(b);
    return {
      id: b.id,
      name: b.name,
      points: pointsAttr(b.polygon),
      ring: ringPoints(b.polygon, 1.18),
      c,
      rc,
      h,
      roof: pointsAttr(roofPts),
      roofInset: ringPoints(roofPts, 0.8),
      walls: wallFaces(b.polygon, h),
      shadow: pointsAttr(b.polygon.map((p) => ({ x: p.x + h * 0.35, y: p.y + h * 0.25 }))),
      box,
      floors,
      capacity: b.capacity,
      risk: b.risk_tag,
      categoryLabel: CATEGORY_STYLE[b.category].label,
      fill: CATEGORY_STYLE[b.category].fill,
      color: CATEGORY_STYLE[b.category].color,
      disasterTitle: disaster?.title ?? null,
      disasterAt: disaster?.at_sim ?? null,
      cordonLabel: cordon ? cordonText(cordon) : null,
      rescueLabel: rescue ? rescueText(rescue) : null,
      aria: `${b.name}，楼栋，${CATEGORY_STYLE[b.category].label}，${floors}，估算容量${b.capacity}${b.risk_tag === null ? '' : `，风险${b.risk_tag}`}${disaster ? `，灾情：${disaster.title}` : ''}${cordon ? `，${cordonText(cordon)}` : ''}${rescue ? `，${rescueText(rescue)}` : ''}${isSelected('building', b.id) ? '，已选中' : ''}`,
    };
  }),
);

const junctionViews = computed(() =>
  props.map.junctions
    .map((j) => ({ junction: j, pos: props.map.junction_positions[j.id] }))
    .filter((v): v is { junction: (typeof props.map.junctions)[number]; pos: Point } => v.pos !== undefined),
);

const routePoints = computed(() => (props.route?.status === 'ready' ? pointsAttr(props.route.points) : ''));
const routeEnds = computed<readonly Point[]>(() => {
  if (props.route?.status !== 'ready' || props.route.points.length === 0) return [];
  const first = props.route.points[0];
  const last = props.route.points[props.route.points.length - 1];
  return first && last ? [first, last] : [];
});

const zoneGroups = computed(() => {
  const acc = new Map<string, { x: number; y: number; n: number }>();
  for (const b of props.map.buildings) {
    const c = centroid(b.polygon);
    const g = acc.get(b.zone) ?? { x: 0, y: 0, n: 0 };
    g.x += c.x;
    g.y += c.y;
    g.n += 1;
    acc.set(b.zone, g);
  }
  return [...acc.entries()].map(([zone, g]) => ({ zone, x: g.x / g.n, y: g.y / g.n }));
});

const presentCategories = computed(() => {
  const seen = new Set(props.map.buildings.map((b) => b.category));
  return [...seen].map((cat) => ({ cat, ...CATEGORY_STYLE[cat] }));
});
</script>

<template>
  <div class="map-wrap" ref="wrapEl">
    <svg
      ref="svgEl"
      class="campus-svg"
      :viewBox="viewString"
      preserveAspectRatio="xMidYMid meet"
      role="group"
      aria-label="校园路网训练地图（示例回放，训练模拟数据）：楼栋、路段、路口均可点选；滚轮缩放、拖拽平移、双击复位"
      @click="onSvgClick"
      @keydown.escape="emit('clear')"
      @wheel.prevent="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @dblclick.prevent="resetViewClean"
    >
      <defs>
        <pattern id="map-grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" class="grid-line" />
        </pattern>
        <filter id="hazard-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="zone-soft" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="26" />
        </filter>
        <linearGradient id="bld-sheen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-opacity="0.16" />
          <stop offset="1" stop-opacity="0" />
        </linearGradient>
      </defs>

      <rect :x="map.view_box.x" :y="map.view_box.y" :width="map.view_box.width" :height="map.view_box.height" class="stage-bg" />
      <rect :x="map.view_box.x" :y="map.view_box.y" :width="map.view_box.width" :height="map.view_box.height" fill="url(#map-grid)" />

      <!-- 分区底晕 + 小字号分区名（由 buildings.zone 聚合，非硬编码） -->
      <g class="layer-zones" aria-hidden="true">
        <ellipse v-for="z in zoneGroups" :key="`tint-${z.zone}`" :cx="z.x" :cy="z.y" rx="150" ry="100" class="zone-tint" filter="url(#zone-soft)" />
        <text v-for="z in zoneGroups" :key="z.zone" :x="z.x" :y="z.y" text-anchor="middle" class="zone-name">{{ z.zone }}</text>
      </g>

      <!-- 路段层：路肩 + 路面 + 中心线；透明宽描边为触屏命中区 -->
      <g class="layer-roads">
        <g
          v-for="rv in roadViews"
          :key="rv.id"
          class="road selectable"
          :class="{ 'is-hl': isHl('road', rv.id), 'is-selected': isSelected('road', rv.id), 'is-route': rv.onRoute }"
          tabindex="0"
          role="button"
          :aria-pressed="isSelected('road', rv.id)"
          :aria-label="rv.aria"
          @click.stop="pick('road', rv.id)"
          @keydown="onKey($event, 'road', rv.id)"
          @pointerenter="onEnter('road', rv.id, $event)"
          @pointerleave="clearHover"
          @focus="onFocus('road', rv.id, $event)"
          @blur="clearHover"
        >
          <polyline :points="rv.points" class="road-hit" />
          <polyline :points="rv.points" class="road-shoulder" />
          <polyline :points="rv.points" class="road-surface" />
          <polyline v-if="!rv.closed" :points="rv.points" class="road-center" />
          <polyline v-if="rv.onRoute" :points="rv.points" class="road-route" />
          <polyline
            v-if="rv.hazardLabel !== null && layers.disaster"
            :points="rv.points"
            class="road-hazard"
            filter="url(#hazard-glow)"
          />
          <polyline :points="rv.points" class="focus-ring" />
          <g v-if="rv.hazardLabel !== null && layers.disaster" :transform="`translate(${rv.mid.x}, ${rv.mid.y - 16})`" class="mark-hazard">
            <rect x="-26" y="-12" width="52" height="22" rx="5" />
            <text x="0" y="3" text-anchor="middle">{{ rv.hazardLabel }} @{{ rv.hazardAt }}</text>
          </g>
          <g v-if="rv.closed" :transform="`translate(${rv.mid.x}, ${rv.mid.y - 44})`" class="mark-closed">
            <rect x="-34" y="-12" width="68" height="22" rx="5" />
            <line x1="-26" y1="-1" x2="-14" y2="-1" class="barrier" />
            <text x="6" y="3" text-anchor="middle">封闭·seq{{ rv.closedSeq }}</text>
          </g>
          <g v-if="isSelected('road', rv.id)" :transform="`translate(${rv.mid.x}, ${rv.mid.y - 70})`" class="sel-tag">
            <rect x="-20" y="-11" width="40" height="20" rx="4" />
            <text x="0" y="3" text-anchor="middle">选中</text>
          </g>
          <title>{{ rv.name }} · 图上长度 {{ rv.length }} px（训练级简化，非官方路名）</title>
        </g>
      </g>

      <!-- 楼栋层：2.5D 体量（阴影 + 侧壁 + 屋顶），几何仍来自 fixture polygon -->
      <g class="layer-buildings">
        <g
          v-for="bv in buildingViews"
          :key="bv.id"
          class="building selectable"
          :class="{ 'is-hl': isHl('building', bv.id), 'is-selected': isSelected('building', bv.id) }"
          tabindex="0"
          role="button"
          :aria-pressed="isSelected('building', bv.id)"
          :aria-label="bv.aria"
          @click.stop="pick('building', bv.id)"
          @keydown="onKey($event, 'building', bv.id)"
          @pointerenter="onEnter('building', bv.id, $event)"
          @pointerleave="clearHover"
          @focus="onFocus('building', bv.id, $event)"
          @blur="clearHover"
        >
          <polygon :points="bv.shadow" class="bld-shadow" />
          <polygon :points="bv.points" class="bld-ground" :style="{ stroke: bv.color }" />
          <template v-for="(w, i) in bv.walls" :key="`w${i}`">
            <polygon :points="w" :style="{ fill: bv.color }" />
            <polygon :points="w" class="wall-shade" />
          </template>
          <polygon v-if="bv.cordonLabel !== null" :points="bv.ring" class="cordon-ring" />
          <polygon :points="bv.roof" class="bld-roof" :style="{ fill: bv.fill, stroke: bv.color }" />
          <polygon :points="bv.roof" fill="url(#bld-sheen)" stroke="none" />
          <polygon :points="bv.roofInset" class="roof-inset" :style="{ stroke: bv.color }" />
          <polygon :points="bv.roof" class="focus-ring" />
          <text :x="bv.rc.x" :y="bv.rc.y - 14" text-anchor="middle" class="b-name">{{ bv.name }}</text>
          <text :x="bv.rc.x" :y="bv.rc.y + 6" text-anchor="middle" class="b-meta">{{ bv.floors }} · 容量≈{{ bv.capacity }}</text>
          <text v-if="bv.risk !== null" :x="bv.rc.x" :y="bv.rc.y + 26" text-anchor="middle" class="b-risk">▲ {{ bv.risk }}</text>
          <g v-if="bv.cordonLabel !== null" class="mark-cordon">
            <text :x="bv.c.x" :y="bv.box.minY - 26 - bv.h" text-anchor="middle">{{ bv.cordonLabel }}</text>
          </g>
          <g v-if="bv.disasterTitle !== null" class="mark-disaster">
            <g :transform="`translate(${bv.box.minX + 14}, ${bv.box.minY + 14 - bv.h})`">
              <circle r="8" />
              <path d="M 0 -4 L 0 1 M 0 4 L 0 4.5" class="bang" />
            </g>
            <text :x="bv.c.x" :y="bv.box.minY - 10 - bv.h" text-anchor="middle">{{ bv.disasterTitle }} @{{ bv.disasterAt }}</text>
          </g>
          <g v-if="bv.rescueLabel !== null" class="mark-rescue">
            <g :transform="`translate(${bv.box.maxX - 14}, ${bv.box.minY + 14})`">
              <circle r="8" />
              <path d="M -4 0 L 4 0 M 0 -4 L 0 4" class="cross" />
            </g>
            <text :x="bv.c.x" :y="bv.box.maxY + 14" text-anchor="middle">{{ bv.rescueLabel }}</text>
          </g>
          <g v-if="isSelected('building', bv.id)" :transform="`translate(${bv.box.maxX + 6}, ${bv.box.minY - 6 - bv.h})`" class="sel-tag">
            <rect x="0" y="-11" width="40" height="20" rx="4" />
            <text x="20" y="3" text-anchor="middle">选中</text>
          </g>
          <title>{{ bv.name }} · {{ bv.categoryLabel }} · {{ bv.floors }} · 估算容量 {{ bv.capacity }}{{ bv.risk ? ' · 风险：' + bv.risk : '' }}</title>
        </g>
      </g>

      <!-- 路径线层：只消费 RouteResult.points；A 未交付时恒不渲染 -->
      <g v-if="routePoints !== ''" class="layer-route" aria-hidden="true">
        <polyline :points="routePoints" class="route-casing" />
        <polyline :points="routePoints" class="route-line" />
        <circle v-for="(p, i) in routeEnds" :key="i" :cx="p.x" :cy="p.y" r="6" class="route-end" />
      </g>

      <!-- 路口层：路网节点，非楼栋 -->
      <g class="layer-junctions">
        <g
          v-for="v in junctionViews"
          :key="v.junction.id"
          class="junction selectable"
          :class="{ 'is-hl': isHl('junction', v.junction.id), 'is-selected': isSelected('junction', v.junction.id) }"
          :transform="`translate(${v.pos.x}, ${v.pos.y})`"
          tabindex="0"
          role="button"
          :aria-pressed="isSelected('junction', v.junction.id)"
          :aria-label="`${v.junction.name}，路口，路网节点非楼栋${isSelected('junction', v.junction.id) ? '，已选中' : ''}`"
          @click.stop="pick('junction', v.junction.id)"
          @keydown="onKey($event, 'junction', v.junction.id)"
          @pointerenter="onEnter('junction', v.junction.id, $event)"
          @pointerleave="clearHover"
          @focus="onFocus('junction', v.junction.id, $event)"
          @blur="clearHover"
        >
          <circle r="24" class="junction-hit" />
          <circle v-if="v.junction.kind === 'gate'" r="6" class="gate-ping" />
          <path v-if="v.junction.kind === 'gate'" d="M -14 10 L -14 -8 L 14 -8 L 14 10 M -14 -8 L 0 -16 L 14 -8" class="gate-glyph" />
          <circle v-else r="7" class="crossing-glyph" />
          <circle :r="v.junction.kind === 'gate' ? 20 : 14" class="focus-ring" />
          <g v-if="isSelected('junction', v.junction.id)" transform="translate(16, -16)" class="sel-tag">
            <rect x="0" y="-11" width="40" height="20" rx="4" />
            <text x="20" y="3" text-anchor="middle">选中</text>
          </g>
          <text x="0" y="30" text-anchor="middle" class="j-name">{{ v.junction.name }}</text>
          <title>{{ v.junction.name }}（路网节点，非楼栋）</title>
        </g>
      </g>
    </svg>

    <!-- 缩放控件（≥44px 触控） -->
    <div class="map-hud map-zoom" role="group" aria-label="地图视图控制">
      <button type="button" class="map-btn" aria-label="放大地图" @click="zoomCenter(1.25)">＋</button>
      <button type="button" class="map-btn" aria-label="缩小地图" @click="zoomCenter(1 / 1.25)">－</button>
      <button type="button" class="map-btn" aria-label="复位视图" @click="resetViewClean">⤾</button>
      <span class="map-zoom-level mono">{{ zoomLevel.toFixed(1) }}×</span>
    </div>

    <!-- 指北针 + 示意比例（不暗示实测距离） -->
    <div class="map-hud map-orient" aria-hidden="true">
      <span class="north">N▲</span>
      <span class="scalebar"><i></i>示意比例 · 非实测</span>
    </div>

    <!-- 图上迷你图例：颜色 + 文字双通道 -->
    <div class="map-hud map-minilegend" aria-label="地图图例">
      <span v-for="c in presentCategories" :key="c.cat" class="lg-item">
        <i class="lg-swatch" :style="{ background: c.fill, borderColor: c.color }"></i>{{ c.label }}
      </span>
      <span class="lg-item"><i class="lg-line lg-open"></i>通行</span>
      <span class="lg-item"><i class="lg-line lg-hazard"></i>灾情</span>
      <span class="lg-item"><i class="lg-line lg-closed"></i>封闭</span>
    </div>

    <!-- hover / 焦点信息卡 -->
    <div v-if="hoverInfo" class="map-hovercard" :style="hoverCardStyle" role="status">
      <div class="hc-head">
        <span class="hc-title">{{ hoverInfo.title }}</span>
        <span class="hc-tag">{{ hoverInfo.tag }}</span>
      </div>
      <p v-for="(line, i) in hoverInfo.lines" :key="i" class="hc-line">{{ line }}</p>
    </div>
  </div>
</template>

<style scoped>
.map-wrap { position: relative; width: 100%; height: 100%; min-width: 0; }
.campus-svg {
  display: block;
  width: 100%;
  height: 100%;
  border: none;
  background: transparent;
  touch-action: none;
  cursor: grab;
}
.campus-svg:active { cursor: grabbing; }

.stage-bg { fill: var(--ink-950); }
.grid-line { fill: none; stroke: var(--grid-svg); stroke-width: 1; }
#bld-sheen stop { stop-color: var(--sheen); }

.zone-tint { fill: var(--zone-ink); opacity: 0.10; pointer-events: none; }
.zone-name {
  fill: var(--zone-ink);
  font-size: 20px;
  font-weight: 800;
  letter-spacing: 0.3em;
  font-family: var(--font-sans);
  pointer-events: none;
}

.selectable { cursor: pointer; }
.selectable:focus { outline: none; }
.focus-ring {
  fill: none;
  stroke: var(--amber);
  stroke-width: 2.5;
  stroke-dasharray: 5 4;
  opacity: 0;
  pointer-events: none;
}
.selectable:focus-visible .focus-ring { opacity: 1; }

.road-hit { fill: none; stroke: transparent; stroke-width: 22; stroke-linecap: round; stroke-linejoin: round; pointer-events: stroke; }
.road-shoulder { fill: none; stroke: var(--road-base); stroke-width: 11; stroke-linecap: round; stroke-linejoin: round; }
.road-surface { fill: none; stroke: var(--ink-800); stroke-width: 7; stroke-linecap: round; stroke-linejoin: round; }
.road-center {
  fill: none;
  stroke: var(--road-open);
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-dasharray: 8 14;
  animation: dash-march 1.6s linear infinite;
}
.road-route {
  fill: none;
  stroke: var(--route-line);
  stroke-width: 3;
  stroke-linecap: round;
  stroke-dasharray: 10 7;
  animation: dash-march 1.2s linear infinite;
  pointer-events: none;
}
.road-hazard {
  fill: none;
  stroke: var(--blue);
  stroke-width: 7;
  stroke-linecap: round;
  stroke-dasharray: 2 10;
  animation: hazard-pulse 1.4s ease-in-out infinite;
  pointer-events: none;
}

.mark-hazard rect { fill: var(--mark-blue); stroke: var(--blue); stroke-width: 1.5; }
.mark-hazard text { fill: var(--blue); font-size: 11px; font-weight: 700; font-family: var(--font-sans); }
.mark-hazard { animation: hazard-pulse 1.4s ease-in-out infinite; pointer-events: none; }
.mark-closed rect { fill: var(--mark-red); stroke: var(--red); stroke-width: 1.5; }
.mark-closed text { fill: var(--red); font-size: 11px; font-weight: 700; font-family: var(--font-mono); }
.mark-closed .barrier { stroke: var(--red); stroke-width: 3; stroke-linecap: round; }
.mark-closed { pointer-events: none; }

/* 2.5D 体量 */
.bld-shadow { fill: var(--ink-950); opacity: 0.5; pointer-events: none; }
.bld-ground { fill: none; stroke-width: 1.5; opacity: 0.4; pointer-events: none; }
.wall-shade { fill: var(--ink-950); opacity: 0.42; pointer-events: none; }
.bld-roof { stroke-width: 2; stroke-linejoin: round; transition: stroke-width 0.12s ease; }
.roof-inset { fill: none; stroke-width: 1; opacity: 0.5; pointer-events: none; }
.building.is-hl .bld-roof { stroke-width: 4; filter: drop-shadow(0 0 7px var(--glow-amber-soft)); }
.building.is-selected .bld-roof { stroke-width: 4; filter: drop-shadow(0 0 9px var(--glow-amber-soft)); }
.road.is-hl .road-shoulder { stroke-width: 14; }
.road.is-hl { filter: drop-shadow(0 0 6px var(--glow-amber-soft)); }
.road.is-selected .road-shoulder { stroke-width: 14; }
.junction.is-hl .gate-glyph, .junction.is-hl .crossing-glyph { stroke-width: 4; filter: drop-shadow(0 0 6px var(--glow-amber-soft)); }

.b-name {
  fill: var(--paper);
  font-size: 13px;
  font-weight: 700;
  font-family: var(--font-sans);
  paint-order: stroke;
  stroke: var(--halo);
  stroke-width: 3;
  pointer-events: none;
}
.b-meta {
  fill: var(--muted);
  font-size: 11px;
  font-family: var(--font-mono);
  paint-order: stroke;
  stroke: var(--halo);
  stroke-width: 3;
  pointer-events: none;
}
.b-risk { fill: var(--amber); font-size: 9.5px; font-family: var(--font-sans); paint-order: stroke; stroke: var(--halo); stroke-width: 3; pointer-events: none; }

.mark-disaster circle { fill: var(--mark-blue); stroke: var(--blue); stroke-width: 1.5; }
.mark-disaster .bang { stroke: var(--blue); stroke-width: 2; stroke-linecap: round; fill: none; }
.mark-disaster text {
  fill: var(--blue);
  font-size: 10.5px;
  font-weight: 700;
  font-family: var(--font-sans);
  paint-order: stroke;
  stroke: var(--halo);
  stroke-width: 3;
}
.mark-disaster { pointer-events: none; }
.cordon-ring { fill: none; stroke: var(--amber); stroke-width: 2.5; stroke-dasharray: 7 5; pointer-events: none; }
.mark-cordon text {
  fill: var(--amber);
  font-size: 10.5px;
  font-weight: 700;
  font-family: var(--font-sans);
  paint-order: stroke;
  stroke: var(--halo);
  stroke-width: 3;
}
.mark-cordon { pointer-events: none; }
.mark-rescue circle { fill: var(--green-soft); stroke: var(--green); stroke-width: 1.5; }
.mark-rescue .cross { stroke: var(--green); stroke-width: 2.5; stroke-linecap: round; fill: none; }
.mark-rescue text {
  fill: var(--green);
  font-size: 10.5px;
  font-weight: 700;
  font-family: var(--font-sans);
  paint-order: stroke;
  stroke: var(--halo);
  stroke-width: 3;
}
.mark-rescue { pointer-events: none; }

.sel-tag rect { fill: var(--amber); stroke: var(--ink-950); stroke-width: 1; }
.sel-tag text { fill: var(--ink-950); font-size: 11px; font-weight: 800; font-family: var(--font-sans); }
.sel-tag { pointer-events: none; filter: drop-shadow(0 0 6px var(--glow-amber-soft)); }

.layer-route { pointer-events: none; }
.route-casing { fill: none; stroke: var(--route-casing); stroke-width: 9; stroke-linecap: round; stroke-linejoin: round; opacity: 0.85; }
.route-line {
  fill: none;
  stroke: var(--route-line);
  stroke-width: 4;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 14 8;
  animation: dash-march 1.2s linear infinite;
}
.route-end { fill: var(--route-line); stroke: var(--route-casing); stroke-width: 2.5; }

.junction-hit { fill: transparent; stroke: none; pointer-events: all; }
.gate-ping { fill: none; stroke: var(--amber); stroke-width: 2; animation: gate-ping 2.2s ease-out infinite; pointer-events: none; }
.gate-glyph { fill: none; stroke: var(--amber); stroke-width: 3; stroke-linejoin: round; stroke-linecap: round; filter: drop-shadow(0 0 6px var(--glow-amber)); }
.crossing-glyph { fill: var(--ink-800); stroke: var(--muted); stroke-width: 2; }
.j-name { fill: var(--amber); font-size: 12px; font-weight: 600; font-family: var(--font-sans); paint-order: stroke; stroke: var(--halo); stroke-width: 3; pointer-events: none; }

/* HUD 覆盖层 */
.map-hud { position: absolute; z-index: 3; }
.map-zoom { left: 10px; top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; gap: 6px; align-items: center; }
.map-btn {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: 1px solid var(--line, var(--grid-svg));
  border-radius: 10px;
  background: var(--ink-900, var(--ink-800));
  color: var(--paper);
  font-size: 18px;
  font-weight: 700;
  cursor: pointer;
}
.map-btn:hover { border-color: var(--amber); color: var(--amber); }
.map-btn:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; }
.map-zoom-level { font-size: 11px; color: var(--muted); background: var(--ink-950); padding: 2px 6px; border-radius: 6px; }
.map-orient { right: 10px; top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; align-items: flex-end; gap: 6px; pointer-events: none; }
.north { color: var(--amber); font-size: 13px; font-weight: 800; font-family: var(--font-mono); }
.scalebar { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 10.5px; }
.scalebar i { display: inline-block; width: 56px; height: 4px; border-left: 2px solid var(--muted); border-right: 2px solid var(--muted); border-bottom: 2px solid var(--muted); }
.map-minilegend {
  left: 10px;
  bottom: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  max-width: 62%;
  padding: 6px 8px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--ink-950) 82%, transparent);
  pointer-events: none;
}
.lg-item { display: inline-flex; align-items: center; gap: 4px; color: var(--paper); font-size: 10.5px; }
.lg-swatch { width: 10px; height: 10px; border-radius: 3px; border: 1.5px solid; display: inline-block; }
.lg-line { width: 16px; height: 0; border-top: 3px solid; display: inline-block; }
.lg-open { border-top-color: var(--road-open); border-top-style: dashed; }
.lg-hazard { border-top-color: var(--blue); }
.lg-closed { border-top-color: var(--red); }
.map-hovercard {
  position: absolute;
  z-index: 4;
  width: 220px;
  padding: 8px 10px;
  border: 1px solid var(--amber);
  border-radius: 10px;
  background: var(--ink-950);
  box-shadow: 0 6px 18px rgb(0 0 0 / 0.4);
  pointer-events: none;
}
.hc-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.hc-title { color: var(--paper); font-size: 13px; font-weight: 700; }
.hc-tag { color: var(--amber); font-size: 10.5px; font-weight: 700; border: 1px solid var(--amber); border-radius: 4px; padding: 0 4px; }
.hc-line { margin: 2px 0; color: var(--muted); font-size: 11.5px; line-height: 1.5; }

@media (max-width: 400px) {
  .map-minilegend { max-width: 78%; gap: 3px 8px; }
  .lg-item { font-size: 10px; }
  .map-hovercard { width: 180px; }
}
</style>
