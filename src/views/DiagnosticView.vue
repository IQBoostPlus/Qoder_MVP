<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import {
  FixturePortError,
  SCORE_PENDING_TEXT,
  buildMapView,
  createFixturePort,
  type MapSource,
  type ReplayOptions,
  type ReplaySnapshot,
  type RouteQuery,
  type RouteResult,
} from '../fixture-port';
import type { Building, Junction, Point, RoadHazard, RoadSegment, RunEvent, Verdict } from '../contracts';
import { useFixtureData, useFixturePort } from '../composables/useFixturePort';
import { useDrillRound, pendingActionText } from '../composables/useDrillRound';
import type { ActionJudge } from '../action-engine';
import { CATEGORY_ORDER } from '../config/categories';
import type { Selection } from '../config/layers';
import { buildRouteQuery, endpointOptions, locationOptions, UNLOCATABLE } from '../config/route-query';
import CampusMap from '../components/CampusMap.vue';
import RoutePanel from '../components/RoutePanel.vue';

const port = useFixturePort();
const fixture = useFixtureData();
const staticPort = createFixturePort(fixture);
const map = port.map;
const nodes = fixture.scenario.nodes;
const runs = fixture.runs;

interface ErrorInfo {
  code: string;
  object_id: string;
  message: string;
}

function toErrorInfo(err: unknown): ErrorInfo {
  if (err instanceof FixturePortError) {
    return { code: err.code, object_id: err.object_id, message: err.message };
  }
  return { code: 'UNEXPECTED', object_id: '—', message: String(err) };
}

function verdictClass(verdict: Verdict): string {
  if (verdict === '真报') return 'badge-green';
  if (verdict === '误报') return 'badge-red';
  return 'badge-amber';
}

function hazardLabel(hazard: RoadHazard): string {
  if (hazard === 'flood') return '积水';
  if (hazard === 'fire') return '火灾';
  if (hazard === 'debris') return '散落物';
  return '无';
}

// ---- 01 地图派生 ----
function junctionPos(id: string): Point | undefined {
  return map.junction_positions[id];
}
function roadLength(id: string): number | undefined {
  return map.road_lengths_px[id];
}

// ---- 02 可见性与判断窗 ----
const defaultNodeIndex = Math.max(0, nodes.findIndex((node) => node.t_sim === 80));
const nodeIndex = ref(defaultNodeIndex);
const t = computed(() => nodes[nodeIndex.value]?.t_sim ?? 0);
const currentNode = computed(() => nodes[nodeIndex.value] ?? null);
const visibleRows = computed(() =>
  port.visibleReportsAt(t.value).map((report) => ({
    report,
    window: port.windowAt(report.id, t.value),
  })),
);
const visibleIds = computed(() => visibleRows.value.map((row) => row.report.id).join(' / '));

const probeReportId = ref(fixture.ugc_reports[0]?.id ?? '');
const probeT = ref(89);
const probeWindow = computed(() =>
  probeReportId.value === '' ? null : port.windowAt(probeReportId.value, probeT.value),
);

// ---- 03 只读回放 ----
function maxSeqOf(id: string): number {
  const events = runs.find((run) => run.run_id === id)?.events ?? [];
  return events.length ? Math.max(...events.map((event) => event.seq)) : 0;
}

const runId = ref(runs[0]?.run_id ?? '');
const currentRun = computed(() => runs.find((run) => run.run_id === runId.value) ?? null);
const maxSeq = computed(() => maxSeqOf(runId.value));
const seqCut = ref(maxSeqOf(runId.value));
const useSeqCut = ref(true);
const useTCut = ref(false);
const tCut = ref(165);
const snapshot = ref<ReplaySnapshot | null>(null);
const replayError = ref<ErrorInfo | null>(null);

function refreshSnapshot(): void {
  replayError.value = null;
  try {
    const options: ReplayOptions = {};
    if (useSeqCut.value) options.seq = seqCut.value;
    if (useTCut.value) options.t_sim = tCut.value;
    snapshot.value = port.replayTo(runId.value, options);
  } catch (err) {
    snapshot.value = null;
    replayError.value = toErrorInfo(err);
  }
}

watch(runId, () => {
  seqCut.value = maxSeq.value;
});
watch([runId, seqCut, useSeqCut, useTCut, tCut], refreshSnapshot, { immediate: true });

const acceptedCount = computed(
  () => snapshot.value?.actions.filter((action) => action.status === 'accepted').length ?? 0,
);
const rejectedCount = computed(
  () => snapshot.value?.actions.filter((action) => action.status === 'rejected').length ?? 0,
);

// ---- 04 评分对照 ----
// 左卡是「明确载入原始示例」，是唯一允许省略第二参数的场景；
// 中卡与右卡都走交互路径，必须传入当前流水，null 时只显示待接入常量。
const baselineScore = computed(() => port.getScore(runId.value));
const interactiveScore = computed(() =>
  snapshot.value ? port.getScore(runId.value, snapshot.value.events) : null,
);
const modifiedEvents = computed<RunEvent[] | null>(() => {
  const events = currentRun.value?.events;
  return events && events.length ? events.slice(0, -1) : null;
});
const modifiedScore = computed(() =>
  modifiedEvents.value ? port.getScore(runId.value, modifiedEvents.value) : null,
);

// ---- 05 路径查询（显式起终点 + 快照路网状态传参） ----
const endpoints = endpointOptions(map);
const routeFrom = ref(fixture.scenario.start_building_id);
const routeTo = ref('');
const routeDegenerate = computed(() => routeTo.value !== '' && routeFrom.value === routeTo.value);
const routeAt = computed(() => snapshot.value?.t_sim ?? t.value);
const routeQuery = computed<RouteQuery | null>(() =>
  routeTo.value === '' || routeDegenerate.value
    ? null
    : buildRouteQuery(map, snapshot.value, routeFrom.value, routeTo.value, routeAt.value),
);
const routeResult = computed(() => (routeQuery.value ? port.getRoute(routeQuery.value) : null));

// ---- 08 构造路径输入（证明 ready / unreachable 渲染分支；非寻路结果） ----
// 链是显式给定的测试数据：沿真实路段几何拼接，不实现任何寻路逻辑。
const CONSTRUCTED_CHAIN = ['R-N7-N1', 'R-N1-N2', 'R-N2-CN1', 'R-CN1-GYM', 'R-GYM-LIB'];
function constructedChainRoads(): RoadSegment[] | null {
  const chain: RoadSegment[] = [];
  for (const id of CONSTRUCTED_CHAIN) {
    const road = map.road_segments.find((r) => r.id === id);
    if (!road) return null;
    chain.push(road);
  }
  return chain;
}
function constructedReady(): RouteResult | null {
  const chain = constructedChainRoads();
  const first = chain?.[0];
  const last = chain?.[chain.length - 1];
  if (!chain || !first || !last) return null;
  const points: Point[] = [];
  let length = 0;
  for (const road of chain) {
    for (const p of road.geometry) {
      const prev = points[points.length - 1];
      if (!prev || prev.x !== p.x || prev.y !== p.y) points.push({ x: p.x, y: p.y });
    }
    length += map.road_lengths_px[road.id] ?? 0;
  }
  return {
    status: 'ready',
    from_node_id: first.from,
    to_node_id: last.to,
    at_sim: routeAt.value,
    node_ids: [first.from, ...chain.map((r) => r.to)],
    road_ids: chain.map((r) => r.id),
    points,
    length_px: length,
  };
}
const constructedMode = ref<'ready' | 'unreachable' | 'none'>('ready');
const constructedRoute = computed<RouteResult | null>(() => {
  if (constructedMode.value === 'none') {
    const query = constructedQuery.value;
    return query ? staticPort.getRoute(query) : null;
  }
  const ready = constructedReady();
  if (!ready || constructedMode.value === 'ready') return ready;
  return {
    status: 'unreachable',
    from_node_id: ready.from_node_id,
    to_node_id: ready.to_node_id,
    at_sim: ready.at_sim,
    reason: '构造输入：假设链上全部路段不可通行，用于验证 unreachable 分支渲染，非寻路结果。',
  };
});
const constructedQuery = computed<RouteQuery | null>(() => {
  const chain = constructedChainRoads();
  const first = chain?.[0];
  const last = chain?.[chain.length - 1];
  if (!first || !last) return null;
  return buildRouteQuery(map, snapshot.value, first.from, last.to, routeAt.value);
});

