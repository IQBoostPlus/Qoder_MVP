/**
 * D1 标准样例校验器（非生产评分器；生产评分器在 D4 交付）
 * 运行：npm run validate
 *
 * 从 fixtures/canonical-run.json 的实际字段与流水检查：
 * 1. 楼栋 / 路段 / 上报 / 动作 / 剧本节点引用
 * 2. 动作提交与完成时序、前置条件、资源占用
 * 3. 判定窗口、改判、末回合排序
 * 4. 甄别 / 响应 / 命中 / 违规四项分数与 83、44、90
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createActionJudge } from '../src/action-engine';
import type { MapSource } from '../src/fixture-port';
import type {
  ActionAttempt,
  ActionDef,
  ActionId,
  Building,
  CanonicalFixture,
  ClockCheck,
  JudgmentWindow,
  Junction,
  ResourceUsage,
  RoadSegment,
  RunEvent,
  RunRecord,
  ScoreResult,
  StandardActionItem,
  UgcReport,
  VerdictAttempt,
} from '../src/contracts';

const fixturePath = fileURLToPath(new URL('../fixtures/canonical-run.json', import.meta.url));
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as CanonicalFixture;

const errors: string[] = [];
const check = (condition: boolean, message: string): void => {
  if (!condition) errors.push(message);
};

const byId = <T extends { id: string }>(items: T[]): Map<string, T> =>
  new Map(items.map((item) => [item.id, item]));

const buildings = byId<Building>(fixture.buildings);
const junctions = byId<Junction>(fixture.junctions);
const roads = byId<RoadSegment>(fixture.road_segments);
const reports = byId<UgcReport>(fixture.ugc_reports);
const actions = byId<ActionDef>(fixture.action_catalog);
const nodes = new Map(fixture.scenario.nodes.map((node) => [node.t_sim, node]));
const nodeTimes = new Set(fixture.scenario.nodes.map((node) => node.t_sim));
const actionIds = new Set<string>(fixture.action_catalog.map((action) => action.id));

const isVerdictEvent = (event: RunEvent): event is Extract<RunEvent, { kind: 'verdict' }> =>
  event.kind === 'verdict';
const isActionEvent = (event: RunEvent): event is Extract<RunEvent, { kind: 'action' }> =>
  event.kind === 'action';
const isSortEvent = (event: RunEvent): event is Extract<RunEvent, { kind: 'sort' }> =>
  event.kind === 'sort';

function itemKey(item: StandardActionItem): string {
  return `${item.action_id}:${item.target_id}`;
}

function sortedStrings(values: string[]): string[] {
  return [...values].sort();
}

function windowAt(report: UgcReport, t: number): JudgmentWindow | undefined {
  return report.judgment_windows.find(
    (window) => t >= window.from_sim && (window.to_sim === null || t < window.to_sim),
  );
}

// ---------------------------------------------------------------------------
// 1. 引用与静态数据
// ---------------------------------------------------------------------------

function validateReferences(): void {
  check(fixture.schema_version === 'd1-1', 'schema_version 必须为 d1-1');
  check(fixture.buildings.length === 8, `D1 fixture 楼栋应为 8 栋，实际 ${fixture.buildings.length}`);
  check(fixture.junctions.length === 1, `D1 fixture 路口应为 1 个，实际 ${fixture.junctions.length}`);
  check(fixture.road_segments.length === 8, `D1 fixture 路段应为 8 条，实际 ${fixture.road_segments.length}`);
  check(fixture.ugc_reports.length === 10, `模拟上报应为 10 条，实际 ${fixture.ugc_reports.length}`);
  check(fixture.action_catalog.length === 6, `动作目录应为 6 种，实际 ${fixture.action_catalog.length}`);
  for (const id of ['N7', 'N1', 'N2', 'N11', 'CN1', 'CN2', 'GYM', 'LIB']) {
    check(buildings.has(id), `缺少 §7.4 fixture 楼栋 ${id}`);
  }
  check(junctions.get('GATE3')?.kind === 'gate', '缺少 3 号门 GATE3');
  for (const id of ['R-N7E', 'R-N7-N1', 'R-N1-N2', 'R-N2-CN1', 'R-CN1-CN2', 'R-N11-CN2', 'R-CN1-GYM', 'R-GYM-LIB']) {
    check(roads.has(id), `缺少 §7.3 路段 ${id}`);
  }
  check(roads.get('R-N7E')?.from === 'N7' && roads.get('R-N7E')?.to === 'GATE3', 'R-N7E 必须连接 N7 与 GATE3');

  for (const building of fixture.buildings) {
    check(building.zone.length > 0, `${building.id} 缺少真实苑/园分区`);
    check(building.floors === null || (Number.isInteger(building.floors) && building.floors > 0), `${building.id} 层数非法`);
    check(building.polygon.length >= 3, `${building.id} 多边形少于 3 个点`);
    check(building.capacity >= 0, `${building.id} 容量为负`);
    for (const adjacent of building.adjacency) {
      check(buildings.has(adjacent), `${building.id} 邻接引用未知楼栋 ${adjacent}`);
      check(
        buildings.get(adjacent)?.adjacency.includes(building.id) ?? false,
        `${building.id} 与 ${adjacent} 的邻接不是双向的`,
      );
    }
  }

  const roadNeighbors = new Map<string, Set<string>>();
  for (const road of fixture.road_segments) {
    for (const endpoint of [road.from, road.to]) {
      check(
        buildings.has(endpoint) || junctions.has(endpoint),
        `${road.id} 端点 ${endpoint} 既不是楼栋也不是路口`,
      );
    }
    check(road.from !== road.to, `${road.id} 起终点相同`);
    check(road.geometry.length >= 2, `${road.id} 路段端点少于 2 个`);
    check(road.blocked === false, `${road.id} 初始状态不应为正式封闭`);
    check(road.hazard === null, `${road.id} 初始状态不应带自然灾情`);
    if (buildings.has(road.from) && buildings.has(road.to)) {
      if (!roadNeighbors.has(road.from)) roadNeighbors.set(road.from, new Set());
      if (!roadNeighbors.has(road.to)) roadNeighbors.set(road.to, new Set());
      roadNeighbors.get(road.from)?.add(road.to);
      roadNeighbors.get(road.to)?.add(road.from);
    }
  }
  for (const building of fixture.buildings) {
    const fromRoads = roadNeighbors.get(building.id) ?? new Set<string>();
    check(
      sortedStrings([...fromRoads]).join(',') === sortedStrings(building.adjacency).join(','),
      `${building.id} adjacency 与 road_segments 不一致`,
    );
  }

  // 路网连通：楼栋与路口一起作为节点，不允许孤立楼栋
  const visited = new Set<string>();
  const queue = ['N7'];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    for (const road of fixture.road_segments) {
      if (road.from === current && !visited.has(road.to)) queue.push(road.to);
      if (road.to === current && !visited.has(road.from)) queue.push(road.from);
    }
  }
  for (const building of fixture.buildings) {
    check(visited.has(building.id), `${building.id} 不在连通路网中`);
  }
  check(visited.has('GATE3'), 'GATE3 不在连通路网中');

  const weights = fixture.action_catalog.reduce((sum, action) => sum + action.weight, 0);
  check(weights === 10, `动作目录权重合计应为 10，实际 ${weights}`);
  for (const action of fixture.action_catalog) {
    check(action.duration_sim > 0, `${action.id} duration_sim 必须为正`);
    check(action.weight >= 0, `${action.id} weight 不能为负`);
    check(action.resource_id.length > 0, `${action.id} 缺少资源引用`);
  }
  check(actions.get('A3')?.preconditions.length === 0, 'A3 警戒按 v4.1 不设前置条件');
  check(actions.get('A5')?.preconditions.length === 0, 'A5 封路按 v4.1 不设前置条件');
  check(actions.get('A4')?.preconditions.length === 1, 'A4 必须保留“先 A3 警戒”前置条件');
  check(actions.get('A6')?.preconditions.length === 2, 'A6 必须保留灾情标注与不可重复断电前置条件');

  const scenario = fixture.scenario;
  check(scenario.start_building_id === 'N7', '样例起始楼栋必须为 N7（萃园 7 幢）');
  check(buildings.has(scenario.start_building_id), '剧本起始楼栋不存在');
  check(scenario.t_end === 300, `样例 t_end 应为 300，实际 ${scenario.t_end}`);
  check(nodes.has(scenario.t_end), '剧本缺少 t_end 节点');
  check(nodeTimes.has(220) && nodeTimes.has(250), '缺少乙分支所需的 220 / 250 推进回合');
  check(scenario.playback_speeds.includes(1), 'playback_speeds 缺少 1×');
  check(scenario.playback_speeds.includes(4), 'playback_speeds 缺少 4×');

  const standardKeys = new Set(scenario.standard_actions.map(itemKey));
  check(standardKeys.size === 6, 'standard_actions 应包含 6 个标准项且不重复');
  for (const item of scenario.standard_actions) {
    const action = actions.get(item.action_id);
    check(Boolean(action), `标准项引用未知动作 ${item.action_id}`);
    if (!action) continue;
    const targetExists =
      action.target_kind === 'building' ? buildings.has(item.target_id) : roads.has(item.target_id);
    check(targetExists, `标准项 ${itemKey(item)} 的目标不存在或类型不符`);
  }
  for (const item of scenario.critical_items) {
    check(standardKeys.has(itemKey(item)), `关键项 ${itemKey(item)} 不在标准动作集中`);
  }

  const resourceIds = new Set(scenario.resources.map((resource) => resource.id));
  for (const action of fixture.action_catalog) {
    check(resourceIds.has(action.resource_id), `${action.id} 引用未知资源 ${action.resource_id}`);
  }
  for (const resource of scenario.resources) {
    check(resource.capacity > 0, `资源 ${resource.id} 容量必须为正`);
  }
  // 场景事件引用
  let previousTime = -Infinity;
  for (const node of scenario.nodes) {
    check(node.t_sim > previousTime, `剧本节点时间未严格递增：${node.t_sim}`);
    previousTime = node.t_sim;
    check(node.t_sim >= 0 && node.t_sim <= scenario.t_end, `节点 ${node.id} 超出推演区间`);
    for (const event of node.events) {
      if (event.type === 'ugc_appear') {
        const report = reports.get(event.report_id);
        check(Boolean(report), `节点 ${node.id} 引用未知上报 ${event.report_id}`);
        check(report?.appears_at_sim === node.t_sim, `${event.report_id} 出现时刻与节点不一致`);
      } else if (event.type === 'disaster_confirm') {
        check(buildings.has(event.building_id), `灾情事件引用未知楼栋 ${event.building_id}`);
      } else if (event.type === 'road_hazard') {
        check(roads.has(event.road_id), `灾情事件引用未知路段 ${event.road_id}`);
      }
    }
  }

  const n140 = nodes.get(140);
  const roadHazardAt140 = n140?.events.find(
    (event) => event.type === 'road_hazard' && event.road_id === 'R-N7E' && event.hazard === 'flood',
  );
  check(Boolean(roadHazardAt140), 't=140 必须由 disaster 事件单独引用 R-N7E 积水阻断');
  const annotationAt90 = nodes
    .get(90)
    ?.events.some(
      (event) =>
        event.type === 'disaster_confirm' &&
        event.building_id === 'N7' &&
        event.adds_disaster_annotation,
    );
  check(Boolean(annotationAt90), 't=90 必须给 N7 增加灾情标注，供 A6 前置条件使用');

  const priorities = new Set<number>();
  for (const report of fixture.ugc_reports) {
    check(report.is_training === 1, `${report.id} is_training 必须为 1`);
    check(priorities.has(report.priority) === false, `priority 重复：${report.priority}`);
    priorities.add(report.priority);
    check(nodeTimes.has(report.appears_at_sim), `${report.id} 出现时刻不是剧本节点`);
    if (!report.event_truth.locatable) {
      check(report.event_truth.building_id === null, `${report.id} 不可定位时 building_id 必须为 null`);
    } else if (report.event_truth.building_id !== null) {
      check(buildings.has(report.event_truth.building_id), `${report.id} 引用未知楼栋`);
    }
    check(
      !('road_id' in report.event_truth),
      `${report.id} 不得把路段 id 塞进 event_truth；阻断由 disaster 事件引用`,
    );

    const windows = report.judgment_windows;
    check(windows.length > 0, `${report.id} 缺少判断窗口`);
    check(windows[0]?.from_sim === report.appears_at_sim, `${report.id} 首个窗口未从出现时刻开始`);
    for (let index = 0; index < windows.length; index += 1) {
      const window = windows[index];
      if (!window) continue;
      check(window.to_sim === null || window.to_sim > window.from_sim, `${report.id} 窗口区间非法`);
      if (index > 0) {
        check(windows[index - 1]?.to_sim === window.from_sim, `${report.id} 判断窗口不连续`);
      }
      check(
        window.expected === '真报' || window.expected === '误报' || window.expected === '待核',
        `${report.id} 窗口 expected 非法`,
      );
    }
    const last = windows[windows.length - 1];
    check(last?.to_sim === null, `${report.id} 最后一个窗口必须延伸到结束`);
  }
  const u1 = reports.get('U1');
  check(u1?.appears_at_sim === 30, 'U1 必须在第 30 秒出现');
  check(windowAt(u1 as UgcReport, 30)?.expected === '待核', 'U1 在 30 秒应处于待核窗口');
  check(windowAt(u1 as UgcReport, 100)?.expected === '真报', 'U1 在 100 秒应处于真报窗口');
  const u9 = reports.get('U9');
  check(u9?.event_truth.building_id === 'N7', 'U9 的楼栋定位应为 N7');
  check(u9?.event_truth.locatable === true, 'U9 的楼栋定位应可判定');
  check(
    fixture.expected_sort.join(',') === 'U2,U8,U4',
    `末回合排序答案应为 U2,U8,U4，实际 ${fixture.expected_sort.join(',')}`,
  );
}

// ---------------------------------------------------------------------------
// 2. 流水回放：尝试序号、时序、前置条件、资源
// ---------------------------------------------------------------------------

interface ReplayState {
  completedAt: Map<string, number>; // "A3:N7" -> 完成时刻
  activeUntil: Map<string, number>; // 同类动作进行中
  poweredOffAt: Map<string, number>;
  closedRoadAt: Map<string, number>;
  annotationAt: Map<string, number>;
  attemptCount: Map<string, number>;
  rejectedOnce: Set<string>;
  violations: number[];
  derivedOccupancy: ResourceUsage[];
}

function annotationTimes(): Map<string, number> {
  const result = new Map<string, number>();
  for (const node of fixture.scenario.nodes) {
    for (const event of node.events) {
      if (event.type === 'disaster_confirm' && event.adds_disaster_annotation) {
        const existing = result.get(event.building_id);
        if (existing === undefined || node.t_sim < existing) {
          result.set(event.building_id, node.t_sim);
        }
      }
    }
  }
  return result;
}

function validateAndReplayRun(run: RunRecord): void {
  check(run.scenario_id === fixture.scenario.id, `${run.run_id} 引用未知剧本`);
  check(run.playback_speed > 0, `${run.run_id} 播放速度必须为正`);
  check(run.events.length > 0, `${run.run_id} 事件流水为空`);

  const state: ReplayState = {
    completedAt: new Map(),
    activeUntil: new Map(),
    poweredOffAt: new Map(),
    closedRoadAt: new Map(),
    annotationAt: annotationTimes(),
    attemptCount: new Map(),
    rejectedOnce: new Set(),
    violations: [],
    derivedOccupancy: [],
  };

  let previousTime = -Infinity;
  let expectedSeq = 1;
  let sortCount = 0;

  for (const event of run.events) {
    check(event.seq === expectedSeq, `${run.run_id} 事件序号不连续：期望 ${expectedSeq}，实际 ${event.seq}`);
    check(event.t_sim >= previousTime, `${run.run_id} seq ${event.seq} 时间倒退`);
    check(nodeTimes.has(event.t_sim), `${run.run_id} seq ${event.seq} 的操作时刻 ${event.t_sim} 不是剧本节点`);
    previousTime = event.t_sim;
    expectedSeq += 1;

    if (isVerdictEvent(event)) {
      const verdict = event.payload;
      check(verdict.seq === event.seq, `${run.run_id} seq ${event.seq} verdict payload.seq 不一致`);
      check(verdict.judged_at_sim === event.t_sim, `${run.run_id} seq ${event.seq} 判定时刻与事件时刻不一致`);
      const report = reports.get(verdict.report_id);
      check(Boolean(report), `${run.run_id} seq ${event.seq} 引用未知上报`);
      if (report) {
        check(verdict.judged_at_sim >= report.appears_at_sim, `${run.run_id} 在 ${verdict.report_id} 出现前判读`);
        check(Boolean(windowAt(report, verdict.judged_at_sim)), `${run.run_id} 判定落在窗口之外`);
      }
      check(
        verdict.verdict === '真报' || verdict.verdict === '误报' || verdict.verdict === '待核',
        `${run.run_id} seq ${event.seq} verdict 值非法`,
      );
      if (verdict.location !== null && verdict.location !== '无法定位') {
        check(buildings.has(verdict.location), `${run.run_id} seq ${event.seq} 定位引用未知楼栋`);
      }
    } else if (isActionEvent(event)) {
      const attempt = event.payload;
      check(attempt.seq === event.seq, `${run.run_id} seq ${event.seq} action payload.seq 不一致`);
      check(attempt.submitted_at_sim === event.t_sim, `${run.run_id} seq ${event.seq} 提交时刻与事件时刻不一致`);
      validateActionAttempt(run, attempt, state);
    } else if (isSortEvent(event)) {
      const sort = event.payload;
      sortCount += 1;
      check(sort.seq === event.seq, `${run.run_id} seq ${event.seq} sort payload.seq 不一致`);
      check(sort.t_sim === fixture.scenario.t_end, `${run.run_id} 排序必须发生在 t_end`);
      check(sort.ordered_report_ids.length === 3, `${run.run_id} 排序应选出 3 条`);
      check(new Set(sort.ordered_report_ids).size === 3, `${run.run_id} 排序结果重复`);
      for (const reportId of sort.ordered_report_ids) {
        check(reports.has(reportId), `${run.run_id} 排序引用未知上报 ${reportId}`);
      }
    }
  }
  check(sortCount === 1, `${run.run_id} 应恰有一次末回合排序，实际 ${sortCount}`);

  // 资源占用记录与流水中 accepted 动作逐项一致
  const derived = [...state.derivedOccupancy].sort((a, b) => a.action_seq - b.action_seq);
  const declared = [...run.resource_occupancy].sort((a, b) => a.action_seq - b.action_seq);
  check(
    JSON.stringify(derived) === JSON.stringify(declared),
    `${run.run_id} resource_occupancy 与 accepted 动作不一致`,
  );
  validateResourceCapacity(run);
  check(
    state.violations.join(',') === derivedViolationSeqs(run).join(','),
    `${run.run_id} 违规记录与“首次被拒、再次提交”规则不一致`,
  );
}

function validateActionAttempt(run: RunRecord, attempt: ActionAttempt, state: ReplayState): void {
  const action = actions.get(attempt.action_id);
  check(Boolean(action), `${run.run_id} seq ${attempt.seq} 引用未知动作 ${attempt.action_id}`);
  const targetExists =
    action?.target_kind === 'building' ? buildings.has(attempt.target_id) : roads.has(attempt.target_id);
  check(targetExists, `${run.run_id} seq ${attempt.seq} 目标 ${attempt.target_id} 不存在或类型不符`);
  if (!action) return;

  const pairKey = `${attempt.action_id}:${attempt.target_id}`;
  const attemptNumber = (state.attemptCount.get(pairKey) ?? 0) + 1;
  state.attemptCount.set(pairKey, attemptNumber);
  check(
    attempt.attempt === attemptNumber,
    `${run.run_id} seq ${attempt.seq} 尝试序号应为 ${attemptNumber}，实际 ${attempt.attempt}`,
  );

  let rejectCode: ActionAttempt['reject_reason_code'] = null;
  const t = attempt.submitted_at_sim;

  const a3Done = state.completedAt.get(`A3:${attempt.target_id}`);
  const a3ActiveUntil = state.activeUntil.get(`A3:${attempt.target_id}`);
  const poweredOffAt = state.poweredOffAt.get(attempt.target_id);
  const closedAt = state.closedRoadAt.get(attempt.target_id);
  const annotationAt = state.annotationAt.get(attempt.target_id);

  if (attempt.action_id === 'A3') {
    if ((a3Done !== undefined && a3Done <= t) || (a3ActiveUntil !== undefined && a3ActiveUntil > t)) {
      rejectCode = 'STATUS_CONFLICT';
    }
  } else if (attempt.action_id === 'A4') {
    if (a3Done === undefined || a3Done > t) {
      rejectCode = 'PRECONDITION_NOT_MET';
    }
  } else if (attempt.action_id === 'A5') {
    if (closedAt !== undefined && closedAt <= t) {
      rejectCode = 'STATUS_CONFLICT';
    }
  } else if (attempt.action_id === 'A6') {
    if (annotationAt === undefined || annotationAt > t) {
      rejectCode = 'TARGET_NOT_APPLICABLE';
    } else if (poweredOffAt !== undefined && poweredOffAt <= t) {
      rejectCode = 'STATUS_CONFLICT';
    }
  }

  const expectedStatus = rejectCode === null ? 'accepted' : 'rejected';
  check(
    attempt.status === expectedStatus,
    `${run.run_id} seq ${attempt.seq} 应${expectedStatus === 'accepted' ? '通过' : '拒绝'}，实际 ${attempt.status}（${attempt.reject_reason ?? '无原因'}）`,
  );
  check(
    attempt.reject_reason_code === rejectCode,
    `${run.run_id} seq ${attempt.seq} 拒绝原因码应为 ${rejectCode ?? 'null'}，实际 ${attempt.reject_reason_code ?? 'null'}`,
  );
  check(
    attempt.duration_sim === action.duration_sim,
    `${run.run_id} seq ${attempt.seq} 动作耗时与目录不一致`,
  );
  if (attempt.status === 'accepted') {
    check(attempt.reject_reason_code === null, `${run.run_id} seq ${attempt.seq} 通过动作不应有拒绝原因码`);
    check(attempt.reject_reason === null, `${run.run_id} seq ${attempt.seq} 通过动作不应有拒绝原因`);
    check(
      attempt.completed_at_sim === attempt.submitted_at_sim + action.duration_sim,
      `${run.run_id} seq ${attempt.seq} 完成时刻应等于提交时刻 + duration_sim`,
    );
    const completed = attempt.completed_at_sim;
    if (completed !== null) {
      check(completed <= fixture.scenario.t_end + action.duration_sim, `${run.run_id} seq ${attempt.seq} 完成时刻异常`);
      state.completedAt.set(`${attempt.action_id}:${attempt.target_id}`, completed);
      state.activeUntil.set(`${attempt.action_id}:${attempt.target_id}`, completed);
      if (attempt.action_id === 'A6') state.poweredOffAt.set(attempt.target_id, completed);
      if (attempt.action_id === 'A5') state.closedRoadAt.set(attempt.target_id, completed);
      const usage = attempt.resource_usage;
      check(Boolean(usage), `${run.run_id} seq ${attempt.seq} 通过动作缺少资源占用记录`);
      if (usage) {
        check(usage.resource_id === action.resource_id, `${run.run_id} seq ${attempt.seq} 资源与目录不一致`);
        check(usage.units === action.resource_units, `${run.run_id} seq ${attempt.seq} 资源数量与目录不一致`);
        check(usage.action_seq === attempt.seq, `${run.run_id} seq ${attempt.seq} 资源记录动作序号不一致`);
        check(usage.from_sim === attempt.submitted_at_sim, `${run.run_id} seq ${attempt.seq} 资源开始时刻不一致`);
        check(usage.to_sim === completed, `${run.run_id} seq ${attempt.seq} 资源结束时刻不一致`);
        state.derivedOccupancy.push({ ...usage });
      }
    }
  } else {
    check(attempt.completed_at_sim === null, `${run.run_id} seq ${attempt.seq} 拒绝动作的完成时刻应为 null`);
    check(attempt.resource_usage === null, `${run.run_id} seq ${attempt.seq} 拒绝动作不应占用资源`);
    check(Boolean(attempt.reject_reason), `${run.run_id} seq ${attempt.seq} 拒绝动作缺少原因说明`);
    if (state.rejectedOnce.has(pairKey)) {
      state.violations.push(attempt.seq);
    } else {
      state.rejectedOnce.add(pairKey);
    }
  }
}

function derivedViolationSeqs(run: RunRecord): number[] {
  const rejectedSeen = new Set<string>();
  const violations: number[] = [];
  const attempts = run.events.filter(isActionEvent).map((event) => event.payload);
  for (const attempt of attempts) {
    if (attempt.status === 'rejected') {
      const key = `${attempt.action_id}:${attempt.target_id}`;
      if (rejectedSeen.has(key)) violations.push(attempt.seq);
      else rejectedSeen.add(key);
    }
  }
  return violations;
}

function validateResourceCapacity(run: RunRecord): void {
  const capacity = new Map(fixture.scenario.resources.map((resource) => [resource.id, resource.capacity]));
  const deltas = new Map<string, Array<{ t: number; delta: number }>>();
  for (const usage of run.resource_occupancy) {
    check(capacity.has(usage.resource_id), `${run.run_id} 引用未知资源 ${usage.resource_id}`);
    check(usage.units > 0, `${run.run_id} 资源数量必须为正`);
    if (usage.to_sim === null) continue;
    const list = deltas.get(usage.resource_id) ?? [];
    list.push({ t: usage.from_sim, delta: usage.units });
    list.push({ t: usage.to_sim, delta: -usage.units });
    deltas.set(usage.resource_id, list);
  }
  for (const [resourceId, list] of deltas) {
    const events = [...list].sort((a, b) => a.t - b.t || a.delta - b.delta);
    let active = 0;
    for (const event of events) {
      active += event.delta;
      const limit = capacity.get(resourceId) ?? 0;
      check(
        active <= limit,
        `${run.run_id} 资源 ${resourceId} 在 ${event.t} 秒占用 ${active} 超过容量 ${limit}`,
      );
    }
    check(active === 0, `${run.run_id} 资源 ${resourceId} 占用记录未闭合`);
  }
}

// ---------------------------------------------------------------------------
// 3. 复算四项指标
// ---------------------------------------------------------------------------

function lastVerdicts(run: RunRecord): Map<string, VerdictAttempt> {
  const result = new Map<string, VerdictAttempt>();
  for (const event of run.events) {
    if (!isVerdictEvent(event)) continue;
    result.set(event.payload.report_id, event.payload);
  }
  return result;
}

function responseScore(seconds: number): number {
  if (seconds <= 60) return 100;
  if (seconds >= 240) return 0;
  return Math.round((((240 - seconds) / 180) * 100 + Number.EPSILON) * 100) / 100;
}

function scoreRun(run: RunRecord): ScoreResult {
  const totalReports = fixture.ugc_reports.length;
  const verdicts = lastVerdicts(run);

  let correct = 0;
  const wrong: string[] = [];
  for (const report of fixture.ugc_reports) {
    const verdict = verdicts.get(report.id);
    const expected = verdict ? windowAt(report, verdict.judged_at_sim)?.expected : undefined;
    if (verdict && expected === verdict.verdict) correct += 1;
    else wrong.push(report.id);
  }
  const discrimination = (correct / totalReports) * 100;

  const firstReal = [...fixture.ugc_reports]
    .filter((report) => report.event_truth.is_real)
    .sort((a, b) => a.appears_at_sim - b.appears_at_sim)[0];
  const acceptedActions = run.events
    .filter(isActionEvent)
    .map((event) => event.payload)
    .filter((attempt) => attempt.status === 'accepted' && attempt.completed_at_sim !== null);
  const related = firstReal
    ? acceptedActions
        .filter((attempt) =>
          firstReal.event_truth.building_id
            ? attempt.target_id === firstReal.event_truth.building_id
            : false,
        )
        .sort((a, b) => (a.completed_at_sim ?? Infinity) - (b.completed_at_sim ?? Infinity) || a.seq - b.seq)
    : [];
  const responseAction = related[0];
  const responseSeconds =
    firstReal && responseAction?.completed_at_sim !== null && responseAction?.completed_at_sim !== undefined
      ? responseAction.completed_at_sim - firstReal.appears_at_sim
      : null;
  const response = responseSeconds === null ? 0 : responseScore(responseSeconds);

  const acceptedKeys = new Set(
    acceptedActions.map((attempt) => `${attempt.action_id}:${attempt.target_id}`),
  );
  let hitWeights = 0;
  const missed: StandardActionItem[] = [];
  for (const item of fixture.scenario.standard_actions) {
    if (acceptedKeys.has(itemKey(item))) hitWeights += actions.get(item.action_id)?.weight ?? 0;
    else missed.push(item);
  }
  const totalWeights = fixture.scenario.standard_actions.reduce(
    (sum, item) => sum + (actions.get(item.action_id)?.weight ?? 0),
    0,
  );
  const coverage = totalWeights === 0 ? 0 : (hitWeights / totalWeights) * 100;

  const violations = derivedViolationSeqs(run);
  const violation = Math.max(0, 100 - 15 * violations.length);

  const sortEvent = run.events.find(isSortEvent);
  const actualSort = sortEvent?.payload.ordered_report_ids ?? [];
  const expectedSort = [...fixture.ugc_reports]
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 3)
    .map((report) => report.id);
  const sortingCorrect = JSON.stringify(actualSort) === JSON.stringify(expectedSort);

  const total = Math.round(
    discrimination * 0.3 + response * 0.2 + coverage * 0.35 + violation * 0.15,
  );

  return {
    discrimination,
    response,
    coverage,
    violation,
    total,
    details: {
      correct_judgments: correct,
      total_reports: totalReports,
      wrong_report_ids: wrong,
      first_real_report_id: firstReal?.id ?? null,
      first_response_action_seq: responseAction?.seq ?? null,
      response_seconds: responseSeconds,
      coverage_hit_weights: hitWeights,
      coverage_total_weights: totalWeights,
      missed_items: missed,
      violation_count: violations.length,
      violation_event_seqs: violations,
    },
    sorting: {
      expected: expectedSort,
      actual: actualSort,
      correct: sortingCorrect,
    },
  };
}

function compareScore(runId: string, actual: ScoreResult): void {
  const expected = fixture.expected_scores[runId];
  if (!expected) {
    errors.push(`${runId} 缺少 expected_scores 基线`);
    return;
  }
  for (const metric of ['discrimination', 'response', 'coverage', 'violation', 'total'] as const) {
    check(
      actual[metric] === expected[metric],
      `${runId} ${metric} 复算 ${actual[metric]} ≠ 基线 ${expected[metric]}`,
    );
  }
  check(
    actual.details.correct_judgments === expected.details.correct_judgments,
    `${runId} correct_judgments 不一致`,
  );
  check(
    sortedStrings(actual.details.wrong_report_ids).join(',') ===
      sortedStrings(expected.details.wrong_report_ids).join(','),
    `${runId} wrong_report_ids 不一致`,
  );
  check(
    actual.details.first_real_report_id === expected.details.first_real_report_id,
    `${runId} first_real_report_id 不一致`,
  );
  check(
    actual.details.first_response_action_seq === expected.details.first_response_action_seq,
    `${runId} first_response_action_seq 不一致`,
  );
  check(
    actual.details.response_seconds === expected.details.response_seconds,
    `${runId} response_seconds 不一致`,
  );
  check(
    actual.details.coverage_hit_weights === expected.details.coverage_hit_weights,
    `${runId} coverage_hit_weights 不一致`,
  );
  check(
    actual.details.coverage_total_weights === expected.details.coverage_total_weights,
    `${runId} coverage_total_weights 不一致`,
  );
  check(
    actual.details.missed_items.map(itemKey).sort().join(',') ===
      expected.details.missed_items.map(itemKey).sort().join(','),
    `${runId} missed_items 不一致`,
  );
  check(
    actual.details.violation_count === expected.details.violation_count,
    `${runId} violation_count 不一致`,
  );
  check(
    actual.details.violation_event_seqs.join(',') ===
      expected.details.violation_event_seqs.join(','),
    `${runId} violation_event_seqs 不一致`,
  );
  check(
    JSON.stringify(actual.sorting) === JSON.stringify(expected.sorting),
    `${runId} sorting 结果不一致`,
  );
}

function validateBuildingsProjection(): void {
  const mapPath = fileURLToPath(new URL('../fixtures/buildings.json', import.meta.url));
  const map = JSON.parse(readFileSync(mapPath, 'utf8')) as {
    buildings: Building[];
    junctions: Junction[];
    road_segments: RoadSegment[];
  };
  check(
    JSON.stringify(map.buildings) === JSON.stringify(fixture.buildings),
    'fixtures/buildings.json 与 canonical-run.json 的楼栋不一致',
  );
  check(
    JSON.stringify(map.junctions) === JSON.stringify(fixture.junctions),
    'fixtures/buildings.json 与 canonical-run.json 的路口不一致',
  );
  check(
    JSON.stringify(map.road_segments) === JSON.stringify(fixture.road_segments),
    'fixtures/buildings.json 与 canonical-run.json 的路段不一致',
  );
}

function validateQualityCases(): void {
  const jia = fixture.runs.find((run) => run.run_id === 'run-jia-1x');
  const yi = fixture.runs.find((run) => run.run_id === 'run-yi-1x');
  const jiaPlus = fixture.runs.find((run) => run.run_id === 'run-jia-plus-a4');
  check(Boolean(jia && yi && jiaPlus), '缺少甲乙或补做 A4 流水');
  if (!jia || !yi || !jiaPlus) return;

  // SC-04 确定性
  const baseline = JSON.stringify(scoreRun(jia));
  for (let index = 0; index < 10; index += 1) {
    check(JSON.stringify(scoreRun(jia)) === baseline, `SC-04 第 ${index + 1} 次复算不一致`);
  }

  // SC-05 违规可达值；60 不可达
  const violationValues = [100, 85, 70, 55, 40, 25, 10, 0];
  for (let count = 0; count <= 7; count += 1) {
    check(
      Math.max(0, 100 - 15 * count) === violationValues[count],
      `SC-05 违规 ${count} 次得分不符`,
    );
  }
  check(violationValues.every((value) => value !== 60), 'SC-05 60 不应可达');

  // SC-07 四舍五入边界
  check(Math.round(82.5) === 83 && Math.round(43.75) === 44 && Math.round(89.5) === 90, 'SC-07 舍入边界不符');

  // SC-03 / RE-01：A3 完成于 130，A4 于 150 合法；乙在 A3 完成前提交 A4 被拒
  const a3Jia = jia.events.find(
    (event) => isActionEvent(event) && event.payload.action_id === 'A3' && event.payload.status === 'accepted',
  );
  check(
    Boolean(a3Jia && isActionEvent(a3Jia) && a3Jia.payload.completed_at_sim === 130),
    'SC-03 甲 A3 应完成于 130',
  );
  const a4JiaPlus = jiaPlus.events.find(
    (event) => isActionEvent(event) && event.payload.action_id === 'A4',
  );
  check(
    Boolean(
      a4JiaPlus &&
        isActionEvent(a4JiaPlus) &&
        a4JiaPlus.payload.status === 'accepted' &&
        a4JiaPlus.payload.submitted_at_sim === 150 &&
        a4JiaPlus.payload.completed_at_sim === 170,
    ),
    'SC-03 甲补做 A4 应于 150 提交、170 完成',
  );
  const yiA4 = yi.events
    .filter(isActionEvent)
    .map((event) => event.payload)
    .filter((attempt) => attempt.action_id === 'A4');
  check(
    yiA4.length === 3 &&
      yiA4.every(
        (attempt) =>
          attempt.status === 'rejected' && attempt.reject_reason_code === 'PRECONDITION_NOT_MET',
      ),
    'RE-01 / SC-03b A3 未完成时 A4 必须被拒绝',
  );

  // SC-08 乙 A3 提前到 220 提交 → 完成 250，响应 220 秒，总分 46
  const yiEarlier = structuredClone(yi);
  const a3Earlier = yiEarlier.events.find(
    (event) => isActionEvent(event) && event.payload.action_id === 'A3' && event.payload.status === 'accepted',
  );
  check(Boolean(a3Earlier), 'SC-08 找不到乙的 A3 流水');
  if (!a3Earlier || !isActionEvent(a3Earlier) || !a3Earlier.payload.resource_usage) return;
  a3Earlier.payload.submitted_at_sim = 220;
  a3Earlier.payload.completed_at_sim = 250;
  a3Earlier.payload.resource_usage.from_sim = 220;
  a3Earlier.payload.resource_usage.to_sim = 250;
  const barrierUsage = yiEarlier.resource_occupancy.find((usage) => usage.resource_id === 'barrier_team');
  check(Boolean(barrierUsage), 'SC-08 找不到乙的警戒组占用');
  if (barrierUsage) {
    barrierUsage.from_sim = 220;
    barrierUsage.to_sim = 250;
  }
  const earlierScore = scoreRun(yiEarlier);
  check(earlierScore.details.response_seconds === 220, 'SC-08 响应时长应为 220 秒');
  check(Math.abs(earlierScore.response - 11.11) < 0.001, 'SC-08 响应分应约为 11.11');
  check(earlierScore.total === 46, `SC-08 总分应为 46，实际 ${earlierScore.total}`);
}

function validateClockChecks(): void {
  const checks: ClockCheck[] = fixture.clock_checks;
  check(checks.length === 2, 'clock_checks 应包含 1× 与 4× 两项');
  for (const clock of checks) {
    const run = fixture.runs.find((candidate) => candidate.run_id === clock.run_id);
    check(Boolean(run), `${clock.label} 引用未知流水`);
    if (!run) continue;
    check(
      fixture.scenario.playback_speeds.includes(clock.playback_speed),
      `${clock.label} 速度未在剧本 playback_speeds 中声明`,
    );
    const score = scoreRun(run);
    check(
      score.details.response_seconds === clock.expected_response_seconds,
      `${clock.label} 响应时长 ${score.details.response_seconds} ≠ ${clock.expected_response_seconds}`,
    );
    const u1 = reports.get('U1');
    const a1 = run.events
      .filter(isActionEvent)
      .map((event) => event.payload)
      .find((attempt) => attempt.action_id === 'A1' && attempt.target_id === 'N7');
    check(u1?.appears_at_sim === 30, `${clock.label} U1 出现时刻必须为 30`);
    check(a1?.completed_at_sim === 75, `${clock.label} A1 完成时刻必须为 75`);
  }
  const [one, four] = checks;
  if (one && four) {
    check(
      one.expected_response_seconds === four.expected_response_seconds,
      '1× 与 4× 的响应时长必须相同',
    );
  }
}

// ---------------------------------------------------------------------------
// 运行
// ---------------------------------------------------------------------------

function rejudgeCanonicalActions(): void {
  const campus = JSON.parse(readFileSync(new URL('../fixtures/campus-map.json', import.meta.url), 'utf8')) as MapSource;
  const judge = createActionJudge(fixture, campus);
  fixture.runs = fixture.runs.map((run) => {
    const events: RunEvent[] = [];
    const resource_occupancy: ResourceUsage[] = [];
    for (const event of run.events) {
      if (!isActionEvent(event)) {
        events.push(event);
        continue;
      }
      const { reject_reason: previousReason, ...expected } = event.payload;
      const judged = judge({
        action_id: expected.action_id,
        target_id: expected.target_id,
        submitted_at_sim: event.t_sim,
        seq: event.seq,
        prior_events: events,
      });
      const { reject_reason: reason, ...actual } = judged;
      assert.deepEqual(actual, expected, `${run.run_id} seq=${event.seq} D3 动作与 D1 基准不一致`);
      assert.equal(Boolean(reason), Boolean(previousReason));
      events.push({ ...event, payload: judged });
      if (judged.resource_usage) resource_occupancy.push(judged.resource_usage);
    }
    console.log(`D3 rejudged ${run.run_id}: ${events.filter(isActionEvent).length} actions, ${resource_occupancy.length} resource intervals`);
    return { ...run, events, resource_occupancy };
  });
}

validateReferences();
validateBuildingsProjection();
if (process.argv.includes('--rejudge-actions')) rejudgeCanonicalActions();
for (const run of fixture.runs) {
  validateAndReplayRun(run);
}
validateQualityCases();
const results = new Map<string, ScoreResult>();
for (const run of fixture.runs) {
  const score = scoreRun(run);
  results.set(run.run_id, score);
  compareScore(run.run_id, score);
}
validateClockChecks();

if (errors.length > 0) {
  console.error(`D1 canonical fixture validation FAILED (${errors.length} errors)`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(process.argv.includes('--rejudge-actions')
  ? 'D3 reconstructed canonical action and D1 reference score validation PASSED'
  : 'D1 canonical fixture validation PASSED');
console.log(
  `buildings=${fixture.buildings.length} junctions=${fixture.junctions.length} roads=${fixture.road_segments.length} reports=${fixture.ugc_reports.length} actions=${fixture.action_catalog.length} runs=${fixture.runs.length}`,
);
for (const run of fixture.runs) {
  const score = results.get(run.run_id);
  if (!score) continue;
  console.log(
    `${run.run_id} [${run.branch}] 甄别=${score.discrimination} 响应=${score.response} 命中=${score.coverage} 违规=${score.violation} 总分=${score.total} | 响应 ${score.details.response_seconds}s, 违规 ${score.details.violation_count} 次, 缺项 ${score.details.missed_items.length}`,
  );
  console.log(
    `  sort ${score.sorting?.actual.join(',')} | correct=${score.sorting?.correct} | response action seq=${score.details.first_response_action_seq}`,
  );
}
console.log('clock_checks: 1× = 45s, 4× = 45s (模拟时刻 30 → 75 固定)');
console.log('quality cases: SC-03 / SC-03b / SC-04 / SC-05 / SC-07 / SC-08 通过');
