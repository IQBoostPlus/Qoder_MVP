<script setup lang="ts">
import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue';
import type { ActionId, LocationChoice, ScenarioModifiers, Verdict, VerdictAttempt } from '../contracts';
import { ActionEngineError } from '../action-engine';
import { windowAt } from '../fixture-port';
import { SORT_LIMIT } from '../score-engine';
import { useFixturePort, useFixtureData } from '../composables/useFixturePort';
import { useDrillRound } from '../composables/useDrillRound';
import { CATEGORY_STYLE, HAZARD_LABEL, formatBuildingFloors } from '../config/categories';
import {
  LAYER_ORDER,
  LAYER_STYLE,
  deriveLayerMarks,
  cordonText,
  rescueText,
  type LayerKey,
  type Selection,
  type SelectionKind,
} from '../config/layers';
import { buildRouteQuery, endpointOptions, endpointName, locationOptions, UNLOCATABLE } from '../config/route-query';
import { closedStamp, formatSimTime, simStamp, seqLabel } from '../config/format';
import { REVIEW_SUMMARY_BADGE, buildReviewSummary } from '../config/review-summary';
import { SCENARIO_CARD_NOTE, SCENARIO_MODIFIER_LABELS } from '../config/rounds';
import CampusMap from '../components/CampusMap.vue';
import RoutePanel from '../components/RoutePanel.vue';
import ScorePanel from '../components/ScorePanel.vue';
import OccupancyBars from '../components/OccupancyBars.vue';

const port = useFixturePort();
const fixture = useFixtureData();
const map = port.map;

const drill = useDrillRound(fixture, port, { judgeAction: port.judgeAction });
const {
  rounds,
  tEnd,
  speeds,
  roundIndex,
  currentT,
  canNext,
  canWrite,
  finished,
  furthestRoundIndex,
  sortOpen,
  speed,
  playing,
  deliveredReports,
  lastBatch,
  realElapsedMs,
} = drill;

const snapshot = computed(() => port.snapshotRound(drill.currentEvents.value, currentT.value));
const roads = computed(() => snapshot.value.roads);
const overlay = computed(() => deriveLayerMarks(snapshot.value));
const result = computed(() => finished.value ? port.scoreRound(drill.currentEvents.value) : null);
const reviewResult = computed(() => currentT.value === tEnd ? result.value : null);
// 结算后判读揭示以整轮评分为准，回看任意回合都能看到当时应判；未结算时为空。
const assessments = computed(() => new Map(result.value?.judgments.map((item) => [item.report_id, item])));
const resultSection = ref<HTMLElement | null>(null);
const finalSection = ref<HTMLElement | null>(null);
const ledgerSection = ref<HTMLElement | null>(null);
const reportsSection = ref<HTMLElement | null>(null);
const toolsSection = ref<HTMLElement | null>(null);

type PrimaryPanel = 'reports' | 'map' | 'orders';
type SidePanel = 'tools' | 'finish' | 'review';
const primaryPanel = ref<PrimaryPanel>('reports');
const sidePanel = ref<SidePanel | null>(null);
const dockItems: { id: PrimaryPanel; label: string }[] = [
  { id: 'reports', label: '上报' },
  { id: 'map', label: '地图' },
  { id: 'orders', label: '指令' },
];

const started = ref(false);
const mapSection = ref<HTMLElement | null>(null);
const orderSection = ref<HTMLElement | null>(null);
const resetDialog = ref<HTMLDialogElement | null>(null);
const reportChoice = ref<string | null>(null);
const actionChoice = ref<ActionId | ''>('');
const routeOpen = ref(false);
const logOpen = ref(false);
const historyOpen = ref(false);
const sceneName = fixture.scenario.title.replace(/（训练样例）$/, '');
const scenarioModifierLabels = Object.entries(fixture.scenario.modifiers)
  .filter(([, enabled]) => enabled)
  .map(([key]) => SCENARIO_MODIFIER_LABELS[key as keyof ScenarioModifiers]);
const heardReports = computed(() => started.value ? deliveredReports.value.length : 0);

const hovered = ref<Selection | null>(null);
const selected = ref<Selection | null>(null);
const highlight = computed<Selection | null>(() => hovered.value ?? selected.value);
function toggleSelect(kind: SelectionKind, id: string): void {
  selected.value =
    selected.value?.kind === kind && selected.value.id === id ? null : { kind, id };
}
function clearSelection(): void {
  selected.value = null;
}
function onGlobalKey(event: KeyboardEvent): void {
  if (event.key === 'Escape' && !resetDialog.value?.open) clearSelection();
}
function warnBeforeLeaving(event: BeforeUnloadEvent): void {
  if (!started.value || (furthestRoundIndex.value === 0 && drill.currentEvents.value.length === 0)) return;
  event.preventDefault();
  event.returnValue = '';
}
onActivated(() => {
  window.addEventListener('keydown', onGlobalKey);
});
onDeactivated(() => {
  window.removeEventListener('keydown', onGlobalKey);
  if (playing.value) drill.togglePlay();
});
onMounted(() => window.addEventListener('beforeunload', warnBeforeLeaving));
onUnmounted(() => window.removeEventListener('beforeunload', warnBeforeLeaving));

const layers = ref<Record<LayerKey, boolean>>({ disaster: true, cordon: true, rescue: true });

