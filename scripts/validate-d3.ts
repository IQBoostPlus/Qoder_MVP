import assert from 'node:assert/strict';
import { effectScope } from 'vue';
import { createActionJudge, type ActionSubmissionInput } from '../src/action-engine';
import { useDrillRound } from '../src/composables/useDrillRound';
import { useFixtureData, useFixturePort } from '../src/composables/useFixturePort';
import { deriveLayerMarks } from '../src/config/layers';
import { buildRouteQuery } from '../src/config/route-query';
import type { ActionAttempt, ActionId, CanonicalFixture, RunEvent } from '../src/contracts';
import { createEnginePort } from '../src/engine-port';

type Judge = ReturnType<typeof createActionJudge>;
const fixture = useFixtureData();
const port = useFixturePort();
const before = structuredClone(fixture);
const mapBefore = structuredClone(port.map);
const nodeTimes = new Set(fixture.scenario.nodes.map((node) => node.t_sim));

function testRun(judge: Judge = port.judgeAction) {
  const events: RunEvent[] = [];
  return {
    events,
    submit(action_id: ActionId, target_id: string, t_sim: number): ActionAttempt {
      const seq = events.length + 1;
      const input: ActionSubmissionInput = { action_id, target_id, submitted_at_sim: t_sim, seq, prior_events: events };
      const prior = structuredClone(events);
      const payload = judge(input);
      assert.deepEqual(judge(input), payload, '同输入应给出确定的结果');
      assert.deepEqual(events, prior, '判定不得改写历史');
      assert.equal(payload.seq, seq);
      events.push({ kind: 'action', seq, t_sim, payload });
      return payload;
    },
  };
}

function accepted(action: ActionAttempt, completion: number): void {
  assert.equal(action.status, 'accepted');
  assert.equal(action.completed_at_sim, completion);
  assert.ok(action.resource_usage);
  assert.equal(action.resource_usage.action_seq, action.seq);
  assert.equal(action.resource_usage.from_sim, action.submitted_at_sim);
  assert.equal(action.resource_usage.to_sim, completion);
}

function rejected(action: ActionAttempt, code: ActionAttempt['reject_reason_code'], attempt = 1): void {
  assert.equal(action.status, 'rejected');
  assert.equal(action.reject_reason_code, code);
  assert.equal(action.attempt, attempt);
  assert.ok(action.reject_reason);
  assert.equal(action.completed_at_sim, null);
  assert.equal(action.resource_usage, null);
}

const rules = testRun();
accepted(rules.submit('A1', 'N7', 30), 75);
rejected(rules.submit('A1', 'N7', 30), 'RESOURCE_UNAVAILABLE', 2);
rejected(rules.submit('A1', 'N7', 30), 'RESOURCE_UNAVAILABLE', 3);
accepted(rules.submit('A2', 'N7', 30), 90);
rejected(rules.submit('A6', 'N7', 80), 'TARGET_NOT_APPLICABLE');
accepted(rules.submit('A1', 'N1', 80), 125);
accepted(rules.submit('A6', 'N7', 90), 125);
rejected(rules.submit('A6', 'N7', 100), 'RESOURCE_UNAVAILABLE', 3);
accepted(rules.submit('A3', 'N7', 100), 130);
rejected(rules.submit('A4', 'N7', 100), 'PRECONDITION_NOT_MET');
const powerBefore = port.snapshotRound(rules.events, 124);
const powerAfter = port.snapshotRound(rules.events, 125);
assert.deepEqual(powerBefore.power_cuts, []);
assert.deepEqual(powerAfter.power_cuts.map(({ building_id, at_sim }) => [building_id, at_sim]), [['N7', 125]]);
accepted(rules.submit('A4', 'N7', 130), 150);
rejected(rules.submit('A4', 'N1', 130), 'PRECONDITION_NOT_MET');
rejected(rules.submit('A6', 'N7', 130), 'STATUS_CONFLICT', 4);
accepted(rules.submit('A5', 'R-N7E', 140), 165);
rejected(rules.submit('A1', '???', 140), 'UNKNOWN_TARGET');
rejected(rules.submit('A1', 'GATE3', 140), 'TARGET_NOT_APPLICABLE');
rejected(rules.submit('A5', 'N7', 140), 'TARGET_NOT_APPLICABLE');
rejected(rules.submit('A2', 'R-N7E', 140), 'TARGET_NOT_APPLICABLE');
const sameRound = testRun();
accepted(sameRound.submit('A3', 'N7', 100), 130);
rejected(sameRound.submit('A4', 'N7', 100), 'PRECONDITION_NOT_MET');
accepted(sameRound.submit('A4', 'N7', 150), 170);
console.log('六动作均有成功例；同秒 A3/A4 因果、警戒完成边界、灾情/断电、稳定拒绝码与尝试留痕通过');

