<script setup lang="ts">
import { computed } from 'vue';
import type { MapView, RoadStatus, RouteResult } from '../fixture-port';
import type { Point } from '../contracts';
import { CATEGORY_STYLE, HAZARD_LABEL } from '../config/categories';
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

// 取折线中间一段的中点，用于放置灾情/封闭标记（纯视觉定位，非地图派生）。
function midMarker(points: readonly Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  const seg = Math.floor((points.length - 1) / 2);
  const a = points[seg];
  if (!a) return { x: 0, y: 0 };
  const b = points[seg + 1] ?? a;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// 警戒线：polygon 顶点相对质心等比放大（纯视觉，非地图派生）。
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
    const disaster = props.layers.disaster
      ? props.overlay.disaster.find((m) => m.building_id === b.id)
      : undefined;
    const cordon = props.layers.cordon ? props.overlay.cordons.find((m) => m.building_id === b.id) : undefined;
    const rescue = props.layers.rescue ? props.overlay.rescues.find((m) => m.building_id === b.id) : undefined;
    const floors = b.floors === null ? '通高' : `${b.floors} 层`;
    return {
      id: b.id,
      name: b.name,
      points: pointsAttr(b.polygon),
      ring: ringPoints(b.polygon, 1.18),
      c,
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
</script>

<template>
  <svg
    class="campus-svg"
    :viewBox="map.view_box_svg"
    preserveAspectRatio="xMidYMid meet"
    role="group"
    aria-label="校园路网训练地图（示例回放，训练模拟数据）：楼栋、路段、路口均可点选"
    @click="emit('clear')"
    @keydown.escape="emit('clear')"
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
      <linearGradient id="bld-sheen" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-opacity="0.10" />
        <stop offset="1" stop-opacity="0" />
      </linearGradient>
    </defs>

    <rect :x="map.view_box.x" :y="map.view_box.y" :width="map.view_box.width" :height="map.view_box.height" class="stage-bg" />
    <rect :x="map.view_box.x" :y="map.view_box.y" :width="map.view_box.width" :height="map.view_box.height" fill="url(#map-grid)" />

    <!-- 分区水印（由 buildings.zone 聚合，非硬编码） -->
    <g class="layer-zones">
      <text v-for="z in zoneGroups" :key="z.zone" :x="z.x" :y="z.y" text-anchor="middle" class="zone-name">{{ z.zone }}</text>
    </g>

    <!-- 路段层（在楼栋之下）；透明宽描边为触屏命中区，视觉不变 -->
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
      >
        <polyline :points="rv.points" class="road-hit" />
        <polyline :points="rv.points" class="road-base" />
        <polyline v-if="!rv.closed" :points="rv.points" class="road-open" />
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

    <!-- 楼栋层 -->
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
      >
        <polygon v-if="bv.cordonLabel !== null" :points="bv.ring" class="cordon-ring" />
        <polygon
          :points="bv.points"
          class="bld-body"
          :style="{ fill: bv.fill, stroke: bv.color }"
          stroke-width="2"
          stroke-linejoin="round"
        />
        <polygon :points="bv.points" fill="url(#bld-sheen)" stroke="none" />
        <polygon :points="bv.points" class="focus-ring" />
        <text :x="bv.c.x" :y="bv.c.y - 14" text-anchor="middle" class="b-name">{{ bv.name }}</text>
        <text :x="bv.c.x" :y="bv.c.y + 6" text-anchor="middle" class="b-meta">{{ bv.floors }} · 容量≈{{ bv.capacity }}</text>
        <text v-if="bv.risk !== null" :x="bv.c.x" :y="bv.c.y + 26" text-anchor="middle" class="b-risk">▲ {{ bv.risk }}</text>
        <g v-if="bv.cordonLabel !== null" class="mark-cordon">
          <text :x="bv.c.x" :y="bv.box.minY - 26" text-anchor="middle">{{ bv.cordonLabel }}</text>
        </g>
        <g v-if="bv.disasterTitle !== null" class="mark-disaster">
          <g :transform="`translate(${bv.box.minX + 14}, ${bv.box.minY + 14})`">
            <circle r="8" />
            <path d="M 0 -4 L 0 1 M 0 4 L 0 4.5" class="bang" />
          </g>
          <text :x="bv.c.x" :y="bv.box.minY - 10" text-anchor="middle">{{ bv.disasterTitle }} @{{ bv.disasterAt }}</text>
        </g>
        <g v-if="bv.rescueLabel !== null" class="mark-rescue">
          <g :transform="`translate(${bv.box.maxX - 14}, ${bv.box.minY + 14})`">
            <circle r="8" />
            <path d="M -4 0 L 4 0 M 0 -4 L 0 4" class="cross" />
          </g>
          <text :x="bv.c.x" :y="bv.box.maxY + 14" text-anchor="middle">{{ bv.rescueLabel }}</text>
        </g>
        <g v-if="isSelected('building', bv.id)" :transform="`translate(${bv.box.maxX + 6}, ${bv.box.minY - 6})`" class="sel-tag">
          <rect x="0" y="-11" width="40" height="20" rx="4" />
          <text x="20" y="3" text-anchor="middle">选中</text>
        </g>
        <title>{{ bv.name }} · {{ bv.categoryLabel }} · {{ bv.floors }} · 估算容量 {{ bv.capacity }}{{ bv.risk ? ' · 风险：' + bv.risk : '' }}</title>
      </g>
    </g>

    <!-- 路径线层：只消费 RouteResult.points，不自己拼几何；A 未交付时恒不渲染 -->
    <g v-if="routePoints !== ''" class="layer-route" aria-hidden="true">
      <polyline :points="routePoints" class="route-casing" />
      <polyline :points="routePoints" class="route-line" />
      <circle v-for="(p, i) in routeEnds" :key="i" :cx="p.x" :cy="p.y" r="6" class="route-end" />
    </g>

    <!-- 路口层：路网节点，非楼栋、不计入楼栋数；D2 开放点选但保持非楼栋语义 -->
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
</template>

<style scoped>
.campus-svg {
  display: block;
  width: 100%;
  height: 100%;
  border: none;
  background: transparent;
}

.stage-bg { fill: var(--ink-950); }
.grid-line { fill: none; stroke: var(--grid-svg); stroke-width: 1; }
#bld-sheen stop { stop-color: var(--sheen); }

.zone-name {
  fill: var(--zone-ink);
  font-size: 44px;
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
.road-base {
  fill: none;
  stroke: var(--road-base);
  stroke-width: 7;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.road-open {
  fill: none;
  stroke: var(--road-open);
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-dasharray: 6 18;
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

/* 辉光只给“正在被指向的对象”，平时楼栋是干净的描边 + 顶部微光 */
.building .bld-body { transition: stroke-width 0.12s ease; }
.building.is-hl .bld-body { stroke-width: 4; filter: drop-shadow(0 0 7px var(--glow-amber-soft)); }
.road.is-hl .road-base { stroke-width: 11; }
.road.is-hl { filter: drop-shadow(0 0 6px var(--glow-amber-soft)); }
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

/* 灾情（楼栋）：蓝色感叹号 + title 文字，位置由 polygon 包围盒派生 */
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

/* 警戒：polygon 外扩虚线圈 + 状态文字 */
.cordon-ring {
  fill: none;
  stroke: var(--amber);
  stroke-width: 2.5;
  stroke-dasharray: 7 5;
  pointer-events: none;
}
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

/* 救援队：绿色十字标 + 静态状态文字；无寻路结果时绝不画行进折线 */
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

/* 选中文字标识：颜色之外必须有文字（T5） */
.sel-tag rect { fill: var(--amber); stroke: var(--ink-950); stroke-width: 1; }
.sel-tag text { fill: var(--ink-950); font-size: 11px; font-weight: 800; font-family: var(--font-sans); }
.sel-tag { pointer-events: none; }

/* 路径线：纸色主线 + 反色护边，双主题都与灾情蓝/封闭红区分 */
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
</style>