// ---- 09 CD-04：程序化 20 栋 + 3 路口，同一 CampusMap 零改动渲染 ----
function buildSyntheticSource(): MapSource {
  const buildings: Building[] = [];
  const centers = new Map<string, Point>();
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 5; c += 1) {
      const i = r * 5 + c;
      const id = `SYN-B${String(i + 1).padStart(2, '0')}`;
      const cx = 100 + c * 170;
      const cy = 100 + r * 150;
      centers.set(id, { x: cx, y: cy });
      buildings.push({
        id,
        name: `合成楼栋 ${String(i + 1).padStart(2, '0')}`,
        zone: ['合成·北', '合成·中', '合成·南'][r % 3] ?? '合成',
        category: CATEGORY_ORDER[i % CATEGORY_ORDER.length] ?? 'other',
        floors: i % 7 === 0 ? null : (i % 6) + 2,
        capacity: 120 + i * 35,
        risk_tag: i % 5 === 0 ? '合成风险标注' : null,
        polygon: [
          { x: cx - 32, y: cy - 24 },
          { x: cx + 32, y: cy - 24 },
          { x: cx + 32, y: cy + 24 },
          { x: cx - 32, y: cy + 24 },
        ],
        adjacency: [],
      });
    }
  }
  const junctions: Junction[] = [
    { id: 'SYN-G1', name: '合成校门 1', kind: 'gate' },
    { id: 'SYN-G2', name: '合成校门 2', kind: 'gate' },
    { id: 'SYN-X1', name: '合成路口 1', kind: 'crossing' },
  ];
  const junctionPos: Readonly<Record<string, Point>> = {
    'SYN-G1': { x: 920, y: 100 },
    'SYN-G2': { x: 100, y: 670 },
    'SYN-X1': { x: 440, y: 670 },
  };
  const roads: RoadSegment[] = [];
  const idAt = (r: number, c: number): string => `SYN-B${String(r * 5 + c + 1).padStart(2, '0')}`;
  const posOf = (id: string): Point => centers.get(id) ?? junctionPos[id] ?? { x: 0, y: 0 };
  let n = 0;
  function addRoad(from: string, to: string): void {
    n += 1;
    const a = posOf(from);
    const b = posOf(to);
    roads.push({
      id: `SYN-R${String(n).padStart(2, '0')}`,
      name: `合成路段 ${n}`,
      from,
      to,
      geometry: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }],
      blocked: false,
      hazard: null,
      block_reason: null,
    });
  }
  for (let r = 0; r < 4; r += 1) for (let c = 0; c < 4; c += 1) addRoad(idAt(r, c), idAt(r, c + 1));
  for (let r = 0; r < 3; r += 1) for (const c of [0, 2, 4]) addRoad(idAt(r, c), idAt(r + 1, c));
  addRoad(idAt(0, 4), 'SYN-G1');
  addRoad(idAt(3, 0), 'SYN-G2');
  addRoad(idAt(3, 2), 'SYN-X1');
  addRoad('SYN-X1', 'SYN-G2');
  const buildingIds = new Set(buildings.map((b) => b.id));
  for (const road of roads) {
    if (buildingIds.has(road.from) && buildingIds.has(road.to)) {
      buildings.find((b) => b.id === road.from)?.adjacency.push(road.to);
      buildings.find((b) => b.id === road.to)?.adjacency.push(road.from);
    }
  }
  return { buildings, junctions, road_segments: roads };
}
const syntheticMap = buildMapView(buildSyntheticSource());
const synSelected = ref<Selection | null>(null);
function synToggle(kind: Selection['kind'], id: string): void {
  synSelected.value =
    synSelected.value?.kind === kind && synSelected.value.id === id ? null : { kind, id };
}

// ---- 10 候选集合分离（JW-09） ----
const locationCandidates = locationOptions(map);
const locationLeak = computed(() => {
  const roadIds = new Set(map.road_segments.map((r) => r.id));
  const junctionIds = new Set(map.junctions.map((j) => j.id));
  return locationCandidates.filter((o) => roadIds.has(o.id) || junctionIds.has(o.id)).map((o) => o.id);
});
const hasUnlocatable = locationCandidates.some((o) => o.id === UNLOCATABLE);

// ---- 06 错误演示 ----
const demoError = ref<ErrorInfo | null>(null);
function triggerError(kind: 'seq' | 't_sim'): void {
  demoError.value = null;
  try {
    if (kind === 'seq') port.replayTo(runId.value, { seq: -1 });
    else port.replayTo(runId.value, { t_sim: -5 });
  } catch (err) {
    demoError.value = toErrorInfo(err);
  }
}

// ---- 07 倍速对照 ----
const speedRunId = ref(runs[0]?.run_id ?? '');
const speeds = fixture.scenario.playback_speeds;

interface Lane {
  speed: number;
  currentT: number | null;
  sequence: number[];
  done: boolean;
  elapsedMs: number | null;
}

function freshLanes(): Lane[] {
  return speeds.map((speed) => ({ speed, currentT: null, sequence: [], done: false, elapsedMs: null }));
}

const lanes = ref<Lane[]>(freshLanes());
const playing = ref(false);
let playToken = 0;
let playTimer: ReturnType<typeof setInterval> | null = null;
const STEP_MS = 500;

function stopPlayback(): void {
  playToken += 1;
  if (playTimer !== null) {
    clearInterval(playTimer);
    playTimer = null;
  }
  playing.value = false;
}

// 单循环 + 绝对时间戳调度：每轨步数由 elapsed*speed 推导，避免链式 sleep 漂移，
// 且后台标签定时器被节流时仍按倍速比例推进。
function playComparison(): void {
  if (playing.value) return;
  const run = runs.find((candidate) => candidate.run_id === speedRunId.value);
  if (!run || run.events.length === 0) return;
  const sequence = [...new Set(run.events.map((event) => event.t_sim))].sort((a, b) => a - b);
  stopPlayback();
  const token = ++playToken;
  playing.value = true;
  lanes.value = freshLanes();
  const started = performance.now();
  playTimer = setInterval(() => {
    if (token !== playToken) return;
    const elapsed = performance.now() - started;
    let allDone = true;
    for (const lane of lanes.value) {
      const target = Math.min(sequence.length, Math.floor((elapsed * lane.speed) / STEP_MS) + 1);
      while (lane.sequence.length < target) {
        const step = sequence[lane.sequence.length];
        if (step === undefined) break;
        lane.sequence.push(step);
        lane.currentT = step;
      }
      if (lane.sequence.length >= sequence.length) {
        if (!lane.done) {
          lane.done = true;
          lane.elapsedMs = Math.round(elapsed);
        }
      } else {
        allDone = false;
      }
    }
    if (allDone) stopPlayback();
  }, 100);
}

