<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { MapView, RoadStatus, RouteResult } from '../fixture-port';
import type { Point } from '../contracts';
import { roadDrawingPoints, routeDrawingPoints } from '../config/map-roads';
import { CATEGORY_STYLE, HAZARD_LABEL, formatBuildingFloors } from '../config/categories';
import { simStamp } from '../config/format';
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
    orderMarks?: readonly { key: string; target: Selection; text: string; complete: boolean }[];
  }>(),
  {
    highlight: null,
    selected: null,
    overlay: () => EMPTY_OVERLAY,
    layers: () => ({ disaster: true, cordon: true, rescue: true }),
    route: null,
    orderMarks: () => [],
  },
);

const emit = defineEmits<{
  (e: 'select', kind: SelectionKind, id: string): void;
  (e: 'clear'): void;
}>();

// 平行斜投影。立面、屋顶和地面都用同一套轴，地图点位保持在地面。
const KY = 0.77;
const KZ = 0.67;
const KX = 0.26;
const SHEAR = 0.075;
function proj(x: number, y: number, z = 0): Point {
  return { x: x + y * SHEAR + z * KX, y: y * KY - z * KZ };
}
function projPts(points: readonly Point[], z = 0): Point[] {
  return points.map((p) => proj(p.x, p.y, z));
}
function pointsAttr(points: readonly Point[]): string {
  return points.map((p) => `${round2(p.x)},${round2(p.y)}`).join(' ');
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function projAttr(points: readonly Point[], z = 0): string {
  return pointsAttr(projPts(points, z));
}
function linePath(points: readonly Point[]): string {
  return points.map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'} ${round2(x)} ${round2(y)}`).join(' ');
}

// 体量高度仅由层数做视觉比例，不对外当实测高度。
function massHeight(floors: number | null): number {
  const f = floors === null ? 2 : Math.min(floors, 8);
  return 12 + f * 4.8;
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
type Box = { minX: number; minY: number; maxX: number; maxY: number };
function boxRect(b: Box): Point[] {
  return [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ];
}
function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// 竖直挤出 + 斜投影下，外法线朝屏幕下方（ny>0）或朝左（nx<0）的侧壁可见。
interface Wall {
  a: Point;
  b: Point;
  quad: string;
  side: 'south' | 'west';
}
function wallFaces(points: readonly Point[], h: number, z0 = 0): Wall[] {
  const c = centroid(points);
  const faces: Wall[] = [];
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
    if (ny > 0.0001 || nx < -0.0001) {
      faces.push({
        a,
        b,
        quad: pointsAttr([proj(a.x, a.y, z0), proj(b.x, b.y, z0), proj(b.x, b.y, z0 + h), proj(a.x, a.y, z0 + h)]),
        side: ny > 0.0001 ? 'south' : 'west',
      });
    }
  }
  return faces;
}
// 侧壁上的横向窗带 / 入口凹龛：沿墙水平取段、沿高度取段。
function wallStrip(w: Wall, h: number, z0: number, f0: number, f1: number, t0: number, t1: number): string {
  const a0 = lerp(w.a, w.b, f0);
  const b0 = lerp(w.a, w.b, f1);
  return pointsAttr([
    proj(a0.x, a0.y, z0 + h * t0),
    proj(b0.x, b0.y, z0 + h * t0),
    proj(b0.x, b0.y, z0 + h * t1),
    proj(a0.x, a0.y, z0 + h * t1),
  ]);
}
function southWall(walls: readonly Wall[]): Wall | null {
  let best: Wall | null = null;
  let bestY = -Infinity;
  for (const w of walls) {
    const my = (w.a.y + w.b.y) / 2;
    if (my > bestY) {
      bestY = my;
      best = w;
    }
  }
  return best;
}

// ---- 视图缩放 / 平移（只改投影空间 viewBox，不改数据几何） ----
const wrapEl = ref<HTMLElement | null>(null);
const svgEl = ref<SVGSVGElement | null>(null);
const view = ref({ x: 0, y: 0, w: 1, h: 1 });

const maxLift = computed(() => {
  let m = 0;
  for (const b of props.map.buildings) m = Math.max(m, massHeight(b.floors));
  return m * KZ + 14; // 屋顶设备 / 树冠余量
});
const sceneBounds = computed(() => {
  const vb = props.map.view_box;
  const padX = 34;
  const left = proj(vb.x, vb.y).x - padX;
  const right = proj(vb.x + vb.width, vb.y + vb.height).x + padX;
  const top = vb.y * KY - maxLift.value - 40;
  const bottom = (vb.y + vb.height) * KY + 46;
  return { x: left, y: top, w: right - left, h: bottom - top };
});
function resetView(): void {
  const b = sceneBounds.value;
  view.value = { x: b.x, y: b.y, w: b.w, h: b.h };
}
resetView();
watch(sceneBounds, resetView, { deep: true });
const viewString = computed(() => `${round2(view.value.x)} ${round2(view.value.y)} ${round2(view.value.w)} ${round2(view.value.h)}`);
const zoomLevel = computed(() => sceneBounds.value.w / view.value.w);

// ---- 屏幕恒定字号 + 标注消隐（LOD）：总览只留地标，放大/选中/悬停展开明细 ----
const wrapSize = ref({ w: 1, h: 1 });
let resizeObs: ResizeObserver | null = null;
onMounted(() => {
  const el = wrapEl.value;
  if (!el) return;
  const sync = (): void => {
    const r = el.getBoundingClientRect();
    wrapSize.value = { w: Math.max(1, r.width), h: Math.max(1, r.height) };
  };
  sync();
  resizeObs = new ResizeObserver(sync);
  resizeObs.observe(el);
});
onBeforeUnmount(() => {
  resizeObs?.disconnect();
  resizeObs = null;
});
const screenScale = computed(() => Math.max(view.value.w / wrapSize.value.w, view.value.h / wrapSize.value.h));
const screenOffset = computed(() => ({
  x: (wrapSize.value.w - view.value.w / screenScale.value) / 2,
  y: (wrapSize.value.h - view.value.h / screenScale.value) / 2,
}));
const NAME_PX = 12;
function textWidth(s: string, px: number): number {
  let w = 0;
  for (const ch of s) w += /[⺀-鿿＀-￯]/.test(ch) ? px : px * 0.6;
  return w;
}
function mapLabel(name: string): string {
  const shorthand = name.match(/（((?:北|东)\s*\d+)）$/)?.[1];
  return shorthand ?? (name.replace(/（[^）]*）$/, '').split('·').at(-1) ?? name);
}
interface LabelRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
function overlaps(a: LabelRect, b: LabelRect): boolean {
  return !(a.x1 < b.x0 || a.x0 > b.x1 || a.y1 < b.y0 || a.y0 > b.y1);
}
const labelPlan = computed<Record<string, { name: boolean; detail: boolean; ax: number; ay: number }>>(() => {
  const ss = screenScale.value;
  const v = view.value;
  const inset = screenOffset.value;
  const overview = zoomLevel.value < 1.35;
  const placed: LabelRect[] = [...markRects.value];
  const out: Record<string, { name: boolean; detail: boolean; ax: number; ay: number }> = {};
  const ranked = [...buildingViews.value].sort(
    (a, b) => (b.box.maxX - b.box.minX) * (b.box.maxY - b.box.minY) - (a.box.maxX - a.box.minX) * (a.box.maxY - a.box.minY),
  );
  const landmarkIds = new Set([
    ...ranked.slice(0, wrapSize.value.w < 410 ? 2 : 4).map((b) => b.id),
    'N7',
  ]);
  const cands: {
    id: string;
    sx: number;
    sy: number;
    name: string;
    detail: boolean;
    prio: number;
    area: number;
    dy: number;
    landmark: boolean;
    sub: string;
  }[] = [];
  for (const bv of buildingViews.value) {
    const bw = (bv.box.maxX - bv.box.minX) / ss;
    const sel = isSelected('building', bv.id);
    const hov = hover.value?.kind === 'building' && hover.value.id === bv.id;
    cands.push({
      id: bv.id,
      sx: (bv.labelAnchor.x - v.x) / ss + inset.x,
      sy: (bv.labelAnchor.y - v.y) / ss + inset.y,
      name: mapLabel(bv.name),
      detail: sel || (hov && bw >= 100),
      prio: sel ? 0 : hov ? 1 : 2,
      area: (bv.box.maxX - bv.box.minX) * (bv.box.maxY - bv.box.minY),
      dy: -14,
      landmark: landmarkIds.has(bv.id),
      sub: `${bv.floors} · 容量≈${bv.capacity}`,
    });
  }
  for (const jv of junctionViews.value) {
    const sel = isSelected('junction', jv.junction.id);
    const hov = hover.value?.kind === 'junction' && hover.value.id === jv.junction.id;
    const gate = jv.junction.kind === 'gate';
    cands.push({
      id: jv.junction.id,
      sx: (jv.screen.x - v.x) / ss + inset.x,
      sy: (jv.screen.y - v.y) / ss + inset.y,
      name: mapLabel(jv.junction.name),
      detail: false,
      prio: sel ? 0 : hov ? 1 : 3,
      area: 0,
      dy: gate ? 26 : 20,
      landmark: gate && (wrapSize.value.w >= 410 || jv.junction.id === 'GATE3'),
      sub: '',
    });
  }
  cands.sort((a, b) => a.prio - b.prio || b.area - a.area);
  for (const c of cands) {
    const nw = textWidth(c.name, NAME_PX);
    const hw = Math.max(nw, c.detail ? textWidth(c.sub, 10) : 0) / 2 + 7;
    // 边缘感知：pill 完整留在舞台内，避免窄屏总览下路口/楼栋标注被 svg 裁切
    const cx = Math.min(Math.max(c.sx, hw + 4), Math.max(hw + 4, wrapSize.value.w - hw - 4));
    let cy = c.sy;
    const top = cy + c.dy - 13;
    const bottom = cy + c.dy + (c.detail ? 22 : 5);
    if (top < 4) cy += 4 - top;
    else if (bottom > wrapSize.value.h - 4) cy -= bottom - (wrapSize.value.h - 4);
    const nameRect: LabelRect = { x0: cx - hw, y0: cy + c.dy - 13, x1: cx + hw, y1: cy + c.dy + 5 };
    const block: LabelRect = c.detail ? { ...nameRect, y1: cy + c.dy + 22 } : nameRect;
    const allowed = c.prio <= 1 || !overview || c.landmark;
    const show = allowed && !placed.some((r) => overlaps(block, r));
    out[c.id] = { name: show, detail: c.detail && show, ax: v.x + (cx - inset.x) * ss, ay: v.y + (cy - inset.y) * ss };
    if (show) placed.push(block);
  }
  return out;
});
function labelOf(id: string, fx: number, fy: number): { name: boolean; detail: boolean; ax: number; ay: number } {
  return labelPlan.value[id] ?? { name: true, detail: false, ax: fx, ay: fy };
}

function clientToMap(clientX: number, clientY: number): Point | null {
  const svg = svgEl.value;
  if (!svg) return null;
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}
function zoomAt(p: Point, factor: number, animate = false): void {
  const base = sceneBounds.value;
  const newW = Math.min(Math.max(view.value.w / factor, base.w / 5), base.w / 0.7);
  const actual = view.value.w / newW;
  const newH = view.value.h / actual;
  const target = {
    x: p.x - (p.x - view.value.x) / actual,
    y: p.y - (p.y - view.value.y) / actual,
    w: newW,
    h: newH,
  };
  if (animate) moveCamera(target);
  else view.value = target;
}
function zoomCenter(factor: number): void {
  clearHover();
  zoomAt({ x: view.value.x + view.value.w / 2, y: view.value.y + view.value.h / 2 }, factor, true);
}
let cameraFrame = 0;
function stopCamera(): void {
  if (cameraFrame) cancelAnimationFrame(cameraFrame);
  cameraFrame = 0;
}
function moveCamera(target: typeof view.value): void {
  stopCamera();
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    view.value = target;
    return;
  }
  const from = view.value;
  const start = performance.now();
  const frame = (now: number): void => {
    const progress = Math.min((now - start) / 235, 1);
    const eased = 1 - (1 - progress) ** 3;
    view.value = {
      x: from.x + (target.x - from.x) * eased,
      y: from.y + (target.y - from.y) * eased,
      w: from.w + (target.w - from.w) * eased,
      h: from.h + (target.h - from.h) * eased,
    };
    cameraFrame = progress < 1 ? requestAnimationFrame(frame) : 0;
  };
  cameraFrame = requestAnimationFrame(frame);
}
function resetViewClean(): void {
  clearHover();
  moveCamera(sceneBounds.value);
}
function focusTarget(target: Selection): void {
  const anchor = target.kind === 'building'
    ? buildingViews.value.find(({ id }) => id === target.id)?.markAnchor
    : roadViews.value.find(({ id }) => id === target.id)?.midScreen;
  if (!anchor) return;
  const { w, h } = sceneBounds.value;
  const width = w / 1.55;
  const height = h / 1.55;
  clearHover();
  moveCamera({ x: anchor.x - width / 2, y: anchor.y - height / 2, w: width, h: height });
}
defineExpose({ focusTarget });
onBeforeUnmount(stopCamera);
function onWheel(e: WheelEvent): void {
  stopCamera();
  clearHover();
  const p = clientToMap(e.clientX, e.clientY);
  if (!p) return;
  zoomAt(p, e.deltaY < 0 ? 1.2 : 1 / 1.2);
}

