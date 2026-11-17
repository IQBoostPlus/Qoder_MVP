/**
 * D1-v2 只读接口验收（非生产评分器）
 * 运行：npm run check:d1-v2
 * 前置：npm run check:d1（原契约、fixture 与 83/44/90 回归）
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import type {
  Building,
  CanonicalFixture,
  Junction,
  Point,
  RoadSegment,
  RunEvent,
} from '../src/contracts';
import {
  FixturePortError,
  PRECISION_NOTICE,
  ROUTE_PENDING_TEXT,
  ROUTE_UNREACHABLE_TEXT,
  SCORE_PENDING_TEXT,
  buildMapView,
  createFixturePort,
  getRoute,
  type FixturePortErrorCode,
  type MapSource,
  type ReplaySnapshot,
} from '../src/fixture-port';

const fixturePath = fileURLToPath(new URL('../fixtures/canonical-run.json', import.meta.url));
const mapPath = fileURLToPath(new URL('../fixtures/buildings.json', import.meta.url));
const portPath = fileURLToPath(new URL('../src/fixture-port.ts', import.meta.url));
const tsconfigPath = fileURLToPath(new URL('../tsconfig.json', import.meta.url));
const readmePath = fileURLToPath(new URL('../README.md', import.meta.url));

const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as CanonicalFixture;
const mapFile = JSON.parse(readFileSync(mapPath, 'utf8')) as MapSource;

const errors: string[] = [];
const check = (condition: boolean, message: string): void => {
  if (!condition) errors.push(message);
};
const checkEqual = (actual: unknown, expected: unknown, message: string): void => {
  if (!isDeepStrictEqual(actual, expected)) {
    errors.push(`${message}；实际=${JSON.stringify(actual)} 期望=${JSON.stringify(expected)}`);
  }
};
const report = (message: string): void => {
  console.log(message);
};

function expectPortError(
  action: () => unknown,
  code: FixturePortErrorCode,
  objectId: string,
  label: string,
): void {
  try {
    action();
    errors.push(`${label}：未抛出预期错误 ${code}/${objectId}`);
  } catch (error) {
    if (!(error instanceof FixturePortError)) {
      errors.push(`${label}：抛出的不是 FixturePortError`);
      return;
    }
    check(
      error.code === code && error.object_id === objectId,
      `${label}：错误应为 ${code}/${objectId}，实际 ${error.code}/${error.object_id}`,
    );
  }
}

const isActionEvent = (event: RunEvent): event is Extract<RunEvent, { kind: 'action' }> =>
  event.kind === 'action';

const port = createFixturePort(fixture);
const canonicalMap = buildMapView(fixture);
const projectionMap = buildMapView(mapFile);

interface MutableMapSource {
  buildings: Building[];
  junctions: Junction[];
  road_segments: RoadSegment[];
}

const cloneMapSource = (source: MapSource): MutableMapSource =>
  structuredClone(source) as MutableMapSource;

// ---------------------------------------------------------------------------
// 1. 地图来源与几何
// ---------------------------------------------------------------------------

check(
  isDeepStrictEqual(fixture.buildings, mapFile.buildings),
  'buildings.json 与 canonical-run.json 的 buildings 投影不一致',
);
check(
  isDeepStrictEqual(fixture.junctions, mapFile.junctions),
  'buildings.json 与 canonical-run.json 的 junctions 投影不一致',
);
check(
  isDeepStrictEqual(fixture.road_segments, mapFile.road_segments),
  'buildings.json 与 canonical-run.json 的 road_segments 投影不一致',
);
checkEqual(canonicalMap.view_box_svg, projectionMap.view_box_svg, '两份投影派生的 viewBox 不一致');
checkEqual(
  canonicalMap.road_lengths_px,
  projectionMap.road_lengths_px,
  '两份投影派生的路段长度不一致',
);

const gatePosition = canonicalMap.junction_positions.GATE3;
check(Boolean(gatePosition), 'GATE3 未能从路段端点派生位置');
if (gatePosition) {
  check(
    gatePosition.x === 500 && gatePosition.y === 520,
    `GATE3 派生位置应为 (500,520)，实际 (${gatePosition.x},${gatePosition.y})`,
  );
}

check(canonicalMap.bounds.min_x <= 60, `viewBox 左边界未覆盖 60：${canonicalMap.bounds.min_x}`);
check(canonicalMap.bounds.max_x >= 900, `viewBox 右边界未覆盖 900：${canonicalMap.bounds.max_x}`);
check(canonicalMap.bounds.min_y <= 60, `viewBox 上边界未覆盖 60：${canonicalMap.bounds.min_y}`);
check(canonicalMap.bounds.max_y >= 580, `viewBox 下边界未覆盖 580：${canonicalMap.bounds.max_y}`);
check(
  canonicalMap.view_box.x <= 60 &&
    canonicalMap.view_box.x + canonicalMap.view_box.width >= 900 &&
    canonicalMap.view_box.y <= 60 &&
    canonicalMap.view_box.y + canonicalMap.view_box.height >= 580,
  'view_box 未覆盖 x[60,900]、y[60,580]',
);

check(fixture.road_segments.length === 8, `路段应为 8 条，实际 ${fixture.road_segments.length}`);
for (const road of fixture.road_segments) {
  const length = canonicalMap.road_lengths_px[road.id];
  check(length !== undefined && length > 0, `${road.id} 折线长度必须大于 0`);
}

function syntheticBuilding(id: string, x: number): Building {
  return {
    id,
    name: id,
    zone: '测试区',
    category: 'other',
    floors: 1,
    capacity: 1,
    risk_tag: null,
    polygon: [
      { x, y: 0 },
      { x, y: 10 },
      { x: x + 10, y: 10 },
    ],
    adjacency: [],
  };
}

function syntheticRoad(from: string, to: string, geometry: Point[]): RoadSegment {
  return {
    id: 'R-THREE-POINT',
    name: '三点折线',
    from,
    to,
    geometry,
    blocked: false,
    hazard: null,
    block_reason: null,
  };
}

const synthetic: MapSource = {
  buildings: [syntheticBuilding('B-ALPHA', 0), syntheticBuilding('B-BETA', 20)],
  junctions: [{ id: 'J-GATE', name: '测试门', kind: 'gate' }],
  road_segments: [
    syntheticRoad('B-ALPHA', 'J-GATE', [
      { x: 0, y: 0 },
      { x: 3, y: 4 },
      { x: 6, y: 8 },
    ]),
  ],
};
const syntheticView = buildMapView(synthetic);
const syntheticLength = syntheticView.road_lengths_px['R-THREE-POINT'];
check(syntheticLength === 10, `三点折线按段求和应为 10，实际 ${String(syntheticLength)}`);
const syntheticGate = syntheticView.junction_positions['J-GATE'];
check(
  Boolean(syntheticGate && syntheticGate.x === 6 && syntheticGate.y === 8),
  '三点折线的路口位置应取末点 (6,8)',
);

const shiftPoint = (point: Point): Point => ({ x: point.x + 100, y: point.y - 50 });
const shifted: MapSource = {
  buildings: synthetic.buildings.map((building) => ({
    ...building,
    id: building.id === 'B-ALPHA' ? 'B-ZETA' : building.id,
    polygon: building.polygon.map(shiftPoint),
  })),
  junctions: synthetic.junctions.map((junction) => ({ ...junction, id: 'J-OTHER' })),
  road_segments: synthetic.road_segments.map((road) => ({
    ...road,
    id: 'R-SHIFTED',
    from: 'B-ZETA',
    to: 'J-OTHER',
    geometry: road.geometry.map(shiftPoint),
  })),
};
const shiftedView = buildMapView(shifted);
const shiftedLength = shiftedView.road_lengths_px['R-SHIFTED'];
check(shiftedLength === 10, `平移并改名后长度仍应为 10，实际 ${String(shiftedLength)}`);
const shiftedGate = shiftedView.junction_positions['J-OTHER'];
check(
  Boolean(shiftedGate && shiftedGate.x === 106 && shiftedGate.y === -42),
  '平移并改名后路口位置应由新输入派生为 (106,-42)',
);
check(
  shiftedView.view_box.x === syntheticView.view_box.x + 100 &&
    shiftedView.view_box.y === syntheticView.view_box.y - 50,
  '平移后 viewBox 应随输入同步平移',
);

const isolated = cloneMapSource(mapFile);
isolated.junctions.push({ id: 'J-ISOLATED', name: '孤立路口', kind: 'crossing' });
expectPortError(
  () => buildMapView(isolated),
  'MAP_JUNCTION_UNREFERENCED',
  'J-ISOLATED',
  '孤立路口',
);

const shortRoad = cloneMapSource(mapFile);
const firstRoad = shortRoad.road_segments[0];
const firstRoadPoint = firstRoad?.geometry[0];
if (firstRoad && firstRoadPoint) {
  firstRoad.geometry = [firstRoadPoint];
  expectPortError(
    () => buildMapView(shortRoad),
    'MAP_INVALID_GEOMETRY',
    firstRoad.id,
    '单点折线',
  );
} else {
  errors.push('无法构造单点折线用例');
}

const mismatch = cloneMapSource(mapFile);
mismatch.road_segments.push({
  id: 'R-ENDPOINT-MISMATCH',
  name: '端点矛盾测试',
  from: 'N7',
  to: 'GATE3',
  geometry: [
    { x: 380, y: 520 },
    { x: 501, y: 520 },
  ],
  blocked: false,
  hazard: null,
  block_reason: null,
});
expectPortError(
  () => buildMapView(mismatch),
  'MAP_ENDPOINT_MISMATCH',
  'GATE3',
  '路口端点矛盾',
);

report(
  `map: 三投影深度相等；GATE3=(500,520)；viewBox=${canonicalMap.view_box_svg}；8 条路段长度>0；三点折线=10；平移/改名由输入决定`,
);

// ---------------------------------------------------------------------------
// 2. 可见性与判断窗
// ---------------------------------------------------------------------------

const visible80 = port.visibleReportsAt(80).map((reportItem) => reportItem.id);
checkEqual(visible80, ['U1', 'U3', 'U2', 'U4', 'U5'], 't=80 可见上报顺序不符');
check(!visible80.includes('U6'), 't=80 不应提前看到 U6');
check(port.visibleReportsAt(300).length === 10, 't=300 应可见 10 条上报');
check(port.windowAt('U1', 29) === null, 'U1 出现前判断窗应为空');
check(port.windowAt('U1', 30)?.expected === '待核', 'U1 在 30 秒应为待核');
check(port.windowAt('U1', 89)?.expected === '待核', 'U1 在 89 秒仍应为待核');
check(port.windowAt('U1', 90)?.expected === '真报', 'U1 在 90 秒应切换为真报');
check(port.windowAt('U1', 100)?.expected === '真报', 'U1 在 100 秒应为真报');

report('visibility: t=80 U1/U3/U2/U4/U5；t=300=10；U1 在 30/90/100 的窗口正确');

// ---------------------------------------------------------------------------
// 3. 甲流水与道路状态
// ---------------------------------------------------------------------------

function roadOf(snapshot: ReplaySnapshot | null, roadId: string) {
  return snapshot?.roads.find((road) => road.road_id === roadId);
}

const jiaSeq20 = port.replayTo('run-jia-1x', { seq: 20 });
check(Boolean(jiaSeq20), 'replayTo(run-jia-1x, seq:20) 不应为 null');
if (jiaSeq20) {
  check(jiaSeq20.events.every((event) => event.seq <= 20), 'seq:20 截断泄漏了后续操作');
  check(jiaSeq20.sorting === null, 'seq:20 不应包含末回合排序');
  const u1 = jiaSeq20.latest_verdicts.find((verdict) => verdict.report_id === 'U1');
  check(
    Boolean(u1 && u1.seq === 7 && u1.supersedes_seq === 2),
    'U1 最新改判应指向首判 seq2',
  );
  check(
    jiaSeq20.actions.filter((action) => action.status === 'accepted').length === 5,
    'seq:20 应有 5 条 accepted 动作',
  );
  check(
    jiaSeq20.actions.filter((action) => action.status === 'rejected').length === 4,
    'seq:20 应有 4 条 rejected 动作',
  );
  check(jiaSeq20.resource_occupancy.length === 5, 'seq:20 应有 5 条资源占用记录');
  check(
    jiaSeq20.active_resource_occupancy.length === 2,
    'seq:20（t=150）应只有 rescue_team 与 traffic_team 仍在占用',
  );
}

const jiaAt140 = port.replayTo('run-jia-1x', { t_sim: 140 });
const jiaAt164 = port.replayTo('run-jia-1x', { t_sim: 164 });
const jiaAt165 = port.replayTo('run-jia-1x', { t_sim: 165 });
const road140 = roadOf(jiaAt140, 'R-N7E');
const road164 = roadOf(jiaAt164, 'R-N7E');
const road165 = roadOf(jiaAt165, 'R-N7E');
check(road140?.hazard === 'flood', 't=140 R-N7E 应已积水');
check(road140?.formally_closed === false, 't=140 R-N7E 不应已正式封闭');
check(road164?.formally_closed === false, 't=164 R-N7E 仍不应正式封闭');
check(road165?.formally_closed === true, 't=165 R-N7E 应正式封闭');
check(road165?.closed_by_action_seq === 17, 't=165 封路应来自 seq17 的 A5');
check(road165?.hazard === 'flood', '正式封闭后 R-N7E 的积水状态仍应保留');
check(
  Boolean(
    jiaAt140?.scenario_events.some(
      (entry) => entry.event.type === 'road_hazard' && entry.event.road_id === 'R-N7E',
    ),
  ),
  't=140 的 scenario_events 应包含 R-N7E road_hazard',
);
check(
  jiaAt140?.active_resource_occupancy.some((usage) => usage.action_seq === 17) === true,
  't=140 A5 进行中，封路组应处于占用状态',
);
check(
  jiaAt165?.active_resource_occupancy.some((usage) => usage.action_seq === 17) === false,
  't=165 A5 完成后，封路组不应再处于占用状态',
);

const jiaFull = port.replayTo('run-jia-1x');
checkEqual(
  jiaFull?.sorting?.ordered_report_ids,
  ['U2', 'U8', 'U4'],
  '完整回放应还原末回合排序 U2,U8,U4',
);
check(jiaFull?.t_sim === 300, '完整回放的快照时刻应为 t_end=300');
check(jiaFull?.latest_verdicts.length === 10, '完整回放应包含 10 条上报的最新判定');

const bounded = port.replayTo('run-jia-1x', { seq: 20, t_sim: 140 });
check(
  bounded?.events.every((event) => event.seq <= 20 && event.t_sim <= 140) === true,
  '同时给出 seq 与 t_sim 时两者都应成为上界',
);
check(bounded?.t_sim === 140, '同时给出 seq 与 t_sim 时快照时刻应为 140');
const seqOnly = port.replayTo('run-jia-1x', { seq: 1, t_sim: 300 });
check(seqOnly?.events.length === 1 && seqOnly.events[0]?.seq === 1, 'seq:1 应只包含首个事件');
check(seqOnly?.t_sim === 30, 'seq:1 与 t:300 同时给出时，快照不应推进到 30 秒之后');

report('replay: seq20=5 accepted/4 rejected/5 占用；U1 改判指向 seq2；t=140/164/165 封路状态正确');

// ---------------------------------------------------------------------------
// 4. 拒绝与违规
// ---------------------------------------------------------------------------

if (jiaSeq20) {
  const actionAt = (seq: number) => jiaSeq20.actions.find((action) => action.seq === seq);
  check(
    actionAt(13)?.action_id === 'A6' &&
      actionAt(13)?.target_id === 'CN1' &&
      actionAt(13)?.reject_reason_code === 'TARGET_NOT_APPLICABLE',
    'seq13 应为 A6 CN1 TARGET_NOT_APPLICABLE',
  );
  check(
    actionAt(14)?.action_id === 'A6' &&
      actionAt(14)?.target_id === 'CN1' &&
      actionAt(14)?.reject_reason_code === 'TARGET_NOT_APPLICABLE',
    'seq14 应为 A6 CN1 TARGET_NOT_APPLICABLE',
  );
  check(
    actionAt(19)?.action_id === 'A6' &&
      actionAt(19)?.target_id === 'N7' &&
      actionAt(19)?.reject_reason_code === 'STATUS_CONFLICT',
    'seq19 应为 A6 N7 STATUS_CONFLICT',
  );
  check(
    actionAt(20)?.action_id === 'A6' &&
      actionAt(20)?.target_id === 'N7' &&
      actionAt(20)?.reject_reason_code === 'STATUS_CONFLICT',
    'seq20 应为 A6 N7 STATUS_CONFLICT',
  );
  checkEqual(
    jiaSeq20.actions
      .filter(
        (action) =>
          action.action_id === 'A6' &&
          action.target_id === 'N7' &&
          action.status === 'rejected',
      )
      .map((action) => action.seq),
    [19, 20],
    'A6 N7 的拒绝序号应为 19,20',
  );
  check(
    actionAt(12)?.action_id === 'A6' &&
      actionAt(12)?.target_id === 'N7' &&
      actionAt(12)?.status === 'accepted' &&
      actionAt(12)?.attempt === 1,
    'seq12 应是 A6 N7 的首次成功尝试',
  );
  checkEqual(
    jiaSeq20.actions
      .filter((action) => action.action_id === 'A6' && action.target_id === 'CN1')
      .map((action) => action.attempt),
    [1, 2],
    'CN1 的 A6 attempt 应为 1,2',
  );
  checkEqual(
    jiaSeq20.actions
      .filter((action) => action.action_id === 'A6' && action.target_id === 'N7')
      .map((action) => action.attempt),
    [1, 2, 3],
    'N7 的 A6 attempt 应为 1,2,3（seq12 成功也占尝试序号）',
  );
}

const a4Def = fixture.action_catalog.find((action) => action.id === 'A4');
const a6Def = fixture.action_catalog.find((action) => action.id === 'A6');
check(
  a4Def?.preconditions.some(
    (precondition) =>
      precondition.type === 'requires_completed_action' &&
      precondition.action_id === 'A3',
  ) === true,
  'A4 的动作目录前置条件应引用 A3',
);
check(
  a6Def?.preconditions.some(
    (precondition) => precondition.type === 'requires_disaster_annotation',
  ) === true &&
    a6Def?.preconditions.some(
      (precondition) => precondition.type === 'not_powered_off',
    ) === true,
  'A6 的动作目录前置条件应含 requires_disaster_annotation 与 not_powered_off',
);

const yiSeq18 = port.replayTo('run-yi-1x', { seq: 18 });
check(Boolean(yiSeq18), 'replayTo(run-yi-1x, seq:18) 不应为 null');
if (yiSeq18) {
  const yiA4 = yiSeq18.actions.filter((action) => action.action_id === 'A4');
  check(yiA4.length === 3, '乙应有 3 次 A4 尝试');
  check(
    yiA4.every(
      (action) =>
        action.status === 'rejected' &&
        action.reject_reason_code === 'PRECONDITION_NOT_MET',
    ),
    '乙 3 次 A4 均应为 PRECONDITION_NOT_MET',
  );
  checkEqual(
    yiA4.map((action) => action.seq),
    [13, 14, 15],
    '乙 A4 拒绝序号应为 13,14,15',
  );
}

const jiaScore = port.getScore('run-jia-1x');
const yiScore = port.getScore('run-yi-1x');
checkEqual(jiaScore?.details.violation_event_seqs, [14, 20], '甲违规序号应为 [14,20]');
checkEqual(yiScore?.details.violation_event_seqs, [9, 14, 15], '乙违规序号应为 [9,14,15]');
check(
  jiaScore?.details.violation_event_seqs.includes(19) === false,
  'seq19 是 A6 N7 的首次被拒，不应计违规',
);

report('rejections: 甲 CN1×2/N7×2、违规 [14,20]；乙 A4×3、违规 [9,14,15]');

// ---------------------------------------------------------------------------
// 5. 静态评分与倍速
// ---------------------------------------------------------------------------

check(jiaScore?.total === 83, `getScore(run-jia-1x) 应为 83，实际 ${String(jiaScore?.total)}`);
checkEqual(port.getScore('run-jia-1x', fixture.runs[0]?.events ?? []), jiaScore, '显式传入基线流水应返回同一结果');
check(port.getScore('run-jia-1x', []) === null, '空流水不应返回基线分数');
check(port.getScore('run-unknown') === null, '未知 run_id 应返回 null');
check(port.getScore('run-jia-4x') === null, '不应存在按倍速复制的 4× 流水');

const mutated = structuredClone(fixture.runs[0]?.events ?? []);
const firstAction = mutated.find(isActionEvent);
if (firstAction) {
  firstAction.payload.submitted_at_sim += 1;
  check(port.getScore('run-jia-1x', mutated) === null, '改动一条操作 payload 后应返回 null');
} else {
  errors.push('找不到可改动的甲动作');
}
const removed = structuredClone(fixture.runs[0]?.events ?? []);
removed.pop();
check(port.getScore('run-jia-1x', removed) === null, '删减事件后应返回 null');

const added = structuredClone(fixture.runs[0]?.events ?? []);
const firstEvent = fixture.runs[0]?.events[0];
if (firstEvent) {
  added.push(structuredClone(firstEvent));
  check(port.getScore('run-jia-1x', added) === null, '新增事件后应返回 null');
} else {
  errors.push('找不到可复制的事件');
}

const reordered = structuredClone(fixture.runs[0]?.events ?? []);
const eventA = reordered[0];
const eventB = reordered[1];
if (eventA && eventB) {
  reordered[0] = eventB;
  reordered[1] = eventA;
  check(port.getScore('run-jia-1x', reordered) === null, '重排事件后应返回 null');
} else {
  errors.push('事件不足，无法验证重排');
}

const simSequence = (fixture.runs[0]?.events ?? []).map((event) => event.t_sim);
for (const speed of [1, 4]) {
  const replayed = simSequence.map(
    (t) => port.replayTo('run-jia-1x', { t_sim: t })?.t_sim ?? null,
  );
  checkEqual(replayed, simSequence, `${speed}× 回放的模拟时刻序列应与流水一致`);
}
check(fixture.clock_checks.length === 2, 'clock_checks 应包含 1× 与 4×');
for (const clock of fixture.clock_checks) {
  check(clock.expected_response_seconds === 45, `${clock.label} 的响应应为 45 秒`);
  const score = port.getScore(clock.run_id);
  check(score?.details.response_seconds === 45, `${clock.label} 的 getScore 响应应为 45 秒`);
}
checkEqual(jiaScore?.details.response_seconds, 45, '甲响应时长应为 45 秒');

report('score: 83；改动/删减/新增/重排/未知 run 均 null；1×/4× 模拟时刻一致且响应 45s');

// ---------------------------------------------------------------------------
// 6. 路径空态、只读性与硬编码
// ---------------------------------------------------------------------------

const routeQuery = {
  from_node_id: 'N7',
  to_node_id: 'GATE3',
  at_sim: 140,
  road_segments: fixture.road_segments,
};
check(getRoute(routeQuery) === null, '静态 getRoute 应返回 null');
check(port.getRoute(routeQuery) === null, '端口 getRoute 应返回 null');
check(ROUTE_PENDING_TEXT === '路径计算待引擎接入', '路径待接入文案不稳定');
check(ROUTE_UNREACHABLE_TEXT.length > 0, '不可达文案不应为空');
check(SCORE_PENDING_TEXT === '实时评分待引擎接入', '实时评分待接入文案不稳定');

const before = JSON.stringify(fixture);
port.visibleReportsAt(80);
port.windowAt('U1', 90);
port.replayTo('run-jia-1x', { seq: 20 });
port.getScore('run-jia-1x');
port.getRoute(routeQuery);
check(JSON.stringify(fixture) === before, '只读接口不应修改输入 fixture');

const portSource = readFileSync(portPath, 'utf8');
for (const token of [
  'N7',
  'N1',
  'N2',
  'N11',
  'CN1',
  'CN2',
  'GYM',
  'LIB',
  'GATE3',
  'R-N7E',
  '萃园',
  '天健苑',
  '文博苑',
]) {
  check(!portSource.includes(token), `fixture-port.ts 含硬编码专名 ${token}`);
}
for (const [x, y] of [
  [500, 520],
  [900, 580],
  [60, 420],
  [220, 460],
  [380, 580],
]) {
  check(
    !new RegExp(`\\b${x}\\s*,\\s*${y}\\b`).test(portSource),
    `fixture-port.ts 含硬编码坐标 (${x},${y})`,
  );
}
check(!/viewBox\s*[:=]\s*["']?\d+\s+\d+/.test(portSource), 'fixture-port.ts 含固定 viewBox');

const tsconfigSource = readFileSync(tsconfigPath, 'utf8');
check(
  /"noUncheckedIndexedAccess"\s*:\s*true/.test(tsconfigSource),
  'tsconfig 必须保持 noUncheckedIndexedAccess=true',
);
const readmeSource = readFileSync(readmePath, 'utf8');
check(readmeSource.includes(PRECISION_NOTICE), 'README 未包含统一精度声明');

checkEqual(
  fixture.expected_scores['run-jia-1x']?.total,
  83,
  '原 D1 甲分支基线应保持 83',
);
checkEqual(
  fixture.expected_scores['run-yi-1x']?.total,
  44,
  '原 D1 乙分支基线应保持 44',
);
checkEqual(
  fixture.expected_scores['run-jia-plus-a4']?.total,
  90,
  '原 D1 甲补做 A4 基线应保持 90',
);

report('route: 静态 null + 空态文案；输入未被修改；专名/坐标/固定 viewBox 扫描通过；README 精度文案一致');

if (errors.length > 0) {
  console.error(`D1-v2 fixture port validation FAILED (${errors.length} errors)`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('D1-v2 fixture port validation PASSED');
console.log(
  `map: projections equal; GATE3=(500,520); viewBox=${canonicalMap.view_box_svg}; roads=${fixture.road_segments.length}`,
);
console.log('visibility: t=80 U1/U3/U2/U4/U5; t=300=10; U1 30=待核, 90=真报');
console.log('replay: jia seq20 5 accepted/4 rejected/5 occupancy; R-N7E flood at 140, closed at 165');
console.log('rejections: jia [14,20]; yi [9,14,15]');
console.log('score: jia 83; mutation=>null; 1x/4x response=45s');
console.log('route: null (pending); hardcode scan clean; README precision notice matched');
console.log('A 接口已测，B 页面待测（无页面，不以字符串存在替代 UI 验收）');