const speedSequenceEqual = computed<boolean | null>(() => {
  const list = lanes.value;
  if (!list.length || !list.every((lane) => lane.done)) return null;
  const first = list[0];
  if (!first) return null;
  return list.every((lane) => JSON.stringify(lane.sequence) === JSON.stringify(first.sequence));
});
const speedResponseSeconds = computed(
  () => port.getScore(speedRunId.value)?.details.response_seconds ?? null,
);
const speedStepCount = computed(() => lanes.value[0]?.sequence.length ?? 0);

onUnmounted(() => {
  stopPlayback();
});

function resetAll(): void {
  stopPlayback();
  lanes.value = freshLanes();
  nodeIndex.value = defaultNodeIndex;
  probeT.value = 89;
  seqCut.value = maxSeq.value;
  useSeqCut.value = true;
  useTCut.value = false;
  tCut.value = 165;
  demoError.value = null;
  routeFrom.value = fixture.scenario.start_building_id;
  routeTo.value = '';
  constructedMode.value = 'ready';
  synSelected.value = null;
  drillProbe.resetDrill();
  drillRejectProbe.resetDrill();
  timingChecks.value = [];
}

// ---- 11 D3 时机不变量断言 ----
// 断言中的时刻字面量（30/75/80/100/150/220/60）是测试断言值，来自 requirements §5.2 与
// quality TC-01～07 / VS-01～04；实现代码（rounds / useDrillRound / DrillView）不写死时刻。
const drillProbe = useDrillRound(fixture, port);

// RE-01～05 渲染侧构造桩：模拟 A 引擎返回 rejected，验证 B 完整留痕并渲染拒绝原因。
// 构造桩专测渲染与接口留痕。生产推演使用真实规则。
const rejectJudgeStub: ActionJudge = (input) => ({
  seq: input.seq,
  attempt: 1 + input.prior_events.filter((event) => event.kind === 'action'
    && event.payload.action_id === input.action_id && event.payload.target_id === input.target_id).length,
  action_id: input.action_id,
  target_id: input.target_id,
  submitted_at_sim: input.submitted_at_sim,
  duration_sim: 20,
  completed_at_sim: null,
  status: 'rejected',
  reject_reason_code: 'PRECONDITION_NOT_MET',
  reject_reason: '需同楼 A3 已完成（构造桩）',
  resource_usage: null,
});
const drillRejectProbe = useDrillRound(fixture, port, { judgeAction: rejectJudgeStub });

interface TimingCheck {
  id: string;
  label: string;
  pass: boolean;
  measured: string;
}
const timingChecks = ref<TimingCheck[]>([]);
const timingRunning = ref(false);
const wait = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