let pan: { startX: number; startY: number; viewX: number; viewY: number } | null = null;
let movedRecently = false;
function onPointerDown(e: PointerEvent): void {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  stopCamera();
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
  view.value = {
    ...view.value,
    x: pan.viewX - dx * screenScale.value,
    y: pan.viewY - dy * screenScale.value,
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
  clearHover();
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
    const powerCut = props.overlay.powerCuts.find((m) => m.building_id === b.id);
    if (d) lines.push(`灾情：${d.title} @${d.at_sim}`);
    if (c) lines.push(cordonText(c));
    if (r) lines.push(rescueText(r));
    if (powerCut) lines.push(`已断电 @${powerCut.at_sim}`);
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

function roadLength(id: string): string {
  const len = props.map.road_lengths_px[id];
  return len === undefined ? '—' : len.toFixed(1);
}
function midMarker(points: readonly Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  const seg = Math.floor((points.length - 1) / 2);
  const a = points[seg];
  if (!a) return { x: 0, y: 0 };
  const b = points[seg + 1] ?? a;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
function ringPoints(points: readonly Point[], scale: number): Point[] {
  const c = centroid(points);
  return points.map((p) => ({ x: c.x + (p.x - c.x) * scale, y: c.y + (p.y - c.y) * scale }));
}

const roadsById = computed(() => new Map(props.map.road_segments.map((item) => [item.id, item])));
const roadDrawings = computed(() => props.map.road_segments.map((road) => {
  const drawing = roadDrawingPoints(road);
  const projected = projPts(drawing);
  return { road, drawing, projected, ground: pointsAttr(projected) };
}));
const roadNetworkPath = computed(() => roadDrawings.value.map((item) => linePath(item.projected)).join(' '));

// ---- 路段视图 ----
interface RoadView {
  id: string;
  name: string;
  ground: string;
  length: string;
  midScreen: Point;
  hazardLabel: string | null;
  hazardAt: number | null;
  closed: boolean;
  closedAt: number | null;
  closedSeq: number | null;
  aria: string;
}
const roadViews = computed<RoadView[]>(() =>
  roadDrawings.value.map(({ road, drawing, ground }) => {
    const st = statusById.value.get(road.id);
    const hazard = st?.hazard ?? null;
    const closed = st?.formally_closed ?? false;
    const hazardLabel = hazard === null ? null : HAZARD_LABEL[hazard];
    const mid = midMarker(drawing);
    return {
      id: road.id,
      name: road.name,
      ground,
      length: roadLength(road.id),
      midScreen: proj(mid.x, mid.y),
      hazardLabel,
      hazardAt: st?.hazard_at_sim ?? null,
      closed,
      closedAt: st?.closed_at_sim ?? null,
      closedSeq: st?.closed_by_action_seq ?? null,
      aria: `${road.name}，路段，${hazardLabel === null ? '无自然灾情' : `自然灾情${hazardLabel}@${st?.hazard_at_sim}`}, ${closed ? `已正式封闭@${st?.closed_at_sim}` : '未封闭'}${isSelected('road', road.id) ? '，已选中' : ''}`,
    };
  }),
);

function pickRoad(event: MouseEvent, fallback: string): void {
  const point = clientToMap(event.clientX, event.clientY);
  let id = fallback;
  let nearest = 11 * screenScale.value;
  if (point) {
    for (const { road, projected } of roadDrawings.value) {
      for (let i = 1; i < projected.length; i += 1) {
        const a = projected[i - 1];
        const b = projected[i];
        if (!a || !b) continue;
        const distance = segDist(point, a, b);
        if (distance < nearest) {
          nearest = distance;
          id = road.id;
        }
      }
    }
  }
  pick('road', id);
}

// ---- 建筑体量模型：统一哑光材质 + 克制的类别体量语言 ----
interface Band {
  pts: string;
  /** 0 暗窗 / 1 暖灯 / 2 冷灯；夜航逐窗点亮，断电整栋熄灭，日光统一玻璃色 */
  lit: 0 | 1 | 2;
}
interface VolumeRender {
  walls: Wall[];
  bands: Band[];
  roof: string;
  roofEdge: string;
  roofInner: string;
}
interface RoofBox {
  walls: string[];
  roof: string;
}
interface BuildingView {
  id: string;
  name: string;
  category: MapView['buildings'][number]['category'];
  depth: number;
  box: Box;
  h: number;
  shadow: string;
  contact: string;
  groundRing: string;
  cordonRing: string;
  focusRing: string;
  plinth: VolumeRender | null;
  tower: VolumeRender | null;
  main: VolumeRender;
  aux: VolumeRender | null;
  roofBoxes: RoofBox[];
  roofPanels: string[];
  roofSeams: string[];
  curvedRoof: string;
  clock: Point | null;
  entrance: { recess: string; canopy: string; fascia: string } | null;
  pool: { x: number; y: number; rx: number; ry: number } | null;
  labelAnchor: Point;
  markAnchor: Point;
  floors: string;
  capacity: number;
  risk: string | null;
  categoryLabel: string;
  catColor: string;
  glow: { x: number; y: number; rx: number; ry: number } | null;
  disasterTitle: string | null;
  disasterAt: number | null;
  cordonLabel: string | null;
  rescueLabel: string | null;
  powerCutAt: number | null;
  aria: string;
}

function seedOf(id: string): number {
  let s = 0;
  for (const ch of id) s = (s * 31 + ch.charCodeAt(0)) % 997;
  return s;
}

function insetPts(points: readonly Point[], t: number): Point[] {
  const c = centroid(points);
  return points.map((p) => lerp(c, p, t));
}

function renderVolume(
  pts: readonly Point[],
  h: number,
  z0: number,
  bandRows: number,
  bandInset: number,
  seed = 0,
): VolumeRender {
  const walls = wallFaces(pts, h, z0);
  const bands: Band[] = [];
  if (bandRows > 0) {
    walls.forEach((w, wi) => {
      const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
      const cells = Math.max(2, Math.round(len / 11));
      const span = 1 - bandInset * 2;
      for (let r = 0; r < bandRows; r += 1) {
        const t0 = (r + 0.42) / (bandRows + 0.6);
        const t1 = (r + 0.82) / (bandRows + 0.6);
        for (let i = 0; i < cells; i += 1) {
          const k = (seed + wi * 3 + r * 7 + i * 5) % 10;
          bands.push({
            pts: wallStrip(
              w,
              h,
              z0,
              bandInset + ((i + 0.18) / cells) * span,
              bandInset + ((i + 0.82) / cells) * span,
              t0,
              t1,
            ),
            lit: k < 7 ? 0 : k < 9 ? 1 : 2,
          });
        }
      }
    });
  }
  const roofPts = projPts(pts, z0 + h);
  return {
    walls,
    bands,
    roof: pointsAttr(roofPts),
    roofEdge: pointsAttr(roofPts),
    roofInner: pointsAttr(projPts(insetPts(pts, 0.84), z0 + h)),
  };
}

function buildingModel(b: MapView['buildings'][number]): BuildingView {
  const box = extent(b.polygon);
  const w = box.maxX - box.minX;
  const d = box.maxY - box.minY;
  const h = massHeight(b.floors);
  const fn = b.floors ?? 2;
  const cat = b.category;
  const c = centroid(b.polygon);
  const seed = seedOf(b.id);

  const shadowPts = b.polygon.map((p) => proj(p.x + h * 0.9, p.y + h * 0.62));
  const contactPts = projPts(ringPoints(b.polygon, 1.06));

  // 类别体量语言：主楼 + 辅楼 / 塔楼 / 基座，全部由 bbox 派生。
  let mainPts: Point[] = b.polygon;
  let aux: VolumeRender | null = null;
  let tower: VolumeRender | null = null;
  let plinth: VolumeRender | null = null;
  let bandRows = Math.max(1, Math.min(fn, 5));
  let mainH = h;

  if (cat === 'teaching' || cat === 'laboratory') {
    const split = box.minX + w * 0.68;
    mainPts = [
      { x: box.minX, y: box.minY },
      { x: split, y: box.minY },
      { x: split, y: box.maxY },
      { x: box.minX, y: box.maxY },
    ];
    aux = renderVolume(
      [
        { x: split, y: box.minY + d * 0.18 },
        { x: box.maxX, y: box.minY + d * 0.18 },
        { x: box.maxX, y: box.maxY },
        { x: split, y: box.maxY },
      ],
      h * 0.55,
      0,
      Math.max(1, Math.min(fn - 1, 3)),
      0.1,
      seed + 1,
    );
  } else if (cat === 'gymnasium') {
    const bevel = Math.min(w, d) * 0.12;
    mainPts = [
      { x: box.minX + bevel, y: box.minY }, { x: box.maxX - bevel, y: box.minY },
      { x: box.maxX, y: box.minY + bevel }, { x: box.maxX, y: box.maxY - bevel },
      { x: box.maxX - bevel, y: box.maxY }, { x: box.minX + bevel, y: box.maxY },
      { x: box.minX, y: box.maxY - bevel }, { x: box.minX, y: box.minY + bevel },
    ];
    mainH = h * 1.05;
    bandRows = 1;
  } else if (cat === 'canteen') {
    mainH = h * 0.72;
    bandRows = 1;
  } else if (cat === 'library' || cat === 'office') {
    plinth = renderVolume(ringPoints(b.polygon, 1.05), 3, 0, 0, 0);
    const tw = Math.min(20, w * 0.24);
    tower = renderVolume(
      [
        { x: box.minX, y: box.minY },
        { x: box.minX + tw, y: box.minY },
        { x: box.minX + tw, y: box.minY + d * 0.5 },
        { x: box.minX, y: box.minY + d * 0.5 },
      ],
      h * 1.3,
      0,
      Math.max(2, Math.min(fn, 4)),
      0.16,
      seed + 2,
    );
  } else if (cat === 'dormitory') {
    bandRows = Math.max(2, Math.min(fn, 6));
  }

  const main = renderVolume(mainPts, mainH, 0, bandRows, cat === 'gymnasium' ? 0.06 : 0.08, seed);

  // 屋顶设备：小哑光体量，保持模型感。
  const roofBoxes: RoofBox[] = [];
  const roofPanels: string[] = [];
  const roofSeams: string[] = [];
  let curvedRoof = '';
  let clock: Point | null = null;
  const addRoofBox = (x: number, y: number, bw: number, bd: number, bh: number, base = mainH): void => {
    const pts = [
      { x, y },
      { x: x + bw, y },
      { x: x + bw, y: y + bd },
      { x, y: y + bd },
    ];
    const walls = wallFaces(pts, bh, base);
    roofBoxes.push({ walls: walls.map((wl) => wl.quad), roof: projAttr(pts, base + bh) });
  };
  if (cat === 'dormitory') addRoofBox(box.maxX - 18, box.minY + 4, 12, 8, 5);
  else if (cat === 'laboratory') {
    addRoofBox(box.minX + 8, box.minY + 5, 6, 6, 6);
    addRoofBox(box.minX + 20, box.minY + 5, 6, 6, 8);
  } else if (cat === 'canteen') addRoofBox(box.minX + 8, box.minY + 4, 8, 6, 5);
  else if (cat === 'teaching' && b.id !== 'SA') addRoofBox(box.minX + w * 0.3, box.minY + 4, 10, 7, 4);

  if (b.id === 'SA') {
    const clockX = box.minX + w * 0.44;
    const clockY = box.minY + d * 0.64;
    addRoofBox(clockX - 9, clockY - 15, 18, 15, 23);
    addRoofBox(clockX - 12, clockY - 17, 24, 20, 3, mainH + 23);
    clock = proj(clockX, clockY + 0.5, mainH + 15);
  }
  if (cat === 'gymnasium') {
    const x1 = box.minX + w * 0.135;
    const x2 = box.maxX - w * 0.135;
    const y1 = box.minY + d * 0.145;
    const y2 = box.maxY - d * 0.145;
    const arch = (y: number, reverse = false): string => {
      const a = proj(reverse ? x2 : x1, y, mainH + 1);
      const mid = proj((x1 + x2) / 2, y, mainH + d * 0.18);
      const z = proj(reverse ? x1 : x2, y, mainH + 1);
      return `${round2(a.x)} ${round2(a.y)} Q ${round2(mid.x)} ${round2(mid.y)} ${round2(z.x)} ${round2(z.y)}`;
    };
    curvedRoof = `M ${arch(y1)} L ${arch(y2, true)} Z`;
    for (const fraction of [0.10, 0.24, 0.38, 0.52, 0.66, 0.80, 0.94]) {
      roofSeams.push(`M ${arch(y1 + (y2 - y1) * fraction)}`);
    }
  }
  if (cat === 'library' || cat === 'laboratory') {
    const roofWidth = cat === 'library' ? w : w * 0.68;
    const top = box.minY + d * 0.21;
    const bottom = box.maxY - d * 0.23;
    const left = box.minX + roofWidth * 0.32;
    const right = box.minX + roofWidth * 0.68;
    roofPanels.push(projAttr(boxRect({ minX: left, minY: top, maxX: right, maxY: bottom }), mainH + 1));
    for (const fraction of [0.2, 0.4, 0.6, 0.8]) {
      const y = top + (bottom - top) * fraction;
      roofSeams.push(linePath([proj(left, y, mainH + 1), proj(right, y, mainH + 1)]));
    }
  }

  // 入口：南立面凹龛 + 深色雨棚板。
  let entrance: BuildingView['entrance'] = null;
  const sw = southWall(wallFaces(mainPts, mainH, 0));
  if (sw && cat !== 'gymnasium') {
    const ew = Math.min(0.24, 26 / Math.max(1, w));
    const f0 = 0.5 - ew / 2;
    const f1 = 0.5 + ew / 2;
    const recess = wallStrip(sw, mainH, 0, f0, f1, 0, 0.42);
    const ca = lerp(sw.a, sw.b, f0 - 0.03);
    const cb = lerp(sw.a, sw.b, f1 + 0.03);
    const cz = mainH * 0.44;
    const canopy = pointsAttr([
      proj(ca.x, ca.y + 10, cz),
      proj(cb.x, cb.y + 10, cz),
      proj(cb.x, cb.y, cz),
      proj(ca.x, ca.y, cz),
    ]);
    const fascia = pointsAttr([
      proj(ca.x, ca.y + 10, cz),
      proj(cb.x, cb.y + 10, cz),
      proj(cb.x, cb.y + 10, cz - 3),
      proj(ca.x, ca.y + 10, cz - 3),
    ]);
    entrance = { recess, canopy, fascia };
  }
  const poolMid = sw ? { x: (sw.a.x + sw.b.x) / 2, y: (sw.a.y + sw.b.y) / 2 + 9 } : null;
  const poolAt = poolMid ? proj(poolMid.x, poolMid.y, 0) : null;
  const pool = poolAt ? { x: poolAt.x, y: poolAt.y, rx: Math.min(26, w * 0.32), ry: 7.5 } : null;

  const disaster = props.layers.disaster ? props.overlay.disaster.find((m) => m.building_id === b.id) : undefined;
  const cordon = props.layers.cordon ? props.overlay.cordons.find((m) => m.building_id === b.id) : undefined;
  const rescue = props.layers.rescue ? props.overlay.rescues.find((m) => m.building_id === b.id) : undefined;
  const powerCutAt = props.overlay.powerCuts.find((m) => m.building_id === b.id)?.at_sim ?? null;
  const floors = formatBuildingFloors(b);
  const roofTop = proj(c.x, c.y, mainH);
  return {
    id: b.id,
    name: b.name,
    category: cat,
    depth: box.maxY,
    box,
    h: mainH,
    shadow: pointsAttr(shadowPts),
    contact: pointsAttr(contactPts),
    groundRing: projAttr(ringPoints(b.polygon, 1.12)),
    cordonRing: projAttr(ringPoints(b.polygon, 1.24)),
    focusRing: projAttr(ringPoints(b.polygon, 1.12)),
    plinth,
    tower,
    main,
    aux,
    roofBoxes,
    roofPanels,
    roofSeams,
    curvedRoof,
    clock,
    entrance,
    pool,
    labelAnchor: roofTop,
    markAnchor: proj(c.x, box.minY, mainH),
    floors,
    capacity: b.capacity,
    risk: b.risk_tag,
    categoryLabel: CATEGORY_STYLE[cat].label,
    catColor: CATEGORY_STYLE[cat].color,
    glow: disaster
      ? { x: proj(c.x, c.y).x, y: proj(c.x, c.y).y, rx: w * 0.9, ry: d * 0.55 * KY }
      : null,
    disasterTitle: disaster?.title ?? null,
    disasterAt: disaster?.at_sim ?? null,
    cordonLabel: cordon ? cordonText(cordon) : null,
    rescueLabel: rescue ? rescueText(rescue) : null,
    powerCutAt,
    aria: `${b.name}，楼栋，${CATEGORY_STYLE[cat].label}，${floors}，估算容量${b.capacity}${b.risk_tag === null ? '' : `，风险${b.risk_tag}`}${disaster ? `，灾情：${disaster.title}` : ''}${cordon ? `，${cordonText(cordon)}` : ''}${rescue ? `，${rescueText(rescue)}` : ''}${powerCutAt === null ? '' : `，已断电 ${simStamp(powerCutAt)}`}${isSelected('building', b.id) ? '，已选中' : ''}`,
  };
}

const buildingViews = computed<BuildingView[]>(() => props.map.buildings.map(buildingModel));

const districtLabels = computed(() => {
  const districts = new Map<string, Point[][]>();
  for (const building of props.map.buildings) {
    const name = building.zone.split('·')[0] ?? '';
    if (!name.endsWith('苑') && !name.endsWith('园')) continue;
    const shapes = districts.get(name) ?? [];
    shapes.push(building.polygon);
    districts.set(name, shapes);
  }
  return [...districts.entries()].filter(([, shapes]) => shapes.length >= 2).map(([name, shapes]) => {
    const bounds = extent(shapes.flat());
    const anchor = proj(bounds.minX, bounds.minY);
    return { name, anchor: { x: anchor.x, y: anchor.y - maxLift.value } };
  });
});

// ---- 路口 / 校门 ----
const junctionViews = computed(() =>
  props.map.junctions
    .map((j) => {
      const pos = props.map.junction_positions[j.id];
      if (!pos) return null;
      return { junction: j, pos, screen: proj(pos.x, pos.y), depth: pos.y };
    })
    .filter((v): v is { junction: MapView['junctions'][number]; pos: Point; screen: Point; depth: number } => v !== null),
);

// ---- 环境：草坪 / 铺装 / 树阵，全部由几何确定性派生，不引入业务含义 ----
const ROAD_HALF = 8;
function segDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  const qx = a.x + dx * t;
  const qy = a.y + dy * t;
  return Math.hypot(p.x - qx, p.y - qy);
}
function roadDist(p: Point): number {
  let m = Infinity;
  for (const { drawing } of roadDrawings.value) {
    for (let i = 0; i + 1 < drawing.length; i += 1) {
      const a = drawing[i];
      const b = drawing[i + 1];
      if (!a || !b) continue;
      m = Math.min(m, segDist(p, a, b));
    }
  }
  return m;
}
const buildingBoxes = computed(() => props.map.buildings.map((b) => extent(b.polygon)));
function inBuilding(p: Point, margin: number): boolean {
  return buildingBoxes.value.some(
    (bb) => p.x >= bb.minX - margin && p.x <= bb.maxX + margin && p.y >= bb.minY - margin && p.y <= bb.maxY + margin,
  );
}
function inBounds(p: Point, inset: number): boolean {
  const vb = props.map.view_box;
  return p.x >= vb.x + inset && p.x <= vb.x + vb.width - inset && p.y >= vb.y + inset && p.y <= vb.y + vb.height - inset;
}

// 资料中的天印湖在南馆附近。轮廓按训练沙盘的留白示意。
const lakeShore = computed<readonly Point[]>(() => {
  if (!props.map.buildings.some((building) => building.id === 'SA' && extent(building.polygon).minX === 405)) return [];
  return [
    { x: 112, y: 745 }, { x: 177, y: 678 }, { x: 273, y: 658 },
    { x: 360, y: 680 }, { x: 393, y: 734 }, { x: 461, y: 770 },
    { x: 512, y: 831 }, { x: 490, y: 879 }, { x: 405, y: 907 },
    { x: 308, y: 887 }, { x: 231, y: 906 }, { x: 150, y: 872 }, { x: 104, y: 817 },
  ];
});
function smoothBank(points: readonly Point[]): string {
  const projected = projPts(points);
  const first = projected[0];
  const last = projected.at(-1);
  if (!first || !last) return '';
  const start = lerp(last, first, 0.5);
  const edges = projected.map((p, i) => {
    const next = projected[i + 1] ?? first;
    const end = lerp(p, next, 0.5);
    return `Q ${round2(p.x)} ${round2(p.y)} ${round2(end.x)} ${round2(end.y)}`;
  });
  return `M ${round2(start.x)} ${round2(start.y)} ${edges.join(' ')} Z`;
}
const lake = computed(() => {
  const shore = lakeShore.value;
  if (!shore.length) return null;
  return {
    outer: smoothBank(ringPoints(shore, 1.10)),
    path: smoothBank(shore),
    inner: smoothBank(ringPoints(shore, 0.93)),
    walk: smoothBank(ringPoints(shore, 1.16)),
    ripples: ([
      [192, 742, 229, 746, 261, 742],
      [205, 752, 228, 755, 247, 752],
      [360, 835, 403, 842, 439, 837],
    ] as const).map(([x1, y1, x2, y2, x3, y3]) => {
      const a = proj(x1, y1);
      const bend = proj(x2, y2);
      const end = proj(x3, y3);
      return `M ${a.x} ${a.y} Q ${bend.x} ${bend.y} ${end.x} ${end.y}`;
    }),
    label: proj(303, 789),
  };
});
function inLake({ x, y }: Point): boolean {
  const shore = lakeShore.value;
  let inside = false;
  for (let i = 0; i < shore.length; i += 1) {
    const a = shore[i];
    const b = shore[(i + 1) % shore.length];
    if (a && b && (a.y > y) !== (b.y > y) && x < a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y)) inside = !inside;
  }
  return inside;
}
function isFree(p: Point, margin: number, roadBuffer = 4): boolean {
  return inBounds(p, 12) && !inLake(p) && !inBuilding(p, margin) && roadDist(p) > ROAD_HALF + roadBuffer;
}

// 景观设施放在训练图留白处。道路和楼栋继续由地图数据决定。
const COURT: Box = { minX: 1170, minY: 791, maxX: 1326, maxY: 896 };
const LOOKOUT: Box = { minX: 92, minY: 774, maxX: 152, maxY: 808 };
const GROVES = [
  { x: 147, y: 165, rx: 78, ry: 64, count: 15 },
  { x: 295, y: 221, rx: 72, ry: 32, count: 9 },
  { x: 785, y: 115, rx: 88, ry: 36, count: 13 },
  { x: 1199, y: 68, rx: 102, ry: 27, count: 12 },
  { x: 1256, y: 930, rx: 94, ry: 23, count: 12 },
];
const plantingBeds = computed(() => lake.value ? GROVES.map(({ x, y, rx, ry }, grove) => {
  const points = Array.from({ length: 12 }, (_, i) => {
    const angle = i * Math.PI / 6;
    const contour = 1 + 0.09 * Math.cos(i * 2 + grove);
    return { x: x + Math.cos(angle) * (rx + 9) * contour, y: y + Math.sin(angle) * (ry + 7) * contour };
  });
  return smoothBank(points);
}) : []);
function nearPlot(p: Point, plot: Box, margin: number): boolean {
  return p.x >= plot.minX - margin && p.x <= plot.maxX + margin
    && p.y >= plot.minY - margin && p.y <= plot.maxY + margin;
}
function inFacility(p: Point, margin = 0): boolean {
  return lakeShore.value.length > 0 && (nearPlot(p, COURT, margin) || nearPlot(p, LOOKOUT, margin));
}
function circleOutline(cx: number, cy: number, radius: number): string {
  const points = Array.from({ length: 25 }, (_, index) => {
    const radians = (index * Math.PI) / 12;
    return proj(cx + Math.cos(radians) * radius, cy + Math.sin(radians) * radius);
  });
  return linePath(points);
}
const siteFacilities = computed(() => {
  if (!lake.value) return null;
  const court = { minX: COURT.minX + 9, minY: COURT.minY + 10, maxX: COURT.maxX - 9, maxY: COURT.maxY - 10 };
  const center = { x: (court.minX + court.maxX) / 2, y: (court.minY + court.maxY) / 2 };
  const groundLine = (x1: number, y1: number, x2: number, y2: number): string =>
    linePath([proj(x1, y1), proj(x2, y2)]);
  const keys = [court.minX, court.maxX - 28].map((x) => projAttr(boxRect({
    minX: x, maxX: x + 28, minY: center.y - 16, maxY: center.y + 16,
  })));
  const laneArcs = [court.minX, court.maxX].map((x, index) => {
    const direction = index === 0 ? 1 : -1;
    const a = proj(x, center.y - 32);
    const bend = proj(x + direction * 69, center.y);
    const z = proj(x, center.y + 32);
    return `M ${a.x} ${a.y} Q ${bend.x} ${bend.y} ${z.x} ${z.y}`;
  });
  const lookoutDeck = projAttr(boxRect(LOOKOUT), 2);
  const boards = Array.from({ length: 7 }, (_, i) => {
    const y = LOOKOUT.minY + 4 * (i + 1);
    return linePath([proj(LOOKOUT.minX, y, 2), proj(LOOKOUT.maxX, y, 2)]);
  });
  const rail = linePath([
    proj(LOOKOUT.minX, LOOKOUT.minY, 10), proj(LOOKOUT.maxX, LOOKOUT.minY, 10),
    proj(LOOKOUT.maxX, LOOKOUT.maxY, 10),
  ]);
  const posts = [0, 0.33, 0.66, 1].map((fraction) => {
    const x = LOOKOUT.minX + (LOOKOUT.maxX - LOOKOUT.minX) * fraction;
    return linePath([proj(x, LOOKOUT.minY, 2), proj(x, LOOKOUT.minY, 10)]);
  });
  posts.push(linePath([proj(LOOKOUT.maxX, LOOKOUT.maxY, 2), proj(LOOKOUT.maxX, LOOKOUT.maxY, 10)]));
  const benches = [{ x: 192, y: 647 }, { x: 330, y: 642 }, { x: 537, y: 880 }, { x: 1246, y: 918 }].map(({ x, y }) => ({
    foot: projAttr(boxRect({ minX: x - 11, minY: y - 3, maxX: x + 11, maxY: y + 4 }), 0),
    seat: projAttr(boxRect({ minX: x - 10, minY: y - 3, maxX: x + 10, maxY: y + 3 }), 4),
    back: linePath([proj(x - 10, y - 3, 7), proj(x + 10, y - 3, 7)]),
  }));
  const lampBases = ringPoints(lakeShore.value, 1.18).filter((p, index) => index % 2 === 0 && isFree(p, 6) && !inFacility(p, 6));
  lampBases.push({ x: 1182, y: 783 }, { x: 1318, y: 905 });
  const lamps = lampBases.map(({ x, y }) => ({ base: proj(x, y), head: proj(x, y, 17) }));
  const hoops = [court.minX + 3, court.maxX - 3].map((x) => ({
    support: linePath([proj(x, center.y), proj(x, center.y, 14)]),
    board: linePath([proj(x, center.y - 5, 14), proj(x, center.y + 5, 14)]),
  }));
  return {
    courtBase: projAttr(boxRect(COURT)),
    courtFloor: projAttr(boxRect(court)),
    keys, laneArcs, hoops,
    halfLine: groundLine(center.x, court.minY, center.x, court.maxY),
    circle: circleOutline(center.x, center.y, 10),
    links: [
      [proj(1146, 780), proj(1157, 806), proj(COURT.minX + 1, 820)],
      [proj(452, 752), proj(452, 764), proj(446, 777)],
    ].map(linePath),
    lookoutDeck, boards, rail, posts, benches, lamps,
  };
});

const lawns = computed<{ x: number; y: number; w: number; h: number; outline: string }[]>(() => {
  const vb = props.map.view_box;
  const cell = 26;
  const cols = Math.floor((vb.width - 32) / cell);
  const rows = Math.floor((vb.height - 32) / cell);
  const free: boolean[][] = [];
  for (let r = 0; r < rows; r += 1) {
    const row: boolean[] = [];
    for (let c = 0; c < cols; c += 1) {
      const p = { x: vb.x + 16 + c * cell + cell / 2, y: vb.y + 16 + r * cell + cell / 2 };
      row.push(isFree(p, 8));
    }
    free.push(row);
  }
  const used: boolean[][] = free.map((row) => row.map(() => false));
  const out: { x: number; y: number; w: number; h: number; outline: string }[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const row = free[r];
      const urow = used[r];
      if (!row || !urow || !row[c] || urow[c]) continue;
      let cw = 0;
      while (c + cw < cols && row[c + cw] && !urow[c + cw]) cw += 1;
      let rh = 1;
      outer: while (r + rh < rows) {
        const nr = free[r + rh];
        const nu = used[r + rh];
        if (!nr || !nu) break;
        for (let k = 0; k < cw; k += 1) if (!nr[c + k] || nu[c + k]) break outer;
        rh += 1;
      }
      for (let rr = r; rr < r + rh; rr += 1) {
        const nu = used[rr];
        if (!nu) continue;
        for (let k = c; k < c + cw; k += 1) nu[k] = true;
      }
      const x = vb.x + 16 + c * cell;
      const y = vb.y + 16 + r * cell;
      const w = cw * cell;
      const hh = rh * cell;
      if (w >= 52 && hh >= 52 && w <= 286 && hh <= 286 && out.length < 10) {
        const outline = smoothBank(boxRect({ minX: x - 6, minY: y - 6, maxX: x + w + 6, maxY: y + hh + 6 }));
        out.push({ x, y, w, h: hh, outline });
      }
    }
  }
  return out;
});