const baseInput: ActionSubmissionInput = { action_id: 'A1', target_id: 'N7', seq: 42, submitted_at_sim: 30, prior_events: [] };
assert.throws(() => port.judgeAction({ ...baseInput, action_id: 'unknown' as ActionId }), { code: 'UNKNOWN_ACTION' });
for (const submitted_at_sim of [-1, Infinity, 75, 301]) {
  assert.throws(() => port.judgeAction({ ...baseInput, submitted_at_sim }), { code: 'INVALID_ACTION_TIME' });
}
assert.throws(() => port.judgeAction({ ...baseInput, seq: 1, prior_events: rules.events.slice(0, 1) }), { code: 'INVALID_ACTION_SEQUENCE' });
assert.throws(() => port.judgeAction({ ...baseInput, prior_events: [rules.events[0]!, rules.events[0]!] }), { code: 'INVALID_ACTION_SEQUENCE' });
assert.throws(() => port.judgeAction({ ...baseInput, prior_events: rules.events }), { code: 'INVALID_ACTION_TIME' });

const configured = structuredClone(fixture);
const at75 = { id: 'test-75', t_sim: 75, label: '', events: [] };
configured.scenario.nodes.push(at75);
const a1 = configured.action_catalog.find(({ id }) => id === 'A1')!;
const a3 = configured.action_catalog.find(({ id }) => id === 'A3')!;
const a5 = configured.action_catalog.find(({ id }) => id === 'A5')!;
configured.scenario.resources.find(({ id }) => id === a1.resource_id)!.capacity = 3;
a3.resource_id = a1.resource_id;
a3.resource_units = 2;
a1.preconditions = [{ type: 'not_already_completed', description: '已完成该动作' }];
a5.preconditions = [{ type: 'road_not_closed', description: '道路已经封闭' }];
const multi = testRun(createActionJudge(configured, port.map));
accepted(multi.submit('A1', 'N7', 30), 75);
accepted(multi.submit('A1', 'N1', 45), 90);
rejected(multi.submit('A3', 'N7', 60), 'RESOURCE_UNAVAILABLE');
rejected(multi.submit('A1', 'N7', 75), 'STATUS_CONFLICT', 2);
const twoUnits = multi.submit('A3', 'N7', 75);
accepted(twoUnits, 105);
assert.equal(twoUnits.resource_usage?.units, 2);
rejected(multi.submit('A1', 'CN1', 80), 'RESOURCE_UNAVAILABLE');
accepted(multi.submit('A1', 'CN1', 90), 135);
accepted(multi.submit('A5', 'R-N7E', 140), 165);
rejected(multi.submit('A5', 'R-N7E', 220), 'STATUS_CONFLICT', 2);
accepted(rules.submit('A5', 'R-N7E', 220), 245);
const blockedMap = { ...port.map, road_segments: port.map.road_segments.map((road) => ({ ...road, blocked: true })) };
rejected(testRun(createActionJudge(configured, blockedMap)).submit('A5', 'R-N7E', 30), 'STATUS_CONFLICT');
a1.preconditions = [{ type: 'invalid' as never, description: '未知规则' }];
assert.throws(() => createActionJudge(configured, port.map), { code: 'INVALID_ACTION_CONFIG' });
const noResources = { ...fixture, scenario: { ...fixture.scenario, resources: [] } };
assert.throws(() => createActionJudge(noResources, port.map), { code: 'INVALID_ACTION_CONFIG' });
console.log('多单位区间峰值、同秒释放、并行资源、目录可选规则、输入错误和配置失败通过');

const roadState = (events: readonly RunEvent[], id: string, t: number) =>
  port.snapshotRound(events, t).roads.find(({ road_id }) => road_id === id)!;
const routeAt = (events: readonly RunEvent[], t: number) =>
  port.getRoute(buildRouteQuery(port.map, port.snapshotRound(events, t), 'N7', 'GATE3', t));
