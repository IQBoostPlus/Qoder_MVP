import type { RunEvent, ScenarioEvent, ScenarioModifiers, SimSeconds, UgcCategory, UgcReport, Verdict } from '../contracts';
import { createActionJudge } from '../action-engine.ts';
import { actionCatalog, campusMap, getTemplate, playbackSpeeds, resources } from './templates.ts';
import type { Candidate, FallbackReason, GenerationRequest, GenerationResult, Issue, Modifier, ScenarioBundle } from './contracts';

export class ValidationError extends Error {
  constructor(readonly issue: Issue) {
    super(issue.message);
  }
}

function fail(path: string, code: string, message: string): never {
  throw new ValidationError({ path, code, message });
}

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strictObject(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (!record(value)) fail(path, 'INVALID_OBJECT', '应为对象');
  for (const key of keys) if (!Object.hasOwn(value, key)) fail(path + '.' + key, 'REQUIRED', '缺少必填字段');
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(path, 'UNKNOWN_FIELD', '包含未授权字段');
  return value;
}

export function validateRequest(value: unknown): GenerationRequest {
  const input = strictObject(value, ['run_id', 'request_id', 'template_id', 'modifiers'], 'request');
  const { run_id, request_id, template_id, modifiers } = input;
  if (typeof run_id !== 'string' || !/^[\w-]{12,80}$/.test(run_id)) fail('request.run_id', 'INVALID_ID', '无效轮次 ID');
  if (typeof request_id !== 'string' || !/^[\w-]{12,80}$/.test(request_id)) fail('request.request_id', 'INVALID_ID', '无效请求 ID');
  const template = typeof template_id === 'string' ? getTemplate(template_id) : undefined;
  if (!template) fail('request.template_id', 'UNKNOWN_TEMPLATE', '模板不存在');
  if (!Array.isArray(modifiers) || modifiers.length > template.modifiers.length ||
    new Set(modifiers).size !== modifiers.length || !modifiers.every((key: unknown) => template.modifiers.some((option) => option === key))) {
    fail('request.modifiers', 'INVALID_MODIFIERS', '修饰项重复或不属于所选模板');
  }
  return { run_id, request_id, template_id: template.id, modifiers: template.modifiers.filter((key) => modifiers.includes(key)) };
}

const candidateKeys = ['start_building_id', 'road_id', 'first_report_at', 'confirmed_at', 'escalation_at', 't_end', 'perspective'] as const;
const timeBounds = { first_report_at: [15, 45], confirmed_at: [65, 115], escalation_at: [125, 190], t_end: [260, 360] } as const;

export function candidateSchema(request: GenerationRequest) {
  const template = getTemplate(request.template_id)!;
  return {
    type: 'object', additionalProperties: false, required: candidateKeys,
    properties: {
      start_building_id: { enum: Object.keys(template.routes) },
      road_id: { enum: [...new Set(Object.values(template.routes).flat())] },
      ...Object.fromEntries(Object.entries(timeBounds).map(([field, [minimum, maximum]]) => [field, { type: 'integer', minimum, maximum }])),
      perspective: { enum: ['witness', 'staff'] },
    },
  };
}

export function validateCandidate(value: unknown, request: GenerationRequest): Candidate {
  const input = strictObject(value, candidateKeys, 'candidate');
  const template = getTemplate(request.template_id)!;
  const { start_building_id: start, road_id: road, perspective } = input;
  if (typeof start !== 'string' || !campusMap.buildings.some(({ id }) => id === start) || !Object.hasOwn(template.routes, start)) {
    fail('candidate.start_building_id', 'UNKNOWN_BUILDING', '楼栋不在所选模板白名单');
  }
  if (typeof road !== 'string' || !campusMap.road_segments.some(({ id }) => id === road) || !template.routes[start]?.includes(road)) {
    fail('candidate.road_id', 'UNKNOWN_ROAD', '路段不与该模板楼栋配对');
  }
  if (perspective !== 'witness' && perspective !== 'staff') fail('candidate.perspective', 'INVALID_ENUM', '上报视角无效');
  function time(field: keyof typeof timeBounds) {
    const value = input[field];
    const [min, max] = timeBounds[field];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      fail('candidate.' + field, 'INVALID_TIME', '时间超出允许的整数范围');
    }
    return value;
  }
  const first = time('first_report_at');
  const confirm = time('confirmed_at');
  const escalation = time('escalation_at');
  const end = time('t_end');
  if (confirm - first < 25) fail('candidate.confirmed_at', 'INVALID_ORDER', '首报与核实至少相隔 25 秒');
  if (escalation - confirm < 20) fail('candidate.escalation_at', 'INVALID_ORDER', '核实与加剧至少相隔 20 秒');
  if (end - escalation < 45) fail('candidate.t_end', 'INVALID_ORDER', '保留动作完成及末回合时间');
  return { start_building_id: start, road_id: road, first_report_at: first, confirmed_at: confirm, escalation_at: escalation, t_end: end, perspective };
}