const endpoints = endpointOptions(map);
const locations = locationOptions(map);
const routeFrom = ref(fixture.scenario.start_building_id);
const routeTo = ref('');
const degenerate = computed(() => routeTo.value !== '' && routeFrom.value === routeTo.value);
const routeQuery = computed(() =>
  routeTo.value === '' || degenerate.value
    ? null
    : buildRouteQuery(map, snapshot.value, routeFrom.value, routeTo.value, currentT.value),
);
const route = computed(() => (routeQuery.value ? port.getRoute(routeQuery.value) : null));
interface SituationEntry {
  key: string;
  color: string;
  text: string;
}
const situation = computed<SituationEntry[]>(() => {
  const list: SituationEntry[] = [];
  if (layers.value.disaster) {
    for (const m of overlay.value.disaster) {
      list.push({ key: `d-${m.building_id}`, color: 'var(--blue)', text: `${endpointName(map, m.building_id)} · 灾情：${m.title} ${simStamp(m.at_sim)}` });
    }
    for (const r of roads.value) {
      if (r.hazard !== null && r.hazard_at_sim !== null) {
        list.push({ key: `h-${r.road_id}`, color: 'var(--blue)', text: `${r.name} · ${HAZARD_LABEL[r.hazard]} ${simStamp(r.hazard_at_sim)}${r.formally_closed ? '' : '（未封闭）'}` });
      }
    }
  }
  if (layers.value.cordon) {
    for (const m of overlay.value.cordons) {
      list.push({ key: `c-${m.seq}`, color: 'var(--amber)', text: `${endpointName(map, m.building_id)} · ${cordonText(m)}` });
    }
  }
  if (layers.value.rescue) {
    for (const m of overlay.value.rescues) {
      list.push({ key: `r-${m.seq}`, color: 'var(--green)', text: `${endpointName(map, m.building_id)} · ${rescueText(m)}` });
    }
  }
  for (const r of roads.value) {
    if (r.formally_closed) {
      list.push({ key: `x-${r.road_id}`, color: 'var(--red)', text: `${r.name} · 已封闭 ${closedStamp(r.closed_at_sim, r.closed_by_action_seq)}` });
    }
  }
  for (const cut of overlay.value.powerCuts) {
    list.push({ key: `power-${cut.seq}`, color: 'var(--red)', text: `${endpointName(map, cut.building_id)} · 已断电 ${simStamp(cut.at_sim)} · ${seqLabel(cut.seq)}` });
  }
  return list;
});

const hazardCount = computed(() => roads.value.filter((r) => r.hazard !== null).length);
const closedCount = computed(() => roads.value.filter((r) => r.formally_closed).length);
const totalReports = fixture.ugc_reports.length;
const realSeconds = computed(() => (realElapsedMs.value / 1000).toFixed(1));

// 判读草稿只在提交时写入流水。
const VERDICTS: Verdict[] = ['真报', '误报', '待核'];
type VerdictDraft = { verdict: Verdict | ''; location: string };
function newDrafts(): Record<string, VerdictDraft> {
  return Object.fromEntries(fixture.ugc_reports.map(({ id }) => [id, { verdict: '', location: '' }]));
}
const drafts = ref(newDrafts());
function draftFor(reportId: string): VerdictDraft {
  const existing = drafts.value[reportId];
  if (existing) return existing;
  const created: VerdictDraft = { verdict: '', location: '' };
  drafts.value = { ...drafts.value, [reportId]: created };
  return created;
}
function locationName(id: string): string {
  return id === UNLOCATABLE ? UNLOCATABLE : endpointName(map, id);
}
function actionName(id: string): string {
  return fixture.action_catalog.find((entry) => entry.id === id)?.name ?? id;
}
// 拒绝原因等 fixture 原文可能含动作编号；学员侧把编号渲染为动作名，语义不改（同 branchLabel 口径）。
function learnerReason(reason: string): string {
  let text = reason;
  for (const entry of fixture.action_catalog) {
    text = text.split(` ${entry.id} ${entry.name}`).join(entry.name);
    text = text.split(`${entry.id} ${entry.name}`).join(entry.name);
  }
  return text.replace(/A\d+/g, (id) => actionName(id));
}
function recordVerdict(reportId: string): void {
  const draft = drafts.value[reportId];
  if (!draft?.verdict) return;
  const location: LocationChoice | null = draft.location === '' ? null : draft.location;
  drill.submitVerdict(reportId, draft.verdict, location);
}
const reportCards = computed(() => {
  const latest = new Map<string, VerdictAttempt>(snapshot.value.latest_verdicts.map((item) => [item.report_id, item]));
  return deliveredReports.value.map((report) => ({
    report,
    verdict: latest.get(report.id),
    assessment: assessments.value.get(report.id),
  }));
});

const activeReport = computed(() =>
  reportCards.value.find(({ report }) => report.id === reportChoice.value)
    ?? reportCards.value.find(({ report }) => report.id === lastBatch.value.at(-1)?.id)
    ?? reportCards.value.at(-1),
);
// 引擎的 judgments 只在有判读动作时给判断窗；未判读上报的揭示用 windowAt 读 fixture 判断窗
// （收到时与回合末），仅展示，不参与评分。
const unjudgedReveal = computed(() => {
  const card = activeReport.value;
  if (!finished.value || !card || card.verdict) return null;
  const receipt = windowAt(fixture, card.report.id, card.report.appears_at_sim);
  if (!receipt) return null;
  const end = windowAt(fixture, card.report.id, tEnd);
  const final = end && (end.expected !== receipt.expected || end.reason !== receipt.reason)
    ? { window: end, at: end.from_sim }
    : null;
  return { receipt, receiptAt: card.report.appears_at_sim, final };
});
const unreadCount = computed(() => reportCards.value.filter(({ verdict }) => !verdict).length);
const targetGroups = [
  { kind: 'building', title: '楼栋', items: map.buildings },
  { kind: 'road', title: '道路', items: map.road_segments },
  { kind: 'junction', title: '校门与路口', items: map.junctions },
] as const;
const targetKey = computed({
  get: () => selected.value ? `${selected.value.kind}:${selected.value.id}` : '',
  set: (key: string) => {
    const group = targetGroups.find(({ kind }) => key.startsWith(`${kind}:`));
    selected.value = group ? { kind: group.kind, id: key.slice(group.kind.length + 1) } : null;
    hovered.value = null;
  },
});
const targetName = computed(() => {
  if (!selected.value) return '';
  const group = targetGroups.find(({ kind }) => kind === selected.value?.kind);
  return group?.items.find(({ id }) => id === selected.value?.id)?.name ?? '';
});
const targetRoad = computed(() => selected.value?.kind === 'road'
  ? roads.value.find((road) => road.road_id === selected.value?.id)
  : undefined);
const targetBuilding = computed(() => selected.value?.kind === 'building'
  ? map.buildings.find((building) => building.id === selected.value?.id)
  : undefined);
