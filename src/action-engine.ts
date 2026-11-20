import type {
  ActionAttempt,
  ActionDef,
  ActionId,
  ActionPrecondition,
  CanonicalFixture,
  RejectReasonCode,
  ResourceUsage,
  RunEvent,
  SimSeconds,
} from './contracts';
import { actionCompletedBy, scenarioEventsAt, type MapSource } from './fixture-port.ts';

export interface ActionSubmissionInput {
  action_id: ActionId;
  target_id: string;
  submitted_at_sim: SimSeconds;
  seq: number;
  prior_events: readonly RunEvent[];
}

export type ActionJudge = (input: ActionSubmissionInput) => ActionAttempt | null;

type ActionErrorCode = 'UNKNOWN_ACTION' | 'INVALID_ACTION_TIME' | 'INVALID_ACTION_SEQUENCE' | 'INVALID_ACTION_CONFIG';

export class ActionEngineError extends Error {
  constructor(readonly code: ActionErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'ActionEngineError';
  }
}

interface Rejection {
  code: RejectReasonCode;
  reason: string;
}

type PreconditionCheck = (context: {
  input: ActionSubmissionInput;
  action: ActionDef;
  completed: readonly ActionAttempt[];
}) => Rejection | null;

function resourceFits(candidate: ResourceUsage & { to_sim: SimSeconds }, attempts: readonly ActionAttempt[], capacity: number): boolean {
  if (candidate.from_sim === candidate.to_sim) return true;
  const checkpoints = new Map<SimSeconds, number>([[candidate.from_sim, candidate.units]]);
  function add(t: SimSeconds, delta: number): void {
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
    // 同时刻的释放和进入合并为一个净变化，采用 [开始, 完成)。
    active += delta;
    if (active > capacity) return false;
  }
  return true;
}