export function parseCandidate(text: string, request: GenerationRequest): Candidate {
  let value: unknown;
  if (text.length > 4096) fail('candidate', 'TOO_LARGE', '候选超过长度限制');
  try { value = JSON.parse(text); } catch { fail('candidate', 'INVALID_JSON', '模型输出不是 JSON'); }
  return validateCandidate(value, request);
}

const modifierLabels: Record<Modifier, string> = { night: '夜间值班', heavy_rain: '暴雨加强', comms_outage: '通信延迟', crowd_peak: '散场高峰' };

export function assembleBundle(request: GenerationRequest, plan: Candidate, source: 'generated' | 'fallback'): ScenarioBundle {
  const p = validateCandidate(plan, request);
  const template = getTemplate(request.template_id)!;
  const { start_building_id: start, road_id: road, first_report_at: first, confirmed_at: confirm, escalation_at: escalation, t_end: end } = p;
  const building = campusMap.buildings.find(({ id }) => id === start)!.name;
  const roadName = campusMap.road_segments.find(({ id }) => id === road)!.name;
  const modifiers: ScenarioModifiers = { night: false, heavy_rain: false, comms_outage: false, crowd_peak: false };
  for (const modifier of request.modifiers) modifiers[modifier] = true;
  const reports: UgcReport[] = [];
  function add(category: UgcCategory, at: number, message: string, real: boolean, locatable: boolean, expected: Verdict, priority: number, reason: string) {
    const report: UgcReport = {
      id: 'U' + (reports.length + 1), category, appears_at_sim: at, text: message, is_training: 1,
      event_truth: { is_real: real, locatable, building_id: locatable ? start : null },
      judgment_windows: [{ from_sim: at, to_sim: null, expected, reason }], priority,
    };
    reports.push(report);
    return report;
  }
  const lead = add('true_report', first, building + '。' + template.reports[p.perspective], true, true, '待核', 4, '首报只有单方描述，待导调核实。');
  lead.judgment_windows[0]!.to_sim = confirm;
  lead.judgment_windows.push({ from_sim: confirm, to_sim: null, expected: '真报', reason: '导调已核实首报所述态势。' });
  add('false_report', first + 8, template.reports.falseAlarm, false, false, '误报', 8, '上报已经说明现场核对结果。');
  add('vague_location', first + 16, '听说附近有异常，但消息没有具体位置。', false, false, '待核', 7, '线索含糊且没有位置。');
  add('true_report', confirm, building + '。' + template.reports.verified, true, true, '真报', 1, '导调核实信息。');
  add('duplicate', confirm + 7, building + '。' + template.reports.duplicate, true, true, '真报', 6, '内容已获核实，但与首报指向同一事件。');
  add('emotional', confirm + 14, '我有点慌，群里只说出事了，具体不清楚。', false, false, '待核', 10, '只有情绪和未核转述。');
  add('true_report', escalation, roadName + '。' + template.hazardText + '，参照楼栋为' + building + '。', true, true, '真报', 2, '节点已标记真实路段阻断。');
  add('true_report', escalation + 10, building + '。' + template.reports.newClue, true, true, '真报', 3, '现场人员补充了同一事件的真实线索。');
  add('false_report', escalation + 20, template.reports.rumor, false, false, '误报', 9, '导调已经核查并否定传言。');
  add('duplicate', escalation + 30, '再次转发：' + roadName + '当前不通，靠近' + building + '。', true, true, '真报', 5, '与已核实的路段阻断重复。');

  const nodes = new Map<SimSeconds, { label: string; events: ScenarioEvent[] }>();
  function addNode(at: number, label: string) {
    if (!nodes.has(at)) nodes.set(at, { label, events: [] });
    return nodes.get(at)!;
  }
  addNode(0, request.modifiers.length ? request.modifiers.map((key) => modifierLabels[key]).join(' · ') : '值班交接');
  addNode(confirm, template.confirmed).events.push({ type: 'disaster_confirm', building_id: start, title: template.confirmed, adds_disaster_annotation: true });
  addNode(escalation, template.intensifies).events.push({ type: 'road_hazard', road_id: road, hazard: template.hazard, description: template.hazardText });
  addNode(confirm + 30, '核对警戒与后续处置');
  addNode(end, '末回合 · 排序与结算');
  for (const report of reports) addNode(report.appears_at_sim, '收到训练上报').events.push({ type: 'ugc_appear', report_id: report.id });

  const standard = template.actions.map((id) => {
    const action = actionCatalog.find((action) => action.id === id)!;
    return { action_id: id, target_id: action.target_kind === 'road' ? road : start, label: action.name };
  });
  const scenario = {
    id: 'd5-' + request.run_id, template_id: template.id, title: template.name + ' · ' + building,
    source, modifiers, start_building_id: start, t_end: end, standard_actions: standard,
    critical_items: standard.filter((item) => actionCatalog.some((action) => action.id === item.action_id && action.critical)),
    resources, playback_speeds: playbackSpeeds,
    nodes: [...nodes.entries()].sort(([a], [b]) => a - b).map(([t_sim, node], index) => ({ id: 'N' + index, t_sim, ...node })),
  };
  return { scenario, ugc_reports: reports, candidate: p, action_catalog: actionCatalog };
}