interface Plaza {
  outline: string;
  joints: string[];
}
const plazas = computed<Plaza[]>(() => {
  const out: Plaza[] = [];
  for (const b of props.map.buildings) {
    if (out.length >= 8) break;
    if (b.category !== 'teaching' && b.category !== 'library' && b.category !== 'office' && b.category !== 'canteen') continue;
    const bb = extent(b.polygon);
    const w = bb.maxX - bb.minX;
    const depth = 24;
    const y0 = bb.maxY + 5;
    let ok = true;
    for (let i = 0; i <= 4; i += 1) {
      for (let j = 0; j <= 2; j += 1) {
        const p = { x: bb.minX + (w * i) / 4, y: y0 + (depth * j) / 2 };
        if (!isFree(p, 2)) ok = false;
      }
    }
    if (!ok) continue;
    const rect = { minX: bb.minX + 2, minY: y0, maxX: bb.maxX - 2, maxY: y0 + depth };
    const joints: string[] = [];
    for (let k = 1; k < 3; k += 1) {
      const y = y0 + (depth * k) / 3;
      joints.push(pointsAttr([proj(rect.minX, y), proj(rect.maxX, y)]));
    }
    out.push({ outline: projAttr(boxRect(rect)), joints });
  }
  return out;
});

interface Tree {
  x: number;
  y: number;
  r: number;
  screen: Point;
  depth: number;
  form: 'broadleaf' | 'upright' | 'ornamental';
  mirrored: boolean;
}
const trees = computed<Tree[]>(() => {
  const out: Tree[] = [];
  let seed = 0;
  const push = (x: number, y: number, seed: number): void => {
    if (out.length >= 152) return;
    const p = { x, y };
    const r = 7.5 + (seed % 7) * 0.65;
    if (inFacility(p, r + 4) || !isFree(p, r + 3, r + 5)) return;
    if (out.some((t) => Math.hypot(t.x - x, t.y - y) < (t.r + r) * 0.96)) return;
    const form = seed % 5 === 0 ? 'upright' : seed % 3 === 0 ? 'ornamental' : 'broadleaf';
    out.push({ x, y, r, screen: proj(x, y), depth: y, form, mirrored: seed % 2 === 0 });
  };

  if (lake.value) {
    const perimeter = ringPoints(lakeShore.value, 1.27);
    perimeter.forEach((a, i) => {
      const b = perimeter[(i + 1) % perimeter.length];
      if (!b) return;
      const count = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 24));
      for (let j = 0; j < count; j += 1) {
        const p = lerp(a, b, (j + 0.25) / count);
        push(p.x, p.y + 3 * Math.cos(i * 3 + j), ++seed);
      }
    });
    for (const grove of GROVES) {
      for (let i = 0; i < grove.count; i += 1) {
        const angle = i * 2.39996;
        const radius = Math.sqrt((i + 0.6) / grove.count);
        push(grove.x + Math.cos(angle) * grove.rx * radius, grove.y + Math.sin(angle) * grove.ry * radius, ++seed);
      }
    }
  }
  for (const { drawing } of roadDrawings.value) {
    for (let i = 0; i + 1 < drawing.length; i += 1) {
      const a = drawing[i];
      const b = drawing[i + 1];
      if (!a || !b) continue;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const n = Math.floor(len / 39);
      const nx = -(b.y - a.y) / (len || 1);
      const ny = (b.x - a.x) / (len || 1);
      for (let k = 1; k <= n; k += 1) {
        const t = k / (n + 1);
        const px = a.x + (b.x - a.x) * t;
        const py = a.y + (b.y - a.y) * t;
        const off = ROAD_HALF + 19;
        seed += 1;
        push(px + nx * off, py + ny * off, seed);
        seed += 1;
        push(px - nx * off, py - ny * off, seed);
      }
    }
  }
  for (const lawn of lawns.value) {
    const n = Math.floor(lawn.w / 30);
    for (let k = 0; k <= n; k += 1) {
      seed += 1;
      push(lawn.x + 8 + (lawn.w - 16) * (k / Math.max(1, n)), lawn.y + 13, seed);
      seed += 1;
      push(lawn.x + 8 + (lawn.w - 16) * (k / Math.max(1, n)), lawn.y + lawn.h - 13, seed);
    }
  }
  return out;
});