async function runTimingChecks(): Promise<void> {
  timingRunning.value = true;
  const checks: TimingCheck[] = [];
  const d = drillProbe;
  const nodeTimes = d.rounds.map((round) => round.node.t_sim);
  const indexOfT = (tSim: number): number => d.rounds.findIndex((round) => round.node.t_sim === tSim);
  const start = fixture.scenario.start_building_id;
  const baseRunId = runs[0]?.run_id ?? '';

  // TC-06 + TC-03：t=100 回合内判读 3 条 + 提交 2 动作，操作间插入真实等待
  d.resetDrill();
  d.goToRound(indexOfT(100));
  const scoreBefore = port.getScore(baseRunId, d.currentEvents.value);
  const realBefore = d.realElapsedMs.value;
  const stamps: number[] = [];
  for (const reportId of ['U1', 'U2', 'U3']) {
    const payload = d.submitVerdict(reportId, '待核', null);
    if (payload) stamps.push(payload.judged_at_sim);
    await wait(120);
  }
  for (const actionId of ['A1', 'A3'] as const) {
    const entry = d.submitAction(actionId, start);
    if (entry && entry.kind === 'action-pending') stamps.push(entry.submission.submitted_at_sim);
    await wait(120);
  }
  const realDelta = d.realElapsedMs.value - realBefore;
  const scoreAfter = port.getScore(baseRunId, d.currentEvents.value);
  checks.push({
    id: 'TC-06',
    label: 't=100 回合内 5 次操作 stamp 全 = 100，不随真实点击递增',
    pass: stamps.length === 5 && stamps.every((s) => s === 100),
    measured: `stamps=[${stamps.join(', ')}]`,
  });
  checks.push({
    id: 'TC-03',
    label: '真实操作间隔拉长，模拟 stamp 与评分不变，仅真实用时变化',
    pass: realDelta > 0 && stamps.every((s) => s === 100) && scoreBefore === null && scoreAfter === null,
    measured: `真实用时 +${realDelta.toFixed(0)}ms · 评分前后均 null（待接入）`,
  });

  // TC-04：t=30 提交 A1（duration 读 ActionDef）→ 期望完成 75；推进 ≥75 显示变化，submitted 不变
  d.resetDrill();
  d.goToRound(indexOfT(30));
  const entry30 = d.submitAction('A1', start);
  const sub = entry30 && entry30.kind === 'action-pending' ? entry30.submission : null;
  const textAt30 = sub ? pendingActionText(sub, d.currentT.value) : '缺失';
  d.goToRound(indexOfT(80));
  const textAt80 = sub ? pendingActionText(sub, d.currentT.value) : '缺失';
  const sk30 = port.replayTo(baseRunId, { t_sim: 30 });
  const baselineA1 = sk30?.actions.find((a) => a.action_id === 'A1' && a.submitted_at_sim === 30) ?? null;
  const baselineText = (tSim: number): string => {
    if (!baselineA1 || baselineA1.completed_at_sim === null) return '缺失';
    return tSim >= baselineA1.completed_at_sim
      ? `已完成 @${baselineA1.completed_at_sim}`
      : `在途 · 预计 @${baselineA1.completed_at_sim}`;
  };
  checks.push({
    id: 'TC-04',
    label: 't=30 提交 A1 → 完成记 75；提交回合在途、≥75 回合显示完成，submitted 仍 30',
    pass:
      sub !== null &&
      sub.expected_completed_at_sim === 75 &&
      sub.submitted_at_sim === 30 &&
      textAt30.includes('预计完成 @75') &&
      textAt80.includes('预计完成时刻已到 @75') &&
      baselineA1?.status === 'accepted' &&
      baselineA1?.completed_at_sim === 75 &&
      baselineText(30) === '在途 · 预计 @75' &&
      baselineText(80) === '已完成 @75',
    measured: `账本：${textAt30} → ${textAt80}（submitted 恒 ${sub?.submitted_at_sim ?? '—'}）；骨架基线：${baselineText(30)} → ${baselineText(80)}`,
  });

  // TC-07：推进回合 t=220 不投放新上报、已可见不变、可正常提交
  d.resetDrill();
  d.goToRound(indexOfT(150));
  const deliveredBefore = d.deliveredIds.value.size;
  d.goToRound(indexOfT(220));
  const batch220 = d.lastBatch.value.length;
  const deliveredAfter = d.deliveredIds.value.size;
  const entry220 = d.submitAction('A2', start);
  const stamp220 = entry220 && entry220.kind === 'action-pending' ? entry220.submission.submitted_at_sim : null;
  const kind220 = d.rounds[indexOfT(220)]?.kind;
  checks.push({
    id: 'TC-07',
    label: '推进回合 t=220 可提交动作，不投放新上报，已可见线索不变',
    pass: batch220 === 0 && deliveredBefore === deliveredAfter && deliveredAfter === 10 && stamp220 === 220 && kind220 === 'advance',
    measured: `新增 ${batch220} 条 · 已投放 ${deliveredBefore}→${deliveredAfter} · 提交 stamp=${stamp220 ?? '—'} · 回合类型=${kind220 ?? '—'}`,
  });

  // TC-01/02：1× 与 4× 响应同为 45 模拟秒；速度切换不改账本
  const clockChecks = fixture.clock_checks;
  const expectedSet = new Set(clockChecks.map((c) => c.expected_response_seconds));
  const skEnd = port.replayTo(baseRunId, { t_sim: fixture.scenario.t_end });
  const firstAccepted = skEnd?.actions.find((a) => a.status === 'accepted' && a.completed_at_sim !== null);
  const firstReport = fixture.ugc_reports.reduce((min, r) => (r.appears_at_sim < min.appears_at_sim ? r : min));
  const computedResponse =
    firstAccepted && firstAccepted.completed_at_sim !== null
      ? firstAccepted.completed_at_sim - firstReport.appears_at_sim
      : null;
  const eventsBeforeSpeed = JSON.stringify(d.currentEvents.value);
  for (const s of d.speeds) d.speed.value = s;
  const eventsAfterSpeed = JSON.stringify(d.currentEvents.value);
  const expectedValue = [...expectedSet][0];
  checks.push({
    id: 'TC-01/02',
    label: '甲 1× 与 4× 响应均 45 模拟秒；速度只记录，不复制流水',
    pass:
      expectedSet.size === 1 &&
      expectedValue === 45 &&
      computedResponse === expectedValue &&
      clockChecks.length === d.speeds.length &&
      eventsBeforeSpeed === eventsAfterSpeed,
    measured: `clock_checks=[${clockChecks.map((c) => `${c.playback_speed}×:${c.expected_response_seconds}s`).join(', ')}] · 骨架推算 ${computedResponse ?? '—'}s · 变速前后账本一致=${eventsBeforeSpeed === eventsAfterSpeed}`,
  });
  d.speed.value = d.speeds[0] ?? 1;

  // VS-01 / VS-04：t=60 仅 U1/U2/U3；t_end 十条全可见
  const vis60 = port.visibleReportsAt(60).map((r) => r.id);
  const vis60Set = new Set(vis60);
  const visEnd = port.visibleReportsAt(fixture.scenario.t_end);
  checks.push({
    id: 'VS-01/04',
    label: 't=60 只见 U1/U2/U3；末回合十条全可见',
    pass: vis60.length === 3 && vis60Set.has('U1') && vis60Set.has('U2') && vis60Set.has('U3') && visEnd.length === 10,
    measured: `t=60 [${vis60.join(', ')}] · t=${fixture.scenario.t_end} 共 ${visEnd.length} 条`,
  });

  // stamp 纯度：账本所有时刻 ∈ 节点集合
  const allStamps = d.entries.value.map((entry) =>
    entry.kind === 'action-pending' ? entry.submission.submitted_at_sim : entry.event.t_sim,
  );
  checks.push({
    id: 'FR-4.7',
    label: '账本全部操作时刻 ∈ scenario.nodes 节点集合',
    pass: allStamps.every((s) => nodeTimes.includes(s)),
    measured: `stamps=[${allStamps.join(', ')}] ⊆ nodes=[${nodeTimes.join(', ')}]`,
  });

  // RE-01～05 渲染侧（构造）：引擎桩返回 rejected，B 留痕 status/code/reason/attempt 并渲染拒绝原因。
  drillRejectProbe.resetDrill();
  const rejEntry = drillRejectProbe.submitAction('A4', fixture.scenario.start_building_id);
  const rejPayload = rejEntry && rejEntry.kind === 'action-confirmed' ? rejEntry.event.payload : null;
  const rejRendered = rejPayload
    ? rejPayload.status === 'accepted'
      ? `已通过 · 完成 @${rejPayload.completed_at_sim}`
      : `已拒绝 · ${rejPayload.reject_reason_code ?? ''} ${rejPayload.reject_reason ?? ''}`
    : '';
  checks.push({
    id: 'RE-渲染侧',
    label: '构造引擎桩返回 rejected：B 留痕 status/code/reason/attempt，账本渲染拒绝原因（非临场引擎）',
    pass:
      rejPayload !== null &&
      rejPayload.status === 'rejected' &&
      rejPayload.reject_reason_code === 'PRECONDITION_NOT_MET' &&
      rejPayload.attempt === 1 &&
      rejRendered.includes('PRECONDITION_NOT_MET') &&
      rejRendered.includes('需同楼 A3 已完成') &&
      drillRejectProbe.currentEvents.value.some((e) => e.kind === 'action'),
    measured: rejPayload
      ? `status=${rejPayload.status} · code=${rejPayload.reject_reason_code} · attempt=${rejPayload.attempt} · 渲染「${rejRendered}」`
      : '引擎桩无返回',
  });
  drillRejectProbe.resetDrill();

  timingChecks.value = checks;
  timingRunning.value = false;
}
</script>

