<script setup lang="ts">
import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue';
import type { ActionAttempt, ActionId, LocationChoice, RunEvent, Verdict, VerdictAttempt } from '../contracts';
import { ActionEngineError } from '../action-engine';
import { windowAt } from '../fixture-port';
import { SORT_LIMIT } from '../score-engine';
import type { EnginePort } from '../engine-port';
import type { RoundData } from '../scenario-generation/contracts';
import type { RunProgress, StoredRun } from '../run-store/contracts';
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
import { learnerReportText, ORDER_EFFECT, VERDICT_GUIDANCE } from '../config/drill-guidance';
import CampusMap from '../components/CampusMap.vue';
import DrillReportScene from '../components/DrillReportScene.vue';
import RoutePanel from '../components/RoutePanel.vue';
import ScorePanel from '../components/ScorePanel.vue';
import OccupancyBars from '../components/OccupancyBars.vue';

const { port, fixture, saved, runSaved } = defineProps<{ port: EnginePort; fixture: RoundData; saved: StoredRun; runSaved: boolean }>();
const emit = defineEmits<{
  checkpoint: [runId: string, progress: RunProgress, events: RunEvent[], score: StoredRun['score']];
  restart: [];
}>();
const map = port.map;
const runId = saved.run_id;

const drill = useDrillRound(fixture, port, { judgeAction: port.judgeAction, restored: saved, clockPaused: true });
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
const reportBody = ref<HTMLElement | null>(null);
const updatesSection = ref<HTMLElement | null>(null);
const toolsSection = ref<HTMLElement | null>(null);

type TaskPanel = 'reports' | 'orders' | 'updates';
type PrimaryPanel = TaskPanel | 'map';
type SidePanel = 'tools' | 'finish' | 'review';
const primaryPanel = ref<PrimaryPanel>('reports');
const taskPanel = ref<TaskPanel>('reports');
const sidePanel = ref<SidePanel | null>(saved.progress.finished && saved.progress.node === saved.progress.furthest ? 'review' : null);
const taskTabs: { id: TaskPanel; label: string }[] = [
  { id: 'reports', label: '上报' },
  { id: 'orders', label: '指令' },
  { id: 'updates', label: '现场通报' },
];
const reportHistoryOpen = ref(false);

const started = ref(saved.progress.started);
const autoEnabled = ref(!saved.progress.started);
const workspaceActive = ref(true);
const pageVisible = ref(!document.hidden);
const resetOpen = ref(false);
const mapSection = ref<HTMLElement | null>(null);
const campusMap = ref<InstanceType<typeof CampusMap> | null>(null);
const orderSection = ref<HTMLElement | null>(null);
const resetDialog = ref<HTMLDialogElement | null>(null);
const reportChoice = ref<string | null>(null);
const actionChoice = ref<ActionId | ''>('');
const actionReceipt = ref<HTMLElement | null>(null);
const routeOpen = ref(false);
const logOpen = ref(false);
const historyOpen = ref(false);
const sceneName = fixture.scenario.title.replace(/（训练样例）$/, '');
const heardReports = computed(() => started.value ? deliveredReports.value.length : 0);

