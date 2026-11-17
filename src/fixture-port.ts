/**
 * D1-v2 前端只读接口：地图派生、可见性、判断窗、回放与静态评分。
 * 纯函数，不依赖 Node API；所有数据由参数传入。
 * 生产路径算法与实时评分器分别在 D2 / D4 交付，本文件只提供空态契约。
 */
import type {
  ActionAttempt,
  Building,
  CanonicalFixture,
  JudgmentWindow,
  Junction,
  Point,
  ReportId,
  ResourceUsage,
  RoadHazard,
  RoadId,
  RoadSegment,
  RunEvent,
  ScenarioEvent,
  ScoreResult,
  SimSeconds,
  SortSubmission,
  UgcReport,
  VerdictAttempt,
} from './contracts';

export const PRECISION_NOTICE =
  '训练级精度。建筑名称、分区与层数来自公开资料及校内确认（2026-11-17）；平面位置、轮廓、容量、风险标注与道路阻断条件均为人工构造的模拟设定，不代表实测坐标或该校真实隐患分布。';

export const ROUTE_PENDING_TEXT = '路径计算待引擎接入';
export const ROUTE_UNREACHABLE_TEXT = '路径已计算，但当前路网无可通行路径';
export const SCORE_PENDING_TEXT = '实时评分待引擎接入';
export const MAP_VIEW_PADDING = 20;

// ---------------------------------------------------------------------------
// 地图派生
// ---------------------------------------------------------------------------

export interface MapSource {
  buildings: readonly Building[];
  junctions: readonly Junction[];
  road_segments: readonly RoadSegment[];
}

export interface MapBounds {
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
}

export interface MapViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MapView {
  buildings: readonly Building[];
  junctions: readonly Junction[];
  road_segments: readonly RoadSegment[];
  /** 路口位置由引用它的路段端点派生 */
  junction_positions: Readonly<Record<string, Point>>;
  /** 每条路段折线按段累加的欧氏长度，单位 px */
  road_lengths_px: Readonly<Record<RoadId, number>>;
  bounds: Readonly<MapBounds>;
  view_box: Readonly<MapViewBox>;
  view_box_svg: string;
}

export type FixturePortErrorCode =
  | 'MAP_DUPLICATE_NODE_ID'
  | 'MAP_DUPLICATE_ROAD_ID'
  | 'MAP_INVALID_GEOMETRY'
  | 'MAP_UNKNOWN_ENDPOINT'
  | 'MAP_SAME_ENDPOINTS'
  | 'MAP_JUNCTION_UNREFERENCED'
  | 'MAP_ENDPOINT_MISMATCH'
  | 'MAP_ZERO_LENGTH'
  | 'REPLAY_INVALID_CUT';

export class FixturePortError extends Error {
  readonly code: FixturePortErrorCode;
  readonly object_id: string;

  constructor(code: FixturePortErrorCode, objectId: string, detail: string) {
    super(`${code}: ${objectId}: ${detail}`);
    this.name = 'FixturePortError';
    this.code = code;
    this.object_id = objectId;
  }
}

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) <= 1e-9 && Math.abs(a.y - b.y) <= 1e-9;
}

function assertPoint(point: Point, roadId: string): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new FixturePortError('MAP_INVALID_GEOMETRY', roadId, '折线包含非有限坐标');
  }
}

function pointDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function buildMapView(
  source: MapSource,
  options: { padding?: number } = {},
): MapView {
  const padding = options.padding ?? MAP_VIEW_PADDING;
  if (!Number.isFinite(padding) || padding < 0) {
    throw new FixturePortError('MAP_INVALID_GEOMETRY', 'view_box', '留白必须是非负有限数');
  }

  const nodeIds = new Set<string>();
  for (const building of source.buildings) {
    if (nodeIds.has(building.id)) {
      throw new FixturePortError('MAP_DUPLICATE_NODE_ID', building.id, '楼栋 id 重复');
    }
    nodeIds.add(building.id);
  }
  for (const junction of source.junctions) {
    if (nodeIds.has(junction.id)) {
      throw new FixturePortError('MAP_DUPLICATE_NODE_ID', junction.id, '路口 id 与楼栋或其他路口重复');
    }
    nodeIds.add(junction.id);
  }

  const junctionIds = new Set(source.junctions.map((junction) => junction.id));
  const junctionPositions = new Map<string, Point>();
  const roadIds = new Set<string>();
  const roadLengths = new Map<string, number>();

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  function includePoint(point: Point, ownerId: string): void {
    assertPoint(point, ownerId);
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  for (const building of source.buildings) {
    for (const point of building.polygon) includePoint(point, building.id);
  }

  function recordJunctionPosition(junctionId: string, point: Point, roadId: string): void {
    const existing = junctionPositions.get(junctionId);
    if (existing && !samePoint(existing, point)) {
      throw new FixturePortError(
        'MAP_ENDPOINT_MISMATCH',
        junctionId,
        `路口 ${junctionId} 在路段 ${roadId} 的端点与先前引用不一致`,
      );
    }
    if (!existing) junctionPositions.set(junctionId, { x: point.x, y: point.y });
  }

  for (const road of source.road_segments) {
    if (roadIds.has(road.id)) {
      throw new FixturePortError('MAP_DUPLICATE_ROAD_ID', road.id, '路段 id 重复');
    }
    roadIds.add(road.id);

    if (!nodeIds.has(road.from)) {
      throw new FixturePortError('MAP_UNKNOWN_ENDPOINT', road.id, `起点 ${road.from} 不存在`);
    }
    if (!nodeIds.has(road.to)) {
      throw new FixturePortError('MAP_UNKNOWN_ENDPOINT', road.id, `终点 ${road.to} 不存在`);
    }
    if (road.from === road.to) {
      throw new FixturePortError('MAP_SAME_ENDPOINTS', road.id, '起点与终点相同');
    }
    if (road.geometry.length < 2) {
      throw new FixturePortError('MAP_INVALID_GEOMETRY', road.id, '折线少于 2 个点');
    }

    for (const point of road.geometry) includePoint(point, road.id);

    const first = road.geometry[0];
    const last = road.geometry[road.geometry.length - 1];
    if (!first || !last) {
      throw new FixturePortError('MAP_INVALID_GEOMETRY', road.id, '折线缺少端点');
    }
    if (junctionIds.has(road.from)) recordJunctionPosition(road.from, first, road.id);
    if (junctionIds.has(road.to)) recordJunctionPosition(road.to, last, road.id);

    let length = 0;
    for (let index = 1; index < road.geometry.length; index += 1) {
      const previous = road.geometry[index - 1];
      const current = road.geometry[index];
      if (!previous || !current) {
        throw new FixturePortError('MAP_INVALID_GEOMETRY', road.id, '折线缺少点');
      }
      length += pointDistance(previous, current);
    }
    if (!(length > 0)) {
      throw new FixturePortError('MAP_ZERO_LENGTH', road.id, '路段折线长度必须大于 0');
    }
    roadLengths.set(road.id, length);
  }

  for (const junction of source.junctions) {
    if (!junctionPositions.has(junction.id)) {
      throw new FixturePortError('MAP_JUNCTION_UNREFERENCED', junction.id, '路口未被任何路段引用');
    }
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
    throw new FixturePortError('MAP_INVALID_GEOMETRY', 'view_box', '没有可用于计算视图的坐标');
  }

  const bounds: MapBounds = { min_x: minX, min_y: minY, max_x: maxX, max_y: maxY };
  const viewBox: MapViewBox = {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };

  return {
    buildings: source.buildings,
    junctions: source.junctions,
    road_segments: source.road_segments,
    junction_positions: Object.fromEntries(junctionPositions),
    road_lengths_px: Object.fromEntries(roadLengths),
    bounds,
    view_box: viewBox,
    view_box_svg: `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`,
  };
}

// ---------------------------------------------------------------------------
// 可见性与判断窗
// ---------------------------------------------------------------------------

export function visibleReportsAt(
  fixture: Pick<CanonicalFixture, 'ugc_reports'>,
  t: SimSeconds,
): UgcReport[] {
  if (!Number.isFinite(t)) return [];
  return fixture.ugc_reports
    .map((report, index) => ({ report, index }))
    .filter(({ report }) => report.appears_at_sim <= t)
    .sort(
      (a, b) =>
        a.report.appears_at_sim - b.report.appears_at_sim || a.index - b.index,
    )
    .map(({ report }) => report);
}

export function windowAt(
  fixture: Pick<CanonicalFixture, 'ugc_reports'>,
  reportId: ReportId,
  t: SimSeconds,
): JudgmentWindow | null {
  const report = fixture.ugc_reports.find((candidate) => candidate.id === reportId);
  if (!report || !Number.isFinite(t) || t < report.appears_at_sim) return null;
  return (
    report.judgment_windows.find(
      (window) => t >= window.from_sim && (window.to_sim === null || t < window.to_sim),
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// 只读回放
// ---------------------------------------------------------------------------

export interface ReplayOptions {
  /** 包含该序号；与 t_sim 同时给出时两者都是上界 */
  seq?: number;
  /** 包含该模拟时刻；与 seq 同时给出时两者都是上界 */
  t_sim?: SimSeconds;
}

export interface ScenarioEventAt {
  node_id: string;
  t_sim: SimSeconds;
  event: ScenarioEvent;
}

export interface RoadStatus {
  road_id: RoadId;
  name: string;
  hazard: RoadHazard;
  hazard_at_sim: SimSeconds | null;
  hazard_description: string | null;
  /** 正式封闭：静态封闭或已接受的 A5 在该时刻前完成 */
  formally_closed: boolean;
  closed_at_sim: SimSeconds | null;
  closed_by_action_seq: number | null;
  block_reason: string | null;
}

export interface ReplayCut {
  requested_seq: number | null;
  requested_t_sim: SimSeconds | null;
  applied_t_sim: SimSeconds;
}

export interface ReplaySnapshot {
  run_id: string;
  scenario_id: string;
  branch: '甲' | '乙' | '甲补做A4';
  playback_speed: number;
  /** 快照对应的模拟时刻 */
  t_sim: SimSeconds;
  cut: ReplayCut;
  /** 截至快照的剧本节点事件 */
  scenario_events: readonly ScenarioEventAt[];
  /** 截至截断点的学员操作 */
  events: readonly RunEvent[];
  /** 每条上报的最新判定，改判保留 supersedes_seq */
  latest_verdicts: readonly VerdictAttempt[];
  /** 截至截断点的尝试，保持原始 accepted/rejected 与原因 */
  actions: readonly ActionAttempt[];
  sorting: SortSubmission | null;
  /** 已记录的合法资源占用区间 */
  resource_occupancy: readonly ResourceUsage[];
  /** 快照时刻仍在占用的资源 */
  active_resource_occupancy: readonly ResourceUsage[];
  roads: readonly RoadStatus[];
}

const isActionEvent = (event: RunEvent): event is Extract<RunEvent, { kind: 'action' }> =>
  event.kind === 'action';
const isVerdictEvent = (event: RunEvent): event is Extract<RunEvent, { kind: 'verdict' }> =>
  event.kind === 'verdict';
const isSortEvent = (event: RunEvent): event is Extract<RunEvent, { kind: 'sort' }> =>
  event.kind === 'sort';

export function replayTo(
  fixture: CanonicalFixture,
  runId: string,
  options: ReplayOptions = {},
): ReplaySnapshot | null {
  const run = fixture.runs.find((candidate) => candidate.run_id === runId);
  if (!run) return null;

  if (
    options.seq !== undefined &&
    (!Number.isInteger(options.seq) || options.seq < 0)
  ) {
    throw new FixturePortError('REPLAY_INVALID_CUT', 'seq', '序号必须是非负整数');
  }
  if (
    options.t_sim !== undefined &&
    (!Number.isFinite(options.t_sim) || options.t_sim < 0)
  ) {
    throw new FixturePortError('REPLAY_INVALID_CUT', 't_sim', '时刻必须是非负有限数');
  }

  const seqLimit = options.seq ?? Infinity;
  const tLimit = options.t_sim ?? Infinity;
  const includedEvents = run.events
    .filter((event) => event.seq <= seqLimit && event.t_sim <= tLimit)
    .sort((a, b) => a.seq - b.seq)
    .map((event) => structuredClone(event));

  const lastIncluded = includedEvents[includedEvents.length - 1];
  const lastIncludedT = lastIncluded ? lastIncluded.t_sim : 0;
  let snapshotT: number;
  if (options.seq === undefined && options.t_sim === undefined) {
    snapshotT = fixture.scenario.t_end;
  } else if (options.t_sim === undefined) {
    snapshotT = lastIncludedT;
  } else if (options.seq === undefined) {
    snapshotT = Math.min(options.t_sim, fixture.scenario.t_end);
  } else {
    snapshotT = Math.min(options.t_sim, lastIncludedT, fixture.scenario.t_end);
  }

  const scenarioEvents: ScenarioEventAt[] = [];
  for (const node of fixture.scenario.nodes) {
    if (node.t_sim > snapshotT) continue;
    for (const event of node.events) {
      scenarioEvents.push({
        node_id: node.id,
        t_sim: node.t_sim,
        event: structuredClone(event),
      });
    }
  }

  const latestByReport = new Map<ReportId, VerdictAttempt>();
  const actions: ActionAttempt[] = [];
  let sorting: SortSubmission | null = null;
  for (const event of includedEvents) {
    if (isVerdictEvent(event)) {
      latestByReport.set(event.payload.report_id, event.payload);
    } else if (isActionEvent(event)) {
      actions.push(event.payload);
    } else if (isSortEvent(event)) {
      sorting = event.payload;
    }
  }
  const latestVerdicts = [...latestByReport.values()].sort((a, b) => a.seq - b.seq);

  const includedActionSeqs = new Set(actions.map((action) => action.seq));
  const occupancy = run.resource_occupancy
    .filter((usage) => includedActionSeqs.has(usage.action_seq))
    .map((usage) => structuredClone(usage));
  const activeOccupancy = occupancy.filter(
    (usage) =>
      usage.from_sim <= snapshotT &&
      (usage.to_sim === null || snapshotT < usage.to_sim),
  );

  const roads: RoadStatus[] = fixture.road_segments.map((road) => {
    let hazard: RoadHazard = road.hazard;
    let hazardAt: SimSeconds | null = hazard === null ? null : 0;
    let hazardDescription: string | null = null;
    for (const entry of scenarioEvents) {
      if (entry.event.type === 'road_hazard' && entry.event.road_id === road.id) {
        hazard = entry.event.hazard;
        hazardAt = entry.t_sim;
        hazardDescription = entry.event.description;
      }
    }

    let closed = road.blocked;
    let closedAt: SimSeconds | null = closed ? 0 : null;
    let closedBy: number | null = null;
    for (const action of actions) {
      if (
        action.action_id === 'A5' &&
        action.target_id === road.id &&
        action.status === 'accepted' &&
        action.completed_at_sim !== null &&
        action.completed_at_sim <= snapshotT
      ) {
        if (closedAt === null || action.completed_at_sim >= closedAt) {
          closed = true;
          closedAt = action.completed_at_sim;
          closedBy = action.seq;
        }
      }
    }

    return {
      road_id: road.id,
      name: road.name,
      hazard,
      hazard_at_sim: hazardAt,
      hazard_description: hazardDescription,
      formally_closed: closed,
      closed_at_sim: closedAt,
      closed_by_action_seq: closedBy,
      block_reason: road.block_reason,
    };
  });

  return {
    run_id: run.run_id,
    scenario_id: run.scenario_id,
    branch: run.branch,
    playback_speed: run.playback_speed,
    t_sim: snapshotT,
    cut: {
      requested_seq: options.seq ?? null,
      requested_t_sim: options.t_sim ?? null,
      applied_t_sim: snapshotT,
    },
    scenario_events: scenarioEvents,
    events: includedEvents,
    latest_verdicts: latestVerdicts,
    actions,
    sorting,
    resource_occupancy: occupancy,
    active_resource_occupancy: activeOccupancy,
    roads,
  };
}

// ---------------------------------------------------------------------------
// 静态评分
// ---------------------------------------------------------------------------

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? 'undefined' : encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

/**
 * 仅对完整匹配的基线流水返回 expected_scores。
 * 省略 currentEvents 只用于明确载入的原始样例；交互中必须传入当前流水。
 */
export function getScore(
  fixture: CanonicalFixture,
  runId: string,
  currentEvents?: readonly RunEvent[],
): ScoreResult | null {
  const run = fixture.runs.find((candidate) => candidate.run_id === runId);
  const expected = fixture.expected_scores[runId];
  if (!run || !expected) return null;
  if (currentEvents === undefined) return structuredClone(expected);
  if (canonicalJson(currentEvents) !== canonicalJson(run.events)) return null;
  return structuredClone(expected);
}

// ---------------------------------------------------------------------------
// 路径空态
// ---------------------------------------------------------------------------

export interface RouteQuery {
  from_node_id: string;
  to_node_id: string;
  at_sim: SimSeconds;
  /** D2 使用的当前路网状态；静态模式忽略，可以传 replayTo(...).roads 对应的路段。 */
  road_segments?: readonly RoadSegment[];
}

export type RouteResult =
  | {
      status: 'ready';
      from_node_id: string;
      to_node_id: string;
      at_sim: SimSeconds;
      node_ids: string[];
      road_ids: RoadId[];
      points: Point[];
      length_px: number;
    }
  | {
      status: 'unreachable';
      from_node_id: string;
      to_node_id: string;
      at_sim: SimSeconds;
      reason: string;
    };

/** D1-v2 静态模式没有路径数据；null 表示待引擎接入，不表示不可达。 */
export function getRoute(_query: RouteQuery): RouteResult | null {
  return null;
}

// ---------------------------------------------------------------------------
// 组合入口
// ---------------------------------------------------------------------------

export interface FixturePort {
  readonly map: MapView;
  visibleReportsAt(t: SimSeconds): UgcReport[];
  windowAt(reportId: ReportId, t: SimSeconds): JudgmentWindow | null;
  replayTo(runId: string, options?: ReplayOptions): ReplaySnapshot | null;
  getScore(runId: string, currentEvents?: readonly RunEvent[]): ScoreResult | null;
  getRoute(query: RouteQuery): RouteResult | null;
}

export function createFixturePort(
  fixture: CanonicalFixture,
  mapSource: MapSource = fixture,
): FixturePort {
  const map = buildMapView(mapSource);
  return {
    map,
    visibleReportsAt: (t) => visibleReportsAt(fixture, t),
    windowAt: (reportId, t) => windowAt(fixture, reportId, t),
    replayTo: (runId, options) => replayTo(fixture, runId, options),
    getScore: (runId, currentEvents) => getScore(fixture, runId, currentEvents),
    getRoute,
  };
}