const applicableActions = computed(() => fixture.action_catalog.filter(({ target_kind }) => target_kind === selected.value?.kind));
const action = computed(() => applicableActions.value.find(({ id }) => id === actionChoice.value));
const actionError = ref('');
const latestOrder = computed(() => {
  const attempt = snapshot.value.actions.filter(({ target_id }) => target_id === selected.value?.id).at(-1);
  if (!attempt) return null;
  const name = fixture.action_catalog.find(({ id }) => id === attempt.action_id)?.name ?? attempt.action_id;
  const complete = attempt.completed_at_sim !== null && currentT.value >= attempt.completed_at_sim;
  return { attempt, name, complete };
});
watch(targetKey, () => {
  actionChoice.value = '';
  actionError.value = '';
});
watch(currentT, () => {
  reportChoice.value = null;
  actionError.value = '';
});
function onAction(): void {
  if (!started.value || !canWrite.value || !action.value || !selected.value) return;
  actionError.value = '';
  try {
    drill.submitAction(action.value.id, selected.value.id);
  } catch (error) {
    if (!(error instanceof ActionEngineError)) throw error;
    actionError.value = error.message;
  }
}

// ---- 信息流：投放 / 判读 / 动作 / 排序 / 路况按 stamp 合并，只读派生，不伪造 ----
const FEED_KINDS = ['全部', '投放', '判读', '动作', '排序', '路况'] as const;
type FeedKind = (typeof FEED_KINDS)[number];
const feedFilter = ref<FeedKind>('全部');
interface FeedRow {
  key: string;
  stamp: number;
  kind: Exclude<FeedKind, '全部'>;
  text: string;
}
const feedRows = computed<FeedRow[]>(() => {
  const rows: FeedRow[] = [];
  for (const r of fixture.ugc_reports) {
    if (r.appears_at_sim <= currentT.value) {
      rows.push({ key: `ugc-${r.id}`, stamp: r.appears_at_sim, kind: '投放', text: `${r.id} · ${r.text}` });
    }
  }
  for (const e of snapshot.value.events) {
    if (e.kind === 'verdict') {
      const p = e.payload;
      rows.push({
        key: `v-${e.seq}`, stamp: p.judged_at_sim, kind: '判读',
        text: `${p.report_id} → ${p.verdict} · ${p.location === null ? '未定位' : locationName(p.location)}${p.supersedes_seq !== null ? ` · 改判覆盖${seqLabel(p.supersedes_seq)}` : ''}`,
      });
    } else if (e.kind === 'sort') {
      rows.push({ key: `s-${e.seq}`, stamp: e.t_sim, kind: '排序', text: e.payload.ordered_report_ids.join(' → ') });
    } else {
      const p = e.payload;
      const def = fixture.action_catalog.find((a) => a.id === p.action_id);
      const state = p.status === 'accepted'
        ? (p.completed_at_sim !== null && p.completed_at_sim <= currentT.value
            ? `已完成 ${simStamp(p.completed_at_sim)}`
            : `进行中${p.completed_at_sim === null ? '' : ` · 预计 ${simStamp(p.completed_at_sim)}`}`)
        : `已拒绝 · ${learnerReason(p.reject_reason ?? '')}`;
      rows.push({ key: `a-${e.seq}`, stamp: p.submitted_at_sim, kind: '动作', text: `${def?.name ?? ''} → ${endpointName(map, p.target_id)} · 第${p.attempt}次 · ${state}` });
    }
  }
  for (const r of roads.value) {
    if (r.hazard !== null && r.hazard_at_sim !== null) {
      rows.push({ key: `hz-${r.road_id}`, stamp: r.hazard_at_sim, kind: '路况', text: `${r.name} · ${HAZARD_LABEL[r.hazard]}（自然灾情${r.formally_closed ? '' : '，未正式封闭'}）` });
    }
    if (r.formally_closed && r.closed_at_sim !== null) {
      rows.push({ key: `cl-${r.road_id}`, stamp: r.closed_at_sim, kind: '路况', text: `${r.name} · 已正式封闭 · ${closedStamp(r.closed_at_sim, r.closed_by_action_seq)}` });
    }
  }
  for (const cut of overlay.value.powerCuts) {
    rows.push({ key: `pw-${cut.seq}`, stamp: cut.at_sim, kind: '路况', text: `${endpointName(map, cut.building_id)} · 已断电 ${simStamp(cut.at_sim)} · ${seqLabel(cut.seq)}` });
  }
  const filtered = feedFilter.value === '全部' ? rows : rows.filter((r) => r.kind === feedFilter.value);
  return filtered.sort((a, b) => a.stamp - b.stamp || a.key.localeCompare(b.key));
});

// ---- 账本摘要 ----
interface LedgerRow {
  seq: number;
  kindLabel: string;
  detail: string;
  stamp: number;
  state: string;
  tone?: 'cell-amber' | 'cell-red';
}
const ledgerRows = computed<LedgerRow[]>(() =>
  snapshot.value.events.map((event) => {
    if (event.kind === 'verdict') {
      const p = event.payload;
      const where = p.location === null ? '未定位' : locationName(p.location);
      return {
        seq: p.seq,
        kindLabel: '判读',
        detail: `${p.report_id} → ${p.verdict} · ${where}`,
        stamp: p.judged_at_sim,
        state: p.supersedes_seq === null ? '已记录' : `改判 · 覆盖${seqLabel(p.supersedes_seq)}`,
      };
    }
    if (event.kind === 'sort') {
      return {
        seq: event.seq, kindLabel: '排序', detail: event.payload.ordered_report_ids.join(' → '),
        stamp: event.t_sim, state: '已记录',
      };
    }
    const p = event.payload;
    const complete = p.completed_at_sim !== null && p.completed_at_sim <= currentT.value;
    const def = fixture.action_catalog.find((action) => action.id === p.action_id);
    return {
      seq: p.seq,
      kindLabel: '动作',
      detail: `${def?.name ?? ''} → ${endpointName(map, p.target_id)} · 第${p.attempt}次`,
      stamp: p.submitted_at_sim,
      state:
        p.status === 'accepted'
          ? (complete && p.completed_at_sim !== null
              ? `已完成 ${simStamp(p.completed_at_sim)}`
              : `已通过 · 进行中${p.completed_at_sim === null ? '' : ` · 预计 ${simStamp(p.completed_at_sim)}`}`)
          : `已拒绝 · ${learnerReason(p.reject_reason ?? '')}`,
      tone: p.status === 'rejected' ? 'cell-red' : complete ? undefined : 'cell-amber',
    };
  }),
);
// ---- 复盘时间线：与账本同源（本轮已确认流水），条数一致；类型细化为 判读 / 改判 / 动作 / 拒绝 / 排序 ----
interface TimelineRow extends LedgerRow {
  key: string;
}
const timelineRows = computed<TimelineRow[]>(() => {
  if (!reviewResult.value) return [];
  const bySeq = new Map(snapshot.value.events.map((event) => [event.seq, event]));
  return ledgerRows.value.map((row) => {
    const event = bySeq.get(row.seq);
    let kindLabel = row.kindLabel;
    if (event?.kind === 'verdict' && event.payload.supersedes_seq !== null) kindLabel = '改判';
    if (event && event.kind !== 'verdict' && event.kind !== 'sort' && event.payload.status === 'rejected') kindLabel = '拒绝';
    return { ...row, key: `tl-${row.seq}`, kindLabel };
  });
});

