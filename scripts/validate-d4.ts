import assert from 'node:assert/strict';
import { effectScope } from 'vue';
import campusMap from '../fixtures/campus-map.json';
import canonical from '../fixtures/canonical-run.json';
import type { CanonicalFixture, RunEvent } from '../src/contracts';
import { useDrillRound } from '../src/composables/useDrillRound';
import { createEnginePort } from '../src/engine-port';

const fixture = canonical as CanonicalFixture;
const port = createEnginePort(fixture, campusMap as Parameters<typeof createEnginePort>[1]);
const [jia, yi, plus] = fixture.runs;
assert(jia && yi && plus);
const scope = effectScope();
try {
  const drill = scope.run(() => useDrillRound(fixture, port, { judgeAction: port.judgeAction }))!;
  function runRound(events: readonly RunEvent[], extra?: { at: number; status: 'accepted' | 'rejected' }) {
    drill.resetDrill();
    assert.equal(drill.finishDrill(), false);
    assert.equal(drill.submitSort(['U2', 'U8', 'U4']), null);
    let inserted = false;
    for (const { kind, payload, t_sim } of events) {
      if (extra && !inserted && t_sim > extra.at) {
        drill.goToTime(extra.at);
        const added = drill.submitAction('A4', 'N7');
        assert(added?.kind === 'action-confirmed');
        assert.equal(added.event.payload.status, extra.status);
        inserted = true;
      }
      drill.goToTime(t_sim);
      if (kind === 'verdict') {
        assert(drill.submitVerdict(payload.report_id, payload.verdict, payload.location));
      } else if (kind === 'action') {
        const actual = drill.submitAction(payload.action_id, payload.target_id);
        assert(actual?.kind === 'action-confirmed');
        assert.equal(actual.event.payload.status, payload.status);
      } else {
        assert(drill.submitSort(payload.ordered_report_ids));
      }
    }
    assert(!extra || inserted);
    const before = JSON.stringify(drill.currentEvents.value);
    assert.equal(drill.finishDrill(), true);
    assert.equal(drill.finishDrill(), false);
    assert.equal(drill.canWrite.value, false);
    assert.equal(drill.submitSort(['U2', 'U8', 'U4']), null);
    assert.equal(drill.submitAction('A1', 'N7'), null);
    assert.equal(drill.submitVerdict('U1', '误报', null), null);
    const result = port.scoreRound(drill.currentEvents.value);
    for (let i = 0; i < 10; i++) assert.deepEqual(port.scoreRound(drill.currentEvents.value), result);
    assert.equal(JSON.stringify(drill.currentEvents.value), before);
    return result;
  }

  for (const run of [jia, yi, plus]) {
    const { judgments, location, ...comparable } = runRound(run.events);
    assert.deepEqual(comparable, fixture.expected_scores[run.run_id]);
    assert.equal(judgments.length, 10);
    assert.equal(location.total, 10);
    console.log(`${run.run_id}: ${[comparable.discrimination, comparable.response, comparable.coverage, comparable.violation].join('/')} → ${comparable.total}; response=${comparable.details.response_seconds}s; violations=[${comparable.details.violation_event_seqs}]`);
  }
  const early = runRound(jia.events, { at: 100, status: 'rejected' });
  assert.equal(early.total, 83);
  assert.equal(early.coverage, 80);
  const live = runRound(jia.events, { at: 150, status: 'accepted' });
  assert.equal(live.total, 90);
  assert.equal(live.coverage, 100);
  console.log(`A4 added live: too early → ${early.total}; on time → ${live.total}`);

  const movedA3 = yi.events.map((event) => event.kind === 'action' && event.payload.action_id === 'A3'
    ? { ...event, t_sim: 220 } : event);
  const moved = runRound(movedA3);
  assert.equal(moved.details.response_seconds, 220);
  assert.equal(moved.total, 46);
  assert(Math.abs(moved.response - 100 / 9) < 1e-10);
  console.log(`SC-08: response=${moved.details.response_seconds}s (${moved.response.toFixed(2)}); total=${moved.total}`);

  drill.resetDrill();
  drill.goToTime(30);
  assert(drill.submitVerdict('U1', '待核', 'N7'));
  const report = (id: string) => port.scoreRound(drill.currentEvents.value).judgments.find((item) => item.report_id === id)!;
  assert.equal(report('U1').window?.expected, '待核');
  assert.equal(report('U1').correct, true);
  assert(drill.submitVerdict('U1', '真报', 'N7'));
  assert.equal(report('U1').correct, false);
  drill.goToTime(70);
  assert(drill.submitVerdict('U4', '待核', '无法定位'));
  assert.equal(report('U4').correct, true);
  assert.equal(report('U4').location_correct, true);
  assert(drill.submitVerdict('U4', '待核', 'N7'));
  assert.equal(report('U4').correct, true);
  assert.equal(report('U4').location_correct, false);
  drill.goToTime(100);
  assert(drill.submitVerdict('U1', '真报', 'N7'));
  assert.equal(report('U1').window?.expected, '真报');
  assert.equal(report('U1').correct, true);
  assert.equal(report('U1').attempt?.supersedes_seq, 2);
  assert(drill.submitVerdict('U1', '待核', 'N7'));
  assert.equal(report('U1').correct, false);
  assert.equal(report('U3').attempt, null);
  assert.equal(report('U3').correct, false);
  drill.goToTime(140);
  assert(drill.submitVerdict('U9', '真报', 'N7'));
  assert.equal(report('U9').location_correct, true);
  drill.goToTime(300);
  assert.equal(drill.finishDrill(), true);
  assert.deepEqual(port.scoreRound(drill.currentEvents.value).sorting, {
    actual: [], expected: ['U2', 'U8', 'U4'], correct: false,
  });
  console.log('JW: as-of-submission judgments, superseded verdict, unjudged report and independent location verified');

  drill.resetDrill();
  drill.goToTime(300);
  for (const invalid of [['U2', 'U8'], ['U2', 'U8', 'U8'], ['U2', 'U8', '?']]) {
    assert.equal(drill.submitSort(invalid), null);
  }
  assert.equal(drill.currentEvents.value.length, 0);
  assert.equal(drill.submitSort(['U8', 'U2', 'U4'])?.seq, 1);
  const wrongOrder = port.scoreRound(drill.currentEvents.value);
  assert.equal(wrongOrder.sorting?.correct, false);
  assert.equal(drill.submitSort(['U2', 'U8', 'U4']), null);
  drill.resetDrill();
  drill.goToTime(300);
  assert.equal(drill.submitSort(['U2', 'U8', 'U4'])?.seq, 1);
  const correctOrder = port.scoreRound(drill.currentEvents.value);
  assert.equal(correctOrder.sorting?.correct, true);
  assert.equal(correctOrder.total, wrongOrder.total);
  drill.goToTime(150);
  assert.equal(drill.submitSort(['U2', 'U8', 'U4']), null);
  assert.equal(drill.finishDrill(), false);
  assert.equal(port.snapshotRound(drill.currentEvents.value, 150).sorting, null);
  drill.goToTime(300);
  assert(drill.finishDrill());
  assert.equal(port.snapshotRound(drill.currentEvents.value, 300).sorting?.seq, 1);
  drill.resetDrill();
  assert.equal(drill.finished.value, false);
  assert.equal(drill.realElapsedMs.value, 0);
  assert.equal(drill.currentEvents.value.length, 0);
  console.log('Sort: invalid, duplicate, wrong order, one submission per run, review and reset verified');

  drill.goToTime(110);
  for (let i = 0; i <= 8; i++) {
    assert(drill.submitAction('A6', 'CN1'));
    assert.equal(port.scoreRound(drill.currentEvents.value).violation, Math.max(0, 100 - 15 * i));
  }
  const firstA1 = jia.events.find((event) => event.kind === 'action' && event.payload.action_id === 'A1');
  assert(firstA1?.kind === 'action');
  const duplicate: RunEvent = { ...firstA1, seq: 2, payload: { ...firstA1.payload, seq: 2 } };
  assert.equal(port.scoreRound([firstA1, duplicate]).details.coverage_hit_weights,
    port.scoreRound([firstA1]).details.coverage_hit_weights);
  drill.resetDrill();
  drill.goToTime(300);
  const pending = drill.submitAction('A1', 'N7');
  assert(pending?.kind === 'action-confirmed');
  assert.equal(pending.event.payload.status, 'accepted');
  assert.equal(pending.event.payload.completed_at_sim, 345);
  const unfinished = port.scoreRound(drill.currentEvents.value);
  assert.equal(unfinished.details.coverage_hit_weights, 0);
  assert.equal(unfinished.details.response_seconds, null);
  console.log('Scoring: violation floor, single coverage credit and end-of-scenario completion cutoff verified');
} finally {
  scope.stop();
}
