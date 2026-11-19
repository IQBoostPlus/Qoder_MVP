<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
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

// ---- 建筑实体沙盘：正交斜投影（约 40° 俯角）。投影只发生在渲染器内部，
// ---- port / fixture 的平面几何与 viewBox 契约保持不变。
const KY = 0.574; // 地面 y 向屏幕压缩（cos 55°，约 35° 俯角）
const KZ = 0.819; // 高度 z 向屏幕抬升（sin 55°）
function proj(x: number, y: number, z = 0): Point {
  return { x, y: y * KY - z * KZ };
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

// 体量高度仅由层数做视觉比例，不对外当实测高度。
function massHeight(floors: number | null): number {
  const f = floors === null ? 2 : Math.min(floors, 8);
  return 14 + f * 5;
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

// 竖直挤出 + 斜投影下，只有外法线朝屏幕下方（ny>0）的侧壁可见。
interface Wall {
  a: Point;
  b: Point;
  quad: string;
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
    if (ny > 0.0001) {
      faces.push({
        a,
        b,
        quad: pointsAttr([proj(a.x, a.y, z0), proj(b.x, b.y, z0), proj(b.x, b.y, z0 + h), proj(a.x, a.y, z0 + h)]),
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
  const top = vb.y * KY - maxLift.value - 40;
  const bottom = (vb.y + vb.height) * KY + 46;
  return { x: vb.x - padX, y: top, w: vb.width + padX * 2, h: bottom - top };
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
const screenScale = computed(() => view.value.w / wrapSize.value.w);
const NAME_PX = 12;
function textWidth(s: string, px: number): number {
  let w = 0;
  for (const ch of s) w += /[⺀-鿿＀-￯]/.test(ch) ? px : px * 0.6;
  return w;
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
const labelPlan = computed<Record<string, { name: boolean; detail: boolean }>>(() => {
  const ss = screenScale.value;
  const v = view.value;
  const overview = zoomLevel.value < 1.35;
  const placed: LabelRect[] = [];
  const out: Record<string, { name: boolean; detail: boolean }> = {};
  const ranked = [...buildingViews.value].sort(
    (a, b) => (b.box.maxX - b.box.minX) * (b.box.maxY - b.box.minY) - (a.box.maxX - a.box.minX) * (a.box.maxY - a.box.minY),
  );
  const landmarkIds = new Set(ranked.slice(0, 4).map((b) => b.id));
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
  }[] = [];
  for (const bv of buildingViews.value) {
    const bw = (bv.box.maxX - bv.box.minX) / ss;
    const sel = isSelected('building', bv.id);
    const hov = hover.value?.kind === 'building' && hover.value.id === bv.id;
    cands.push({
      id: bv.id,
      sx: (bv.labelAnchor.x - v.x) / ss,
      sy: (bv.labelAnchor.y - v.y) / ss,
      name: bv.name,
      detail: sel || hov || bw >= 120,
      prio: sel ? 0 : hov ? 1 : 2,
      area: (bv.box.maxX - bv.box.minX) * (bv.box.maxY - bv.box.minY),
      dy: -14,
      landmark: landmarkIds.has(bv.id),
    });
  }
  for (const jv of junctionViews.value) {
    const sel = isSelected('junction', jv.junction.id);
    const hov = hover.value?.kind === 'junction' && hover.value.id === jv.junction.id;
    const gate = jv.junction.kind === 'gate';
    cands.push({
      id: jv.junction.id,
      sx: (jv.screen.x - v.x) / ss,
      sy: (jv.screen.y - v.y) / ss,
      name: jv.junction.name,
      detail: false,
      prio: sel ? 0 : hov ? 1 : 3,
      area: 0,
      dy: gate ? 26 : 20,
      landmark: gate,
    });
  }
  cands.sort((a, b) => a.prio - b.prio || b.area - a.area);
  for (const c of cands) {
    const nw = textWidth(c.name, NAME_PX);
    const nameRect: LabelRect = { x0: c.sx - nw / 2 - 7, y0: c.sy + c.dy - 13, x1: c.sx + nw / 2 + 7, y1: c.sy + c.dy + 5 };
    const block: LabelRect = c.detail ? { ...nameRect, y1: c.sy + c.dy + 22 } : nameRect;
    const allowed = c.prio <= 1 || !overview || c.landmark;
    const show = allowed && !placed.some((r) => overlaps(block, r));
    out[c.id] = { name: show, detail: c.detail && show };
    if (show) placed.push(block);
  }
  return out;
});
function labelOf(id: string): { name: boolean; detail: boolean } {
  return labelPlan.value[id] ?? { name: true, detail: false };
}

function clientToMap(clientX: number, clientY: number): Point | null {
  const svg = svgEl.value;
  if (!svg) return null;
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}
function zoomAt(p: Point, factor: number): void {
  const base = sceneBounds.value;
  const newW = Math.min(Math.max(view.value.w / factor, base.w / 5), base.w / 0.7);
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

const routeRoadIds = computed<readonly string[]>(() =>
  props.route?.status === 'ready' ? props.route.road_ids : [],
);

// ---- 路段视图 ----
interface RoadView {
  id: string;
  name: string;
  ground: string;
  length: string;
  mid: Point;
  midScreen: Point;
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
    const mid = midMarker(road.geometry);
    return {
      id: road.id,
      name: road.name,
      ground: projAttr(road.geometry),
      length: roadLength(road.id),
      mid,
      midScreen: proj(mid.x, mid.y),
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

// ---- 建筑体量模型：统一哑光材质 + 克制的类别体量语言 ----
interface VolumeRender {
  walls: string[];
  bands: string[];
  roof: string;
  roofEdge: string;
}
interface RoofBox {
  walls: string[];
  roof: string;
}
interface BuildingView {
  id: string;
  name: string;
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
  entrance: { recess: string; canopy: string; fascia: string } | null;
  labelAnchor: Point;
  markAnchor: Point;
  floors: string;
  capacity: number;
  risk: string | null;
  categoryLabel: string;
  disasterTitle: string | null;
  disasterAt: number | null;
  cordonLabel: string | null;
  rescueLabel: string | null;
  aria: string;
}

function renderVolume(pts: readonly Point[], h: number, z0: number, bandRows: number, bandInset: number): VolumeRender {
  const walls = wallFaces(pts, h, z0);
  const bands: string[] = [];
  if (bandRows > 0) {
    for (const w of walls) {
      for (let r = 0; r < bandRows; r += 1) {
        const t0 = (r + 0.45) / (bandRows + 0.7);
        const t1 = (r + 0.8) / (bandRows + 0.7);
        bands.push(wallStrip(w, h, z0, bandInset, 1 - bandInset, t0, t1));
      }
    }
  }
  const roofPts = projPts(pts, z0 + h);
  return {
    walls: walls.map((w) => w.quad),
    bands,
    roof: pointsAttr(roofPts),
    roofEdge: pointsAttr(roofPts),
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

  const shadowPts = b.polygon.map((p) => proj(p.x + h * 0.7, p.y + h * 0.5));
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
    );
  } else if (cat === 'gymnasium') {
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
    );
  } else if (cat === 'dormitory') {
    bandRows = Math.max(2, Math.min(fn, 6));
  }

  const main = renderVolume(mainPts, mainH, 0, bandRows, cat === 'gymnasium' ? 0.06 : 0.08);

  // 屋顶设备：小哑光体量，保持模型感。
  const roofBoxes: RoofBox[] = [];
  const addRoofBox = (x: number, y: number, bw: number, bd: number, bh: number): void => {
    const pts = [
      { x, y },
      { x: x + bw, y },
      { x: x + bw, y: y + bd },
      { x, y: y + bd },
    ];
    const walls = wallFaces(pts, bh, mainH);
    roofBoxes.push({ walls: walls.map((wl) => wl.quad), roof: projAttr(pts, mainH + bh) });
  };
  if (cat === 'dormitory') addRoofBox(box.maxX - 18, box.minY + 4, 12, 8, 5);
  else if (cat === 'laboratory') {
    addRoofBox(box.minX + 8, box.minY + 5, 6, 6, 6);
    addRoofBox(box.minX + 20, box.minY + 5, 6, 6, 8);
  } else if (cat === 'canteen') addRoofBox(box.minX + 8, box.minY + 4, 8, 6, 5);
  else if (cat === 'teaching') addRoofBox(box.minX + w * 0.3, box.minY + 4, 10, 7, 4);

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

  const disaster = props.layers.disaster ? props.overlay.disaster.find((m) => m.building_id === b.id) : undefined;
  const cordon = props.layers.cordon ? props.overlay.cordons.find((m) => m.building_id === b.id) : undefined;
  const rescue = props.layers.rescue ? props.overlay.rescues.find((m) => m.building_id === b.id) : undefined;
  const floors = formatBuildingFloors(b);
  const roofTop = proj(c.x, c.y, mainH);
  return {
    id: b.id,
    name: b.name,
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
    entrance,
    labelAnchor: roofTop,
    markAnchor: proj(c.x, box.minY, mainH),
    floors,
    capacity: b.capacity,
    risk: b.risk_tag,
    categoryLabel: CATEGORY_STYLE[cat].label,
    disasterTitle: disaster?.title ?? null,
    disasterAt: disaster?.at_sim ?? null,
    cordonLabel: cordon ? cordonText(cordon) : null,
    rescueLabel: rescue ? rescueText(rescue) : null,
    aria: `${b.name}，楼栋，${CATEGORY_STYLE[cat].label}，${floors}，估算容量${b.capacity}${b.risk_tag === null ? '' : `，风险${b.risk_tag}`}${disaster ? `，灾情：${disaster.title}` : ''}${cordon ? `，${cordonText(cordon)}` : ''}${rescue ? `，${rescueText(rescue)}` : ''}${isSelected('building', b.id) ? '，已选中' : ''}`,
  };
}

const buildingViews = computed<BuildingView[]>(() => props.map.buildings.map(buildingModel));

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
  for (const r of props.map.road_segments) {
    for (let i = 0; i + 1 < r.geometry.length; i += 1) {
      const a = r.geometry[i];
      const b = r.geometry[i + 1];
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
function isFree(p: Point, margin: number): boolean {
  return inBounds(p, 12) && !inBuilding(p, margin) && roadDist(p) > ROAD_HALF + 4;
}

interface Lawn {
  x: number;
  y: number;
  w: number;
  h: number;
  px: number;
  py: number;
  pw: number;
  ph: number;
}
const lawns = computed<Lawn[]>(() => {
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
  const out: Lawn[] = [];
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
        const tl = proj(x + 6, y + 6);
        out.push({ x, y, w, h: hh, px: tl.x, py: tl.y, pw: w - 12, ph: (hh - 12) * KY });
      }
    }
  }
  return out;
});

interface Plaza {
  px: number;
  py: number;
  pw: number;
  ph: number;
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
    const tl = proj(rect.minX, rect.minY);
    out.push({ px: tl.x, py: tl.y, pw: rect.maxX - rect.minX, ph: (rect.maxY - rect.minY) * KY, joints });
  }
  return out;
});

interface Tree {
  x: number;
  y: number;
  r: number;
  screen: Point;
  depth: number;
  tone: number;
}
const trees = computed<Tree[]>(() => {
  const out: Tree[] = [];
  const push = (x: number, y: number, seed: number): void => {
    if (out.length >= 110) return;
    const p = { x, y };
    if (!inBounds(p, 14) || inBuilding(p, 6) || roadDist(p) < ROAD_HALF + 8) return;
    if (out.some((t) => Math.hypot(t.x - x, t.y - y) < 17)) return;
    const r = 8 + (seed % 3) * 1.6;
    out.push({ x, y, r, screen: proj(x, y), depth: y, tone: seed % 3 });
  };
  let seed = 0;
  for (const road of props.map.road_segments) {
    for (let i = 0; i + 1 < road.geometry.length; i += 1) {
      const a = road.geometry[i];
      const b = road.geometry[i + 1];
      if (!a || !b) continue;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const n = Math.floor(len / 34);
      const nx = -(b.y - a.y) / (len || 1);
      const ny = (b.x - a.x) / (len || 1);
      for (let k = 1; k <= n; k += 1) {
        const t = k / (n + 1);
        const px = a.x + (b.x - a.x) * t;
        const py = a.y + (b.y - a.y) * t;
        const off = ROAD_HALF + 11;
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
      push(lawn.x + 8 + (lawn.w - 16) * (k / Math.max(1, n)), lawn.y + 8, seed);
      seed += 1;
      push(lawn.x + 8 + (lawn.w - 16) * (k / Math.max(1, n)), lawn.y + lawn.h - 8, seed);
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
  type: 'disaster' | 'cordon' | 'rescue' | 'hazard' | 'closed';
  x: number;
  y: number;
  dy: number;
  text: string;
  pillW: number;
  range: string | null;
}
const MARK_DY: Record<MarkView['type'], number> = {
  disaster: 0,
  cordon: -26,
  rescue: -52,
  hazard: 0,
  closed: -34,
};
const markViews = computed<MarkView[]>(() => {
  const out: MarkView[] = [];
  const push = (key: string, type: MarkView['type'], x: number, y: number, text: string, range: string | null): void => {
    out.push({ key, type, x, y, dy: MARK_DY[type], text, pillW: textWidth(text, 10.5) + 16, range });
  };
  for (const bv of buildingViews.value) {
    if (bv.disasterTitle !== null) {
      push(`d-${bv.id}`, 'disaster', bv.markAnchor.x, bv.markAnchor.y, `${bv.disasterTitle} @${bv.disasterAt}`, bv.groundRing);
    }
    if (bv.cordonLabel !== null) {
      push(`c-${bv.id}`, 'cordon', bv.markAnchor.x, bv.markAnchor.y, bv.cordonLabel, bv.cordonRing);
    }
    if (bv.rescueLabel !== null) {
      push(`r-${bv.id}`, 'rescue', bv.markAnchor.x, bv.markAnchor.y, bv.rescueLabel, null);
    }
  }
  for (const rv of roadViews.value) {
    if (rv.hazardLabel !== null && props.layers.disaster) {
      push(`h-${rv.id}`, 'hazard', rv.midScreen.x, rv.midScreen.y, `${rv.hazardLabel} @${rv.hazardAt}`, null);
    }
    if (rv.closed) {
      push(`x-${rv.id}`, 'closed', rv.midScreen.x, rv.midScreen.y, `封闭·seq${rv.closedSeq}`, null);
    }
  }
  return out;
});

const routePoints = computed(() => (props.route?.status === 'ready' ? projAttr(props.route.points) : ''));
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
  return pointsAttr([proj(x0, y), proj(x1, y), proj(x1, y, -10), proj(x0, y, -10)]);
});
const plinthSide = computed(() => {
  const vb = props.map.view_box;
  const x = vb.x + vb.width + 10;
  const y0 = vb.y - 10;
  const y1 = vb.y + vb.height + 10;
  return pointsAttr([proj(x, y0), proj(x, y1), proj(x, y1, -10), proj(x, y0, -10)]);
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
      aria-label="校园实体沙盘（示例回放，训练模拟数据）：楼栋、路段、路口均可点选；滚轮缩放、拖拽平移、双击复位"
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
          <stop offset="0" stop-color="#cfc7b8" />
          <stop offset="1" stop-color="#a99f8d" />
        </linearGradient>
        <linearGradient id="roof-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#f8f5ef" />
          <stop offset="1" stop-color="#e9e4d9" />
        </linearGradient>
        <radialGradient id="tree-crown" cx="0.35" cy="0.3" r="0.85">
          <stop offset="0" stop-color="#aab894" />
          <stop offset="0.65" stop-color="#8fa07c" />
          <stop offset="1" stop-color="#75866a" />
        </radialGradient>
        <radialGradient id="tree-crown-1" cx="0.35" cy="0.3" r="0.85">
          <stop offset="0" stop-color="#b0bd9c" />
          <stop offset="0.65" stop-color="#95a683" />
          <stop offset="1" stop-color="#7b8c6e" />
        </radialGradient>
        <radialGradient id="tree-crown-2" cx="0.35" cy="0.3" r="0.85">
          <stop offset="0" stop-color="#a2b190" />
          <stop offset="0.65" stop-color="#879875" />
          <stop offset="1" stop-color="#6d7f60" />
        </radialGradient>
      </defs>

      <!-- 模型底座 + 场地 -->
      <g class="layer-base" aria-hidden="true">
        <polygon :points="plinthDrop" class="plinth-drop" filter="url(#soft-shadow)" />
        <polygon :points="plinthSide" class="plinth-side" />
        <polygon :points="plinthFront" class="plinth-front" />
        <polygon :points="plinthTop" class="plinth-top" />
      </g>

      <!-- 草坪 / 铺装广场 -->
      <g class="layer-landscape" aria-hidden="true">
        <rect v-for="(l, i) in lawns" :key="`lawn-${i}`" :x="l.px" :y="l.py" :width="l.pw" :height="l.ph" rx="7" class="lawn" />
        <g v-for="(p, i) in plazas" :key="`plaza-${i}`">
          <rect :x="p.px" :y="p.py" :width="p.pw" :height="p.ph" rx="4" class="plaza" />
          <polyline v-for="(j, k) in p.joints" :key="`j-${k}`" :points="j" class="plaza-joint" />
        </g>
      </g>

      <!-- 路段：路缘 + 路面 + 中心线；透明宽描边为命中区 -->
      <g class="layer-roads">
        <g
          v-for="rv in roadViews"
          :key="rv.id"
          class="road selectable"
          :class="{ 'is-hl': isHl('road', rv.id), 'is-selected': isSelected('road', rv.id), 'is-route': rv.onRoute, 'is-closed': rv.closed }"
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
          <polyline :points="rv.ground" class="road-hit" :style="{ strokeWidth: `${20 * screenScale}px` }" />
          <polyline :points="rv.ground" class="road-curb" />
          <polyline :points="rv.ground" class="road-surface" />
          <polyline v-if="!rv.closed && zoomLevel >= 1.5" :points="rv.ground" class="road-center" />
          <polyline v-if="rv.onRoute" :points="rv.ground" class="road-route" />
          <polyline v-if="rv.hazardLabel !== null && layers.disaster" :points="rv.ground" class="road-hazard" />
          <polyline :points="rv.ground" class="focus-ring" />
          <title>{{ rv.name }} · 图上长度 {{ rv.length }} px（训练级简化，非官方路名）</title>
        </g>
      </g>

      <!-- 地面接触阴影 / 投影（统一左上日光） -->
      <g class="layer-shadows" aria-hidden="true">
        <polygon v-for="bv in buildingViews" :key="`sh-${bv.id}`" :points="bv.shadow" class="cast-shadow" filter="url(#soft-shadow)" />
        <polygon v-for="bv in buildingViews" :key="`ct-${bv.id}`" :points="bv.contact" class="contact-shadow" filter="url(#contact-shadow)" />
      </g>

      <!-- 场景对象：画家算法深度排序 -->
      <g class="layer-scene">
        <template v-for="obj in sceneObjects" :key="obj.kind === 'building' ? `b-${obj.bv.id}` : obj.kind === 'junction' ? `j-${obj.jv.junction.id}` : `t-${obj.tree.x}-${obj.tree.y}`">
          <!-- 树 -->
          <g v-if="obj.kind === 'tree'" class="tree" aria-hidden="true">
            <ellipse :cx="obj.tree.screen.x + obj.tree.r * 0.55" :cy="obj.tree.screen.y + obj.tree.r * 0.3" :rx="obj.tree.r * 1.05" :ry="obj.tree.r * 0.45" class="tree-shadow" filter="url(#tree-shadow)" />
            <rect :x="obj.tree.screen.x - 1.1" :y="obj.tree.screen.y - obj.tree.r * 0.85" width="2.2" :height="obj.tree.r * 0.95" class="tree-trunk" />
            <circle :cx="obj.tree.screen.x" :cy="obj.tree.screen.y - obj.tree.r * 0.95" :r="obj.tree.r" :fill="`url(#tree-crown-${obj.tree.tone})`" class="tree-crown" />
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
            :class="{ 'is-hl': isHl('building', obj.bv.id), 'is-selected': isSelected('building', obj.bv.id) }"
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
            <template v-if="obj.bv.plinth">
              <polygon v-for="(w, i) in obj.bv.plinth.walls" :key="`pw${i}`" :points="w" class="vol-wall plinth-wall" />
              <polygon :points="obj.bv.plinth.roof" class="vol-roof plinth-roof" />
            </template>
            <template v-if="obj.bv.tower">
              <polygon v-for="(w, i) in obj.bv.tower.walls" :key="`tw${i}`" :points="w" class="vol-wall" />
              <polygon v-for="(bd, i) in obj.bv.tower.bands" :key="`tb${i}`" :points="bd" class="vol-band" />
              <polygon :points="obj.bv.tower.roof" class="vol-roof" />
              <polygon :points="obj.bv.tower.roofEdge" class="vol-roof-edge" />
            </template>
            <polygon v-for="(w, i) in obj.bv.main.walls" :key="`mw${i}`" :points="w" class="vol-wall" />
            <polygon v-for="(bd, i) in obj.bv.main.bands" :key="`mb${i}`" :points="bd" class="vol-band" />
            <template v-if="obj.bv.entrance">
              <polygon :points="obj.bv.entrance.recess" class="entrance-recess" />
              <polygon :points="obj.bv.entrance.fascia" class="entrance-fascia" />
              <polygon :points="obj.bv.entrance.canopy" class="entrance-canopy" />
            </template>
            <polygon :points="obj.bv.main.roof" class="vol-roof" />
            <polygon :points="obj.bv.main.roofEdge" class="vol-roof-edge" />
            <template v-if="obj.bv.aux">
              <polygon v-for="(w, i) in obj.bv.aux.walls" :key="`aw${i}`" :points="w" class="vol-wall" />
              <polygon v-for="(bd, i) in obj.bv.aux.bands" :key="`ab${i}`" :points="bd" class="vol-band" />
              <polygon :points="obj.bv.aux.roof" class="vol-roof" />
              <polygon :points="obj.bv.aux.roofEdge" class="vol-roof-edge" />
            </template>
            <g v-for="(rb, i) in obj.bv.roofBoxes" :key="`rb${i}`">
              <polygon v-for="(w, k) in rb.walls" :key="`rbw${k}`" :points="w" class="roofbox-wall" />
              <polygon :points="rb.roof" class="roofbox-roof" />
            </g>
            <polygon :points="obj.bv.focusRing" class="focus-ring" />
            <title>{{ obj.bv.name }} · {{ obj.bv.categoryLabel }} · {{ obj.bv.floors }} · 估算容量 {{ obj.bv.capacity }}{{ obj.bv.risk ? ' · 风险：' + obj.bv.risk : '' }}</title>
          </g>
        </template>
      </g>

      <!-- 路径线：只消费 RouteResult.points -->
      <g v-if="routePoints !== ''" class="layer-route" aria-hidden="true">
        <polyline :points="routePoints" class="route-casing" />
        <polyline :points="routePoints" class="route-line" />
        <circle v-for="(p, i) in routeEnds" :key="i" :cx="p.x" :cy="p.y" r="5" class="route-end" />
      </g>

      <!-- 应急指挥标记覆盖层 -->
      <g class="layer-marks" aria-hidden="true">
        <template v-for="m in markViews" :key="m.key">
          <polygon v-if="m.range !== null && m.type === 'disaster'" :points="m.range" class="risk-range risk-disaster" />
          <polygon v-if="m.range !== null && m.type === 'cordon'" :points="m.range" class="risk-range risk-cordon" />
          <g :transform="`translate(${m.x}, ${m.y + m.dy * screenScale}) scale(${screenScale})`" :class="`mark mark-${m.type}`">
            <template v-if="m.type === 'closed'">
              <rect :x="-m.pillW / 2" y="-30" :width="m.pillW" height="18" rx="4" class="mark-pill" />
              <g class="barrier-glyph">
                <rect :x="-m.pillW / 2 + 4" y="-25" width="12" height="8" rx="1" />
                <line :x1="-m.pillW / 2 + 4" y1="-21" :x2="-m.pillW / 2 + 16" y2="-21" />
              </g>
              <text x="6" y="-17" text-anchor="middle">{{ m.text }}</text>
            </template>
            <template v-else>
              <line x1="0" y1="-12" x2="0" y2="-2" class="mark-stem" />
              <circle cx="0" cy="-20" r="8" class="mark-dot" />
              <path v-if="m.type === 'disaster' || m.type === 'hazard'" d="M 0 -24 L 0 -19 M 0 -16.5 L 0 -16" class="mark-glyph" />
              <path v-else-if="m.type === 'rescue'" d="M -3.5 -20 L 3.5 -20 M 0 -23.5 L 0 -16.5" class="mark-glyph" />
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
          <g v-if="labelOf(bv.id).name" :transform="`translate(${bv.labelAnchor.x}, ${bv.labelAnchor.y}) scale(${screenScale})`" class="label" :class="{ 'is-active': isSelected('building', bv.id) || (hover?.kind === 'building' && hover.id === bv.id) }">
            <rect :x="-textWidth(bv.name, NAME_PX) / 2 - 6" y="-24" :width="textWidth(bv.name, NAME_PX) + 12" height="17" rx="4" class="label-pill" />
            <text x="0" y="-11.5" text-anchor="middle" class="label-name">{{ bv.name }}</text>
            <template v-if="labelOf(bv.id).detail">
              <rect :x="-textWidth(`${bv.floors} · 容量≈${bv.capacity}`, 10) / 2 - 6" y="-6" :width="textWidth(`${bv.floors} · 容量≈${bv.capacity}`, 10) + 12" height="15" rx="4" class="label-pill label-pill-sub" />
              <text x="0" y="5" text-anchor="middle" class="label-meta">{{ bv.floors }} · 容量≈{{ bv.capacity }}</text>
            </template>
          </g>
        </template>
        <template v-for="jv in junctionViews" :key="`lj-${jv.junction.id}`">
          <g v-if="labelOf(jv.junction.id).name" :transform="`translate(${jv.screen.x}, ${jv.screen.y}) scale(${screenScale})`" class="label label-junction">
            <rect :x="-textWidth(jv.junction.name, NAME_PX) / 2 - 6" y="12" :width="textWidth(jv.junction.name, NAME_PX) + 12" height="17" rx="4" class="label-pill" />
            <text x="0" y="24.5" text-anchor="middle" class="label-name">{{ jv.junction.name }}</text>
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
  background: #e4e2dc;
  touch-action: none;
  cursor: grab;
}
.campus-svg:active { cursor: grabbing; }

/* 底座与场地 */
.plinth-drop { fill: #4e4a40; opacity: 0.25; }
.plinth-top { fill: #e7e1d4; stroke: #c9c2b4; stroke-width: 1; }
.plinth-front { fill: #a89e8c; }
.plinth-side { fill: #b8af9d; }
.lawn { fill: #b2bb9f; stroke: #9fa88c; stroke-width: 1; }
.plaza { fill: #ddd6c8; stroke: #cbc3b2; stroke-width: 1; }
.plaza-joint { fill: none; stroke: #cbc3b2; stroke-width: 0.8; }

/* 道路 */
.selectable { cursor: pointer; }
.selectable:focus { outline: none; }
.focus-ring {
  fill: none;
  stroke: #4a453c;
  stroke-width: 2;
  stroke-dasharray: 5 4;
  opacity: 0;
  pointer-events: none;
}
.selectable:focus-visible .focus-ring { opacity: 1; }
.road-hit { fill: none; stroke: transparent; stroke-width: 22; stroke-linecap: round; stroke-linejoin: round; pointer-events: stroke; }
.road-curb { fill: none; stroke: #a29b8c; stroke-width: 17; stroke-linecap: round; stroke-linejoin: round; }
.road-surface { fill: none; stroke: #bdb7ab; stroke-width: 13; stroke-linecap: round; stroke-linejoin: round; }
.road-center { fill: none; stroke: #f6f3ec; stroke-width: 1.4; stroke-linecap: round; stroke-dasharray: 7 12; }
.road-route { fill: none; stroke: #2f6fb0; stroke-width: 3; stroke-linecap: round; stroke-dasharray: 10 7; pointer-events: none; }
.road-hazard { fill: none; stroke: #2f6fb0; stroke-width: 13; stroke-linecap: round; opacity: 0.28; pointer-events: none; }
.road.is-closed .road-surface { stroke: #d8b3a6; }
.road.is-hl .road-curb, .road.is-selected .road-curb { stroke: #4a453c; }

/* 阴影 */
.cast-shadow { fill: #5d5648; opacity: 0.3; pointer-events: none; }
.contact-shadow { fill: #4e4a3c; opacity: 0.35; pointer-events: none; }

/* 树 */
.tree { pointer-events: none; }
.tree-shadow { fill: #5d5648; opacity: 0.25; }
.tree-trunk { fill: #9c8668; }
.tree-crown { stroke: #6d7f60; stroke-width: 0.6; }

/* 建筑体量：统一哑光材质 */
.bld-ground-ring { fill: none; stroke: #4a453c; stroke-width: 0; opacity: 0; pointer-events: none; }
.building.is-hl .bld-ground-ring, .building.is-selected .bld-ground-ring { stroke-width: 2; opacity: 0.85; }
.vol-wall { fill: url(#facade-grad); stroke: #a89f8d; stroke-width: 0.7; stroke-linejoin: round; }
.plinth-wall { fill: #d3ccbe; }
.vol-band { fill: #8d979e; opacity: 0.85; pointer-events: none; }
.vol-roof { fill: url(#roof-grad); stroke: #d8d2c6; stroke-width: 0.8; stroke-linejoin: round; }
.plinth-roof { fill: #ded7c9; }
.vol-roof-edge { fill: none; stroke: #a89f8d; stroke-width: 2; stroke-linejoin: round; pointer-events: none; transition: stroke-width 0.12s ease; }
.building.is-hl .vol-roof-edge, .building.is-selected .vol-roof-edge { stroke: #37332c; stroke-width: 2.2; }
.roofbox-wall { fill: #d6cfc2; stroke: #b9b2a4; stroke-width: 0.5; }
.roofbox-roof { fill: #e6e0d4; stroke: #c4bdb0; stroke-width: 0.7; }
.entrance-recess { fill: #b0a897; pointer-events: none; }
.entrance-canopy { fill: #8d8577; pointer-events: none; }
.entrance-fascia { fill: #766e60; pointer-events: none; }

/* 路口 / 校门 */
.junction-hit { fill: transparent; stroke: none; pointer-events: all; }
.gate-shadow { fill: #6b6353; opacity: 0.2; }
.gate-pillar { fill: #d9d2c4; stroke: #b0a897; stroke-width: 0.8; }
.gate-beam { fill: #c9c1b1; stroke: #a89f8d; stroke-width: 0.8; }
.gate-plaque { fill: #8d8577; }
.crossing-pad { fill: #d8d2c6; stroke: #b6afa1; stroke-width: 1; }
.crossing-dot { fill: #a89f8d; }
.junction.is-hl .crossing-pad, .junction.is-selected .crossing-pad { stroke: #37332c; stroke-width: 2; }
.junction.is-hl .gate-beam, .junction.is-selected .gate-beam { stroke: #37332c; stroke-width: 2; }

/* 路径 */
.layer-route { pointer-events: none; }
.route-casing { fill: none; stroke: #f6f3ec; stroke-width: 8; stroke-linecap: round; stroke-linejoin: round; opacity: 0.9; }
.route-line { fill: none; stroke: #2f6fb0; stroke-width: 3.5; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 12 7; }
.route-end { fill: #2f6fb0; stroke: #f6f3ec; stroke-width: 2; }

/* 应急标记 */
.layer-marks { pointer-events: none; }
.mark { animation: mark-in 0.28s ease-out; }
@keyframes mark-in { from { opacity: 0; } to { opacity: 1; } }
.risk-range { fill: none; stroke-width: 2; stroke-dasharray: 6 4; opacity: 0.8; }
.risk-disaster { stroke: #2f6fb0; fill: #2f6fb0; fill-opacity: 0.08; }
.risk-cordon { stroke: #c07a2a; fill: #c07a2a; fill-opacity: 0.06; }
.mark-stem { stroke: #6b6353; stroke-width: 1.2; }
.mark-pill { fill: #fbfaf6; stroke: #d8d2c6; stroke-width: 1; }
.mark text { font-size: 10.5px; font-weight: 700; font-family: var(--font-sans); }
.mark-disaster .mark-dot, .mark-hazard .mark-dot { fill: #2f6fb0; }
.mark-disaster .mark-glyph, .mark-hazard .mark-glyph { stroke: #fbfaf6; stroke-width: 2; stroke-linecap: round; fill: none; }
.mark-disaster text, .mark-hazard text { fill: #245a90; }
.mark-cordon .mark-dot { fill: #c07a2a; }
.mark-cordon .mark-glyph { stroke: #fbfaf6; stroke-width: 2; stroke-linecap: round; fill: none; }
.mark-cordon text { fill: #96591b; }
.mark-rescue .mark-dot { fill: #4a7c59; }
.mark-rescue .mark-glyph { stroke: #fbfaf6; stroke-width: 2.2; stroke-linecap: round; fill: none; }
.mark-rescue text { fill: #38604a; }
.mark-closed .mark-pill { stroke: #b3402e; }
.mark-closed text { fill: #b3402e; font-family: var(--font-mono); }
.barrier-glyph rect { fill: #b3402e; }
.barrier-glyph line { stroke: #fbfaf6; stroke-width: 2; }

/* 屏幕标签层 */
.layer-labels { pointer-events: none; }
.label-pill { fill: #fbfaf6; fill-opacity: 0.92; stroke: #c9c2b4; stroke-width: 0.8; }
.label-pill-sub { fill-opacity: 0.85; }
.label-name { fill: #33302a; font-size: 12px; font-weight: 700; font-family: var(--font-sans); }
.label-meta { fill: #6b6353; font-size: 10px; font-family: var(--font-mono); }
.label.is-active .label-pill { stroke: #37332c; stroke-width: 1.4; }
.label-junction .label-name { fill: #4a453c; font-weight: 600; }

/* HUD 浮层 */
.map-hud { position: absolute; z-index: 3; }
.map-zoom { left: 10px; top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; gap: 6px; align-items: center; }
.map-btn {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: 1px solid #c9c2b4;
  border-radius: 10px;
  background: rgb(251 250 246 / 0.92);
  color: #33302a;
  font-size: 18px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 2px 8px rgb(60 55 45 / 0.12);
}
.map-btn:hover { border-color: #37332c; }
.map-btn:focus-visible { outline: 2px solid #37332c; outline-offset: 2px; }
.map-zoom-level { font-size: 11px; color: #6b6353; background: rgb(251 250 246 / 0.92); padding: 2px 6px; border-radius: 6px; }
.map-orient { right: 10px; top: 110px; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; pointer-events: none; }
.north { color: #4a453c; font-size: 13px; font-weight: 800; font-family: var(--font-mono); }
.scalebar { display: flex; align-items: center; gap: 6px; color: #6b6353; font-size: 10.5px; }
.scalebar i { display: inline-block; width: 56px; height: 4px; border-left: 2px solid #6b6353; border-right: 2px solid #6b6353; border-bottom: 2px solid #6b6353; }
.map-minilegend {
  left: 10px;
  bottom: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  max-width: 62%;
  padding: 6px 8px;
  border-radius: 8px;
  background: rgb(251 250 246 / 0.9);
  border: 1px solid #d8d2c6;
  pointer-events: none;
}
.lg-item { display: inline-flex; align-items: center; gap: 4px; color: #33302a; font-size: 10.5px; }
.lg-line { width: 16px; height: 0; border-top: 3px solid; display: inline-block; }
.lg-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
.lg-open { border-top-color: #b6afa1; }
.lg-closed { border-top-color: #b3402e; }
.lg-disaster { background: #2f6fb0; }
.lg-cordon { background: #c07a2a; }
.lg-rescue { background: #4a7c59; }
.map-hovercard {
  position: absolute;
  z-index: 4;
  width: 220px;
  padding: 8px 10px;
  border: 1px solid #c9c2b4;
  border-radius: 10px;
  background: #fbfaf6;
  box-shadow: 0 6px 18px rgb(60 55 45 / 0.18);
  pointer-events: none;
}
.hc-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.hc-title { color: #33302a; font-size: 13px; font-weight: 700; }
.hc-tag { color: #6b6353; font-size: 10.5px; font-weight: 700; border: 1px solid #c9c2b4; border-radius: 4px; padding: 0 4px; }
.hc-line { margin: 2px 0; color: #6b6353; font-size: 11.5px; line-height: 1.5; }

@media (max-width: 400px) {
  .map-minilegend { max-width: 78%; gap: 3px 8px; }
  .lg-item { font-size: 10px; }
  .map-hovercard { width: 180px; }
}
</style>