export function createActionJudge(
  { scenario, action_catalog }: Pick<CanonicalFixture, 'scenario' | 'action_catalog'>,
  map: MapSource,
): (input: ActionSubmissionInput) => ActionAttempt {
  const catalog = new Map(action_catalog.map((action) => [action.id, action]));
  const resources = new Map(scenario.resources.map((resource) => [resource.id, resource]));
  const nodeTimes = new Set(scenario.nodes.map((node) => node.t_sim));
  const targets = new Map([
    ...map.buildings.map(({ id }) => [id, 'building'] as const),
    ...map.road_segments.map(({ id }) => [id, 'road'] as const),
    ...map.junctions.map(({ id }) => [id, 'junction'] as const),
  ]);
  const initiallyClosed = new Set(map.road_segments.filter((road) => road.blocked).map((road) => road.id));

  function invalidConfig(detail: string): never {
    throw new ActionEngineError('INVALID_ACTION_CONFIG', detail);
  }

  function compilePrecondition(action: ActionDef, rule: ActionPrecondition): PreconditionCheck {
    const reason = rule.description;
    switch (rule.type) {
      case 'requires_completed_action': {
        const required = rule.action_id && catalog.get(rule.action_id);
        if (!required || required.target_kind !== action.target_kind) {
          return invalidConfig(`${action.id} 的前置动作不存在或对象类型不匹配`);
        }
        return ({ completed }) => completed.some((item) => item.action_id === required.id)
          ? null : { code: 'PRECONDITION_NOT_MET', reason };
      }
      case 'requires_disaster_annotation':
        return ({ input }) => scenarioEventsAt(scenario, input.submitted_at_sim).some(({ event }) =>
          event.type === 'disaster_confirm' && event.building_id === input.target_id && event.adds_disaster_annotation,
        ) ? null : { code: 'TARGET_NOT_APPLICABLE', reason };
      case 'not_already_completed':
        return ({ action, completed }) => completed.some((item) => item.action_id === action.id)
          ? { code: 'STATUS_CONFLICT', reason } : null;
      case 'not_powered_off':
        return ({ completed }) => completed.some((item) => item.action_id === 'A6')
          ? { code: 'STATUS_CONFLICT', reason } : null;
      case 'road_not_closed':
        return ({ input, completed }) => initiallyClosed.has(input.target_id) || completed.some((item) => item.action_id === 'A5')
          ? { code: 'STATUS_CONFLICT', reason } : null;
      default:
        return invalidConfig(`${action.id} 声明了未知前置条件 ${rule.type}`);
    }
  }

  if (catalog.size !== action_catalog.length || resources.size !== scenario.resources.length) {
    invalidConfig('动作或资源 ID 重复');
  }
  const compiled = new Map(action_catalog.map((action) => {
    const resource = resources.get(action.resource_id);
    if (!resource || !Number.isSafeInteger(resource.capacity) || resource.capacity < 0) {
      return invalidConfig(`${action.id} 对应的资源 ${action.resource_id} 不存在或容量非法`);
    }
    if (!Number.isSafeInteger(action.resource_units) || action.resource_units <= 0
      || !Number.isFinite(action.duration_sim) || action.duration_sim < 0) {
      return invalidConfig(`${action.id} 的资源数量或耗时非法`);
    }
    if (action.target_kind !== 'building' && action.target_kind !== 'road') {
      return invalidConfig(`${action.id} 的目标类型非法`);
    }
    return [action.id, { action, resource, checks: action.preconditions.map((rule) => compilePrecondition(action, rule)) }] as const;
  }));

  return (input) => {
    const { action_id, target_id, submitted_at_sim, seq, prior_events } = input;
    const definition = compiled.get(action_id);
    if (!definition) throw new ActionEngineError('UNKNOWN_ACTION', `未知动作 ${action_id}`);
    if (!Number.isFinite(submitted_at_sim) || submitted_at_sim < 0 ||
      submitted_at_sim > scenario.t_end || !nodeTimes.has(submitted_at_sim)) {
      throw new ActionEngineError('INVALID_ACTION_TIME', `提交时刻 ${submitted_at_sim} 必须是剧本回合节点`);
    }
    let previousSeq = 0;
    let previousTime = 0;
    const attempts: ActionAttempt[] = [];
    for (const event of prior_events) {
      if (!Number.isSafeInteger(event.seq) || event.seq <= previousSeq || event.payload.seq !== event.seq) {
        throw new ActionEngineError('INVALID_ACTION_SEQUENCE', `历史序号重复、倒序或与载荷不一致：${event.seq}`);
      }
      if (!nodeTimes.has(event.t_sim) || event.t_sim < previousTime || event.t_sim > submitted_at_sim) {
        throw new ActionEngineError('INVALID_ACTION_TIME', `历史序号 ${event.seq} 的时刻无效或晚于提交时刻`);
      }
      previousSeq = event.seq;
      previousTime = event.t_sim;
      if (event.kind === 'action') attempts.push(event.payload);
    }
    if (!Number.isSafeInteger(seq) || seq <= previousSeq) {
      throw new ActionEngineError('INVALID_ACTION_SEQUENCE', `提交序号 ${seq} 必须是大于历史末序号的整数`);
    }

    const { action, resource, checks } = definition;
    const sameTarget = attempts.filter((item) => item.target_id === target_id);
    const attempt = sameTarget.filter((item) => item.action_id === action_id).length + 1;
    const core = { seq, attempt, action_id, target_id, submitted_at_sim, duration_sim: action.duration_sim };
    function reject(code: RejectReasonCode, reason: string): ActionAttempt {
      return {
        ...core, status: 'rejected', reject_reason_code: code, reject_reason: reason,
        completed_at_sim: null, resource_usage: null,
      };
    }

    const targetKind = targets.get(target_id);
    if (!targetKind) return reject('UNKNOWN_TARGET', `找不到目标 ${target_id}`);
    if (targetKind !== action.target_kind) {
      return reject('TARGET_NOT_APPLICABLE', `${action.name}的目标须为${action.target_kind === 'building' ? '楼栋' : '路段'}`);
    }
    const completed = sameTarget.filter((item) => actionCompletedBy(item, submitted_at_sim));
    for (const check of checks) {
      const failure = check({ input, action, completed });
      if (failure) return reject(failure.code, failure.reason);
    }

    const completion = submitted_at_sim + action.duration_sim;
    if (!Number.isFinite(completion)) invalidConfig(`${action.id} 的完成时刻超出可表示范围`);
    const usage = {
      resource_id: resource.id, units: action.resource_units,
      action_seq: seq, from_sim: submitted_at_sim, to_sim: completion,
    };
    if (!resourceFits(usage, attempts, resource.capacity)) {
      return reject('RESOURCE_UNAVAILABLE', `${resource.name}在预计执行区间内余量不足（需要 ${action.resource_units} ${resource.unit}）`);
    }
    return {
      ...core, status: 'accepted', reject_reason_code: null, reject_reason: null,
      completed_at_sim: completion, resource_usage: usage,
    };
  };
}