// ---- 场景对象按深度排序（画家算法）：远（y 小）先画 ----
type SceneObject =
  | { kind: 'building'; depth: number; bv: BuildingView }
  | { kind: 'junction'; depth: number; jv: (typeof junctionViews.value)[number] }
  | { kind: 'tree'; depth: number; tree: Tree };
const sceneObjects = computed<SceneObject[]>(() => {
  const objs: SceneObject[] = [];
  for (const bv of buildingViews.value) objs.push({ kind: 'building', depth: bv.depth, bv });
  for (const jv of junctionViews.value) objs.push({ kind: 'junction', depth: jv.depth, jv });
  for (const tree of trees.value) objs.push({ kind: 'tree', depth: tree.depth, tree });
  objs.sort((a, b) => a.depth - b.depth);
  return objs;
});

// ---- 应急指挥标记（覆盖层，不参与体量遮挡） ----
interface MarkView {
  key: string;
  type: 'disaster' | 'cordon' | 'rescue' | 'hazard' | 'closed' | 'powercut' | 'order' | 'order-done';
  x: number;
  y: number;
  dx: number;
  dy: number;
  text: string;
  pillW: number;
  range: string | null;
}
const MARK_PRIO: Record<MarkView['type'], number> = {
  disaster: 0, powercut: 1, closed: 2, hazard: 3, cordon: 4, rescue: 5, order: 6, 'order-done': 7,
};
function markRect(m: MarkView): LabelRect {
  const ss = screenScale.value;
  const v = view.value;
  const inset = screenOffset.value;
  const sx = (m.x - v.x) / ss + inset.x + m.dx;
  const sy = (m.y - v.y) / ss + inset.y + m.dy;
  const top = m.type === 'closed' ? -30 : -46;
  const bottom = m.type === 'closed' ? -12 : -2;
  return { x0: sx - m.pillW / 2, y0: sy + top, x1: sx + m.pillW / 2, y1: sy + bottom };
}
const markViews = computed<MarkView[]>(() => {
  const raw: MarkView[] = [];
  const push = (key: string, type: MarkView['type'], x: number, y: number, text: string, range: string | null): void => {
    raw.push({ key, type, x, y, dx: 0, dy: 0, text, pillW: textWidth(text, 10.5) + 16, range });
  };
  for (const bv of buildingViews.value) {
    if (bv.disasterTitle !== null) {
      push(`d-${bv.id}`, 'disaster', bv.markAnchor.x, bv.markAnchor.y, `${bv.disasterTitle}${bv.disasterAt === null ? '' : ` ${simStamp(bv.disasterAt)}`}`, bv.groundRing);
    }
    if (bv.cordonLabel !== null) {
      push(`c-${bv.id}`, 'cordon', bv.markAnchor.x, bv.markAnchor.y, bv.cordonLabel, bv.cordonRing);
    }
    if (bv.rescueLabel !== null) {
      push(`r-${bv.id}`, 'rescue', bv.markAnchor.x, bv.markAnchor.y, bv.rescueLabel, null);
    }
    if (bv.powerCutAt !== null) {
      push(`p-${bv.id}`, 'powercut', bv.markAnchor.x, bv.markAnchor.y, `已断电 ${simStamp(bv.powerCutAt)}`, null);
    }
  }
  for (const rv of roadViews.value) {
    if (rv.hazardLabel !== null && props.layers.disaster) {
      push(`h-${rv.id}`, 'hazard', rv.midScreen.x, rv.midScreen.y, `${rv.hazardLabel}${rv.hazardAt === null ? '' : ` ${simStamp(rv.hazardAt)}`}`, null);
    }
    if (rv.closed) {
      push(`x-${rv.id}`, 'closed', rv.midScreen.x, rv.midScreen.y, rv.closedAt === null ? '封闭' : `封闭 ${simStamp(rv.closedAt)}`, null);
    }
  }
  for (const order of props.orderMarks) {
    const anchor = order.target.kind === 'building'
      ? buildingViews.value.find(({ id }) => id === order.target.id)?.markAnchor
      : roadViews.value.find(({ id }) => id === order.target.id)?.midScreen;
    if (anchor) push(order.key, order.complete ? 'order-done' : 'order', anchor.x, anchor.y, order.text, null);
  }
  // 散开文字框时保留引线，指回实际楼栋或路段锚点。
  const placed: LabelRect[] = [];
  const sorted = [...raw].sort((a, b) => MARK_PRIO[a.type] - MARK_PRIO[b.type]);
  for (const m of sorted) {
    const original = markRect(m);
    const { w, h } = wrapSize.value;
    const sideways = m.pillW / 2 + 20;
    const offsets = [[0, 0], [sideways, 2], [-sideways, 2], [0, -34], [0, 44], [sideways, -44], [-sideways, -44], [sideways, 50], [-sideways, 50]];
    for (const [dx = 0, dy = 0] of offsets) {
      m.dx = Math.max(4 - original.x0, Math.min(dx, w - 4 - original.x1));
      m.dy = Math.max(5 - original.y0, Math.min(dy, h - 5 - original.y1));
      if (!placed.some((other) => overlaps(markRect(m), other))) break;
    }
    let rect = markRect(m);
    let hit = placed.find((other) => overlaps(rect, other));
    while (hit) {
      m.dy -= rect.y1 - hit.y0 + 4;
      rect = markRect(m);
      hit = placed.find((other) => overlaps(rect, other));
    }
    placed.push(rect);
  }
  return raw;
});
/** 标记已占用的屏幕矩形，供标注消隐让位（指挥标记优先于楼栋名）。 */
const markRects = computed(() => markViews.value.map(markRect));