// ---- 失误定位：只取评分器输出（missed_items / judgments / sorting / 违规序号），不自造判定 ----
type MissKind = '漏做' | '判读' | '定位' | '排序' | '违规';
interface MissRow {
  key: string;
  kind: MissKind;
  text: string;
  basis: string;
  tSim: number;
  select?: Selection;
  reportId?: string;
}
function targetSelection(actionId: string, targetId: string): Selection | undefined {
  const kind = fixture.action_catalog.find((entry) => entry.id === actionId)?.target_kind;
  return kind === 'building' || kind === 'road' ? { kind, id: targetId } : undefined;
}
const missRows = computed<MissRow[]>(() => {
  const score = reviewResult.value;
  if (!score) return [];
  const rows: MissRow[] = [];
  for (const item of score.details.missed_items) {
    rows.push({
      key: `miss-${item.action_id}-${item.target_id}`,
      kind: '漏做',
      text: `${actionName(item.action_id)} · ${endpointName(map, item.target_id)}`,
      basis: `应于回合结束（${simStamp(tEnd)}）前完成`,
      tSim: tEnd,
      select: targetSelection(item.action_id, item.target_id),
    });
  }
  for (const judgment of score.judgments) {
    const attempt = judgment.attempt;
    if (!judgment.correct) {
      rows.push(attempt
        ? {
            key: `verdict-${judgment.report_id}`,
            kind: '判读',
            text: `${judgment.report_id} 判为「${attempt.verdict}」`,
            basis: judgment.window ? `当时可判为「${judgment.window.expected}」。${judgment.window.reason}` : '当时无可判窗口',
            tSim: attempt.judged_at_sim,
            reportId: judgment.report_id,
          }
        : {
            key: `verdict-${judgment.report_id}`,
            kind: '判读',
            text: `${judgment.report_id} 未判读`,
            basis: '本轮未提交判读',
            tSim: fixture.ugc_reports.find((report) => report.id === judgment.report_id)?.appears_at_sim ?? tEnd,
            reportId: judgment.report_id,
          });
    }
    if (attempt && !judgment.location_correct) {
      rows.push({
        key: `location-${judgment.report_id}`,
        kind: '定位',
        text: `${judgment.report_id} 定位${attempt.location === null ? '未填写' : `为「${locationName(attempt.location)}」`}`,
        basis: `参考位置 ${judgment.expected_location === null ? '未设定' : locationName(judgment.expected_location)}`,
        tSim: attempt.judged_at_sim,
        reportId: judgment.report_id,
      });
    }
  }
  if (score.sorting && !score.sorting.correct) {
    rows.push({
      key: 'sorting',
      kind: '排序',
      text: score.sorting.actual.length ? `排序 ${score.sorting.actual.join(' → ')}` : '未做排序',
      basis: `参考排序 ${score.sorting.expected.join(' → ')}`,
      tSim: tEnd,
    });
  }
  for (const seq of score.details.violation_event_seqs) {
    const event = drill.currentEvents.value.find((entry) => entry.seq === seq);
    if (!event || event.kind === 'verdict' || event.kind === 'sort') continue;
    const payload = event.payload;
    rows.push({
      key: `violation-${seq}`,
      kind: '违规',
      text: `${actionName(payload.action_id)} · ${endpointName(map, payload.target_id)} 第${payload.attempt}次提交被拒`,
      basis: `同一动作被拒后再次提交 · ${learnerReason(payload.reject_reason ?? '')}`,
      tSim: payload.submitted_at_sim,
      select: targetSelection(payload.action_id, payload.target_id),
    });
  }
  return rows;
});
async function jumpToMiss(row: MissRow): Promise<void> {
  drill.goToTime(row.tSim);
  // currentT 的 watcher 会清空 reportChoice，须等其 flush 后再定位上报。
  await nextTick();
  if (row.reportId) {
    await selectReport(row.reportId);
    return;
  }
  if (row.select) {
    selected.value = row.select;
    hovered.value = null;
    await showPanel('orders');
    return;
  }
  await showSide('review');
}
const timelineSection = ref<HTMLElement | null>(null);
async function backToTimeline(): Promise<void> {
  await showSide('review');
  timelineSection.value?.scrollIntoView({ block: 'nearest' });
}
const summaryLines = computed(() => reviewResult.value
  ? buildReviewSummary(reviewResult.value, {
      actionName,
      targetName: (id) => endpointName(map, id),
      locationName,
    })
  : []);

