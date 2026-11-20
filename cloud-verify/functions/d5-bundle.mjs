// Ported from src/scenario-generation/bundle.ts, src/action-engine.ts and the
// relevant parts of src/fixture-port.ts. Kept field-for-field with the browser
// implementation so the server and client rebuild the same run package.
import { actionCatalog, campusMap, getTemplate, playbackSpeeds, resources } from './d5-data.mjs';

export const GENERATION_WAIT_MS = 15_000;
export const SESSION_LIMIT = 3;
export const ROUND_LIMIT = 4;

export class ValidationError extends Error {
  constructor(issue) {
    super(issue.message);
    this.issue = issue;
  }
}

function fail(path, code, message) {
  throw new ValidationError({ path, code, message });
}

export function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strictObject(value, keys, path) {
  if (!record(value)) fail(path, 'INVALID_OBJECT', '应为对象');
  for (const key of keys) if (!Object.hasOwn(value, key)) fail(path + '.' + key, 'REQUIRED', '缺少必填字段');
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(path, 'UNKNOWN_FIELD', '包含未授权字段');
  return value;
}

export function validateRequest(value) {
  const input = strictObject(value, ['run_id', 'request_id', 'template_id', 'modifiers'], 'request');
  const { run_id, request_id, template_id, modifiers } = input;
  if (typeof run_id !== 'string' || !/^[\w-]{12,80}$/.test(run_id)) fail('request.run_id', 'INVALID_ID', '无效轮次 ID');
  if (typeof request_id !== 'string' || !/^[\w-]{12,80}$/.test(request_id)) fail('request.request_id', 'INVALID_ID', '无效请求 ID');
  const template = typeof template_id === 'string' ? getTemplate(template_id) : undefined;
  if (!template) fail('request.template_id', 'UNKNOWN_TEMPLATE', '模板不存在');
  if (!Array.isArray(modifiers) || modifiers.length > template.modifiers.length ||
    new Set(modifiers).size !== modifiers.length || !modifiers.every((key) => template.modifiers.includes(key))) {
    fail('request.modifiers', 'INVALID_MODIFIERS', '修饰项重复或不属于所选模板');
  }
  return { run_id, request_id, template_id: template.id, modifiers: template.modifiers.filter((key) => modifiers.includes(key)) };
}

const candidateKeys = ['start_building_id', 'road_id', 'first_report_at', 'confirmed_at', 'escalation_at', 't_end', 'perspective'];
const timeBounds = { first_report_at: [15, 45], confirmed_at: [65, 115], escalation_at: [125, 190], t_end: [260, 360] };

