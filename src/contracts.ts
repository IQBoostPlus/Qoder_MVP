/**
 * D1 数据契约基线（2026-11-17）
 * 仅供 Node 与浏览器共同引用；不含运行时代码。
 * 正式路径算法、规则引擎与生产评分器分别在 D2～D4 交付。
 */

export type SimSeconds = number;
export type BuildingId = string;
export type JunctionId = string;
export type RoadId = string;
export type ReportId = string;

export type Verdict = '真报' | '误报' | '待核';
export type Unlocatable = '无法定位';
export type LocationChoice = BuildingId | Unlocatable;

export type ActionId = 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6';
export type ActionTargetKind = 'building' | 'road';
export type ActionAttemptStatus = 'accepted' | 'rejected';

export type RejectReasonCode =
  | 'UNKNOWN_TARGET'
  | 'PRECONDITION_NOT_MET'
  | 'TARGET_NOT_APPLICABLE'
  | 'STATUS_CONFLICT'
  | 'RESOURCE_UNAVAILABLE';

export interface Point {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// 地图与基础设施
// ---------------------------------------------------------------------------

export type BuildingCategory =
  | 'dormitory'
  | 'canteen'
  | 'teaching'
  | 'laboratory'
  | 'library'
  | 'gymnasium'
  | 'office'
  | 'other';

export interface Building {
  id: BuildingId;
  name: string;
  /** 真实苑/园分区，如“萃园·北区”“文博苑·中部” */
  zone: string;
  category: BuildingCategory;
  /** 楼层数；训练地图中，体育馆的 null 表示大跨度通高，其余 null 表示未公开。 */
  floors: number | null;
  /** 估算容量，训练级精度 */
  capacity: number;
  /** 风险标注：变电 / 燃气 / 实验室等；无则 null */
  risk_tag: string | null;
  /** SVG 使用的楼栋多边形，至少 3 个点 */
  polygon: Point[];
  /** 由 road_segments 推导出的直接相邻楼栋；不包含校门或路口 */
  adjacency: BuildingId[];
}

/** 校门与路口：路网节点，不是楼栋，不计入 20 栋 */
export interface Junction {
  id: JunctionId;
  name: string;
  kind: 'gate' | 'crossing';
}

export type RoadHazard = 'flood' | 'fire' | 'debris' | null;

export interface RoadSegment {
  id: RoadId;
  name: string;
  /** 端点引用 Building.id 或 Junction.id */
  from: BuildingId | JunctionId;
  to: BuildingId | JunctionId;
  /** 路段折线；首尾点为端点，供 B 绘制与 D2 路径计算 */
  geometry: Point[];
  /** 正式封闭状态，只有 A5 封路成功后才置 true */
  blocked: boolean;
  /** 自然灾情状态（如积水），与正式封闭分开，D2 路径重算可将其视为不可通行 */
  hazard: RoadHazard;
  block_reason: string | null;
}

export interface ResourceDef {
  id: string;
  name: string;
  capacity: number;
  unit: string;
}

export interface ResourceUsage {
  resource_id: string;
  units: number;
  /** 对应 RunEvent.seq 中的动作事件 */
  action_seq: number;
  from_sim: SimSeconds;
  /** 动作被拒绝时为 null */
  to_sim: SimSeconds | null;
}

// ---------------------------------------------------------------------------
// 动作规则
// ---------------------------------------------------------------------------

export type PreconditionType =
  | 'requires_completed_action'
  | 'requires_disaster_annotation'
  | 'not_already_completed'
  | 'not_powered_off'
  | 'road_not_closed';

export interface ActionPrecondition {
  type: PreconditionType;
  /** requires_completed_action 使用；作用对象固定为同一对象 */
  action_id?: ActionId;
  description: string;
}

export interface ActionDef {
  id: ActionId;
  name: string;
  target_kind: ActionTargetKind;
  critical: boolean;
  /** 标准动作命中率的权重；目录内总权重为 10 */
  weight: number;
  duration_sim: SimSeconds;
  resource_id: string;
  resource_units: number;
  preconditions: ActionPrecondition[];
}

export interface StandardActionItem {
  action_id: ActionId;
  target_id: BuildingId | RoadId;
  label: string;
}

// ---------------------------------------------------------------------------
// 剧本与模拟上报
// ---------------------------------------------------------------------------

export interface ScenarioModifiers {
  night: boolean;
  heavy_rain: boolean;
  comms_outage: boolean;
  crowd_peak: boolean;
}

export type ScenarioEvent =
  | {
      type: 'ugc_appear';
      report_id: ReportId;
    }
  | {
      type: 'disaster_confirm';
      building_id: BuildingId;
      title: string;
      /** 是否给楼栋增加“存在灾情标注”状态，供 A6 断电前置条件使用 */
      adds_disaster_annotation: boolean;
    }
  | {
      type: 'road_hazard';
      road_id: RoadId;
      hazard: Exclude<RoadHazard, null>;
      description: string;
    };

export interface ScenarioNode {
  id: string;
  t_sim: SimSeconds;
  label: string;
  /** 可同时注入多个事件；纯操作节点允许为空数组 */
  events: ScenarioEvent[];
}

export interface Scenario {
  id: string;
  template_id: string;
  title: string;
  source: 'generated' | 'fallback' | 'canonical';
  modifiers: ScenarioModifiers;
  start_building_id: BuildingId;
  t_end: SimSeconds;
  nodes: ScenarioNode[];
  standard_actions: StandardActionItem[];
  critical_items: StandardActionItem[];
  resources: ResourceDef[];
  /** 样例要求 1× 与 4× 均能到达同一模拟时刻 */
  playback_speeds: number[];
}

export type UgcCategory =
  | 'true_report'
  | 'false_report'
  | 'emotional'
  | 'vague_location'
  | 'duplicate'
  | 'other';

/** 事后真值：客观锚点，用于复盘揭示与响应时长起点 */
export interface EventTruth {
  is_real: boolean;
  locatable: boolean;
  /** locatable=false 时必须为 null */
  building_id: BuildingId | null;
}

/** 分时段合理判断：计分依据，随核实进展分段变化 */
export interface JudgmentWindow {
  from_sim: SimSeconds;
  /** null 表示直到推演结束 */
  to_sim: SimSeconds | null;
  expected: Verdict;
  /** 复盘时向学员解释为何此时应这样判 */
  reason: string;
}

export interface UgcReportBase {
  id: ReportId;
  category: UgcCategory;
  appears_at_sim: SimSeconds;
  text: string;
  event_truth: EventTruth;
  judgment_windows: JudgmentWindow[];
  /** 1 最紧急；本轮内唯一 */
  priority: number;
}

/** 训练上报固定 is_training = 1 */
export type UgcReport = UgcReportBase & { is_training: 1 };
export type TrainingReport = UgcReport;

// ---------------------------------------------------------------------------
// 推演流水
// ---------------------------------------------------------------------------

export interface VerdictAttempt {
  seq: number;
  report_id: ReportId;
  judged_at_sim: SimSeconds;
  verdict: Verdict;
  location: LocationChoice | null;
  /** 改判时指向被覆盖的前次判定 seq；首判为 null */
  supersedes_seq: number | null;
}

export interface ActionAttempt {
  seq: number;
  /** 同一 action_id + target_id 的尝试序号，从 1 开始 */
  attempt: number;
  action_id: ActionId;
  target_id: BuildingId | RoadId;
  submitted_at_sim: SimSeconds;
  duration_sim: SimSeconds;
  /** 被拒绝时为 null */
  completed_at_sim: SimSeconds | null;
  status: ActionAttemptStatus;
  reject_reason_code: RejectReasonCode | null;
  reject_reason: string | null;
  resource_usage: ResourceUsage | null;
}

export interface SortSubmission {
  seq: number;
  t_sim: SimSeconds;
  ordered_report_ids: ReportId[];
}

export type RunEvent =
  | { seq: number; t_sim: SimSeconds; kind: 'verdict'; payload: VerdictAttempt }
  | { seq: number; t_sim: SimSeconds; kind: 'action'; payload: ActionAttempt }
  | { seq: number; t_sim: SimSeconds; kind: 'sort'; payload: SortSubmission };

export interface RunRecord {
  run_id: string;
  scenario_id: string;
  branch: '甲' | '乙' | '甲补做A4';
  playback_speed: number;
  events: RunEvent[];
  /** 并行动作的合法资源占用记录；与 accepted 动作一一对应 */
  resource_occupancy: ResourceUsage[];
}

// ---------------------------------------------------------------------------
// 评分结果
// ---------------------------------------------------------------------------

export interface ScoreDetails {
  correct_judgments: number;
  total_reports: number;
  wrong_report_ids: ReportId[];
  first_real_report_id: ReportId | null;
  first_response_action_seq: number | null;
  response_seconds: SimSeconds | null;
  coverage_hit_weights: number;
  coverage_total_weights: number;
  missed_items: StandardActionItem[];
  violation_count: number;
  violation_event_seqs: number[];
}

export interface ScoreResult {
  discrimination: number;
  response: number;
  coverage: number;
  violation: number;
  /** 加权求和后四舍五入 */
  total: number;
  details: ScoreDetails;
  sorting?: {
    expected: ReportId[];
    actual: ReportId[];
    correct: boolean;
  };
}

export interface ClockCheck {
  label: string;
  run_id: string;
  playback_speed: number;
  expected_response_seconds: SimSeconds;
}

/** fixtures/canonical-run.json 的顶层结构 */
export interface CanonicalFixture {
  schema_version: 'd1-1';
  generated_at: string;
  scenario: Scenario;
  buildings: Building[];
  junctions: Junction[];
  road_segments: RoadSegment[];
  ugc_reports: UgcReport[];
  action_catalog: ActionDef[];
  runs: RunRecord[];
  clock_checks: ClockCheck[];
  expected_sort: ReportId[];
  expected_scores: Record<string, ScoreResult>;
}