assert.equal(roadState([], 'R-N7E', 165).hazard, 'flood');
assert.equal(roadState([], 'R-N7E', 165).formally_closed, false);
const east = testRun();
accepted(east.submit('A5', 'R-N7E', 140), 165);
assert.equal(roadState(east.events, 'R-N7E', 164).formally_closed, false);
assert.equal(roadState(east.events, 'R-N7E', 165).closed_by_action_seq, 1);
const backup = testRun();
accepted(backup.submit('A5', 'R-N1-GATE3', 140), 165);
assert.equal(roadState(backup.events, 'R-N1-GATE3', 165).hazard, null);
const beforeClosure = routeAt(backup.events, 164);
assert.equal(beforeClosure?.status, 'ready');
assert.deepEqual(beforeClosure.road_ids, ['R-N7-N1', 'R-N1-GATE3']);
assert.equal(routeAt(backup.events, 165)?.status, 'unreachable');
assert.equal(routeAt([], 165)?.status, 'ready');
assert.equal(port.replayTo('run-jia-1x', { t_sim: 165 })?.roads.find(({ road_id }) => road_id === 'R-N7E')?.formally_closed, true);
assert.equal(port.snapshotRound(rules.events, 30).active_resource_occupancy.length, 2);
assert.equal(port.snapshotRound(rules.events, 75).active_resource_occupancy.length, 1);
assert.equal(deriveLayerMarks(port.snapshotRound(rules.events, 85)).disaster.length, 0);
assert.equal(deriveLayerMarks(port.snapshotRound(rules.events, 90)).rescues[0]?.state, 'arrived');
assert.equal(deriveLayerMarks(port.snapshotRound(rules.events, 129)).cordons[0]?.state, 'placing');
assert.equal(deriveLayerMarks(port.snapshotRound(rules.events, 130)).cordons[0]?.state, 'ready');
const end = testRun();
accepted(end.submit('A5', 'R-N1-GATE3', 300), 325);
assert.equal(roadState(end.events, 'R-N1-GATE3', 300).formally_closed, false);
assert.equal(port.snapshotRound(end.events, 300).active_resource_occupancy.length, 1);
assert.ok(!('run_id' in port.snapshotRound([], 165)));
console.log('学员快照：t=165 空账本仅积水；A5 到时封闭；备用路无灾情但封闭后真实不可达；跨结束仍占用');

const scope = effectScope();
try {
  const userRound = (speed: number, source: CanonicalFixture = fixture) => scope.run(() => {
    const engine = createEnginePort(source, port.map);
    const round = useDrillRound(source, engine, { judgeAction: engine.judgeAction });
    round.speed.value = speed;
    return round;
  })!;
  const one = userRound(1);
  const four = userRound(4);
  for (const round of [one, four]) {
    assert.equal(round.submitVerdict('U10', '待核', null), null);
    assert.equal(round.submitVerdict('U1', '待核', 'N7')?.seq, 1);
    const a1 = round.submitAction('A1', 'N7');
    assert.equal(a1?.kind, 'action-confirmed');
    accepted(a1.event.payload, 75);
    assert.equal(a1.event.payload.resource_usage?.action_seq, 2);
    const second = round.submitAction('A1', 'N7');
    assert.equal(second?.kind, 'action-confirmed');
    rejected(second.event.payload, 'RESOURCE_UNAVAILABLE', 2);
    round.goToTime(80);
    assert.equal(port.snapshotRound(round.currentEvents.value, 80).active_resource_occupancy.length, 0);
    round.goToTime(90);
    assert.equal(round.submitVerdict('U1', '真报', 'N7')?.supersedes_seq, 1);
    round.goToTime(30);
    assert.equal(round.canWrite.value, false);
    assert.equal(round.submitVerdict('U10', '真报', null), null);
    assert.equal(round.submitVerdict('U1', '真报', null), null);
    assert.equal(round.submitAction('A1', 'N7'), null);
    assert.equal(round.sortOpen.value, false);
    assert.deepEqual(round.deliveredReports.value.map(({ id }) => id), ['U1']);
    assert.equal(port.snapshotRound(round.currentEvents.value, 30).events.length, 3);
    assert.equal(port.snapshotRound(round.currentEvents.value, 30).latest_verdicts[0]?.verdict, '待核');
    round.goToTime(90);
    assert.equal(round.canWrite.value, true);
    assert.equal(round.submitAction('A2', 'N7')?.kind, 'action-confirmed');
    assert.equal(round.currentEvents.value.at(-1)?.seq, 5);
    assert.ok(round.currentEvents.value.every(({ t_sim }) => nodeTimes.has(t_sim)));
  }
  assert.deepEqual(one.currentEvents.value, four.currentEvents.value);
  assert.deepEqual(port.snapshotRound(one.currentEvents.value, 90), port.snapshotRound(four.currentEvents.value, 90));
  const playback = userRound(4);
  playback.togglePlay();
  assert.equal(playback.playing.value, true);
  await new Promise<void>((resolve) => setTimeout(resolve, 550));
  assert.ok(playback.realElapsedMs.value > 0);
  for (const round of [one, four, playback]) {
    round.resetDrill();
    assert.equal(round.currentT.value, 30);
    assert.equal(round.playing.value, false);
    assert.equal(round.speed.value, 1);
    assert.equal(round.realElapsedMs.value, 0);
    assert.deepEqual(round.currentEvents.value, []);
    assert.deepEqual(port.snapshotRound(round.currentEvents.value, 30).active_resource_occupancy, []);
    assert.deepEqual(round.deliveredReports.value.map(({ id }) => id), ['U1']);
    assert.equal(round.submitVerdict('U1', '待核', null)?.seq, 1);
  }
} finally {
  scope.stop();
}
assert.deepEqual(port.map, mapBefore);
assert.deepEqual(fixture, before);
console.log('B 接口：统一 seq、即时竞争、完成边界、1×/4× 一致、回看只读、未来信息隐藏与重置通过');
console.log('D3 action engine and learner integration validation PASSED');