export function referenceActions(bundle: ScenarioBundle): Extract<RunEvent, { kind: 'action' }>[] {
  const judge = createActionJudge(bundle, campusMap);
  const { first_report_at: first, confirmed_at: confirm, escalation_at: escalation } = bundle.candidate;
  const scheduled = bundle.scenario.standard_actions.map((item, index) => ({
    ...item, index, at: item.action_id === 'A1' ? first : item.action_id === 'A4' ? confirm + 30 : item.action_id === 'A5' ? escalation : confirm,
  })).sort((a, b) => a.at - b.at || a.index - b.index);
  const events: Extract<RunEvent, { kind: 'action' }>[] = [];
  for (const { index, action_id, target_id, at } of scheduled) {
    const seq = events.length + 1;
    const payload = judge({ action_id, target_id, submitted_at_sim: at, seq, prior_events: events });
    if (payload.status !== 'accepted' || payload.completed_at_sim === null || payload.completed_at_sim > bundle.scenario.t_end) {
      fail('bundle.scenario.standard_actions.' + index, 'INFEASIBLE_ACTION', '标准动作无法按参考序列完成');
    }
    events.push({ seq, t_sim: at, kind: 'action', payload });
  }
  return events;
}

// D5 的节点、动作与上报只允许来自可信模板。逐字段比较并返回重建结果，拒绝任何额外字段。
function compare(value: unknown, expected: unknown, path: string): void {
  if (Array.isArray(expected)) {
    if (!Array.isArray(value) || value.length !== expected.length) fail(path, 'ARRAY_MISMATCH', '条目数与模板约束不符');
    for (const [i, item] of expected.entries()) compare(value[i], item, path + '.' + i);
  } else if (record(expected)) {
    const input = strictObject(value, Object.keys(expected), path);
    for (const [key, item] of Object.entries(expected)) compare(input[key], item, path + '.' + key);
  } else if (value !== expected) {
    fail(path, 'TEMPLATE_MISMATCH', '值与已验证的模板事实或规则不一致');
  }
}

export function validateBundle(value: unknown, request: GenerationRequest, source: 'generated' | 'fallback'): ScenarioBundle {
  const input = strictObject(value, ['candidate', 'scenario', 'ugc_reports', 'action_catalog'], 'bundle');
  const expected = assembleBundle(request, validateCandidate(input.candidate, request), source);
  if (source === 'fallback') compare(expected.candidate, getTemplate(request.template_id)!.preset, 'bundle.candidate');
  compare(input, expected, 'bundle');
  referenceActions(expected);
  return expected;
}

export function fallbackResult(
  request: GenerationRequest, reason: FallbackReason | null, elapsed_ms = 0, calls: number | null = 0,
): GenerationResult {
  const preset = assembleBundle(request, getTemplate(request.template_id)!.preset, 'fallback');
  const bundle = validateBundle(preset, request, 'fallback');
  return {
    request, bundle, selection: reason ? 'fallback' : 'preset', scenario_source: 'fallback', report_source: 'preset',
    provider: null, fallback_reason: reason, elapsed_ms, calls, shared_retry_used: calls === null ? null : false,
    upstream_state: calls === null ? 'unknown' : 'not_sent', issues: [],
  };
}