const sortExpanded = ref(false);
const sortDraft = ref<string[]>([]);
const sortCount = computed(() => Math.min(SORT_LIMIT, deliveredReports.value.length));
const sortReady = computed(() => {
  const slots = Array.from({ length: sortCount.value }, (_, index) => sortDraft.value[index]);
  return slots.length > 0 && slots.every(Boolean) && new Set(slots).size === slots.length;
});
function saveSort(): void {
  if (!sortReady.value) return;
  if (drill.submitSort(sortDraft.value.slice(0, sortCount.value))) sortExpanded.value = false;
}
async function showPanel(panel: PrimaryPanel): Promise<void> {
  primaryPanel.value = panel;
  sidePanel.value = null;
  await nextTick();
  const element = { reports: reportsSection.value, map: mapSection.value, orders: orderSection.value }[panel];
  element?.focus({ preventScroll: true });
}
async function showSide(panel: SidePanel): Promise<void> {
  sidePanel.value = panel;
  await nextTick();
  const element = { tools: toolsSection.value, finish: finalSection.value, review: resultSection.value }[panel];
  element?.focus({ preventScroll: true });
  element?.scrollTo(0, 0);
}
async function selectReport(id: string): Promise<void> {
  reportChoice.value = id;
  await showPanel('reports');
  reportsSection.value?.scrollTo(0, 0);
}
async function advanceRound(): Promise<void> {
  drill.nextRound();
  if (sortOpen.value) await showSide('finish');
  else if (primaryPanel.value === 'reports' && !sidePanel.value && lastBatch.value.length) reportsSection.value?.scrollTo(0, 0);
}
async function finishDrill(): Promise<void> {
  if (!drill.finishDrill()) return;
  await showSide('review');
}
async function openReviewLog(): Promise<void> {
  logOpen.value = true;
  await showSide('tools');
  ledgerSection.value?.scrollIntoView({ block: 'nearest' });
  ledgerSection.value?.focus({ preventScroll: true });
}
async function returnToCurrent(): Promise<void> {
  drill.goToRound(furthestRoundIndex.value);
  if (finished.value) await showSide('review');
}
async function planRoute(): Promise<void> {
  routeOpen.value = true;
  await showSide('tools');
}
function beginDrill(): void {
  drill.resetDrill();
  started.value = true;
  clearSelection();
  hovered.value = null;
  void showPanel('reports');
}
function resetDrill(): void {
  resetDialog.value?.close();
  drill.resetDrill();
  sortExpanded.value = false;
  sortDraft.value = [];
  drafts.value = newDrafts();
  actionError.value = '';
  feedFilter.value = '全部';
  reportChoice.value = null;
  actionChoice.value = '';
  clearSelection();
  hovered.value = null;
  routeFrom.value = fixture.scenario.start_building_id;
  routeTo.value = '';
  routeOpen.value = false;
  logOpen.value = false;
  historyOpen.value = false;
  void showPanel('reports');
}
</script>