const routeD = computed(() => props.route?.status === 'ready'
  ? linePath(projPts(routeDrawingPoints(props.route, roadsById.value)))
  : '');
const routeEnds = computed<readonly Point[]>(() => {
  if (props.route?.status !== 'ready' || props.route.points.length === 0) return [];
  const first = props.route.points[0];
  const last = props.route.points[props.route.points.length - 1];
  return first && last ? [proj(first.x, first.y), proj(last.x, last.y)] : [];
});

const plinthTop = computed(() => {
  const vb = props.map.view_box;
  return projAttr(boxRect({ minX: vb.x - 10, minY: vb.y - 10, maxX: vb.x + vb.width + 10, maxY: vb.y + vb.height + 10 }));
});
const plinthFront = computed(() => {
  const vb = props.map.view_box;
  const y = vb.y + vb.height + 10;
  const x0 = vb.x - 10;
  const x1 = vb.x + vb.width + 10;
  return pointsAttr([proj(x0, y), proj(x1, y), proj(x1, y, -20), proj(x0, y, -20)]);
});
const plinthSide = computed(() => {
  const vb = props.map.view_box;
  const x = vb.x - 10;
  const y0 = vb.y - 10;
  const y1 = vb.y + vb.height + 10;
  return pointsAttr([proj(x, y0), proj(x, y1), proj(x, y1, -20), proj(x, y0, -20)]);
});
const plinthDrop = computed(() => {
  const vb = props.map.view_box;
  return projAttr(
    boxRect({ minX: vb.x - 4, minY: vb.y + 2, maxX: vb.x + vb.width + 16, maxY: vb.y + vb.height + 18 }),
    -10,
  );
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
      aria-label="校园沙盘，训练模拟数据。楼栋、路段和路口均可点选，支持缩放和平移。"
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
        <linearGradient id="terrain-tone" x2="0.75" y2="1">
          <stop offset="0" class="terrain-lit" />
          <stop offset="1" class="terrain-shaded" />
        </linearGradient>
        <linearGradient id="lake-tone" x2="0.65" y2="1">
          <stop offset="0" class="lake-lit" />
          <stop offset="1" class="lake-shaded" />
        </linearGradient>
        <pattern id="terrain-grain" patternUnits="userSpaceOnUse" width="29" height="21">
          <path d="M 3 4 h 2 M 13 9 h 3 M 23 16 h 2 M 6 18 h 1" class="terrain-grain-trace" />
        </pattern>
        <linearGradient id="roof-glass" x2="0.7" y2="1">
          <stop offset="0" class="glass-lit" />
          <stop offset="1" class="glass-shaded" />
        </linearGradient>
        <filter id="soft-shadow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3.2" />
        </filter>
        <filter id="contact-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.4" />
        </filter>
        <filter id="tree-shadow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="1.1" />
        </filter>
        <linearGradient id="facade-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" class="grad-facade-top" />
          <stop offset="1" class="grad-facade-bot" />
        </linearGradient>
        <linearGradient id="roof-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" class="grad-roof-top" />
          <stop offset="1" class="grad-roof-bot" />
        </linearGradient>
        <radialGradient id="glow-disaster" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" class="grad-glow-in" />
          <stop offset="0.7" class="grad-glow-mid" />
          <stop offset="1" class="grad-glow-out" />
        </radialGradient>
        <radialGradient id="glow-lamp" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" class="grad-lamp-in" />
          <stop offset="0.6" class="grad-lamp-mid" />
          <stop offset="1" class="grad-lamp-out" />
        </radialGradient>
        <radialGradient id="tree-crown" cx="0.35" cy="0.3" r="0.85">
          <stop offset="0" class="grad-tree-0a" />
          <stop offset="0.65" class="grad-tree-0b" />
          <stop offset="1" class="grad-tree-0c" />
        </radialGradient>
        <radialGradient id="tree-crown-1" cx="0.35" cy="0.3" r="0.85">
          <stop offset="0" class="grad-tree-1a" />
          <stop offset="0.65" class="grad-tree-1b" />
          <stop offset="1" class="grad-tree-1c" />
        </radialGradient>
        <radialGradient id="tree-crown-2" cx="0.35" cy="0.3" r="0.85">
          <stop offset="0" class="grad-tree-2a" />
          <stop offset="0.65" class="grad-tree-2b" />
          <stop offset="1" class="grad-tree-2c" />
        </radialGradient>
        <g id="plant-broadleaf">
          <path class="tree-trunk" d="M -1.2 0 -1.5 -10 1.8 -10 1.2 0Z" />
          <path class="tree-crown" fill="url(#tree-crown)" d="M -9 -9C-13-12-10-18-6-19C-7-24 2-26 5-22C11-24 14-17 11-14C15-9 8-5 3-6C0-3-7-5-9-9Z" />
          <path class="tree-glint" d="M -7 -16Q -5 -20 -2 -20M 0 -21Q 3 -22 5 -19" />
        </g>
        <g id="plant-upright">
          <path class="tree-trunk" d="M -1.25 0V-13H1.25V0Z" />
          <path class="tree-crown" fill="url(#tree-crown-2)" d="M 0 -31C6-26 4-20 8-17C7-13 10-11 7-7Q 0 -4 -7 -7C-10-11-6-15-7-18C-4-23-6-25 0-31Z" />
          <path class="tree-glint" d="M -0.8 -26Q -2 -22 -3 -20" />
        </g>
        <g id="plant-ornamental">
          <path class="tree-trunk" d="M -1.4 0V-7H1.4V0Z" />
          <path class="tree-crown" fill="url(#tree-crown-1)" d="M -10 -7C-12-12-9-15-5-14C-1-20 6-17 7-13C13-13 14-8 10-6C5-3-7-3-10-7Z" />
          <path class="tree-glint" d="M -7 -11Q -5 -13 -3 -12M 0 -15Q 3 -16 5 -13" />
        </g>
      </defs>

      <!-- 模型底座 + 场地 -->
      <g class="layer-base" aria-hidden="true">
        <polygon :points="plinthDrop" class="plinth-drop" filter="url(#soft-shadow)" />
        <polygon :points="plinthSide" class="plinth-side" />
        <polygon :points="plinthFront" class="plinth-front" />
        <polygon :points="plinthTop" class="plinth-top" />
        <polygon :points="plinthTop" class="plinth-grain" />
      </g>

      <!-- 草坪 / 铺装广场 -->
      <g class="layer-landscape" aria-hidden="true">
        <path v-for="(lawn, i) in lawns" :key="`lawn-${i}`" :d="lawn.outline" class="lawn" />
        <path v-for="bed in plantingBeds" :key="bed" :d="bed" class="planting-bed" />
        <g v-for="(p, i) in plazas" :key="`plaza-${i}`">
          <polygon :points="p.outline" class="plaza" />
          <polyline v-for="(j, k) in p.joints" :key="`j-${k}`" :points="j" class="plaza-joint" />
        </g>
        <g v-if="lake" class="lake">
          <path :d="lake.walk" class="shore-walk-curb" />
          <path :d="lake.walk" class="shore-walk" />
          <path :d="lake.outer" class="lake-bank" />
          <path :d="lake.path" class="lake-water" />
          <path :d="lake.inner" class="lake-reflection" />
          <path v-for="ripple in lake.ripples" :key="ripple" :d="ripple" class="lake-ripple" />
          <text :x="lake.label.x" :y="lake.label.y" text-anchor="middle" class="lake-name">天印湖 · 示意</text>
        </g>
        <g v-if="siteFacilities" class="site-facilities">
          <path v-for="link in siteFacilities.links" :key="link" :d="link" class="shore-walk" />
          <g class="campus-court">
            <polygon :points="siteFacilities.courtBase" class="court-base" />
            <polygon :points="siteFacilities.courtFloor" class="court-floor" />
            <polygon v-for="area in siteFacilities.keys" :key="area" :points="area" class="court-key" />
            <path v-for="arc in siteFacilities.laneArcs" :key="arc" :d="arc" class="court-line" />
            <path :d="siteFacilities.halfLine" class="court-line" />
            <path :d="siteFacilities.circle" class="court-line" />
            <g v-for="hoop in siteFacilities.hoops" :key="hoop.support">
              <path :d="hoop.support" class="site-metal" />
              <path :d="hoop.board" class="hoop-board" />
            </g>
          </g>
          <g class="lake-lookout">
            <polygon :points="siteFacilities.lookoutDeck" class="lookout-deck" />
            <path v-for="board in siteFacilities.boards" :key="board" :d="board" class="deck-board" />
            <path v-for="post in siteFacilities.posts" :key="post" :d="post" class="site-metal" />
            <path :d="siteFacilities.rail" class="site-metal" />
          </g>
          <g v-for="bench in siteFacilities.benches" :key="bench.seat" class="site-bench">
            <polygon :points="bench.foot" class="bench-shadow" />
            <polygon :points="bench.seat" class="bench-seat" />
            <path :d="bench.back" class="deck-board" />
          </g>
          <g v-for="lamp in siteFacilities.lamps" :key="`${lamp.base.x},${lamp.base.y}`" class="site-lamp">
            <ellipse :cx="lamp.base.x" :cy="lamp.base.y" rx="9" ry="5" class="site-light-pool" />
            <line :x1="lamp.base.x" :y1="lamp.base.y" :x2="lamp.head.x" :y2="lamp.head.y" class="site-metal" />
            <ellipse :cx="lamp.head.x" :cy="lamp.head.y" rx="3.1" ry="1.65" class="site-lamp-head" />
          </g>
        </g>
      </g>

      <!-- 路口用连续铺面，整层路缘先于路面绘制，避免接头叠出白边。 -->
      <g class="layer-road-bed" aria-hidden="true">
        <path :d="roadNetworkPath" class="road-curb" />
        <path :d="roadNetworkPath" class="road-surface" />
        <path v-if="zoomLevel >= 1.45" :d="roadNetworkPath" class="road-seam" />
      </g>
      <g class="layer-roads">
        <g
          v-for="rv in roadViews"
          :key="rv.id"
          :data-road-id="rv.id"
          class="road selectable"
          :class="{ 'is-hl': isHl('road', rv.id), 'is-selected': isSelected('road', rv.id), 'is-closed': rv.closed }"
          tabindex="0"
          role="button"
          :aria-pressed="isSelected('road', rv.id)"
          :aria-label="rv.aria"
          @click.stop="pickRoad($event, rv.id)"
          @keydown="onKey($event, 'road', rv.id)"
          @pointerenter="onEnter('road', rv.id, $event)"
          @pointerleave="clearHover"
          @focus="onFocus('road', rv.id, $event)"
          @blur="clearHover"
        >
          <polyline :points="rv.ground" class="road-hit" :style="{ strokeWidth: `${20 * screenScale}px` }" />
          <polyline v-if="rv.closed" :points="rv.ground" class="road-closed" />
          <polyline v-if="rv.hazardLabel !== null && layers.disaster" :points="rv.ground" class="road-hazard" />
          <polyline :points="rv.ground" class="road-selection" />
          <polyline :points="rv.ground" class="focus-ring" />
          <title>{{ rv.name }} · 图上示意道路（长度非实测）</title>
        </g>
      </g>

      <!-- 地面接触阴影 / 投影（统一左上日光） -->
      <g class="layer-shadows" aria-hidden="true">
        <polygon v-for="bv in buildingViews" :key="`sh-${bv.id}`" :points="bv.shadow" class="cast-shadow" filter="url(#soft-shadow)" />
        <polygon v-for="bv in buildingViews" :key="`ct-${bv.id}`" :points="bv.contact" class="contact-shadow" filter="url(#contact-shadow)" />
      </g>

      <!-- 灾情地面光晕：语义色随图层（灾情蓝），呼吸脉冲 -->
      <g class="layer-glow" aria-hidden="true">
        <template v-for="bv in buildingViews" :key="`gl-${bv.id}`">
          <ellipse
            v-if="bv.glow"
            :cx="bv.glow.x"
            :cy="bv.glow.y"
            :rx="bv.glow.rx"
            :ry="bv.glow.ry"
            class="disaster-glow"
          />
        </template>
      </g>

      <g v-if="routeD" :key="routeD" class="layer-route" aria-hidden="true">
        <path :d="routeD" class="route-casing" />
        <path :d="routeD" pathLength="1" class="route-line" />
        <path :d="routeD" pathLength="1" class="route-sweep" />
      </g>

      <!-- 场景对象：画家算法深度排序 -->
      <g class="layer-scene">
        <template v-for="obj in sceneObjects" :key="obj.kind === 'building' ? `b-${obj.bv.id}` : obj.kind === 'junction' ? `j-${obj.jv.junction.id}` : `t-${obj.tree.x}-${obj.tree.y}`">
          <!-- 树 -->
          <g v-if="obj.kind === 'tree'" class="tree" aria-hidden="true"
            :transform="`translate(${obj.tree.screen.x} ${obj.tree.screen.y})`">
            <ellipse :cx="obj.tree.r * 0.61" :cy="obj.tree.r * 0.29" :rx="obj.tree.r * 1.02" :ry="obj.tree.r * 0.46" class="tree-shadow" />
            <use :href="`#plant-${obj.tree.form}`"
              :transform="`scale(${(obj.tree.mirrored ? -1 : 1) * obj.tree.r / 10} ${obj.tree.r / 10})`" />
          </g>

          <!-- 路口 / 校门 -->
          <g
            v-else-if="obj.kind === 'junction'"
            class="junction selectable"
            :class="{ 'is-hl': isHl('junction', obj.jv.junction.id), 'is-selected': isSelected('junction', obj.jv.junction.id) }"
            :transform="`translate(${obj.jv.screen.x}, ${obj.jv.screen.y})`"
            tabindex="0"
            role="button"
            :aria-pressed="isSelected('junction', obj.jv.junction.id)"
            :aria-label="`${obj.jv.junction.name}，路口，路网节点非楼栋${isSelected('junction', obj.jv.junction.id) ? '，已选中' : ''}`"
            @click.stop="pick('junction', obj.jv.junction.id)"
            @keydown="onKey($event, 'junction', obj.jv.junction.id)"
            @pointerenter="onEnter('junction', obj.jv.junction.id, $event)"
            @pointerleave="clearHover"
            @focus="onFocus('junction', obj.jv.junction.id, $event)"
            @blur="clearHover"
          >
            <circle r="22" class="junction-hit" />
            <ellipse cx="0" cy="3" rx="17" ry="6" class="lamp-pool" />
            <template v-if="obj.jv.junction.kind === 'gate'">
              <ellipse cx="0" cy="3" rx="20" ry="6" class="gate-shadow" filter="url(#tree-shadow)" />
              <rect x="-17" y="-16" width="5" height="18" rx="1" class="gate-pillar" />
              <rect x="12" y="-16" width="5" height="18" rx="1" class="gate-pillar" />
              <rect x="-19" y="-19" width="38" height="5" rx="1" class="gate-beam" />
              <rect x="-8" y="-13" width="16" height="6" rx="1" class="gate-plaque" />
            </template>
            <template v-else>
              <circle r="7" class="crossing-pad" />
              <circle r="2.2" class="crossing-dot" />
            </template>
            <circle :r="obj.jv.junction.kind === 'gate' ? 22 : 13" class="focus-ring" />
            <title>{{ obj.jv.junction.name }}（路网节点，非楼栋）</title>
          </g>

          <!-- 建筑体量 -->
          <g
            v-else
            class="building selectable"
            :data-material="obj.bv.category"
            :class="{ 'is-hl': isHl('building', obj.bv.id), 'is-selected': isSelected('building', obj.bv.id), 'is-dark': obj.bv.powerCutAt !== null }"
            tabindex="0"
            role="button"
            :aria-pressed="isSelected('building', obj.bv.id)"
            :aria-label="obj.bv.aria"
            @click.stop="pick('building', obj.bv.id)"
            @keydown="onKey($event, 'building', obj.bv.id)"
            @pointerenter="onEnter('building', obj.bv.id, $event)"
            @pointerleave="clearHover"
            @focus="onFocus('building', obj.bv.id, $event)"
            @blur="clearHover"
          >
            <polygon :points="obj.bv.groundRing" class="bld-ground-ring" />
            <polygon v-if="isSelected('building', obj.bv.id)" :points="obj.bv.groundRing" class="selection-cue" />
            <ellipse v-if="obj.bv.pool" :cx="obj.bv.pool.x" :cy="obj.bv.pool.y" :rx="obj.bv.pool.rx" :ry="obj.bv.pool.ry" class="entrance-pool" />
            <template v-if="obj.bv.plinth">
              <polygon v-for="(w, i) in obj.bv.plinth.walls" :key="`pw${i}`" :points="w.quad" class="vol-wall plinth-wall" :class="{ 'vol-wall-west': w.side === 'west' }" />
              <polygon :points="obj.bv.plinth.roof" class="vol-roof plinth-roof" />
            </template>
            <template v-if="obj.bv.tower">
              <polygon v-for="(w, i) in obj.bv.tower.walls" :key="`tw${i}`" :points="w.quad" class="vol-wall" :class="{ 'vol-wall-west': w.side === 'west' }" />
              <polygon v-for="(bd, i) in obj.bv.tower.bands" :key="`tb${i}`" :points="bd.pts" class="vol-band" :class="`lit-${bd.lit}`" />
              <polygon :points="obj.bv.tower.roof" class="vol-roof" />
              <polygon :points="obj.bv.tower.roof" class="vol-roof-tint" :style="{ fill: obj.bv.catColor }" />
              <polygon :points="obj.bv.tower.roofInner" class="vol-roof-inner" />
              <polygon :points="obj.bv.tower.roofEdge" class="vol-roof-edge" />
            </template>
            <polygon v-for="(w, i) in obj.bv.main.walls" :key="`mw${i}`" :points="w.quad" class="vol-wall" :class="{ 'vol-wall-west': w.side === 'west' }" />
            <polygon v-for="(bd, i) in obj.bv.main.bands" :key="`mb${i}`" :points="bd.pts" class="vol-band" :class="`lit-${bd.lit}`" />
            <template v-if="obj.bv.entrance">
              <polygon :points="obj.bv.entrance.recess" class="entrance-recess" />
              <polygon :points="obj.bv.entrance.fascia" class="entrance-fascia" />
              <polygon :points="obj.bv.entrance.canopy" class="entrance-canopy" />
            </template>
            <polygon :points="obj.bv.main.roof" class="vol-roof" />
            <polygon :points="obj.bv.main.roof" class="vol-roof-tint" :style="{ fill: obj.bv.catColor }" />
            <polygon :points="obj.bv.main.roofInner" class="vol-roof-inner" />
            <path v-if="obj.bv.curvedRoof" :d="obj.bv.curvedRoof" class="curved-roof" />
            <polygon v-for="panel in obj.bv.roofPanels" :key="panel" :points="panel" class="roof-panel" />
            <path v-for="seam in obj.bv.roofSeams" :key="seam" :d="seam" class="roof-seam" />
            <polygon :points="obj.bv.main.roofEdge" class="vol-roof-edge" :style="{ '--building-edge': obj.bv.catColor }" />
            <template v-if="obj.bv.aux">
              <polygon v-for="(w, i) in obj.bv.aux.walls" :key="`aw${i}`" :points="w.quad" class="vol-wall" :class="{ 'vol-wall-west': w.side === 'west' }" />
              <polygon v-for="(bd, i) in obj.bv.aux.bands" :key="`ab${i}`" :points="bd.pts" class="vol-band" :class="`lit-${bd.lit}`" />
              <polygon :points="obj.bv.aux.roof" class="vol-roof" />
              <polygon :points="obj.bv.aux.roof" class="vol-roof-tint" :style="{ fill: obj.bv.catColor }" />
              <polygon :points="obj.bv.aux.roofInner" class="vol-roof-inner" />
              <polygon :points="obj.bv.aux.roofEdge" class="vol-roof-edge" />
            </template>
            <g v-for="(rb, i) in obj.bv.roofBoxes" :key="`rb${i}`">
              <polygon v-for="(w, k) in rb.walls" :key="`rbw${k}`" :points="w" class="roofbox-wall" />
              <polygon :points="rb.roof" class="roofbox-roof" />
            </g>
            <g v-if="obj.bv.clock" :transform="`translate(${obj.bv.clock.x} ${obj.bv.clock.y})`" class="tower-clock" aria-hidden="true">
              <circle r="5.8" />
              <path d="M 0 -3.6 V 0 L 2.6 1.3" />
            </g>
            <polygon :points="obj.bv.focusRing" class="focus-ring" />
            <title>{{ obj.bv.name }} · {{ obj.bv.categoryLabel }} · {{ obj.bv.floors }} · 估算容量 {{ obj.bv.capacity }}{{ obj.bv.risk ? ' · 风险：' + obj.bv.risk : '' }}</title>
          </g>
        </template>
      </g>

      <!-- 分区名置于场景之上、标记与屏幕标签之下，描边晕保证可读 -->
      <g v-if="wrapSize.w >= 500" class="district-labels" aria-hidden="true">
        <text v-for="district in districtLabels" :key="district.name"
          :x="district.anchor.x" :y="district.anchor.y">{{ district.name }}</text>
      </g>

      <g v-if="routeD" class="layer-route layer-route-ends" aria-hidden="true">
        <circle v-for="(p, i) in routeEnds" :key="i" :cx="p.x" :cy="p.y" r="5" class="route-end" />
      </g>

      <!-- 应急指挥标记覆盖层 -->
      <g class="layer-marks" aria-hidden="true">
        <template v-for="m in markViews" :key="`${m.key}:${m.text}`">
          <polygon v-if="m.range !== null && m.type === 'disaster'" :points="m.range" class="risk-range risk-disaster" />
          <polygon v-if="m.range !== null && m.type === 'cordon'" :points="m.range" class="risk-range risk-cordon" />
          <g :transform="`translate(${m.x + m.dx * screenScale}, ${m.y + m.dy * screenScale}) scale(${screenScale})`" :class="`mark mark-${m.type}`">
            <line x1="0" y1="-12" :x2="-m.dx" :y2="-m.dy" class="mark-stem" />
            <circle :cx="-m.dx" :cy="-m.dy" r="2.7" class="mark-anchor" />
            <circle v-if="m.type !== 'hazard'" :cx="-m.dx" :cy="-m.dy" r="10" class="mark-change-ring" />
            <template v-if="m.type === 'closed'">
              <rect :x="-m.pillW / 2" y="-30" :width="m.pillW" height="18" rx="4" class="mark-pill" />
              <g class="barrier-glyph">
                <rect :x="-m.pillW / 2 + 4" y="-25" width="12" height="8" rx="1" />
                <line :x1="-m.pillW / 2 + 4" y1="-21" :x2="-m.pillW / 2 + 16" y2="-21" />
              </g>
              <text x="6" y="-17" text-anchor="middle">{{ m.text }}</text>
            </template>
            <template v-else>
              <circle cx="0" cy="-20" r="8" class="mark-dot" />
              <path v-if="m.type === 'disaster' || m.type === 'hazard'" d="M 0 -24 L 0 -19 M 0 -16.5 L 0 -16" class="mark-glyph" />
              <path v-else-if="m.type === 'rescue'" d="M -3.5 -20 L 3.5 -20 M 0 -23.5 L 0 -16.5" class="mark-glyph" />
              <path v-else-if="m.type === 'powercut'" d="M 1 -24 L -2 -19.5 L 1 -19.5 L -1 -16" class="mark-glyph" />
              <path v-else-if="m.type === 'order'" d="M 0 -24 V -20 L 3 -18.5" class="mark-glyph" />
              <path v-else-if="m.type === 'order-done'" d="M -3.5 -20 L -1 -17.5 L 4 -22.5" class="mark-glyph" />
              <path v-else d="M -3.5 -20 L 3.5 -20 M -3.5 -23 L 3.5 -17" class="mark-glyph" />
              <rect :x="-m.pillW / 2" y="-46" :width="m.pillW" height="16" rx="4" class="mark-pill" />
              <text x="0" y="-34.5" text-anchor="middle">{{ m.text }}</text>
            </template>
          </g>
        </template>
      </g>

      <!-- 屏幕标签层：字号恒定、薄底、总览只留地标 -->
      <g class="layer-labels" aria-hidden="true">
        <template v-for="bv in buildingViews" :key="`lb-${bv.id}`">
          <g v-if="labelOf(bv.id, bv.labelAnchor.x, bv.labelAnchor.y).name" :transform="`translate(${labelOf(bv.id, bv.labelAnchor.x, bv.labelAnchor.y).ax}, ${labelOf(bv.id, bv.labelAnchor.x, bv.labelAnchor.y).ay}) scale(${screenScale})`" class="label" :class="{ 'is-active': isSelected('building', bv.id) || (hover?.kind === 'building' && hover.id === bv.id) }">
            <rect :x="-textWidth(mapLabel(bv.name), NAME_PX) / 2 - 6" y="-24" :width="textWidth(mapLabel(bv.name), NAME_PX) + 12" height="17" rx="4" class="label-pill" />
            <text x="0" y="-11.5" text-anchor="middle" class="label-name">{{ mapLabel(bv.name) }}</text>
            <template v-if="labelOf(bv.id, bv.labelAnchor.x, bv.labelAnchor.y).detail">
              <rect :x="-textWidth(`${bv.floors} · 容量≈${bv.capacity}`, 10) / 2 - 6" y="-6" :width="textWidth(`${bv.floors} · 容量≈${bv.capacity}`, 10) + 12" height="15" rx="4" class="label-pill label-pill-sub" />
              <text x="0" y="5" text-anchor="middle" class="label-meta">{{ bv.floors }} · 容量≈{{ bv.capacity }}</text>
            </template>
          </g>
        </template>
        <template v-for="jv in junctionViews" :key="`lj-${jv.junction.id}`">
          <g v-if="labelOf(jv.junction.id, jv.screen.x, jv.screen.y).name" :transform="`translate(${labelOf(jv.junction.id, jv.screen.x, jv.screen.y).ax}, ${labelOf(jv.junction.id, jv.screen.x, jv.screen.y).ay}) scale(${screenScale})`" class="label label-junction">
            <rect :x="-textWidth(mapLabel(jv.junction.name), NAME_PX) / 2 - 6" y="12" :width="textWidth(mapLabel(jv.junction.name), NAME_PX) + 12" height="17" rx="4" class="label-pill" />
            <text x="0" y="24.5" text-anchor="middle" class="label-name">{{ mapLabel(jv.junction.name) }}</text>
          </g>
        </template>
      </g>
    </svg>

    <!-- 边缘精致浮层控件 -->
    <div class="map-hud map-zoom" role="group" aria-label="地图视图控制">
      <button type="button" class="map-btn" aria-label="放大地图" @click="zoomCenter(1.25)">＋</button>
      <button type="button" class="map-btn" aria-label="缩小地图" @click="zoomCenter(1 / 1.25)">－</button>
      <button type="button" class="map-btn" aria-label="复位视图" @click="resetViewClean">⤾</button>
      <span class="map-zoom-level mono">{{ zoomLevel.toFixed(1) }}×</span>
    </div>

    <div class="map-hud map-orient" aria-hidden="true">
      <span class="north">N▲</span>
      <span class="scalebar"><i></i>示意比例 · 非实测</span>
    </div>

    <div class="map-hud map-minilegend" aria-label="地图图例">
      <span class="lg-item"><i class="lg-line lg-open"></i>通行</span>
      <span class="lg-item"><i class="lg-dot lg-disaster"></i>灾情</span>
      <span class="lg-item"><i class="lg-line lg-closed"></i>封闭</span>
      <span class="lg-item"><i class="lg-dot lg-cordon"></i>警戒</span>
      <span class="lg-item"><i class="lg-dot lg-rescue"></i>救援</span>
      <span class="lg-item"><i class="lg-dot lg-powercut"></i>断电</span>
    </div>

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
  background: var(--map-void);
  touch-action: none;
  cursor: grab;
}
.campus-svg:active { cursor: grabbing; }

/* 渐变 stop 走 token，双主题翻转 */
.grad-facade-top { stop-color: var(--map-facade-top); }
.grad-facade-bot { stop-color: var(--map-facade-bot); }
.grad-roof-top { stop-color: var(--map-roof-top); }
.grad-roof-bot { stop-color: var(--map-roof-bot); }
.grad-glow-in { stop-color: var(--blue); stop-opacity: 0.42; }
.grad-glow-mid { stop-color: var(--blue); stop-opacity: 0.16; }
.grad-glow-out { stop-color: var(--blue); stop-opacity: 0; }
.grad-lamp-in { stop-color: var(--map-band-lit); stop-opacity: 0.5; }
.grad-lamp-mid { stop-color: var(--map-band-lit); stop-opacity: 0.16; }
.grad-lamp-out { stop-color: var(--map-band-lit); stop-opacity: 0; }
.grad-tree-0a { stop-color: var(--map-tree-1); }
.grad-tree-0b { stop-color: var(--map-tree-0); }
.grad-tree-0c { stop-color: var(--map-tree-2); }
.grad-tree-1a { stop-color: var(--map-tree-1); }
.grad-tree-1b { stop-color: var(--map-tree-1); }
.grad-tree-1c { stop-color: var(--map-tree-0); }
.grad-tree-2a { stop-color: var(--map-tree-0); }
.grad-tree-2b { stop-color: var(--map-tree-2); }
.grad-tree-2c { stop-color: var(--map-tree-2); }

/* 底座与场地 */
.plinth-drop { fill: var(--map-shadow); opacity: 0.18; }
.terrain-lit { stop-color: var(--map-ground); }
.terrain-shaded { stop-color: var(--map-ground-shade); }
.lake-lit { stop-color: var(--map-lake-lit); }
.lake-shaded { stop-color: var(--map-lake-shaded); }
.glass-lit { stop-color: var(--map-glass-lit); }
.glass-shaded { stop-color: var(--map-glass-shaded); }
.plinth-top { fill: url(#terrain-tone); stroke: var(--map-ground-edge); stroke-width: 1; }
.plinth-grain { fill: url(#terrain-grain); pointer-events: none; }
.terrain-grain-trace { stroke: var(--map-ground-edge); stroke-width: 1; opacity: .28; }
.plinth-front { fill: var(--map-plinth-front); }
.plinth-side { fill: var(--map-plinth-side); }
.lawn { fill: var(--map-lawn); stroke: var(--map-lawn-edge); stroke-width: 1; stroke-linejoin: round; }
.plaza { fill: var(--map-plaza); stroke: var(--map-plaza-edge); stroke-width: 1; stroke-linejoin: round; }
.plaza-joint { fill: none; stroke: var(--map-plaza-edge); stroke-width: 0.8; }
.lake { pointer-events: none; }
.lake-bank { fill: var(--map-lawn); stroke: var(--map-lawn-edge); stroke-width: 1.8; }
.lake-water { fill: url(#lake-tone); stroke: var(--map-lake-shore); stroke-width: 1.2; }
.lake-reflection { fill: none; stroke: var(--map-lake-reflection); stroke-width: 1.1; opacity: .75; }
.lake-ripple { fill: none; stroke: var(--map-lake-reflection); stroke-width: 1.25; stroke-linecap: round; opacity: .64; }
.planting-bed { fill: var(--map-lawn); opacity: .56; pointer-events: none; }
.lake-name { fill: var(--map-lake-ink); font-size: 21px; font-weight: 650; letter-spacing: .12em; }
.shore-walk-curb, .shore-walk { fill: none; stroke-linejoin: round; }
.shore-walk-curb { stroke: var(--map-walk-edge); stroke-width: 10.5; }
.shore-walk { stroke: var(--map-walk-surface); stroke-width: 7; }
.site-facilities { pointer-events: none; }
.court-base { fill: var(--map-court-apron); stroke: var(--map-walk-edge); stroke-width: 1.4; }
.court-floor { fill: var(--map-court-floor); stroke: var(--map-court-marking); stroke-width: 1.7; }
.court-key { fill: var(--map-court-key); stroke: var(--map-court-marking); stroke-width: 1.3; }
.court-line { fill: none; stroke: var(--map-court-marking); stroke-width: 1.5; }
.lookout-deck, .bench-seat { fill: var(--map-timber); stroke: var(--map-timber-edge); stroke-width: 1.2; }
.deck-board { fill: none; stroke: var(--map-timber-edge); stroke-width: 1.35; opacity: .85; }
.bench-shadow { fill: var(--map-shadow); opacity: .23; }
.site-metal { fill: none; stroke: var(--map-site-metal); stroke-width: 1.55; stroke-linecap: round; stroke-linejoin: round; }
.hoop-board { fill: none; stroke: var(--map-court-marking); stroke-width: 2.1; }
.site-lamp-head { fill: var(--map-walk-surface); stroke: var(--map-site-metal); stroke-width: .9; }
.site-light-pool { fill: var(--map-band-lit); opacity: 0; }
[data-theme='ops'] .site-lamp-head { fill: var(--map-band-lit); }
[data-theme='ops'] .site-light-pool { opacity: .24; }
.district-labels { pointer-events: none; }
.district-labels text {
  fill: var(--map-label-dim);
  font-size: 18px;
  font-weight: 650;
  letter-spacing: 0.13em;
  paint-order: stroke;
  stroke: var(--map-label-plate);
  stroke-width: 4px;
  stroke-linejoin: round;
}

/* 道路 */
.selectable { cursor: pointer; }
.selectable:focus { outline: none; }
.focus-ring {
  fill: none;
  stroke: var(--paper);
  stroke-width: 2;
  stroke-dasharray: 5 4;
  opacity: 0;
  pointer-events: none;
}
.selectable:focus-visible .focus-ring { opacity: 1; }
.road-hit { fill: none; stroke: transparent; stroke-width: 22; stroke-linecap: round; stroke-linejoin: round; pointer-events: stroke; }
.layer-road-bed { pointer-events: none; }
.road-curb, .road-surface, .road-closed, .road-hazard, .road-selection {
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.road-curb { stroke: var(--map-road-curb); stroke-width: 16; }
.road-surface { stroke: var(--map-road-surface); stroke-width: 12; }
.road-seam { fill: none; stroke: var(--map-road-lane); stroke-width: .9; stroke-dasharray: 5 10; opacity: .86; }
.road-closed { stroke: var(--red); stroke-width: 10; stroke-dasharray: 10 5; opacity: .85; pointer-events: none; }
.road-hazard { stroke: var(--blue); stroke-width: 10; opacity: .38; pointer-events: none; }
.road.is-closed .road-hazard { stroke-width: 3; opacity: .85; }
.road-selection { stroke: var(--work-accent); stroke-width: 3; opacity: 0; pointer-events: none; transition: opacity 150ms ease-out; }
.road.is-hl .road-selection { opacity: .65; }
.road.is-selected .road-selection { opacity: 1; }

/* 阴影 */
.cast-shadow { fill: var(--map-shadow); opacity: 0.24; pointer-events: none; }
.contact-shadow { fill: var(--map-shadow); opacity: 0.21; pointer-events: none; }

/* 灾情地面光晕 */
.layer-glow { pointer-events: none; }
.disaster-glow { fill: url(#glow-disaster); }

/* 树 */
.tree { pointer-events: none; }
.tree-shadow { fill: var(--map-shadow); opacity: 0.21; }
.tree-trunk { fill: var(--map-tree-trunk); }
.tree-crown { stroke: var(--map-tree-edge); stroke-width: .55; stroke-linejoin: round; }
.tree-glint { fill: none; stroke: var(--map-tree-1); opacity: .66; stroke-width: 1; stroke-linecap: round; }

/* 建筑体量：统一哑光材质，类别只走屋顶描边 */
.bld-ground-ring { fill: var(--work-accent); fill-opacity: .08; stroke: var(--work-accent); stroke-width: 2; opacity: 0; pointer-events: none; transition: opacity 155ms ease-out; }
.building.is-hl .bld-ground-ring { opacity: .55; }
.building.is-selected .bld-ground-ring { opacity: .95; }
.selection-cue {
  fill: none; stroke: var(--work-accent); stroke-width: 2; opacity: 0; pointer-events: none;
  transform-box: fill-box; transform-origin: center;
  animation: selection-cue 340ms cubic-bezier(.22, 1, .36, 1) both;
}
@keyframes selection-cue {
  from { transform: scale(1); opacity: .6; }
  to { transform: scale(1.09); opacity: 0; }
}
.vol-wall { fill: url(#facade-grad); stroke: var(--map-wall-edge); stroke-width: 0.85; stroke-linejoin: round; }
.vol-wall-west { fill: var(--map-facade-west); }
.plinth-wall { fill: var(--map-plaza); }
.vol-band { fill: var(--map-band-dark); opacity: 0.29; pointer-events: none; transition: fill 200ms ease-out, opacity 200ms ease-out; }
[data-theme='ops'] .vol-band.lit-1 { fill: var(--map-band-lit); opacity: .67; }
[data-theme='ops'] .vol-band.lit-2 { fill: var(--map-band-cool); opacity: .34; }
.building.is-dark .vol-band { fill: var(--map-band-dark); }
[data-theme='ops'] .building.is-dark .vol-band { fill: var(--map-band-dark); opacity: .22; }
.vol-roof { fill: url(#roof-grad); stroke: var(--map-roof-edge); stroke-width: 0.8; stroke-linejoin: round; }
[data-material='dormitory'] .vol-roof { fill: var(--map-roof-residence); }
[data-material='canteen'] .vol-roof { fill: var(--map-roof-canteen); }
[data-material='laboratory'] .vol-roof { fill: var(--map-roof-lab); }
.plinth-roof { fill: var(--map-plaza); }
.vol-roof-tint { opacity: 0.12; pointer-events: none; transition: opacity 150ms ease-out; }
.building.is-hl .vol-roof-tint { opacity: .2; }
.building.is-selected .vol-roof-tint { opacity: .27; }
.vol-roof-inner { fill: none; stroke: var(--map-roof-edge); stroke-width: 0.9; opacity: 0.50; pointer-events: none; }
.vol-roof-edge { fill: none; stroke: var(--building-edge, var(--map-roof-edge)); stroke-width: 1.35; opacity: 0.6; stroke-linejoin: round; pointer-events: none; }
.building.is-hl .vol-roof-edge { stroke: var(--work-accent); stroke-width: 2.4; opacity: 0.95; }
.building.is-selected .vol-roof-edge { stroke: var(--work-accent); stroke-width: 3; opacity: 1; }
.roofbox-wall { fill: var(--map-facade-bot); stroke: var(--map-wall-edge); stroke-width: 0.5; }
.roofbox-roof { fill: var(--map-roof-bot); stroke: var(--map-roof-edge); stroke-width: 0.7; }
.curved-roof, .roof-panel { fill: url(#roof-glass); stroke: var(--map-roof-edge); stroke-width: 1.3; pointer-events: none; }
.roof-seam { fill: none; stroke: var(--map-glass-seam); stroke-width: 1.45; pointer-events: none; }
.tower-clock { pointer-events: none; }
.tower-clock circle { fill: var(--map-roof-top); stroke: var(--map-label-dim); stroke-width: 1.25; }
.tower-clock path { fill: none; stroke: var(--map-label-dim); stroke-width: 1.05; stroke-linecap: round; }
.entrance-recess { fill: var(--map-band-lit); opacity: 0.85; pointer-events: none; }
.entrance-canopy { fill: var(--map-plinth-front); pointer-events: none; }
.entrance-fascia { fill: var(--map-wall-edge); pointer-events: none; }
.entrance-pool { fill: url(#glow-lamp); opacity: 0.12; pointer-events: none; }
.building.is-dark .entrance-recess { fill: var(--map-band-dark); opacity: 0.9; }
.building.is-dark .entrance-pool { opacity: 0; }

/* 路口 / 校门 */
.junction-hit { fill: transparent; stroke: none; pointer-events: all; }
.gate-shadow { fill: var(--map-shadow); opacity: 0.3; }
.gate-pillar { fill: var(--map-gate); stroke: var(--map-gate-edge); stroke-width: 0.8; }
.gate-beam { fill: var(--map-gate); stroke: var(--map-gate-edge); stroke-width: 0.8; }
.gate-plaque { fill: var(--amber); }
.crossing-pad { fill: var(--map-crossing); stroke: var(--map-gate-edge); stroke-width: 1; }
.crossing-dot { fill: var(--map-crossing-dot); }
.lamp-pool { fill: url(#glow-lamp); opacity: 0.10; pointer-events: none; }
.junction.is-hl .crossing-pad, .junction.is-selected .crossing-pad { stroke: var(--paper); stroke-width: 2; }
.junction.is-hl .gate-beam, .junction.is-selected .gate-beam { stroke: var(--paper); stroke-width: 2; }

/* 线路改动时沿行进方向绘制一次，地面保留可静态阅读的路线。 */
.layer-route { pointer-events: none; }
.route-casing, .route-line, .route-sweep { fill: none; stroke-linecap: round; stroke-linejoin: round; }
.route-casing { stroke: var(--map-road-surface); stroke-width: 10; opacity: .95; }
.route-line { stroke: var(--blue); stroke-width: 5.5; stroke-dasharray: 1 1; animation: trace-route 460ms cubic-bezier(.22,1,.36,1) both; }
.route-sweep {
  stroke: #c9e9ff; stroke-width: 2.1; stroke-dasharray: .08 .92; opacity: 0;
  animation: route-sweep 720ms 120ms ease-out both;
}
.route-end { fill: var(--blue); stroke: var(--map-road-surface); stroke-width: 2.4; }
.route-end:first-child { fill: var(--map-road-surface); stroke: var(--blue); }
@keyframes trace-route { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
@keyframes route-sweep {
  0% { stroke-dashoffset: 1; opacity: 0; }
  18% { opacity: .9; }
  76% { opacity: .7; }
  100% { stroke-dashoffset: 0; opacity: 0; }
}

/* 应急标记：语义色不变，牌底随主题 */
.layer-marks { pointer-events: none; }
.mark { animation: mark-in 220ms cubic-bezier(.22,1,.36,1) both; }
.mark-dot { transform-box: fill-box; transform-origin: center; animation: mark-focus 220ms cubic-bezier(.22,1,.36,1) both; }
@keyframes mark-in { from { opacity: .26; } to { opacity: 1; } }
@keyframes mark-focus { from { transform: scale(.75); } to { transform: scale(1); } }
.risk-range { fill: none; stroke-width: 2; stroke-dasharray: 6 4; opacity: 0.8; }
.risk-disaster { stroke: var(--blue); fill: var(--blue); fill-opacity: 0.08; }
.risk-cordon { stroke: var(--amber); fill: var(--amber); fill-opacity: 0.06; }
.mark-stem { stroke: var(--map-label-dim); stroke-width: 1.15; }
.mark-anchor { fill: var(--map-label-dim); stroke: var(--map-mark-plate); stroke-width: 1; }
.mark-hazard .mark-anchor { fill: var(--blue); }
.mark-closed .mark-anchor { fill: var(--red); }
.mark-pill { fill: var(--map-mark-plate); stroke: var(--map-label-edge); stroke-width: 1; }
.mark text { font-size: 10.5px; font-weight: 700; font-family: var(--font-sans); }
.mark-disaster .mark-dot, .mark-hazard .mark-dot { fill: var(--blue); }
.mark-disaster .mark-glyph, .mark-hazard .mark-glyph { stroke: #f5f8fc; stroke-width: 2; stroke-linecap: round; fill: none; }
.mark-disaster text, .mark-hazard text { fill: var(--blue); }
.mark-disaster .mark-pill, .mark-hazard .mark-pill { stroke: var(--edge-blue); }
.mark-cordon .mark-dot { fill: var(--amber); }
.mark-cordon .mark-glyph { stroke: #f5f8fc; stroke-width: 2; stroke-linecap: round; fill: none; }
.mark-cordon text { fill: var(--amber); }
.mark-cordon .mark-pill { stroke: var(--edge-amber); }
.mark-rescue .mark-dot { fill: var(--green); }
.mark-rescue .mark-glyph { stroke: #f5f8fc; stroke-width: 2.2; stroke-linecap: round; fill: none; }
.mark-rescue text { fill: var(--green); }
.mark-rescue .mark-pill { stroke: var(--edge-green); }
.mark-powercut .mark-dot { fill: var(--red); }
.mark-powercut .mark-glyph { stroke: #f5f8fc; stroke-width: 2; stroke-linecap: round; fill: none; }
.mark-powercut text { fill: var(--red); }
.mark-powercut .mark-pill { stroke: var(--edge-red); }
.mark-closed .mark-pill { stroke: var(--red); }
.mark-closed text { fill: var(--red); font-family: var(--font-mono); }
.mark-order, .mark-disaster { --mark-state: var(--blue); }
.mark-order-done, .mark-rescue { --mark-state: var(--green); }
.mark-cordon { --mark-state: var(--amber); }
.mark-closed, .mark-powercut { --mark-state: var(--red); }
:is(.mark-order, .mark-order-done) :is(.mark-dot, .mark-anchor, text) { fill: var(--mark-state); }
:is(.mark-order, .mark-order-done) .mark-pill { stroke: var(--mark-state); }
:is(.mark-order, .mark-order-done) .mark-glyph { fill: none; stroke: #fff; stroke-width: 1.65; stroke-linecap: round; stroke-linejoin: round; }
.mark-change-ring {
  fill: none; stroke: var(--mark-state); stroke-width: 1.7; opacity: 0;
  transform-box: fill-box; transform-origin: center; animation: mark-change 800ms ease-out both;
}
@keyframes mark-change {
  from { transform: scale(.55); opacity: .92; }
  to { transform: scale(2.2); opacity: 0; }
}
.barrier-glyph rect { fill: var(--red); }
.barrier-glyph line { stroke: #f5f8fc; stroke-width: 2; }

/* 屏幕标签层 */
.layer-labels { pointer-events: none; }
.label-pill { fill: var(--map-label-plate); stroke: var(--map-label-edge); stroke-width: 0.8; }
.label-pill-sub { fill-opacity: 0.85; }
.label-name { fill: var(--map-label-ink); font-size: 12px; font-weight: 700; font-family: var(--font-sans); }
.label-meta { fill: var(--map-label-dim); font-size: 10px; font-family: var(--font-mono); }
.label.is-active .label-pill { stroke: var(--amber); stroke-width: 1.4; }
.label-junction .label-name { fill: var(--map-label-dim); font-weight: 600; }

/* HUD 浮层 */
.map-hud { position: absolute; z-index: 3; }
.map-zoom { left: 10px; top: 10px; display: flex; gap: 5px; align-items: center; }
.map-btn {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: 1px solid var(--map-hud-edge);
  border-radius: 8px;
  background: var(--map-hud-plate);
  color: var(--map-hud-ink);
  font-size: 18px;
  font-weight: 700;
  cursor: pointer;
}
.map-btn:hover { border-color: var(--amber); }
.map-btn:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; }
.map-zoom-level { font-size: 11px; color: var(--map-hud-dim); background: var(--map-hud-plate); padding: 2px 6px; border-radius: 3px; }
.map-orient { right: 12px; top: 14px; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; pointer-events: none; }
.north { color: var(--map-hud-ink); font-size: 13px; font-weight: 800; font-family: var(--font-mono); }
.scalebar { display: flex; align-items: center; gap: 6px; color: var(--map-hud-dim); font-size: 10.5px; }
.scalebar i { display: inline-block; width: 56px; height: 4px; border-left: 2px solid var(--map-hud-dim); border-right: 2px solid var(--map-hud-dim); border-bottom: 2px solid var(--map-hud-dim); }
.map-minilegend {
  left: 10px;
  bottom: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  max-width: 62%;
  padding: 6px 8px;
  border-radius: 7px;
  background: var(--map-hud-plate);
  border: 1px solid var(--map-hud-edge);
  pointer-events: none;
}
.lg-item { display: inline-flex; align-items: center; gap: 4px; color: var(--map-hud-ink); font-size: 10.5px; }
.lg-line { width: 16px; height: 0; border-top: 3px solid; display: inline-block; }
.lg-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
.lg-open { border-top-color: var(--map-road-curb); }
.lg-closed { border-top-color: var(--red); }
.lg-disaster { background: var(--blue); }
.lg-cordon { background: var(--amber); }
.lg-rescue { background: var(--green); }
.lg-powercut { background: var(--red); }
.map-hovercard {
  position: absolute;
  z-index: 4;
  width: 220px;
  padding: 8px 10px;
  border: 1px solid var(--map-hud-edge);
  border-radius: 4px;
  background: var(--map-hud-plate);
  box-shadow: 0 8px 20px rgb(15 38 27 / 0.15);
  pointer-events: none;
}
.hc-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.hc-title { color: var(--map-hud-ink); font-size: 13px; font-weight: 700; }
.hc-tag { color: var(--map-hud-dim); font-size: 10.5px; font-weight: 700; border: 1px solid var(--map-hud-edge); border-radius: 3px; padding: 0 4px; }
.hc-line { margin: 2px 0; color: var(--map-hud-dim); font-size: 11.5px; line-height: 1.5; }
@media (hover: none), (max-width: 920px) {
  .map-hovercard { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .bld-ground-ring, .vol-roof-tint, .vol-band, .road-selection { transition: none; }
  .selection-cue, .route-sweep, .mark-change-ring { display: none; }
  .route-line, .mark, .mark-dot { animation: none; }
}

@media (max-width: 400px) {
  .campus-svg { touch-action: pan-y; }
  .map-minilegend { max-width: 78%; gap: 3px 8px; }
  .map-orient .scalebar { display: none; }
  .lg-item { font-size: 10px; }
  .map-hovercard { width: 180px; }
}
</style>