export function candidateSchema(request) {
  const template = getTemplate(request.template_id);
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

export function validateCandidate(value, request) {
  const input = strictObject(value, candidateKeys, 'candidate');
  const template = getTemplate(request.template_id);
  const { start_building_id: start, road_id: road, perspective } = input;
  if (typeof start !== 'string' || !campusMap.buildings.some(({ id }) => id === start) || !Object.hasOwn(template.routes, start)) {
    fail('candidate.start_building_id', 'UNKNOWN_BUILDING', '楼栋不在所选模板白名单');
  }
  if (typeof road !== 'string' || !campusMap.road_segments.some(({ id }) => id === road) || !template.routes[start].includes(road)) {
    fail('candidate.road_id', 'UNKNOWN_ROAD', '路段不与该模板楼栋配对');
  }
  if (perspective !== 'witness' && perspective !== 'staff') fail('candidate.perspective', 'INVALID_ENUM', '上报视角无效');
  function time(field) {
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

export function parseCandidate(text, request) {
  let value;
  if (text.length > 4096) fail('candidate', 'TOO_LARGE', '候选超过长度限制');
  try { value = JSON.parse(text); } catch { fail('candidate', 'INVALID_JSON', '模型输出不是 JSON'); }
  return validateCandidate(value, request);
}

const modifierLabels = { night: '夜间值班', heavy_rain: '暴雨加强', comms_outage: '通信延迟', crowd_peak: '散场高峰' };

export function assembleBundle(request, plan, source) {
  const p = validateCandidate(plan, request);
  const template = getTemplate(request.template_id);
  const { start_building_id: start, road_id: road, first_report_at: first, confirmed_at: confirm, escalation_at: escalation, t_end: end } = p;
  const building = campusMap.buildings.find(({ id }) => id === start).name;
  const roadName = campusMap.road_segments.find(({ id }) => id === road).name;
  const modifiers = { night: false, heavy_rain: false, comms_outage: false, crowd_peak: false };
  for (const modifier of request.modifiers) modifiers[modifier] = true;
  const reports = [];
  function add(category, at, message, real, locatable, expected, priority, reason) {
    const report = {
      id: 'U' + (reports.length + 1), category, appears_at_sim: at, text: message, is_training: 1,
      event_truth: { is_real: real, locatable, building_id: locatable ? start : null },
      judgment_windows: [{ from_sim: at, to_sim: null, expected, reason }], priority,
    };
    reports.push(report);
    return report;
  }
  const lead = add('true_report', first, building + '。' + template.reports[p.perspective], true, true, '待核', 4, '首报只有单方描述，待导调核实。');
  lead.judgment_windows[0].to_sim = confirm;
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

  const nodes = new Map();
  function addNode(at, label) {
    if (!nodes.has(at)) nodes.set(at, { label, events: [] });
    return nodes.get(at);
  }
  addNode(0, request.modifiers.length ? request.modifiers.map((key) => modifierLabels[key]).join(' · ') : '值班交接');
  addNode(confirm, template.confirmed).events.push({ type: 'disaster_confirm', building_id: start, title: template.confirmed, adds_disaster_annotation: true });
  addNode(escalation, template.intensifies).events.push({ type: 'road_hazard', road_id: road, hazard: template.hazard, description: template.hazardText });
  addNode(confirm + 30, '核对警戒与后续处置');
  addNode(end, '末回合 · 排序与结算');
  for (const report of reports) addNode(report.appears_at_sim, '收到训练上报').events.push({ type: 'ugc_appear', report_id: report.id });

  const standard = template.actions.map((id) => {
    const action = actionCatalog.find((item) => item.id === id);
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

// --- action engine subset used by referenceActions ---
function actionCompletedBy(action, t) {
  return action.status === 'accepted' && action.completed_at_sim !== null && action.completed_at_sim <= t;
}
function scenarioEventsAt(scenario, t) {
  return scenario.nodes
    .filter((node) => node.t_sim <= t)
    .sort((a, b) => a.t_sim - b.t_sim)
    .flatMap((node) => node.events.map((event) => ({ node_id: node.id, t_sim: node.t_sim, event })));
}
function resourceFits(candidate, attempts, capacity) {
  if (candidate.from_sim === candidate.to_sim) return true;
  const checkpoints = new Map([[candidate.from_sim, candidate.units]]);
  function add(t, delta) {
    checkpoints.set(t, (checkpoints.get(t) ?? 0) + delta);
  }
  for (const action of attempts) {
    const usage = action.resource_usage;
    if (action.status !== 'accepted' || !usage || usage.resource_id !== candidate.resource_id) continue;
    const start = Math.max(candidate.from_sim, usage.from_sim);
    const end = Math.min(candidate.to_sim, usage.to_sim ?? Infinity);
    if (start >= end) continue;
    add(start, usage.units);
    add(end, -usage.units);
  }
  let active = 0;
  for (const [, delta] of [...checkpoints].sort(([a], [b]) => a - b)) {
    active += delta;
    if (active > capacity) return false;
  }
  return true;
}
function createActionJudge({ scenario, action_catalog }, map) {
  const catalog = new Map(action_catalog.map((action) => [action.id, action]));
  const resourceMap = new Map(scenario.resources.map((resource) => [resource.id, resource]));
  const nodeTimes = new Set(scenario.nodes.map((node) => node.t_sim));
  const targets = new Map([
    ...map.buildings.map(({ id }) => [id, 'building']),
    ...map.road_segments.map(({ id }) => [id, 'road']),
    ...map.junctions.map(({ id }) => [id, 'junction']),
  ]);
  const initiallyClosed = new Set(map.road_segments.filter((road) => road.blocked).map((road) => road.id));
  function invalidConfig(detail) {
    throw new Error('INVALID_ACTION_CONFIG: ' + detail);
  }
  function compilePrecondition(action, rule) {
    const reason = rule.description;
    switch (rule.type) {
      case 'requires_completed_action': {
        const required = rule.action_id && catalog.get(rule.action_id);
        if (!required || required.target_kind !== action.target_kind) invalidConfig(`${action.id} 的前置动作不存在或对象类型不匹配`);
        return ({ completed }) => completed.some((item) => item.action_id === required.id) ? null : { code: 'PRECONDITION_NOT_MET', reason };
      }
      case 'requires_disaster_annotation':
        return ({ input }) => scenarioEventsAt(scenario, input.submitted_at_sim).some(({ event }) =>
          event.type === 'disaster_confirm' && event.building_id === input.target_id && event.adds_disaster_annotation,
        ) ? null : { code: 'TARGET_NOT_APPLICABLE', reason };
      case 'not_already_completed':
        return ({ action: current, completed }) => completed.some((item) => item.action_id === current.id) ? { code: 'STATUS_CONFLICT', reason } : null;
      case 'not_powered_off':
        return ({ completed }) => completed.some((item) => item.action_id === 'A6') ? { code: 'STATUS_CONFLICT', reason } : null;
      case 'road_not_closed':
        return ({ input, completed }) => initiallyClosed.has(input.target_id) || completed.some((item) => item.action_id === 'A5')
          ? { code: 'STATUS_CONFLICT', reason } : null;
      default:
        return invalidConfig(`${action.id} 声明了未知前置条件 ${rule.type}`);
    }
  }
  const compiled = new Map(action_catalog.map((action) => {
    const resource = resourceMap.get(action.resource_id);
    if (!resource) invalidConfig(`${action.id} 对应的资源不存在`);
    return [action.id, { action, resource, checks: action.preconditions.map((rule) => compilePrecondition(action, rule)) }];
  }));
  return (input) => {
    const { action_id, target_id, submitted_at_sim, seq, prior_events } = input;
    const definition = compiled.get(action_id);
    if (!definition) throw new Error('UNKNOWN_ACTION');
    const { action, resource, checks } = definition;
    const attempts = [];
    for (const event of prior_events) {
      if (event.kind === 'action') attempts.push(event.payload);
    }
    const sameTarget = attempts.filter((item) => item.target_id === target_id);
    const attempt = sameTarget.filter((item) => item.action_id === action_id).length + 1;
    const core = { seq, attempt, action_id, target_id, submitted_at_sim, duration_sim: action.duration_sim };
    function reject(code, reason) {
      return { ...core, status: 'rejected', reject_reason_code: code, reject_reason: reason, completed_at_sim: null, resource_usage: null };
    }
    const targetKind = targets.get(target_id);
    if (!targetKind) return reject('UNKNOWN_TARGET', `找不到目标 ${target_id}`);
    if (targetKind !== action.target_kind) return reject('TARGET_NOT_APPLICABLE', `${action.name}的目标类型不符`);
    const completed = sameTarget.filter((item) => actionCompletedBy(item, submitted_at_sim));
    for (const check of checks) {
      const failure = check({ input, action, completed });
      if (failure) return reject(failure.code, failure.reason);
    }
    const completion = submitted_at_sim + action.duration_sim;
    const usage = { resource_id: resource.id, units: action.resource_units, action_seq: seq, from_sim: submitted_at_sim, to_sim: completion };
    if (!resourceFits(usage, attempts, resource.capacity)) return reject('RESOURCE_UNAVAILABLE', `${resource.name}在预计执行区间内余量不足`);
    return { ...core, status: 'accepted', reject_reason_code: null, reject_reason: null, completed_at_sim: completion, resource_usage: usage };
  };
}

export function referenceActions(bundle) {
  const judge = createActionJudge(bundle, campusMap);
  const { first_report_at: first, confirmed_at: confirm, escalation_at: escalation } = bundle.candidate;
  const scheduled = bundle.scenario.standard_actions.map((item, index) => ({
    ...item, index, at: item.action_id === 'A1' ? first : item.action_id === 'A4' ? confirm + 30 : item.action_id === 'A5' ? escalation : confirm,
  })).sort((a, b) => a.at - b.at || a.index - b.index);
  const events = [];
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

function compare(value, expected, path) {
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

export function validateBundle(value, request, source) {
  const input = strictObject(value, ['candidate', 'scenario', 'ugc_reports', 'action_catalog'], 'bundle');
  const expected = assembleBundle(request, validateCandidate(input.candidate, request), source);
  if (source === 'fallback') compare(expected.candidate, getTemplate(request.template_id).preset, 'bundle.candidate');
  compare(input, expected, 'bundle');
  referenceActions(expected);
  return expected;
}

export function fallbackResult(request, reason, elapsed_ms = 0, calls = 0) {
  const preset = assembleBundle(request, getTemplate(request.template_id).preset, 'fallback');
  const bundle = validateBundle(preset, request, 'fallback');
  return {
    request, bundle, selection: reason ? 'fallback' : 'preset', scenario_source: 'fallback', report_source: 'preset',
    provider: null, fallback_reason: reason, elapsed_ms, calls, shared_retry_used: calls === null ? null : false,
    upstream_state: calls === null ? 'unknown' : 'not_sent', issues: [],
  };
}

export function generationPrompt(request, issue) {
  const template = getTemplate(request.template_id);
  return JSON.stringify({
    instruction: '为校园应急训练选择一组剧情事实。仅输出符合 Schema 的单个 JSON 对象，不要 Markdown、命令或文件操作。',
    template: template.description,
    modifiers: request.modifiers,
    allowed_road_by_building: template.routes,
    constraints: ['核实比首报晚至少 25 秒', '事态加剧比核实晚至少 20 秒', '结束比加剧晚至少 45 秒'],
    output_schema: candidateSchema(request),
    previous_validation_issue: issue,
  });
}