<template>
  <div class="diag-grid">
    <!-- 01 地图派生 -->
    <section class="panel" id="panel-map">
      <header class="panel-head">
        <span class="panel-no">01</span>
        <h2>地图派生<code>port.map</code></h2>
        <span class="panel-sub">构造时预派生 · 只读</span>
      </header>
      <div class="panel-body">
        <div class="kv-row">
          <div class="kv">
            <span class="kv-k">view_box_svg</span>
            <span class="kv-v mono" id="meta-viewbox">{{ map.view_box_svg }}</span>
          </div>
          <div class="kv">
            <span class="kv-k">楼栋 / 路口 / 路段</span>
            <span class="kv-v mono" id="meta-counts">
              {{ map.buildings.length }} / {{ map.junctions.length }} / {{ map.road_segments.length }}
            </span>
          </div>
        </div>
        <h3>bounds</h3>
        <div class="kv-row" id="meta-bounds">
          <div class="kv" v-for="(value, key) in map.bounds" :key="key">
            <span class="kv-k">{{ key }}</span>
            <span class="kv-v mono">{{ value }}</span>
          </div>
        </div>
        <h3>路口位置（由路段几何派生）</h3>
        <div class="table-wrap">
          <table class="data" id="junction-pos-table">
            <thead>
              <tr><th>id</th><th>名称</th><th>kind</th><th>x</th><th>y</th></tr>
            </thead>
            <tbody>
              <tr v-for="junction in map.junctions" :key="junction.id">
                <td class="num">{{ junction.id }}</td>
                <td>{{ junction.name }}</td>
                <td class="num">{{ junction.kind }}</td>
                <td class="num">{{ junctionPos(junction.id)?.x ?? '—' }}</td>
                <td class="num">{{ junctionPos(junction.id)?.y ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <h3>路段折线长度（px）</h3>
        <div class="table-wrap">
          <table class="data" id="road-len-table">
            <thead>
              <tr><th>id</th><th>名称</th><th>from → to</th><th>length_px</th><th>&gt;0</th></tr>
            </thead>
            <tbody>
              <tr v-for="road in map.road_segments" :key="road.id">
                <td class="num">{{ road.id }}</td>
                <td class="wrap">{{ road.name }}</td>
                <td class="num">{{ road.from }} → {{ road.to }}</td>
                <td class="num">{{ roadLength(road.id)?.toFixed(2) ?? '—' }}</td>
                <td>
                  <span
                    class="badge badge-sm"
                    :class="(roadLength(road.id) ?? 0) > 0 ? 'badge-green' : 'badge-red'"
                  >{{ (roadLength(road.id) ?? 0) > 0 ? '通过' : '异常' }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- 02 可见性与判断窗 -->
    <section class="panel" id="panel-vis">
      <header class="panel-head">
        <span class="panel-no">02</span>
        <h2>可见性与判断窗<code>visibleReportsAt / windowAt</code></h2>
        <span class="panel-sub">左闭右开 · 未到线索不可见</span>
      </header>
      <div class="panel-body">
        <div class="controls">
          <div class="slider-block">
            <div class="slider-row">
              <span class="control-label">t_sim 节点</span>
              <input
                type="range"
                v-model.number="nodeIndex"
                :min="0"
                :max="nodes.length - 1"
                :step="1"
                aria-label="模拟时刻节点滑块"
              />
              <span class="slider-value" id="vis-t">{{ t }}</span>
            </div>
            <div class="node-chips">
              <button
                v-for="(node, index) in nodes"
                :key="node.id"
                type="button"
                class="chip"
                :class="{ active: index === nodeIndex }"
                @click="nodeIndex = index"
              >{{ node.t_sim }}</button>
            </div>
          </div>
        </div>
        <p class="note" v-if="currentNode">当前节点：{{ currentNode.label }}</p>
        <p class="note">可见上报（<span class="mono" id="vis-count">{{ visibleRows.length }}</span> 条）：<span class="mono" id="vis-ids">{{ visibleIds || '无' }}</span></p>
        <div class="table-wrap">
          <table class="data" id="vis-table">
            <thead>
              <tr><th>id</th><th>出现</th><th>上报文本</th><th>当时应判</th><th>窗口</th></tr>
            </thead>
            <tbody>
              <tr v-for="row in visibleRows" :key="row.report.id">
                <td class="num">
                  {{ row.report.id }}
                  <span v-if="row.report.is_training === 1" class="badge badge-red badge-sm">训练模拟数据</span>
                </td>
                <td class="num">{{ row.report.appears_at_sim }}</td>
                <td class="wrap">{{ row.report.text }}</td>
                <td>
                  <span v-if="row.window" class="badge badge-sm" :class="verdictClass(row.window.expected)">
                    {{ row.window.expected }}
                  </span>
                  <span v-else class="badge badge-muted badge-sm">无窗口</span>
                </td>
                <td class="num" v-if="row.window">[{{ row.window.from_sim }}, {{ row.window.to_sim ?? '∞' }})</td>
                <td v-else>—</td>
              </tr>
              <tr v-if="!visibleRows.length"><td colspan="5">该时刻暂无可见上报</td></tr>
            </tbody>
          </table>
        </div>
        <h3>判断窗边界探针（任意时刻）</h3>
        <div class="controls">
          <label class="control">
            <span class="control-label">上报</span>
            <select v-model="probeReportId" aria-label="探针上报选择">
              <option v-for="report in fixture.ugc_reports" :key="report.id" :value="report.id">
                {{ report.id }}（出现于 {{ report.appears_at_sim }}）
              </option>
            </select>
          </label>
          <label class="control">
            <span class="control-label">t =</span>
            <input type="number" v-model.number="probeT" aria-label="探针时刻" />
          </label>
        </div>
        <div id="probe-expected">
          <template v-if="probeWindow">
            <span class="badge" :class="verdictClass(probeWindow.expected)">{{ probeWindow.expected }}</span>
            <span class="note mono">
              窗口 [{{ probeWindow.from_sim }}, {{ probeWindow.to_sim ?? '∞' }}) · {{ probeWindow.reason }}
            </span>
          </template>
          <span v-else class="badge badge-muted">null（上报未出现或无适用窗口）</span>
        </div>
      </div>
    </section>

    <!-- 03 只读回放 -->
    <section class="panel span-2" id="panel-replay">
      <header class="panel-head">
        <span class="panel-no">03</span>
        <h2>只读回放<code>replayTo(runId, { seq?, t_sim? })</code></h2>
        <span class="panel-sub">状态全部由 A 推导 · B 只消费</span>
      </header>
      <div class="panel-body">
        <div class="controls">
          <label class="control">
            <span class="control-label">流水</span>
            <select v-model="runId" aria-label="回放流水选择">
              <option v-for="run in runs" :key="run.run_id" :value="run.run_id">
                {{ run.run_id }} · {{ run.branch }} · {{ run.playback_speed }}×
              </option>
            </select>
          </label>
          <div class="slider-block">
            <div class="slider-row">
              <label class="control" style="min-height: 0">
                <input type="checkbox" v-model="useSeqCut" aria-label="启用 seq 上界" />
                <span class="control-label">seq 上界</span>
              </label>
              <input
                type="range"
                v-model.number="seqCut"
                :min="0"
                :max="maxSeq"
                :step="1"
                :disabled="!useSeqCut"
                aria-label="回放序号截断滑块"
              />
              <span class="slider-value" id="seq-cut">{{ useSeqCut ? seqCut : '—' }}</span>
            </div>
          </div>
          <label class="control">
            <input type="checkbox" v-model="useTCut" />
            <span class="control-label">t_sim 上界</span>
            <input type="number" v-model.number="tCut" :disabled="!useTCut" aria-label="回放时刻截断" />
          </label>
          <button type="button" class="btn" @click="resetAll">重置控制台</button>
        </div>

        <div v-if="replayError" class="alert-error" id="replay-error">
          <span class="err-code">{{ replayError.code }}</span> · object_id=<span>{{ replayError.object_id }}</span>
          <div>{{ replayError.message }}</div>
        </div>

        <template v-if="snapshot">
          <div class="kv-row">
            <div class="kv"><span class="kv-k">branch</span><span class="kv-v" id="replay-branch">{{ snapshot.branch }}</span></div>
            <div class="kv"><span class="kv-k">playback_speed</span><span class="kv-v mono">{{ snapshot.playback_speed }}×</span></div>
            <div class="kv"><span class="kv-k">快照 t_sim</span><span class="kv-v big mono" id="replay-t">{{ snapshot.t_sim }}</span></div>
            <div class="kv">
              <span class="kv-k">cut（requested → applied）</span>
              <span class="kv-v mono" style="font-size: 12px">
                seq {{ snapshot.cut.requested_seq ?? '—' }} / t {{ snapshot.cut.requested_t_sim ?? '—' }} → {{ snapshot.cut.applied_t_sim }}
              </span>
            </div>
            <div class="kv">
              <span class="kv-k">accepted / rejected / 占用</span>
              <span class="kv-v mono" id="replay-counts">{{ acceptedCount }} / {{ rejectedCount }} / {{ snapshot.resource_occupancy.length }}</span>
            </div>
          </div>

          <h3>最新判定 latest_verdicts（改判保留 supersedes_seq）</h3>
          <div class="table-wrap">
            <table class="data" id="verdict-table">
              <thead>
                <tr><th>seq</th><th>上报</th><th>判定</th><th>judged_at_sim</th><th>定位</th><th>supersedes_seq</th></tr>
              </thead>
              <tbody>
                <tr v-for="verdict in snapshot.latest_verdicts" :key="verdict.seq">
                  <td class="num">{{ verdict.seq }}</td>
                  <td class="num">{{ verdict.report_id }}</td>
                  <td><span class="badge badge-sm" :class="verdictClass(verdict.verdict)">{{ verdict.verdict }}</span></td>
                  <td class="num">{{ verdict.judged_at_sim }}</td>
                  <td class="num">{{ verdict.location ?? '—' }}</td>
                  <td class="num">{{ verdict.supersedes_seq ?? '首判' }}</td>
                </tr>
                <tr v-if="!snapshot.latest_verdicts.length"><td colspan="6">截断内暂无判定</td></tr>
              </tbody>
            </table>
          </div>

          <h3>动作尝试 actions（attempt / 拒绝码 / 原因）</h3>
          <div class="table-wrap">
            <table class="data" id="action-table">
              <thead>
                <tr>
                  <th>seq</th><th>attempt</th><th>动作</th><th>对象</th>
                  <th>提交</th><th>duration</th><th>完成</th><th>状态</th><th>拒绝码 / 原因</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="action in snapshot.actions" :key="action.seq">
                  <td class="num">{{ action.seq }}</td>
                  <td class="num">{{ action.attempt }}</td>
                  <td class="num">{{ action.action_id }}</td>
                  <td class="num">{{ action.target_id }}</td>
                  <td class="num">{{ action.submitted_at_sim }}</td>
                  <td class="num">{{ action.duration_sim }}</td>
                  <td class="num">{{ action.completed_at_sim ?? '—' }}</td>
                  <td>
                    <span class="badge badge-sm" :class="action.status === 'accepted' ? 'badge-green' : 'badge-red'">
                      {{ action.status }}
                    </span>
                  </td>
                  <td class="wrap">
                    <template v-if="action.reject_reason_code">
                      <span class="mono">{{ action.reject_reason_code }}</span> · {{ action.reject_reason }}
                    </template>
                    <template v-else>—</template>
                  </td>
                </tr>
                <tr v-if="!snapshot.actions.length"><td colspan="9">截断内暂无动作</td></tr>
              </tbody>
            </table>
          </div>

          <h3>资源占用 resource_occupancy / 快照时刻仍占用 active</h3>
          <div class="table-wrap">
            <table class="data" id="occ-table">
              <thead>
                <tr><th>资源</th><th>units</th><th>action_seq</th><th>from_sim</th><th>to_sim</th><th>快照时刻仍占用</th></tr>
              </thead>
              <tbody>
                <tr v-for="usage in snapshot.resource_occupancy" :key="usage.action_seq">
                  <td class="num">{{ usage.resource_id }}</td>
                  <td class="num">{{ usage.units }}</td>
                  <td class="num">{{ usage.action_seq }}</td>
                  <td class="num">{{ usage.from_sim }}</td>
                  <td class="num">{{ usage.to_sim ?? '—' }}</td>
                  <td>
                    <span
                      class="badge badge-sm"
                      :class="snapshot.active_resource_occupancy.some((active) => active.action_seq === usage.action_seq) ? 'badge-amber' : 'badge-muted'"
                    >
                      {{ snapshot.active_resource_occupancy.some((active) => active.action_seq === usage.action_seq) ? '占用中' : '已释放' }}
                    </span>
                  </td>
                </tr>
                <tr v-if="!snapshot.resource_occupancy.length"><td colspan="6">截断内暂无占用</td></tr>
              </tbody>
            </table>
          </div>
          <p class="note">
            active_resource_occupancy（<span class="mono" id="active-occ-count">{{ snapshot.active_resource_occupancy.length }}</span> 条）：
            <span class="mono">
              {{ snapshot.active_resource_occupancy.map((usage) => `${usage.resource_id}@seq${usage.action_seq}`).join('、') || '无' }}
            </span>
          </p>

          <h3>道路双状态 roads（自然灾情 ≠ 正式封闭，两组字段分开）</h3>
          <div class="table-wrap">
            <table class="data" id="roads-table">
              <thead>
                <tr>
                  <th rowspan="2">路段</th>
                  <th colspan="3" class="th-blue">自然灾情</th>
                  <th colspan="4" class="th-red">正式封闭</th>
                </tr>
                <tr>
                  <th class="th-blue">hazard</th><th class="th-blue">hazard_at_sim</th><th class="th-blue">描述</th>
                  <th class="th-red">formally_closed</th><th class="th-red">closed_at_sim</th><th class="th-red">closed_by_action_seq</th><th class="th-red">block_reason</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="road in snapshot.roads" :key="road.road_id">
                  <td class="num">{{ road.road_id }}<div class="note" style="margin: 0">{{ road.name }}</div></td>
                  <td class="cell-blue">
                    <span v-if="road.hazard" class="badge badge-blue badge-sm">{{ hazardLabel(road.hazard) }}</span>
                    <span v-else class="badge badge-muted badge-sm">无</span>
                  </td>
                  <td class="num cell-blue">{{ road.hazard_at_sim ?? '—' }}</td>
                  <td class="wrap cell-blue">{{ road.hazard_description ?? '—' }}</td>
                  <td class="cell-red">
                    <span class="badge badge-sm" :class="road.formally_closed ? 'badge-red' : 'badge-green'">
                      {{ road.formally_closed ? '已封闭' : '未封闭' }}
                    </span>
                  </td>
                  <td class="num cell-red">{{ road.closed_at_sim ?? '—' }}</td>
                  <td class="num cell-red">{{ road.closed_by_action_seq ?? '—' }}</td>
                  <td class="wrap cell-red">{{ road.block_reason ?? '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <p class="note" v-if="snapshot.sorting">
            末回合排序：seq {{ snapshot.sorting.seq }} @ t={{ snapshot.sorting.t_sim }} ·
            <span class="mono">{{ snapshot.sorting.ordered_report_ids.join(' → ') }}</span>
          </p>
          <p class="note">场景事件 scenario_events：{{ snapshot.scenario_events.length }} 条 · 学员事件 events：{{ snapshot.events.length }} 条</p>
        </template>
      </div>
    </section>

    <!-- 04 评分对照 -->
    <section class="panel span-2" id="panel-score">
      <header class="panel-head">
        <span class="panel-no">04</span>
        <h2>静态评分对照<code>getScore</code></h2>
        <span class="panel-sub">偏离基线 → null → 待接入常量 · 不回退 expected_scores</span>
      </header>
      <div class="panel-body">
        <div class="kv-row">
          <div class="score-card">
            <div class="score-card-title">原始示例（明确载入，仅此场景省略第二参数）</div>
            <div class="score-card-call">getScore('{{ runId }}')</div>
            <template v-if="baselineScore">
              <div class="score-total ok" id="score-baseline-total">{{ baselineScore.total }}</div>
              <div class="score-metrics">
                <span><span class="m-k">甄别 </span><span class="m-v">{{ baselineScore.discrimination }}</span></span>
                <span><span class="m-k">响应 </span><span class="m-v">{{ baselineScore.response }}</span></span>
                <span><span class="m-k">命中 </span><span class="m-v">{{ baselineScore.coverage }}</span></span>
                <span><span class="m-k">违规 </span><span class="m-v">{{ baselineScore.violation }}</span></span>
              </div>
              <div class="score-detail">
                响应时长 <span class="mono">{{ baselineScore.details.response_seconds ?? '—' }}</span> 模拟秒 ·
                违规明细 details.violation_event_seqs =
                <span class="mono" id="violation-seqs">[{{ baselineScore.details.violation_event_seqs.join(', ') }}]</span>
                <div>误判上报：<span class="mono">{{ baselineScore.details.wrong_report_ids.join('、') || '无' }}</span></div>
                <div>缺项：<span class="mono">{{ baselineScore.details.missed_items.map((item) => item.label).join('、') || '无' }}</span></div>
              </div>
            </template>
            <div v-else class="score-total pending">null</div>
          </div>

          <div class="score-card">
            <div class="score-card-title">交互路径（传入当前回放流水{{ useSeqCut ? ` seq≤${seqCut}` : '' }}{{ useTCut ? ` t≤${tCut}` : '' }}）</div>
            <div class="score-card-call">getScore('{{ runId }}', snapshot.events)</div>
            <template v-if="interactiveScore">
              <div class="score-total ok" id="score-interactive">{{ interactiveScore.total }}</div>
              <p class="note">当前流水与基线完全一致（canonical JSON 匹配）。</p>
            </template>
            <div v-else class="empty-state" id="score-interactive">
              <span>null →</span><strong>{{ SCORE_PENDING_TEXT }}</strong>
            </div>
          </div>

          <div class="score-card">
            <div class="score-card-title">改动流水（删减末条事件）</div>
            <div class="score-card-call">getScore('{{ runId }}', events.slice(0, -1))</div>
            <template v-if="modifiedScore">
              <div class="score-total ok" id="score-modified">{{ modifiedScore.total }}</div>
            </template>
            <div v-else class="empty-state" id="score-modified">
              <span>null →</span><strong>{{ SCORE_PENDING_TEXT }}</strong>
            </div>
          </div>
        </div>
        <p class="note">T2 为静态接入：此处只证明接口契约（基线匹配 / 偏离返回 null），未验证 D4 实时评分。</p>
      </div>
    </section>

    <!-- 05 路径查询与空态 -->
    <section class="panel" id="panel-route">
      <header class="panel-head">
        <span class="panel-no">05</span>
        <h2>路径查询<code>getRoute</code></h2>
        <span class="panel-sub">D2 寻路 · 使用回放道路快照</span>
      </header>
      <div class="panel-body">
        <div class="controls route-controls">
          <label class="control">
            <span class="control-label">起点</span>
            <select v-model="routeFrom" id="diag-route-from" aria-label="诊断路径起点">
              <option v-for="opt in endpoints" :key="opt.id" :value="opt.id">{{ opt.name }}（{{ opt.note }}）</option>
            </select>
          </label>
          <label class="control">
            <span class="control-label">终点</span>
            <select v-model="routeTo" id="diag-route-to" aria-label="诊断路径终点">
              <option value="">未选择</option>
              <option v-for="opt in endpoints" :key="opt.id" :value="opt.id">{{ opt.name }}（{{ opt.note }}）</option>
            </select>
          </label>
        </div>
        <div v-if="routeDegenerate" class="alert-error" id="diag-route-degenerate">起点与终点相同，已禁用查询。</div>
        <template v-if="routeQuery">
          <p class="note mono" id="diag-route-query">
            query: {{ routeQuery.from_node_id }} → {{ routeQuery.to_node_id }} @ t={{ routeQuery.at_sim }}（状态取自 03 回放快照）
          </p>
          <h3>传入的路网状态（blocked 与 hazard 分开，不合并布尔）</h3>
          <div class="table-wrap">
            <table class="data" id="diag-route-segs">
              <thead>
                <tr><th>road_id</th><th>blocked（正式封闭）</th><th>hazard（自然灾情）</th></tr>
              </thead>
              <tbody>
                <tr v-for="seg in routeQuery.road_segments ?? []" :key="seg.id">
                  <td class="num">{{ seg.id }}</td>
                  <td>
                    <span class="badge badge-sm" :class="seg.blocked ? 'badge-red' : 'badge-muted'">{{ seg.blocked ? 'true' : 'false' }}</span>
                  </td>
                  <td>
                    <span class="badge badge-sm" :class="seg.hazard !== null ? 'badge-blue' : 'badge-muted'">{{ hazardLabel(seg.hazard) }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
        <RoutePanel technical :route="routeResult" :query="routeQuery" :map="map" :roads="snapshot?.roads ?? []" />
        <p class="note">此处使用 D2 寻路引擎。积水等灾情出现时立即绕行，正式封闭仍单独记录。</p>
      </div>
    </section>

    <!-- 06 错误演示 -->
    <section class="panel" id="panel-error">
      <header class="panel-head">
        <span class="panel-no">06</span>
        <h2>错误演示<code>FixturePortError</code></h2>
        <span class="panel-sub">code + object_id 不吞异常</span>
      </header>
      <div class="panel-body">
        <div class="controls">
          <button type="button" class="btn btn-danger" @click="triggerError('seq')">故意触发：seq = -1</button>
          <button type="button" class="btn btn-danger" @click="triggerError('t_sim')">故意触发：t_sim = -5</button>
        </div>
        <div v-if="demoError" class="alert-error" id="demo-error">
          <div>code = <span class="err-code">{{ demoError.code }}</span></div>
          <div>object_id = <span class="mono">{{ demoError.object_id }}</span></div>
          <div>message = {{ demoError.message }}</div>
        </div>
        <p v-else class="note">点击按钮触发非法截断，页面展示错误码与对象 id。</p>
      </div>
    </section>

    <!-- 07 倍速对照 -->
    <section class="panel span-2" id="panel-speed">
      <header class="panel-head">
        <span class="panel-no">07</span>
        <h2>倍速无关性对照<code>1× / 4×</code></h2>
        <span class="panel-sub">倍速只压缩真实等待 · t_sim 序列不变</span>
      </header>
      <div class="panel-body">
        <div class="controls">
          <label class="control">
            <span class="control-label">流水</span>
            <select v-model="speedRunId" aria-label="倍速对照流水选择">
              <option v-for="run in runs" :key="run.run_id" :value="run.run_id">{{ run.run_id }} · {{ run.branch }}</option>
            </select>
          </label>
          <button type="button" class="btn btn-primary" :disabled="playing" @click="playComparison">
            {{ playing ? '播放中…' : '同时播放对照' }}
          </button>
        </div>
        <div class="lanes">
          <div class="lane" v-for="(lane, index) in lanes" :key="lane.speed">
            <div class="lane-head">
              <span class="lane-speed">{{ lane.speed }}×</span>
              <span class="badge badge-muted badge-sm">{{ lane.done ? '完成' : playing ? '播放中' : '待播放' }}</span>
              <span class="lane-t" :id="`lane-t-${index}`">t={{ lane.currentT ?? '—' }}</span>
            </div>
            <div class="lane-track">
              <span
                v-for="(step, stepIndex) in lane.sequence"
                :key="stepIndex"
                class="lane-dot lit"
                :title="`t=${step}`"
              ></span>
              <span v-if="!lane.sequence.length" class="note" style="margin: 0">尚未开始</span>
            </div>
            <div class="lane-meta">
              真实耗时 {{ lane.elapsedMs === null ? '—' : `${lane.elapsedMs} ms` }} · 步进 {{ lane.sequence.length }} 个 t_sim
            </div>
          </div>
        </div>
        <p class="note" id="speed-result">
          <template v-if="speedSequenceEqual === null">播放后此处显示两轨 t_sim 序列是否完全一致。</template>
          <template v-else>
            两轨 t_sim 序列{{ speedSequenceEqual ? '完全一致' : '不一致（异常）' }}（{{ speedStepCount }} 步）·
            基线响应时长 <span class="mono">{{ speedResponseSeconds ?? '—' }}</span> 模拟秒（与倍速无关）
          </template>
        </p>
        <h3>fixture.clock_checks（A 的模拟时钟基准）</h3>
        <div class="table-wrap">
          <table class="data" id="clock-table">
            <thead>
              <tr><th>label</th><th>run_id</th><th>playback_speed</th><th>expected_response_seconds</th></tr>
            </thead>
            <tbody>
              <tr v-for="check in fixture.clock_checks" :key="check.label">
                <td class="wrap">{{ check.label }}</td>
                <td class="num">{{ check.run_id }}</td>
                <td class="num">{{ check.playback_speed }}×</td>
                <td class="num">{{ check.expected_response_seconds }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- 08 构造路径渲染验证 -->
    <section class="panel span-2" id="panel-route-constructed">
      <header class="panel-head">
        <span class="panel-no">08</span>
        <h2>路径渲染分支验证<code>RouteResult</code></h2>
        <span class="panel-sub"><span class="badge badge-amber badge-sm">构造输入 · 非寻路结果</span></span>
      </header>
      <div class="panel-body">
        <p class="note">
          此处用显式测试链（{{ CONSTRUCTED_CHAIN.join(' → ') }}）检验渲染分支。真实寻路见面板 05。
        </p>
        <div class="controls">
          <button type="button" class="btn" :class="{ 'btn-primary': constructedMode === 'ready' }" :aria-pressed="constructedMode === 'ready'" @click="constructedMode = 'ready'">构造 ready</button>
          <button type="button" class="btn" :class="{ 'btn-primary': constructedMode === 'unreachable' }" :aria-pressed="constructedMode === 'unreachable'" @click="constructedMode = 'unreachable'">构造 unreachable</button>
          <button type="button" class="btn" :class="{ 'btn-primary': constructedMode === 'none' }" :aria-pressed="constructedMode === 'none'" @click="constructedMode = 'none'">null（待接入）</button>
        </div>
        <div class="diag-map" id="constructed-map">
          <CampusMap :map="map" :roads="snapshot?.roads ?? []" :route="constructedRoute" />
        </div>
        <RoutePanel technical :route="constructedRoute" :query="constructedQuery" :map="map" :roads="snapshot?.roads ?? []" />
      </div>
    </section>

    <!-- 09 CD-04 程序化 20 栋 -->
    <section class="panel span-2" id="panel-cd04">
      <header class="panel-head">
        <span class="panel-no">09</span>
        <h2>CD-04 · 20 栋零改动渲染<code>buildMapView</code></h2>
        <span class="panel-sub"><span class="badge badge-amber badge-sm">程序化合成数据 · 非真实校园</span></span>
      </header>
      <div class="panel-body">
        <div class="kv-row">
          <div class="kv"><span class="kv-k">楼栋 / 路口 / 路段</span><span class="kv-v mono" id="syn-counts">{{ syntheticMap.buildings.length }} / {{ syntheticMap.junctions.length }} / {{ syntheticMap.road_segments.length }}</span></div>
          <div class="kv"><span class="kv-k">派生 viewBox</span><span class="kv-v mono" id="syn-viewbox">{{ syntheticMap.view_box_svg }}</span></div>
          <div class="kv"><span class="kv-k">渲染组件</span><span class="kv-v mono">同一 CampusMap.vue · 零改动</span></div>
        </div>
        <div class="diag-map" id="syn-map">
          <CampusMap :map="syntheticMap" :roads="[]" :selected="synSelected" @select="synToggle" @clear="synSelected = null" />
        </div>
        <p class="note">
          数据为程序化生成的 20 栋 + 3 路口栅格路网，仅验证界面不含硬编码 id / 名称 / 坐标 / viewBox；
          该面板保留合成数据回归用例。正式训练地图可在地图页查看。
        </p>
      </div>
    </section>

    <!-- 10 候选集合分离 -->
    <section class="panel" id="panel-candidates">
      <header class="panel-head">
        <span class="panel-no">10</span>
        <h2>候选集合分离<code>JW-09</code></h2>
        <span class="panel-sub">定位 ≠ 路径端点</span>
      </header>
      <div class="panel-body">
        <div class="kv-row">
          <div class="kv">
            <span class="kv-k">上报定位候选（楼栋 + 无法定位）</span>
            <span class="kv-v mono" id="loc-candidates">{{ locationCandidates.map((o) => o.id).join(' / ') }}</span>
          </div>
          <div class="kv">
            <span class="kv-k">路径端点候选（楼栋 + 路口）</span>
            <span class="kv-v mono" id="endpoint-candidates">{{ endpoints.map((o) => `${o.id}(${o.note})`).join(' / ') }}</span>
          </div>
        </div>
        <p class="note">
          定位候选混入路段 / 路口：
          <span class="badge badge-sm" :class="locationLeak.length ? 'badge-red' : 'badge-green'" id="loc-leak">
            {{ locationLeak.length ? `异常：${locationLeak.join('、')}` : '无（JW-09 通过）' }}
          </span>
          「无法定位」选项：
          <span class="badge badge-sm" :class="hasUnlocatable ? 'badge-green' : 'badge-red'" id="loc-unlocatable">
            {{ hasUnlocatable ? '存在' : '缺失' }}
          </span>
        </p>
        <p class="note">路口可点选查看连接路段，但不进上报定位候选、不可作为动作对象；路段永不进定位候选。</p>
      </div>
    </section>

    <!-- 11 D3 时机不变量 -->
    <section class="panel span-2" id="panel-timing">
      <header class="panel-head">
        <span class="panel-no">11</span>
        <h2>D3 时机不变量断言</h2>
        <span class="badge badge-amber badge-sm">测试断言 · 非临场引擎</span>
        <span class="panel-sub">TC-01～07 · VS-01/04 · FR-4.7</span>
      </header>
      <div class="panel-body">
        <div class="controls">
          <button type="button" class="btn btn-primary" id="run-timing" :disabled="timingRunning" @click="runTimingChecks">
            {{ timingRunning ? '断言运行中…' : '运行时机断言' }}
          </button>
          <span class="note">对独立回合状态机实例执行；动作合法性待 A 引擎，断言中动作状态为「待引擎接入」占位。</span>
        </div>
        <div v-if="timingChecks.length" class="table-wrap">
          <table class="data" id="timing-table">
            <thead>
              <tr><th>用例</th><th>断言</th><th>结果</th><th>实测值</th></tr>
            </thead>
            <tbody>
              <tr v-for="check in timingChecks" :key="check.id">
                <td class="num">{{ check.id }}</td>
                <td class="wrap">{{ check.label }}</td>
                <td>
                  <span class="badge badge-sm" :class="check.pass ? 'badge-green' : 'badge-red'">
                    {{ check.pass ? '通过' : '失败' }}
                  </span>
                </td>
                <td class="wrap mono">{{ check.measured }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="note">尚未运行。断言时刻字面量来自 requirements §5.2 与 quality TC/VS 用例（测试断言值）；实现代码不写死节点时刻。</p>
      </div>
    </section>
  </div>
</template>