<template>
  <div class="drill-workspace">
    <header class="scene-header">
      <div class="scene-heading">
        <p class="scene-context">南京工程学院江宁校区</p>
        <h2>{{ sceneName }}</h2>
      </div>
      <div v-if="started" class="scene-progress" aria-label="当前推演进度">
        <div>
          <span class="clock-reading" id="round-now">T+{{ formatSimTime(currentT) }}</span>
          <span class="round-label">第 {{ roundIndex + 1 }} / {{ rounds.length }} 回合</span>
        </div>
        <button type="button" class="btn work-small desktop-tools" :aria-pressed="sidePanel === 'tools'"
          @click="sidePanel === 'tools' ? showPanel('orders') : showSide('tools')">工具</button>
        <button v-if="!finished && canWrite && canNext" type="button" class="btn work-primary"
          id="round-next" @click="advanceRound">推进时间 <span aria-hidden="true">→</span></button>
        <button v-else-if="roundIndex !== furthestRoundIndex" type="button" class="btn work-primary"
          @click="returnToCurrent">{{ finished ? '返回复盘' : '返回当前回合' }}</button>
        <button v-else-if="sortOpen || reviewResult" type="button" class="btn work-primary"
          @click="showSide(sortOpen ? 'finish' : 'review')">{{ sortOpen ? '结算' : '复盘' }}</button>
      </div>
    </header>

    <div class="drill-board" :data-panel="primaryPanel" :data-side="sidePanel || undefined">
    <section v-if="reviewResult" v-show="sidePanel === 'review'" ref="resultSection" class="work-panel review-panel side-panel" tabindex="-1" aria-labelledby="drill-score-heading">
      <div>
        <h2 id="drill-score-heading">本轮复盘</h2>
        <p class="work-muted">实际用时 {{ realSeconds }} 秒</p>
        <ScorePanel :score="reviewResult" />
      </div>
      <div class="review-actions">
        <template v-if="reviewResult.details.missed_items.length">
          <h3>本轮遗漏的处置</h3>
          <ul class="review-misses">
            <li v-for="item in reviewResult.details.missed_items" :key="`${item.action_id}-${item.target_id}`">
              {{ fixture.action_catalog.find((entry) => entry.id === item.action_id)?.name ?? item.action_id }} · {{ endpointName(map, item.target_id) }}
            </li>
          </ul>
        </template>
        <p id="drill-location-score" class="work-muted">定位正确 {{ reviewResult.location.correct }} / {{ reviewResult.location.total }}</p>
        <div v-if="reviewResult.sorting" id="drill-sort-result" class="review-sort">
          <strong>{{ reviewResult.sorting.actual.length === 0 ? '未做排序' : reviewResult.sorting.correct ? '排序正确' : '排序有误' }}</strong>
          <span v-if="reviewResult.sorting.actual.length">你的排序 {{ reviewResult.sorting.actual.join(' → ') }}</span>
          <span>参考排序 {{ reviewResult.sorting.expected.join(' → ') }}</span>
        </div>
        <div class="work-controls">
          <button type="button" class="btn" @click="showPanel('reports')">逐条查看判读</button>
          <button type="button" class="btn" @click="openReviewLog">查看操作记录</button>
        </div>
      </div>
      <details ref="timelineSection" class="work-panel tool-panel review-timeline" open>
        <summary>本轮时间线 <span>{{ timelineRows.length }}</span></summary>
        <div class="tool-content">
          <ol v-if="timelineRows.length" class="ledger-list" id="review-timeline">
            <li v-for="row in timelineRows" :key="row.key">
              <span class="ledger-stamp">{{ formatSimTime(row.stamp) }} · {{ row.kindLabel }} · {{ seqLabel(row.seq) }}</span>
              <strong>{{ row.detail }}</strong>
              <span :class="row.tone">{{ row.state }}</span>
            </li>
          </ol>
          <p v-else class="work-muted">本轮没有已确认的操作。</p>
          <button type="button" class="btn work-small" @click="openReviewLog">在操作记录中核对</button>
        </div>
      </details>
      <section class="review-jump" aria-labelledby="review-jump-heading">
        <h3 id="review-jump-heading">失误定位 <span class="work-muted">点按跳回对应时刻 · 只读回看</span></h3>
        <ul v-if="missRows.length" class="miss-list">
          <li v-for="row in missRows" :key="row.key">
            <button type="button" class="miss-row" @click="jumpToMiss(row)">
              <span class="miss-kind">{{ row.kind }}</span>
              <span class="miss-body">
                <strong>{{ row.text }}</strong>
                <span class="miss-basis">{{ row.basis }}</span>
              </span>
            </button>
          </li>
        </ul>
        <p v-else class="work-muted">评分器未记录失误。</p>
      </section>
      <section class="review-summary" aria-labelledby="review-summary-heading">
        <h3 id="review-summary-heading">本轮小结 <span class="work-chip">{{ REVIEW_SUMMARY_BADGE }}</span></h3>
        <ul class="summary-list">
          <li v-for="(line, index) in summaryLines" :key="index">{{ line }}</li>
        </ul>
      </section>
    </section>

    <section v-if="started && sortOpen" v-show="sidePanel === 'finish'" ref="finalSection" class="work-panel final-panel side-panel" tabindex="-1" aria-labelledby="final-heading">
      <div>
        <h2 id="final-heading">结束推演</h2>
        <p class="work-muted">可选出最紧急的 {{ sortCount }} 条上报，也可以直接查看评分。</p>
      </div>
      <div class="work-controls">
        <button v-if="!snapshot.sorting" type="button" class="btn" id="sort-entry" :aria-expanded="sortExpanded" @click="sortExpanded = !sortExpanded">排定上报优先级</button>
        <span v-else id="sort-saved" class="work-chip" role="status">排序已记录 {{ snapshot.sorting.ordered_report_ids.join(' → ') }}</span>
        <button type="button" class="btn work-primary" id="finish-drill" @click="finishDrill">结束推演并查看评分</button>
      </div>
      <form v-if="sortExpanded" class="sort-form" @submit.prevent="saveSort">
        <label v-for="(_, index) in sortCount" :key="index" class="work-field">
          <span>优先级第 {{ index + 1 }} 位</span>
          <select v-model="sortDraft[index]">
            <option value="">选择上报</option>
            <option v-for="report in deliveredReports" :key="report.id" :value="report.id"
              :disabled="sortDraft.some((id, slot) => slot !== index && id === report.id)">{{ report.id }} · {{ report.text }}</option>
          </select>
        </label>
        <button type="submit" class="btn work-primary" :disabled="!sortReady">记录排序</button>
      </form>
    </section>

      <section ref="reportsSection" class="work-panel report-panel" tabindex="-1" aria-labelledby="drill-reports-heading">
        <div v-if="!started" class="drill-intro">
          <h2 id="drill-reports-heading">今晚，你来值班</h2>
          <p>上报会陆续送到。读完消息，到地图上找楼栋或道路，再决定怎么处置。发现新线索时，可以改判。</p>
          <article class="active-report scenario-card" tabindex="0" role="group" aria-label="本期剧本">
            <div class="active-report-meta">
              <span class="report-ref">本期剧本</span>
              <span class="report-training">训练模拟数据</span>
            </div>
            <h3 class="scenario-title">{{ fixture.scenario.title }}</h3>
            <ul class="scenario-facts">
              <li>情境：{{ scenarioModifierLabels.join(' · ') }}</li>
              <li>起始对象：{{ endpointName(map, fixture.scenario.start_building_id) }}</li>
              <li>模拟时长 {{ formatSimTime(fixture.scenario.t_end) }} · {{ fixture.scenario.nodes.length }} 个回合节点 · {{ fixture.ugc_reports.length }} 条模拟上报</li>
            </ul>
            <p class="scenario-note">{{ SCENARIO_CARD_NOTE }}</p>
          </article>
          <p class="intro-meta">全程约 5 分钟 · 免登录 · 浏览器本地会话 · 训练模拟</p>
          <button id="start-drill" type="button" class="btn work-primary" @click="beginDrill">开始一次推演</button>
        </div>
        <template v-else>
          <div class="panel-heading">
            <h2 id="drill-reports-heading">模拟上报</h2>
            <span class="work-chip" aria-live="polite">{{ finished ? '已结算' : `${unreadCount} 条待判读` }}</span>
          </div>
          <p class="report-count work-muted">已收到 {{ heardReports }} / {{ totalReports }} 条 · 随推演时间陆续到达</p>
          <article v-if="activeReport" :key="activeReport.report.id" class="active-report" :data-report="activeReport.report.id">
            <div class="active-report-meta">
              <span class="report-ref">{{ activeReport.report.id }} · {{ formatSimTime(activeReport.report.appears_at_sim) }}</span>
              <span class="report-training">训练模拟数据</span>
            </div>
            <p class="reported-text">{{ activeReport.report.text }}</p>
            <p v-if="activeReport.verdict" class="report-recorded" role="status">
              已记录「{{ activeReport.verdict.verdict }}」{{ activeReport.verdict.location === null ? '' : ` · ${locationName(activeReport.verdict.location)}` }}
            </p>
            <form v-if="canWrite" class="verdict-form" @submit.prevent="recordVerdict(activeReport.report.id)">
              <fieldset>
                <legend>你的判断</legend>
                <div class="verdict-choices">
                  <label v-for="verdict in VERDICTS" :key="verdict">
                    <input v-model="draftFor(activeReport.report.id).verdict" type="radio" name="verdict" :value="verdict" />
                    <span>{{ verdict }}</span>
                  </label>
                </div>
              </fieldset>
              <label class="work-field">
                <span>上报位置 <small>可选</small></span>
                <select v-model="draftFor(activeReport.report.id).location">
                  <option value="">选择楼栋或无法定位</option>
                  <option v-for="item in locations" :key="item.id" :value="item.id">{{ item.name }}</option>
                </select>
              </label>
              <button v-if="selected?.kind === 'building'" type="button" class="btn work-small"
                @click="draftFor(activeReport.report.id).location = selected.id">用图上选中的楼栋定位</button>
              <button type="submit" class="btn work-primary" :disabled="!draftFor(activeReport.report.id).verdict">
                {{ activeReport.verdict ? '记录改判' : '记录判读' }}
              </button>
            </form>
            <div v-if="activeReport.assessment" class="report-assessment">
              <strong>{{ !activeReport.assessment.attempt ? '本轮未判读' : activeReport.assessment.correct ? '判断合理' : '判断有误' }}</strong>
              <p v-if="activeReport.assessment.window">当时可判为「{{ activeReport.assessment.window.expected }}」。{{ activeReport.assessment.window.reason }}</p>
              <template v-else-if="unjudgedReveal">
                <p>收到时（{{ simStamp(unjudgedReveal.receiptAt) }}）可判为「{{ unjudgedReveal.receipt.expected }}」。{{ unjudgedReveal.receipt.reason }}</p>
                <p v-if="unjudgedReveal.final">自 {{ simStamp(unjudgedReveal.final.at) }} 起可判为「{{ unjudgedReveal.final.window.expected }}」。{{ unjudgedReveal.final.window.reason }}</p>
              </template>
              <p>参考位置 {{ activeReport.assessment.expected_location === null ? '未设定' : locationName(activeReport.assessment.expected_location) }}</p>
            </div>
          </article>
          <div v-if="reportCards.length > 1" class="report-history">
            <h3>已收到的上报</h3>
            <ul>
              <li v-for="{ report, verdict } in [...reportCards].reverse()" :key="report.id">
                <button type="button" :aria-pressed="report.id === activeReport?.report.id"
                  :data-report-id="report.id" @click="selectReport(report.id)">
                  <span class="report-history-ref">{{ report.id }} <small>{{ verdict?.verdict ?? (finished ? '未判读' : '待判读') }}</small></span>
                  <span class="report-history-text">{{ report.text }}</span>
                </button>
              </li>
            </ul>
          </div>
        </template>
      </section>

      <section ref="mapSection" class="work-panel map-panel" tabindex="-1" aria-labelledby="drill-map-title">
        <div class="panel-heading map-heading">
          <h2 id="drill-map-title">校园沙盘</h2>
          <span class="map-scale-text">训练示意图</span>
        </div>
        <div class="layer-toolbar" role="group" aria-label="地图图层">
          <button v-for="key in LAYER_ORDER" :key="key" type="button" class="btn work-small"
            :data-layer="key" :aria-pressed="layers[key]" @click="layers[key] = !layers[key]">
            <span class="layer-indicator" aria-hidden="true"></span>{{ LAYER_STYLE[key].label }}
          </button>
          <button v-if="started" type="button" class="btn work-small map-order-link"
            @click="planRoute">规划路径</button>
        </div>
        <div class="work-map">
          <CampusMap :map="map" :roads="roads" :highlight="highlight" :selected="selected"
            :overlay="overlay" :layers="layers" :route="route" @select="toggleSelect" @clear="clearSelection" />
        </div>
        <div class="map-status">
          <p v-if="selected"><strong>已选中</strong> {{ targetName }}</p>
          <p v-else>点选楼栋、道路或校门查看详情</p>
          <button v-if="started && selected" type="button" class="btn work-small" @click="showPanel('orders')">查看对象与指令</button>
        </div>
        <ul v-if="situation.length" class="map-situation" aria-label="当前态势">
          <li v-for="entry in situation" :key="entry.key">
            <i :style="{ backgroundColor: entry.color }" aria-hidden="true"></i>{{ entry.text }}
          </li>
        </ul>
        <div v-else class="map-summary">
          <span>{{ map.buildings.length }} 栋楼</span><span>{{ map.road_segments.length }} 条路段</span>
          <span v-if="started">灾情 {{ hazardCount }} · 封闭 {{ closedCount }}</span>
        </div>
      </section>

      <section ref="orderSection" class="work-panel order-panel" tabindex="-1" aria-labelledby="drill-order-heading">
        <div class="panel-heading">
          <h2 id="drill-order-heading">下达指令</h2>
          <span v-if="started && !canWrite" class="work-chip">只读</span>
        </div>
        <div v-if="!started" class="order-empty">
          <p>三步玩法：</p>
          <ol class="order-steps">
            <li>读上报并判读：真报 / 误报 / 待核</li>
            <li>在地图点选楼栋或道路，下达处置指令</li>
            <li>末回合排出最紧急的上报，结束并查看评分</li>
          </ol>
        </div>
        <template v-else>
          <label class="work-field">
            <span>处置对象</span>
            <select v-model="targetKey" id="drill-target">
              <option value="">从地图点选，或在此选择</option>
              <optgroup v-for="group in targetGroups" :key="group.kind" :label="group.title">
                <option v-for="item in group.items" :key="item.id" :value="`${group.kind}:${item.id}`">{{ item.name }}</option>
              </optgroup>
            </select>
          </label>
          <p v-if="!selected" class="order-empty">选中后会显示适用于该对象的指令。收到上报后，可直接处置。</p>
          <template v-else>
            <div v-if="targetRoad" class="selected-road">
              <p>自然灾情 <strong>{{ targetRoad.hazard ? HAZARD_LABEL[targetRoad.hazard] : '无' }}</strong></p>
              <p>正式封闭 <strong>{{ targetRoad.formally_closed ? '已封闭' : '未封闭' }}</strong></p>
            </div>
            <p v-if="selected.kind === 'junction'" class="order-empty">校门和路口可用于规划路径。下达指令时请选择楼栋或道路。</p>
            <form v-else-if="canWrite" class="order-form" @submit.prevent="onAction">
              <fieldset>
                <legend>选择指令</legend>
                <div class="order-options">
                  <label v-for="item in applicableActions" :key="item.id">
                    <input v-model="actionChoice" type="radio" name="order" :value="item.id" />
                    <span>{{ item.name }} <small>{{ item.duration_sim }} 秒</small></span>
                  </label>
                </div>
              </fieldset>
              <button type="submit" class="btn work-primary" id="submit-order" :disabled="!action">
                {{ action ? `对${targetName}下达${action.name}` : '下达指令' }}
              </button>
            </form>
            <p v-else class="order-empty">{{ finished ? '本轮已结算。可查看当时的指令状态。' : '正在回看。回到当前回合可继续下达指令。' }}</p>
            <p v-if="actionError" class="order-feedback rejected" role="alert">{{ actionError }}</p>
            <div v-else-if="latestOrder" id="action-feedback" class="order-feedback" role="status"
              :class="{ rejected: latestOrder.attempt.status === 'rejected' }">
              <strong>{{ latestOrder.name }} · {{ latestOrder.attempt.status === 'rejected' ? '未下达' : latestOrder.complete ? '已完成' : '执行中' }}</strong>
              <p v-if="latestOrder.attempt.status === 'rejected'">{{ learnerReason(latestOrder.attempt.reject_reason ?? '') }}</p>
              <p v-else-if="latestOrder.attempt.completed_at_sim !== null">
                {{ latestOrder.complete ? '完成于' : '预计完成于' }} T+{{ formatSimTime(latestOrder.attempt.completed_at_sim) }}
              </p>
            </div>
            <details v-if="targetBuilding" class="target-details">
              <summary>楼栋资料</summary>
              <dl>
                <dt>分区</dt><dd>{{ targetBuilding.zone }}</dd>
                <dt>用途</dt><dd>{{ CATEGORY_STYLE[targetBuilding.category].label }}</dd>
                <dt>楼层</dt><dd>{{ formatBuildingFloors(targetBuilding) }}</dd>
                <dt>估算容量</dt><dd>{{ targetBuilding.capacity }} 人</dd>
                <template v-if="targetBuilding.risk_tag">
                  <dt>模拟风险</dt><dd>{{ targetBuilding.risk_tag }}</dd>
                </template>
              </dl>
            </details>
          </template>
        </template>
        <button v-if="started" type="button" class="btn work-small" @click="showPanel('map')">返回校园沙盘</button>
      </section>

    <section v-if="started" v-show="sidePanel === 'tools'" ref="toolsSection" class="work-panel drill-tools side-panel"
      tabindex="-1" aria-labelledby="tools-heading">
      <div class="panel-heading">
        <h2 id="tools-heading">推演工具</h2>
        <button type="button" class="btn work-small" @click="showPanel('orders')">返回指令</button>
      </div>
      <details class="work-panel tool-panel" :open="routeOpen" @toggle="routeOpen = ($event.target as HTMLDetailsElement).open">
        <summary>规划路径</summary>
        <div class="tool-content">
          <div class="route-fields">
            <label class="work-field">
              <span>路径起点</span>
              <select v-model="routeFrom" id="drill-route-from">
                <option v-for="item in endpoints" :key="item.id" :value="item.id">{{ item.name }}</option>
              </select>
            </label>
            <label class="work-field">
              <span>路径终点</span>
              <select v-model="routeTo" id="drill-route-to">
                <option value="">选择终点</option>
                <option v-for="item in endpoints" :key="item.id" :value="item.id">{{ item.name }}</option>
              </select>
            </label>
          </div>
          <p v-if="degenerate" class="order-feedback rejected">起点与终点相同，请另选一个终点。</p>
          <RoutePanel v-else :route="route" :map="map" :roads="roads" />
        </div>
      </details>
      <details class="work-panel tool-panel" :open="historyOpen" @toggle="historyOpen = ($event.target as HTMLDetailsElement).open">
        <summary>时间线与播放</summary>
        <div class="tool-content">
          <p class="work-muted">可回看已经到达的回合。回看期间无法下令。</p>
          <div class="round-progress" role="group" aria-label="已到达的回合">
            <button v-for="round in rounds.slice(0, furthestRoundIndex + 1)" :key="round.node.id"
              type="button" class="btn" :aria-current="round.index === roundIndex ? 'step' : undefined"
              @click="drill.goToRound(round.index)">{{ formatSimTime(round.node.t_sim) }}</button>
          </div>
          <div class="work-controls">
            <button type="button" class="btn" id="round-play" :disabled="!canNext || !canWrite" :aria-pressed="playing"
              @click="drill.togglePlay()">{{ playing ? '暂停播放' : '自动推进' }}</button>
            <label class="work-field speed-field">
              <span>播放速度</span>
              <select v-model.number="speed" id="speed-select">
                <option v-for="value in speeds" :key="value" :value="value">{{ value }}×</option>
              </select>
            </label>
            <button type="button" class="btn" id="drill-reset" @click="resetDialog?.showModal()">重置本轮</button>
          </div>
        </div>
      </details>
      <details class="work-panel tool-panel log-panel" :open="logOpen" @toggle="logOpen = ($event.target as HTMLDetailsElement).open">
        <summary>操作记录与资源 <span>{{ ledgerRows.length }}</span></summary>
        <section ref="ledgerSection" class="tool-content ledger-content" tabindex="-1" aria-label="本轮记录">
          <div>
            <h3>本轮操作</h3>
            <ol v-if="ledgerRows.length" class="ledger-list" id="ledger-table">
              <li v-for="row in ledgerRows" :key="row.seq">
                <span class="ledger-stamp">{{ formatSimTime(row.stamp) }} · {{ row.kindLabel }}</span>
                <strong>{{ row.detail }}</strong>
                <span :class="row.tone">{{ row.state }}</span>
              </li>
            </ol>
            <p v-else class="work-muted">本轮还没有操作。</p>
            <button v-if="reviewResult" type="button" class="btn work-small" @click="backToTimeline">回到复盘时间线</button>
            <h3>信息流</h3>
            <div class="work-controls" aria-label="信息流过滤" role="group">
              <button v-for="kind in FEED_KINDS" :key="kind" type="button" class="btn work-small"
                :aria-pressed="feedFilter === kind" @click="feedFilter = kind">{{ kind }}</button>
            </div>
            <ol class="ledger-list">
              <li v-for="row in feedRows" :key="row.key">
                <span class="ledger-stamp">{{ formatSimTime(row.stamp) }} · {{ row.kind }}</span>
                <span>{{ row.text }}</span>
              </li>
            </ol>
            <p v-if="!feedRows.length" class="work-muted">当前回合暂无这类记录。</p>
          </div>
          <div>
            <h3>资源占用</h3>
            <OccupancyBars :resources="fixture.scenario.resources" :occupancy="snapshot.resource_occupancy"
              :active="snapshot.active_resource_occupancy" />
          </div>
        </section>
      </details>
    </section>
    </div>

    <nav class="drill-dock" aria-label="推演快捷操作">
      <button v-for="{ id, label } in dockItems" :key="id" type="button" class="btn work-small"
        :aria-pressed="!sidePanel && primaryPanel === id" @click="showPanel(id)">{{ label }}</button>
      <button v-if="started" type="button" class="btn work-small dock-tools"
        :aria-pressed="sidePanel === 'tools'" @click="sidePanel === 'tools' ? showPanel('orders') : showSide('tools')">工具</button>
    </nav>

    <dialog ref="resetDialog" class="work-dialog" aria-labelledby="reset-heading">
      <h2 id="reset-heading">重置本轮推演？</h2>
      <p>这会清除本轮的判读、指令与评分，并回到第一条上报。</p>
      <form method="dialog" class="work-controls">
        <button class="btn" autofocus>继续本轮</button>
        <button class="btn work-danger" type="button" @click="resetDrill">清空并重置</button>
      </form>
    </dialog>
  </div>
</template>