const hovered = ref<Selection | null>(null);
const selected = ref<Selection | null>(null);
const orderTarget = ref<Selection | null>(null);
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
function checkpoint(): void {
  emit('checkpoint', runId, {
    node: roundIndex.value, furthest: furthestRoundIndex.value, started: started.value,
    finished: finished.value, speed: speed.value, elapsed_ms: started.value ? drill.readClock() : 0,
  }, drill.currentEvents.value, result.value);
}
function pauseAndSave(): void {
  drill.pauseClock();
  checkpoint();
}
function updatePageVisibility(): void {
  pageVisible.value = !document.hidden;
  if (!workspaceActive.value) return;
  if (!pageVisible.value) pauseAndSave();
  else if (started.value) drill.resumeClock();
}
onActivated(() => {
  workspaceActive.value = true;
  updatePageVisibility();
  window.addEventListener('keydown', onGlobalKey);
});
onDeactivated(() => {
  workspaceActive.value = false;
  window.removeEventListener('keydown', onGlobalKey);
  pauseAndSave();
});
watch([started, finished, roundIndex, furthestRoundIndex, speed, drill.currentEvents], checkpoint);
onMounted(() => {
  const timer = setInterval(() => {
    if (workspaceActive.value && pageVisible.value && started.value && !finished.value) checkpoint();
  }, 5000);
  window.addEventListener('pagehide', pauseAndSave);
  window.addEventListener('pageshow', updatePageVisibility);
  document.addEventListener('visibilitychange', updatePageVisibility);
  onUnmounted(() => {
    clearInterval(timer);
    window.removeEventListener('pagehide', pauseAndSave);
    window.removeEventListener('pageshow', updatePageVisibility);
    document.removeEventListener('visibilitychange', updatePageVisibility);
  });
});

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
const drafts = ref<Record<string, VerdictDraft>>({});
function draftFor(reportId: string): VerdictDraft {
  const existing = drafts.value[reportId];
  if (existing) return existing;
  const latest = snapshot.value.latest_verdicts.find(({ report_id }) => report_id === reportId);
  drafts.value[reportId] = { verdict: latest?.verdict ?? '', location: latest?.location ?? '' };
  return drafts.value[reportId];
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
async function recordVerdict(reportId: string): Promise<void> {
  const draft = drafts.value[reportId];
  if (!draft?.verdict) return;
  const location: LocationChoice | null = draft.location === '' ? null : draft.location;
  if (!drill.submitVerdict(reportId, draft.verdict, location)) return;
  reportChoice.value = reportId;
  await nextTick();
  reportBody.value?.scrollTo(0, 0);
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
    ?? reportCards.value.find(({ report, verdict }) => !verdict && lastBatch.value.some(({ id }) => id === report.id))
    ?? reportCards.value.find(({ verdict }) => !verdict)
    ?? reportCards.value.find(({ report }) => report.id === lastBatch.value.at(-1)?.id)
    ?? reportCards.value.at(-1),
);
const fieldUpdates = computed(() => {
  const updates = new Map<string, { key: string; tSim: number; text: string; target: Selection }>();
  for (const { t_sim: tSim, event } of snapshot.value.scenario_events) {
    if (event.type === 'ugc_appear') continue;
    const target: Selection = event.type === 'road_hazard'
      ? { kind: 'road', id: event.road_id }
      : { kind: 'building', id: event.building_id };
    const key = `${target.kind}:${target.id}`;
    updates.delete(key);
    updates.set(key, {
      key, tSim, target,
      text: event.type === 'road_hazard' ? event.description : event.title,
    });
  }
  return [...updates.values()].reverse();
});
const freshFieldUpdate = computed(() => fieldUpdates.value.some(({ tSim }) => tSim === currentT.value));
const editingVerdict = computed(() => {
  const card = activeReport.value;
  if (!card?.verdict) return false;
  const draft = drafts.value[card.report.id];
  return !!draft && !!draft.verdict &&
    (draft.verdict !== card.verdict.verdict || draft.location !== (card.verdict.location ?? ''));
});
function discardVerdictEdit(): void {
  const card = activeReport.value;
  if (!card?.verdict) return;
  drafts.value[card.report.id] = { verdict: card.verdict.verdict, location: card.verdict.location ?? '' };
}
const locatingReport = ref<string | null>(null);
async function locateReport(reportId: string): Promise<void> {
  locatingReport.value = reportId;
  await showPanel('map');
}
function setReportLocation(): void {
  if (!locatingReport.value || selected.value?.kind !== 'building') return;
  const id = locatingReport.value;
  draftFor(id).location = selected.value.id;
  void selectReport(id);
}
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
const nextUnread = computed(() => reportCards.value.find(({ verdict, report }) =>
  !verdict && report.id !== activeReport.value?.report.id,
));
const targetGroups = [
  { kind: 'building', title: '楼栋', items: map.buildings },
  { kind: 'road', title: '道路', items: map.road_segments },
  { kind: 'junction', title: '校门与路口', items: map.junctions },
] as const;
const targetKey = computed({
  get: () => orderTarget.value ? `${orderTarget.value.kind}:${orderTarget.value.id}` : '',
  set: (key: string) => {
    const group = targetGroups.find(({ kind }) => key.startsWith(`${kind}:`));
    orderTarget.value = group ? { kind: group.kind, id: key.slice(group.kind.length + 1) } : null;
    selected.value = orderTarget.value;
    hovered.value = null;
  },
});
function selectionName(selection: Selection | null): string {
  if (!selection) return '';
  const group = targetGroups.find(({ kind }) => kind === selection.kind);
  return group?.items.find(({ id }) => id === selection.id)?.name ?? '';
}
const targetName = computed(() => selectionName(orderTarget.value));
const targetRoad = computed(() => orderTarget.value?.kind === 'road'
  ? roads.value.find((road) => road.road_id === orderTarget.value?.id)
  : undefined);
const targetBuilding = computed(() => orderTarget.value?.kind === 'building'
  ? map.buildings.find((building) => building.id === orderTarget.value?.id)
  : undefined);
const applicableActions = computed(() => fixture.action_catalog.filter(({ target_kind }) => target_kind === orderTarget.value?.kind));
const action = computed(() => applicableActions.value.find(({ id }) => id === actionChoice.value));
const actionError = ref('');
const orderDraftPending = ref(false);
function orderCompleted(attempt: ActionAttempt): boolean {
  return attempt.completed_at_sim !== null && currentT.value >= attempt.completed_at_sim;
}
const latestOrder = computed(() => {
  const attempt = snapshot.value.actions.filter(({ target_id }) => target_id === orderTarget.value?.id).at(-1);
  if (!attempt) return null;
  const complete = orderCompleted(attempt);
  const effect = ORDER_EFFECT[attempt.action_id];
  return { attempt, name: actionName(attempt.action_id), complete, effect: complete ? effect?.done : effect?.working };
});
const orderMarks = computed(() => {
  const marks = new Map<string, { key: string; target: Selection; complete: boolean; text: string }>();
  for (const attempt of snapshot.value.actions) {
    if (attempt.status !== 'accepted') continue;
    const target = targetSelection(attempt.action_id, attempt.target_id);
    if (!target) continue;
    // 救援和警戒已有独立图层。封路和断电完成后，由路况和楼栋状态接替。
    const complete = orderCompleted(attempt);
    if (attempt.action_id === 'A2' || attempt.action_id === 'A3') continue;
    if (complete && (attempt.action_id === 'A5' || attempt.action_id === 'A6')) continue;
    const key = `${attempt.action_id}:${attempt.target_id}`;
    marks.set(key, {
      target, complete, key: `${key}:${attempt.seq}`,
      text: `${actionName(attempt.action_id)} · ${complete ? '已完成' : '执行中'}`,
    });
  }
  return [...marks.values()];
});
watch(targetKey, () => {
  actionChoice.value = '';
  actionError.value = '';
  orderDraftPending.value = false;
});
watch(currentT, () => {
  reportChoice.value = null;
  actionError.value = '';
});
async function onAction(): Promise<void> {
  if (!started.value || !canWrite.value || !action.value || !orderTarget.value) return;
  actionError.value = '';
  try {
    if (drill.submitAction(action.value.id, orderTarget.value.id)) orderDraftPending.value = false;
  } catch (error) {
    if (!(error instanceof ActionEngineError)) throw error;
    actionError.value = error.message;
  }
  await nextTick();
  actionReceipt.value?.scrollIntoView({ block: 'nearest' });
}
function discardOrderEdit(): void {
  actionChoice.value = '';
  orderDraftPending.value = false;
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
    orderTarget.value = row.select;
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
  if (panel !== 'map') {
    locatingReport.value = null;
    taskPanel.value = panel;
  }
  primaryPanel.value = panel;
  sidePanel.value = null;
  await nextTick();
  const element = { reports: reportsSection.value, map: mapSection.value, orders: orderSection.value, updates: updatesSection.value }[panel];
  element?.focus({ preventScroll: true });
}
async function showSide(panel: SidePanel): Promise<void> {
  locatingReport.value = null;
  sidePanel.value = panel;
  await nextTick();
  const element = { tools: toolsSection.value, finish: finalSection.value, review: resultSection.value }[panel];
  element?.focus({ preventScroll: true });
  element?.scrollTo(0, 0);
}
async function selectReport(id: string): Promise<void> {
  reportChoice.value = id;
  reportHistoryOpen.value = false;
  await showPanel('reports');
  reportBody.value?.scrollTo(0, 0);
}
function orderForSelection(): void {
  if (!selected.value || selected.value.kind === 'junction') return;
  orderTarget.value = selected.value;
  void showPanel('orders');
}
async function showTargetOnMap(target: Selection, actionId?: ActionId): Promise<void> {
  selected.value = target;
  hovered.value = null;
  if (actionId === 'A2') layers.value.rescue = true;
  if (actionId === 'A3') layers.value.cordon = true;
  if (!actionId) layers.value.disaster = true;
  await showPanel('map');
  campusMap.value?.focusTarget(target);
}
async function advanceRound(): Promise<void> {
  if (!canNext.value || !canWrite.value) return;
  const focus = document.activeElement;
  const focusWasInReports = reportsSection.value?.contains(focus);
  locatingReport.value = null;
  drill.nextRound();
  if (sortOpen.value) await showSide('finish');
  else if (!sidePanel.value && (lastBatch.value.length || freshFieldUpdate.value)) {
    await nextTick();
    reportBody.value?.scrollTo(0, 0);
    if (focusWasInReports && !focus?.isConnected) reportsSection.value?.focus({ preventScroll: true });
  }
}
const autoHold = computed(() => {
  if (!autoEnabled.value) return '已暂停';
  if (unreadCount.value) return `等候判读 · ${unreadCount.value} 条`;
  if (editingVerdict.value) return '正在编辑判读';
  if (orderDraftPending.value) return '正在编辑指令';
  if (locatingReport.value) return '正在沙盘上定位';
  if (sidePanel.value || resetOpen.value || !workspaceActive.value || !pageVisible.value) return '暂缓推进';
  return '';
});
const awaitingFirstReport = computed(() => !deliveredReports.value.length && !fieldUpdates.value.length);
const autoDelay = computed(() => awaitingFirstReport.value
  ? 1200
  : Math.max(8000, (freshFieldUpdate.value ? 24000 : 15000) / speed.value));
const autoReady = computed(() => started.value && canWrite.value && canNext.value && !autoHold.value);
const autoCycle = ref(0);
watch([autoReady, autoDelay, currentT, () => drill.currentEvents.value.length], (_values, _old, onCleanup) => {
  if (!autoReady.value) return;
  autoCycle.value += 1;
  const timer = setTimeout(() => {
    if (autoReady.value) void advanceRound();
  }, autoDelay.value);
  onCleanup(() => clearTimeout(timer));
});
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
  updatePageVisibility();
  clearSelection();
  hovered.value = null;
  void showPanel('reports');
}
function resetDrill(): void {
  resetDialog.value?.close();
  pauseAndSave();
  emit('restart');
}
function openReset(): void {
  resetOpen.value = true;
  resetDialog.value?.showModal();
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
        <div class="scene-clock">
          <span class="clock-reading" id="round-now">T+{{ formatSimTime(currentT) }}</span>
          <span class="round-label">{{ roundIndex + 1 }} / {{ rounds.length }} 回合</span>
        </div>
        <button type="button" class="btn work-small desktop-tools" :aria-pressed="sidePanel === 'tools'"
          @click="sidePanel === 'tools' ? showPanel(taskPanel) : showSide('tools')">工具</button>
        <div v-if="canWrite && canNext" class="playback-controls">
          <button id="round-play" type="button" class="btn work-small" :aria-pressed="autoEnabled"
            aria-describedby="auto-status" @click="autoEnabled = !autoEnabled">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path v-if="autoEnabled" d="M6 3.5v9m4-9v9" />
              <path v-else d="m6 3.5 6 4.5-6 4.5z" />
            </svg>
            <span>{{ autoEnabled ? '暂停' : '自动推进' }}</span>
            <span v-if="autoReady" :key="autoCycle" class="auto-progress" aria-hidden="true"
              :style="{ '--auto-duration': autoDelay + 'ms' }"></span>
          </button>
          <button id="round-next" type="button" class="btn work-small"
            :title="unreadCount ? '可跳过未判读的上报，稍后仍可查看' : '立即进入下一回合'" @click="advanceRound">
            下一回合 <span aria-hidden="true">→</span>
          </button>
          <span id="auto-status" class="auto-status" role="status">
            {{ autoReady ? (awaitingFirstReport ? '接收首报中' : '自动推进中') : autoHold }}
          </span>
        </div>
        <button v-else-if="roundIndex !== furthestRoundIndex" type="button" class="btn work-primary"
          @click="returnToCurrent">{{ finished ? '返回复盘' : '返回当前回合' }}</button>
        <button v-else-if="sortOpen || reviewResult" type="button" class="btn work-primary"
          @click="showSide(sortOpen ? 'finish' : 'review')">{{ sortOpen ? '结算' : '复盘' }}</button>
      </div>
      <div v-else class="scene-progress">
        <button type="button" class="btn work-small desktop-tools" :aria-pressed="sidePanel === 'tools'"
          @click="sidePanel === 'tools' ? showPanel(taskPanel) : showSide('tools')">工具</button>
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
      <div class="panel-heading">
        <h2 id="final-heading">结束推演</h2>
        <button type="button" class="btn work-small" @click="showPanel(taskPanel)">返回任务</button>
      </div>
      <p class="work-muted">可选出最紧急的 {{ sortCount }} 条上报，也可以直接查看评分。</p>
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
                :disabled="sortDraft.some((id, slot) => slot !== index && id === report.id)">{{ report.id }} · {{ learnerReportText(report.text) }}</option>
          </select>
        </label>
        <button type="submit" class="btn work-primary" :disabled="!sortReady">记录排序</button>
      </form>
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
          <CampusMap ref="campusMap" :map="map" :roads="roads" :highlight="highlight" :selected="selected"
            :overlay="overlay" :layers="layers" :route="route" :order-marks="orderMarks" @select="toggleSelect" @clear="clearSelection" />
        </div>
        <div class="map-status">
          <p v-if="selected"><strong>正在查看</strong> {{ selectionName(selected) }}</p>
          <p v-else>{{ locatingReport ? '请点选上报提到的楼栋' : '点选楼栋、道路或校门查看详情' }}</p>
          <template v-if="locatingReport">
            <button type="button" class="btn work-small" @click="showPanel('reports')">返回上报</button>
            <button type="button" class="btn work-small work-primary" :disabled="selected?.kind !== 'building'"
              @click="setReportLocation">用此楼栋定位</button>
          </template>
          <button v-else-if="started && selected && selected.kind !== 'junction'" type="button" class="btn work-small"
            @click="orderForSelection">对此处下达指令</button>
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

      <div class="work-panel task-deck" :class="{ 'task-deck-started': started }">
        <nav v-if="started" class="task-tabs" aria-label="当前任务">
          <button v-for="{ id, label } in taskTabs" :key="id" type="button" class="task-tab"
            :aria-pressed="taskPanel === id" @click="showPanel(id)">
            {{ label }}
            <span v-if="id === 'reports' && !finished && unreadCount" class="task-count">{{ unreadCount }}</span>
            <span v-if="id === 'orders' && orderDraftPending" class="task-draft">草稿</span>
            <span v-if="id === 'updates' && fieldUpdates.length" class="task-count" :class="{ 'task-count-fresh': freshFieldUpdate }">
              {{ freshFieldUpdate ? '新' : fieldUpdates.length }}
            </span>
          </button>
        </nav>

        <section v-show="taskPanel === 'reports'" ref="reportsSection" class="task-page report-panel" tabindex="-1" aria-labelledby="drill-reports-heading">
          <div v-if="!started" class="drill-intro">
            <DrillReportScene />
            <div>
              <p class="intro-meta">校园值班台 · {{ simStamp(currentT) }}</p>
              <h2 id="drill-reports-heading">{{ deliveredReports.length ? '收到现场上报' : '值班台已就绪' }}</h2>
            </div>
            <ol class="briefing-steps">
              <li><strong>读消息</strong><span>看清上报说了什么，线索不够可以标为待核。</span></li>
              <li><strong>需要处置时去沙盘</strong><span>点选楼栋或路段，再确认指令的对象。</span></li>
              <li><strong>看变化</strong><span>新上报会暂停时间，记录判读后自动继续。</span></li>
            </ol>
            <button id="start-drill" type="button" class="btn work-primary" @click="beginDrill">
              {{ deliveredReports.length ? '查看首报' : '开始值班' }} <span aria-hidden="true">→</span>
            </button>
          </div>
          <template v-else>
            <div class="panel-heading task-heading">
              <div>
                <h2 id="drill-reports-heading">{{ reportHistoryOpen ? '上报记录' : '当前上报' }}</h2>
                <p class="work-muted">已收到 {{ heardReports }} / {{ totalReports }} 条</p>
              </div>
              <button v-if="reportCards.length > 1 || reportHistoryOpen" type="button" class="btn work-small"
                :aria-expanded="reportHistoryOpen" aria-controls="drill-report-history"
                @click="reportHistoryOpen = !reportHistoryOpen">{{ reportHistoryOpen ? '返回当前上报' : '全部上报' }}</button>
            </div>
            <article v-if="activeReport" v-show="!reportHistoryOpen" :key="activeReport.report.id" class="active-report" :data-report="activeReport.report.id">
              <div ref="reportBody" class="task-scroll report-content">
                <div class="report-message">
                  <div class="active-report-meta">
                    <span class="report-ref">{{ activeReport.report.id }} · {{ simStamp(activeReport.report.appears_at_sim) }}</span>
                    <span class="report-training">{{ activeReport.verdict ? '已判读' : '待判读' }}</span>
                  </div>
                  <p class="reported-text">{{ learnerReportText(activeReport.report.text) }}</p>
                  <p v-if="activeReport.verdict" :key="activeReport.verdict.seq" class="report-recorded" role="status">
                    <span aria-hidden="true">✓</span> {{ activeReport.verdict.supersedes_seq === null ? '已记录' : '已更新' }}「{{ activeReport.verdict.verdict }}」{{ activeReport.verdict.location === null ? '' : ` · ${locationName(activeReport.verdict.location)}` }}
                  </p>
                </div>
                <div v-if="canWrite" class="report-tools">
                  <button type="button" class="work-text-btn" @click="showPanel('map')">查看沙盘 →</button>
                  <button v-if="activeReport.verdict && nextUnread" type="button" class="work-text-btn"
                    @click="selectReport(nextUnread.report.id)">下一条待判读 →</button>
                </div>
                <details v-if="canWrite" class="report-location">
                  <summary>
                    <span>定位练习</span>
                    <small>{{ draftFor(activeReport.report.id).location ? locationName(draftFor(activeReport.report.id).location) : '可跳过' }}</small>
                  </summary>
                  <p class="work-muted">练习在沙盘上找出上报提到的楼栋，结果单列展示。下令时另选实际处置对象。</p>
                  <label class="work-field">
                    <span>上报提到的楼栋</span>
                    <select v-model="draftFor(activeReport.report.id).location">
                      <option value="">选择楼栋或无法定位</option>
                      <option v-for="item in locations" :key="item.id" :value="item.id">{{ item.name }}</option>
                    </select>
                  </label>
                  <button type="button" class="work-text-btn" @click="locateReport(activeReport.report.id)">到沙盘上找楼栋 →</button>
                </details>
                <figure class="reported-scene">
                  <DrillReportScene :text="learnerReportText(activeReport.report.text)" />
                  <figcaption>上报内容示意 · 核实结果见现场通报</figcaption>
                </figure>
                <div v-if="activeReport.assessment" class="report-assessment">
                  <strong>{{ !activeReport.assessment.attempt ? '本轮未判读' : activeReport.assessment.correct ? '判断合理' : '判断有误' }}</strong>
                  <p v-if="activeReport.assessment.window">当时可判为「{{ activeReport.assessment.window.expected }}」。{{ activeReport.assessment.window.reason }}</p>
                  <template v-else-if="unjudgedReveal">
                    <p>收到时（{{ simStamp(unjudgedReveal.receiptAt) }}）可判为「{{ unjudgedReveal.receipt.expected }}」。{{ unjudgedReveal.receipt.reason }}</p>
                    <p v-if="unjudgedReveal.final">自 {{ simStamp(unjudgedReveal.final.at) }} 起可判为「{{ unjudgedReveal.final.window.expected }}」。{{ unjudgedReveal.final.window.reason }}</p>
                  </template>
                  <p>参考位置 {{ activeReport.assessment.expected_location === null ? '未设定' : locationName(activeReport.assessment.expected_location) }}</p>
                </div>
              </div>
              <form v-if="canWrite" class="verdict-form task-footer" @submit.prevent="recordVerdict(activeReport.report.id)">
                <fieldset>
                  <legend>根据当前线索，你怎么判断？</legend>
                  <div class="verdict-choices">
                    <label v-for="verdict in VERDICTS" :key="verdict">
                      <input v-model="draftFor(activeReport.report.id).verdict" type="radio" name="verdict" :value="verdict" />
                      <span>{{ verdict }} <small>{{ VERDICT_GUIDANCE[verdict] }}</small></span>
                    </label>
                  </div>
                </fieldset>
                <div class="task-actions">
                  <button type="submit" class="btn work-primary" :disabled="!draftFor(activeReport.report.id).verdict">
                    {{ activeReport.verdict ? '记录改判' : '记录判读' }}
                  </button>
                  <button v-if="editingVerdict" type="button" class="btn work-small" @click="discardVerdictEdit">取消改判</button>
                </div>
              </form>
            </article>
            <div v-else class="task-scroll report-wait">
              <DrillReportScene />
              <p class="work-muted">{{ autoEnabled ? '正在接收第一条现场上报…' : '时间已暂停。恢复自动推进或进入下一回合即可继续接收。' }}</p>
            </div>
            <div v-show="reportHistoryOpen" id="drill-report-history" class="task-scroll report-history">
              <ul>
                <li v-for="{ report, verdict } in [...reportCards].reverse()" :key="report.id">
                  <button type="button" :aria-pressed="report.id === activeReport?.report.id"
                    :data-report-id="report.id" @click="selectReport(report.id)">
                    <span class="report-history-ref">{{ report.id }} <small>{{ verdict?.verdict ?? (finished ? '未判读' : '待判读') }}</small></span>
                    <span class="report-history-text">{{ learnerReportText(report.text) }}</span>
                  </button>
                </li>
              </ul>
            </div>
          </template>
        </section>

        <section v-show="taskPanel === 'orders'" ref="orderSection" class="task-page order-panel" tabindex="-1" aria-labelledby="drill-order-heading">
          <div class="panel-heading task-heading">
            <h2 id="drill-order-heading">下达指令</h2>
            <span v-if="!canWrite" class="work-chip">只读</span>
            <button v-else type="button" class="btn work-small" @click="showPanel('map')">去沙盘选对象</button>
          </div>
          <div class="task-scroll order-content">
            <label class="work-field">
              <span>处置对象</span>
              <select v-model="targetKey" id="drill-target">
                <option value="">从地图点选，或在此选择</option>
                <optgroup v-for="group in targetGroups" :key="group.kind" :label="group.title">
                  <option v-for="item in group.items" :key="item.id" :value="`${group.kind}:${item.id}`">{{ item.name }}</option>
                </optgroup>
              </select>
            </label>
            <p v-if="!orderTarget" class="order-empty">选择要处置的楼栋或路段，即可查看能下达的指令。</p>
            <template v-else>
              <div v-if="targetRoad" class="selected-road">
                <p>自然灾情 <strong>{{ targetRoad.hazard ? HAZARD_LABEL[targetRoad.hazard] : '无' }}</strong></p>
                <p>正式封闭 <strong>{{ targetRoad.formally_closed ? '已封闭' : '未封闭' }}</strong></p>
              </div>
              <p v-if="orderTarget.kind === 'junction'" class="order-empty">校门和路口可用于规划路径。下达指令时请选择楼栋或道路。</p>
              <form v-else-if="canWrite" id="drill-order-form" class="order-form" @submit.prevent="onAction">
                <fieldset>
                  <legend>选择指令</legend>
                  <div class="order-options">
                    <label v-for="item in applicableActions" :key="item.id">
                      <input v-model="actionChoice" type="radio" name="order" :value="item.id" @change="orderDraftPending = true" />
                      <span>{{ item.name }} <small>模拟 {{ item.duration_sim }} 秒</small></span>
                    </label>
                  </div>
                </fieldset>
              </form>
              <p v-else class="order-empty">{{ finished ? '本轮已结算。可查看当时的指令状态。' : '正在回看。回到当前回合可继续下达指令。' }}</p>
              <p v-if="actionError" ref="actionReceipt" class="order-feedback rejected" role="alert">{{ actionError }}</p>
              <div v-else-if="latestOrder" ref="actionReceipt" id="action-feedback" class="order-feedback"
                :key="`${latestOrder.attempt.seq}:${latestOrder.complete}`" role="status"
                :class="{ rejected: latestOrder.attempt.status === 'rejected' }">
                <strong>{{ latestOrder.name }} · {{ latestOrder.attempt.status === 'rejected' ? '未下达' : latestOrder.complete ? '已完成' : '已下达，执行中' }}</strong>
                <p v-if="latestOrder.attempt.status === 'rejected'">{{ learnerReason(latestOrder.attempt.reject_reason ?? '') }}</p>
                <template v-else>
                  <p>{{ latestOrder.effect }}</p>
                  <p v-if="latestOrder.attempt.completed_at_sim !== null" class="order-time">
                    {{ latestOrder.complete ? '完成于' : '预计完成于' }} T+{{ formatSimTime(latestOrder.attempt.completed_at_sim) }}
                  </p>
                  <button type="button" class="work-text-btn"
                    @click="orderTarget && showTargetOnMap(orderTarget, latestOrder.attempt.action_id)">在沙盘查看 →</button>
                </template>
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
          </div>
          <div v-if="canWrite && orderTarget && orderTarget.kind !== 'junction'" class="task-footer task-actions">
            <button type="submit" form="drill-order-form" class="btn work-primary" id="submit-order" :disabled="!action">
              {{ action ? `对${targetName}下达${action.name}` : '下达指令' }}
            </button>
            <button v-if="orderDraftPending" type="button" class="btn work-small" @click="discardOrderEdit">取消选择</button>
          </div>
        </section>

        <section v-show="taskPanel === 'updates'" ref="updatesSection" class="task-page updates-panel" tabindex="-1"
          aria-labelledby="drill-updates-heading">
          <div class="panel-heading task-heading">
            <h2 id="drill-updates-heading">现场通报</h2>
          </div>
          <div class="task-scroll">
            <ul v-if="fieldUpdates.length" class="field-updates">
              <li v-for="entry in fieldUpdates" :key="`${entry.key}:${entry.tSim}`" class="field-update">
                <span class="report-ref">{{ simStamp(entry.tSim) }} · {{ selectionName(entry.target) }}</span>
                <p>{{ entry.text }}</p>
                <button type="button" class="work-text-btn" @click="showTargetOnMap(entry.target)">在沙盘定位 →</button>
              </li>
            </ul>
            <p v-else class="order-empty">暂时没有现场通报。有核实结果或道路状态变化时，这里会更新。</p>
          </div>
        </section>
      </div>

    <section v-show="sidePanel === 'tools'" ref="toolsSection" class="work-panel drill-tools side-panel"
      tabindex="-1" aria-labelledby="tools-heading">
      <div class="panel-heading">
        <h2 id="tools-heading">推演工具</h2>
        <button type="button" class="btn work-small" @click="showPanel(taskPanel)">返回任务</button>
      </div>
      <slot name="run-tools" :save="checkpoint" />
      <template v-if="started">
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
        <summary>时间线与推进速度</summary>
        <div class="tool-content">
          <p class="work-muted">可回看已经到达的回合。回看期间无法下令。</p>
          <div class="round-progress" role="group" aria-label="已到达的回合">
            <button v-for="round in rounds.slice(0, furthestRoundIndex + 1)" :key="round.node.id"
              type="button" class="btn" :aria-current="round.index === roundIndex ? 'step' : undefined"
              @click="drill.goToRound(round.index)">{{ formatSimTime(round.node.t_sim) }}</button>
          </div>
          <div class="work-controls">
            <label class="work-field speed-field">
              <span>自动推进速度</span>
              <select v-model.number="speed" id="speed-select">
                <option v-for="value in speeds" :key="value" :value="value">{{ value }}×</option>
              </select>
            </label>
            <button type="button" class="btn" id="drill-reset" @click="openReset">重置本轮</button>
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
      </template>
    </section>
    </div>

    <nav class="drill-dock" aria-label="推演快捷操作">
      <button type="button" class="btn work-small" :aria-pressed="!sidePanel && primaryPanel !== 'map'" @click="showPanel(taskPanel)">
        任务<span v-if="started && !finished && unreadCount" class="dock-count">{{ unreadCount }}</span>
      </button>
      <button type="button" class="btn work-small" :aria-pressed="!sidePanel && primaryPanel === 'map'" @click="showPanel('map')">沙盘</button>
      <button type="button" class="btn work-small dock-tools"
        :aria-pressed="sidePanel === 'tools'" @click="sidePanel === 'tools' ? showPanel(taskPanel) : showSide('tools')">工具</button>
    </nav>

    <dialog ref="resetDialog" class="work-dialog" aria-labelledby="reset-heading" @close="resetOpen = false">
      <h2 id="reset-heading">重置本轮推演？</h2>
      <p v-if="runSaved">旧轮次会保留在本机，并用相同剧本开启一次新训练。</p>
      <p v-else>当前进度可能未保存到本机。可先在工具中导出本轮，再重新开始。</p>
      <form method="dialog" class="work-controls">
        <button class="btn" autofocus>继续本轮</button>
        <button class="btn work-danger" type="button" @click="resetDrill">重新开始</button>
      </form>
    </dialog>
  </div>
</template>
