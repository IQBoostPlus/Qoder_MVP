import { createEnginePort } from '../src/engine-port.ts';
import { record } from '../src/scenario-generation/bundle.ts';
import { actionCatalog, campusMap } from '../src/scenario-generation/templates.ts';
import type { StoredRun } from '../src/run-store/contracts.ts';
import type { ReviewItem, ReviewReason } from '../src/review-contract.ts';

export function reviewFacts(run: StoredRun) {
  const engine = createEnginePort(run.bundle, run.map);
  const score = engine.scoreRound(run.events);
  const actionEvents = run.events.filter((event) => event.kind === 'action');
  const facts = actionEvents.map(({ seq, t_sim, payload }) => {
    const action = actionCatalog.find(({ id }) => id === payload.action_id)?.name ?? '未识别动作';
    const known = [...campusMap.buildings, ...campusMap.road_segments, ...campusMap.junctions].find(({ id }) => id === payload.target_id);
    const target = known?.name ?? '无效目标';
    const outcome = payload.status === 'rejected' ? '被规则拒绝'
      : payload.completed_at_sim !== null && payload.completed_at_sim <= run.bundle.scenario.t_end ? '在结算前完成' : '结算时尚未完成';
    const basis = score.details.violation_event_seqs.includes(seq) ? '评分器记为重复违规'
      : score.details.first_response_action_seq === seq ? '评分器计入首报响应' : null;
    const statement = `第${seq}条在 T+${t_sim} 秒对「${target}」提交「${action}」，${outcome}${basis ? '，' + basis : ''}。`;
    const choices = [`本轮模拟中，${statement}`, `回看本轮流水，${statement}`];
    if (payload.action_id === 'A4' && actionEvents.some((prior) => prior.seq < seq && prior.payload.action_id === 'A3' &&
        prior.payload.target_id === payload.target_id && prior.payload.status === 'accepted' &&
        prior.payload.completed_at_sim !== null && prior.payload.completed_at_sim <= t_sim)) {
      choices.push(`本轮完成警戒后才提交疏散，对应第${seq}条操作。`);
    }
    return { seq, t_sim, action, target, outcome, basis, choices };
  });
  return { run_id: run.run_id, facts };
}

export function reviewPrompt(input: ReturnType<typeof reviewFacts>): string {
  return JSON.stringify({ task: 'd7_review', instruction: '只回顾这场已结束的模拟训练。选择 1 至 3 条有代表性的流水，每条原样采用该流水 choices 内的一句。禁止真实事件指挥、补写事实或评分。只输出 JSON。',
    run_id: input.run_id, output: { run_id: input.run_id, items: [{ seq: '本轮操作序号', text: '该条候选句' }] }, facts: input.facts });
}

const realCommand = /立即疏散|马上撤离|请(?:立刻|立即|马上)|(?:拨打|致电)\s*(?:119|110|120)|(?:真实|实际)事件(?:中|时)?(?:请|应当|必须)|现在(?:派人|组织|指挥)/u;
export function parseReview(raw: string, input: ReturnType<typeof reviewFacts>): ReviewItem[] | ReviewReason {
  if (raw.length > 12_000) return 'invalid_output';
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return 'invalid_output'; }
  if (!record(value) || Object.keys(value).length !== 2 || typeof value.run_id !== 'string' || !Array.isArray(value.items) ||
      value.items.length < 1 || value.items.length > 3) return 'invalid_output';
  if (value.run_id !== input.run_id) return 'bad_reference';
  const items: ReviewItem[] = [];
  for (const item of value.items) {
    if (!record(item) || Object.keys(item).length !== 2 || typeof item.text !== 'string' || typeof item.seq !== 'number' ||
        !Number.isSafeInteger(item.seq) || item.text.length > 240) return 'invalid_output';
    if (realCommand.test(item.text)) return 'unsafe_text';
    const fact = input.facts.find(({ seq }) => seq === item.seq);
    if (!fact || items.some(({ seq }) => seq === item.seq)) return 'bad_reference';
    if (!fact.choices.includes(item.text)) return 'fact_mismatch';
    items.push({ seq: item.seq, text: item.text });
  }
  return items;
}
