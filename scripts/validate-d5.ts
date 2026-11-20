import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { effectScope } from 'vue';
import type { RunEvent } from '../src/contracts';
import { createEnginePort } from '../src/engine-port';
import { useDrillRound } from '../src/composables/useDrillRound';
import { assembleBundle, fallbackResult, parseCandidate, referenceActions, validateBundle, validateRequest, ValidationError } from '../src/scenario-generation/bundle';
import { completeSessionGeneration, readGenerationSession, requestScenario, reserveSessionGeneration } from '../src/scenario-generation/client';
import type { GenerationRequest, GenerationResult } from '../src/scenario-generation/contracts';
import { campusMap, templates } from '../src/scenario-generation/templates';
import { GenerationLedger, type BudgetSlot } from '../server/generation-ledger';
import { ProviderError, qoderProvider, type GenerationProvider } from '../server/generation-provider';
import { createGenerationService, type GenerationReply } from '../server/generation-service';

const lab = templates[1]!;
const fresh = (template = lab): GenerationRequest => ({
  run_id: crypto.randomUUID(), request_id: crypto.randomUUID(), template_id: template.id, modifiers: template.modifiers,
});
const updated = { ...lab.preset, start_building_id: 'G8', road_id: 'R-G8-CLI', first_report_at: 35, t_end: 340 };
const valid = JSON.stringify(updated);
function ready(reply: GenerationReply): GenerationResult {
  assert(reply.status === 'ready');
  return reply.result;
}
function mock(send: GenerationProvider['send'], read?: GenerationProvider['read']): GenerationProvider {
  return { name: 'simulated', prepare: async () => crypto.randomUUID(), send, read };
}
function validation(path: string, code?: string) {
  return (error: unknown) => error instanceof ValidationError && error.issue.path === path && (!code || error.issue.code === code);
}

let previousRun: ReturnType<typeof useDrillRound> | undefined;
for (const template of templates) {
  const request = fresh(template);
  const { bundle } = fallbackResult(request, null);
  const engine = createEnginePort(bundle, campusMap);
  const scope = effectScope();
  try {
    const drill = scope.run(() => useDrillRound(bundle, engine, { judgeAction: engine.judgeAction }))!;
    assert.equal(drill.currentEvents.value.length, 0);
    assert.equal(drill.realElapsedMs.value, 0);
    assert.equal(drill.playing.value, false);
    assert.equal(drill.finished.value, false);
    assert.equal(engine.getScore('run-jia-1x'), null);
    assert.equal(drill.deliveredReports.value.length, 0);
    const plan = referenceActions(bundle);
    const verdictEvents: Array<{ t: number; report: typeof bundle.ugc_reports[number] }> =
      bundle.ugc_reports.map((report) => ({ t: report.appears_at_sim, report }));
    const actions = plan.map((event) => ({ t: event.t_sim, event }));
    for (const point of [...verdictEvents, ...actions].sort((a, b) => a.t - b.t)) {
      drill.goToTime(point.t);
      if ('report' in point) {
        const { report } = point;
        assert(drill.deliveredReports.value.every((item) => item.appears_at_sim <= drill.currentT.value));
        const verdict = engine.windowAt(report.id, point.t)!;
        assert(drill.submitVerdict(report.id, verdict.expected, report.event_truth.building_id ?? '无法定位'));
      } else {
        const accepted = drill.submitAction(point.event.payload.action_id, point.event.payload.target_id);
        assert(accepted?.kind === 'action-confirmed' && accepted.event.payload.status === 'accepted');
      }
    }
    drill.goToTime(bundle.scenario.t_end);
    assert.equal(drill.deliveredReports.value.length, 10);
    assert(drill.submitSort(['U4', 'U7', 'U8']));
    assert(drill.finishDrill());
    const score = engine.scoreRound(drill.currentEvents.value);
    assert.equal(score.total, 100);
    assert.equal(score.sorting?.correct, true);
    assert.equal(score.location.correct, 10);
    assert.equal(score.details.response_seconds, 45);
    const snapshot = engine.snapshotRound(drill.currentEvents.value, bundle.scenario.t_end);
    assert(snapshot.roads.some((road) => road.road_id === bundle.candidate.road_id && road.formally_closed));
    drill.goToRound(0);
    assert.equal(drill.canWrite.value, false);
    assert.equal(engine.snapshotRound(drill.currentEvents.value, 0).events.length, 0);
    drill.resetDrill();
    assert.equal(drill.currentEvents.value.length, 0);
    assert.equal(drill.realElapsedMs.value, 0);
    assert.equal(drill.finished.value, false);
    assert.notEqual(drill, previousRun);
    previousRun = drill;
    console.log(`${template.id}: 10 reports, ${plan.length} rules-engine actions, score=100, response=45s, closure/review/reset passed`);
  } finally { scope.stop(); }
}

const rejection = fresh();
assert.throws(() => parseCandidate('not json', rejection), validation('candidate', 'INVALID_JSON'));
assert.throws(() => parseCandidate('{}', rejection), validation('candidate.start_building_id', 'REQUIRED'));
assert.throws(() => validateRequest({ ...rejection, modifiers: ['heavy_rain'] }), validation('request.modifiers', 'INVALID_MODIFIERS'));
for (const id of ['GATE3', 'N7']) {
  assert.throws(() => parseCandidate(JSON.stringify({ ...updated, start_building_id: id }), rejection), validation('candidate.start_building_id', 'UNKNOWN_BUILDING'));
}
assert.throws(() => parseCandidate(JSON.stringify({ ...updated, road_id: 'R-N7E' }), rejection), validation('candidate.road_id', 'UNKNOWN_ROAD'));
const base = assembleBundle(rejection, updated, 'generated');
function rejectChange(mutate: (data: ReturnType<typeof assembleBundle>) => void, path: string) {
  const data = structuredClone(base);
  mutate(data);
  assert.throws(() => validateBundle(data, rejection, 'generated'), validation(path));
}
rejectChange((data) => { data.scenario.standard_actions[0]!.action_id = 'BAD' as never; }, 'bundle.scenario.standard_actions.0.action_id');
rejectChange((data) => { data.scenario.standard_actions[0]!.target_id = 'R-G8-CLI'; }, 'bundle.scenario.standard_actions.0.target_id');
rejectChange((data) => { data.scenario.nodes[0]!.events.push({ type: 'bad' } as never); }, 'bundle.scenario.nodes.0.events');
rejectChange((data) => { data.ugc_reports[0]!.judgment_windows[0]!.to_sim = 99; }, 'bundle.ugc_reports.0.judgment_windows.0.to_sim');
rejectChange((data) => { data.ugc_reports[0]!.judgment_windows[1]!.from_sim = 100; }, 'bundle.ugc_reports.0.judgment_windows.1.from_sim');
rejectChange((data) => { data.ugc_reports[1]!.priority = data.ugc_reports[0]!.priority; }, 'bundle.ugc_reports.1.priority');
rejectChange((data) => { data.ugc_reports[1]!.id = data.ugc_reports[0]!.id; }, 'bundle.ugc_reports.1.id');
assert.throws(() => referenceActions({ ...base, scenario: { ...base.scenario, t_end: 40 } }),
  validation('bundle.scenario.standard_actions.0', 'INFEASIBLE_ACTION'));
console.log('Runtime rejection: malformed/missing fields, references, timing/window, duplicate ID/priority, infeasible actions');

const folder = mkdtempSync(join(tmpdir(), 'd5-atomic-'));
const dbPath = join(folder, 'ledger.sqlite');
const ledger = new GenerationLedger(dbPath);
const replica = new GenerationLedger(dbPath);
try {
  const notConfigured = ready(await createGenerationService(ledger).generate(fresh()));
  assert.equal(notConfigured.fallback_reason, 'not_configured');
  assert.equal(notConfigured.calls, 0);
  let sends = 0;
  const retrying = createGenerationService(ledger, mock(async (_, prompt) => {
    if (++sends === 1) return JSON.stringify({ ...updated, road_id: 'R-N7E' });
    assert.match(prompt, /UNKNOWN_ROAD/);
    return valid;
  }));
  const request = fresh();
  const accepted = ready(await retrying.generate(request));
  assert.equal(accepted.calls, 2);
  assert.equal(accepted.shared_retry_used, true);
  assert.equal(accepted.selection, 'generated');
  assert.equal(accepted.provider, 'simulated');
  assert.equal(accepted.bundle.scenario.t_end, 340);
  assert.equal(accepted.bundle.ugc_reports[0]!.event_truth.building_id, 'G8');
  const engine = createEnginePort(accepted.bundle, campusMap);
  assert.equal(engine.visibleReportsAt(34).length, 0);
  assert.equal(engine.visibleReportsAt(35).length, 1);
  assert.equal(engine.scoreRound(referenceActions(accepted.bundle) as RunEvent[]).coverage, 100);
  assert.deepEqual(await createGenerationService(replica).generate(request), { status: 'ready', result: accepted });
  assert.equal(sends, 2);

  const bad = ready(await createGenerationService(ledger, mock(async () => '{')).generate(fresh()));
  assert.equal(bad.fallback_reason, 'invalid_candidate');
  assert.equal(bad.calls, 2);
  assert.equal(bad.issues.length, 2);
  assert.equal(bad.bundle.scenario.start_building_id, 'SY');

  const unauth = ready(await createGenerationService(ledger, mock(async () => { throw new ProviderError('unauthorized', true); })).generate(fresh()));
  assert.equal(unauth.fallback_reason, 'unauthorized');
  assert.equal(unauth.calls, 1);
  const network = ready(await createGenerationService(ledger, mock(async () => { throw new TypeError(); })).generate(fresh()));
  assert.equal(network.calls, 1);
  assert.equal(network.upstream_state, 'unknown');

  let asyncSends = 0;
  let finishProvider: (result: string) => void = () => {};
  const slowProvider = mock(() => {
    asyncSends++;
    return new Promise<string>((resolve) => { finishProvider = resolve; });
  }, async () => valid);
  const slow = createGenerationService(ledger, slowProvider, 35);
  const slowRequest = fresh();
  const keepEventLoop = setTimeout(() => {}, 100);
  const first = slow.generate(slowRequest);
  const duplicate = await createGenerationService(replica, slowProvider).generate(slowRequest);
  assert.equal(duplicate.status, 'pending');
  assert.equal(ready(await createGenerationService(replica, slowProvider).generate({ ...slowRequest, request_id: crypto.randomUUID() })).fallback_reason, 'conflict');
  const timedOut = ready(await first);
  clearTimeout(keepEventLoop);
  assert.equal(timedOut.calls, 1);
  assert.equal(timedOut.fallback_reason, 'timeout');
  assert.equal(timedOut.upstream_state, 'unknown');
  finishProvider(valid);
  assert.equal(ready(await slow.generate(slowRequest)).selection, 'fallback');
  const recovered = ready(await slow.recover(slowRequest));
  assert.equal(recovered.selection, 'generated');
  assert.equal(recovered.upstream_state, 'complete');
  assert.equal(asyncSends, 1);

  for (const slot of ['reports', 'review'] as const) {
    assert(ledger.reserve(request.run_id, slot));
    assert(ledger.markSent(request.run_id, slot, slot));
  }
  assert.equal(ledger.usage(request.run_id).calls, 4);
  assert.equal(replica.reserve(request.run_id, 'retry'), false);
  assert.equal(replica.reserve(request.run_id, 'fifth' as BudgetSlot), false);
  const competing = fresh();
  ledger.claim(competing);
  for (const slot of ['scenario', 'reports', 'review'] as const) {
    assert(ledger.reserve(competing.run_id, slot));
    assert(ledger.markSent(competing.run_id, slot, slot));
  }
  const gate = new SharedArrayBuffer(4);
  const contenders = await Promise.all([1, 2].map(() => new Promise<boolean>((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(workerData.dbPath);
      db.exec('PRAGMA busy_timeout=2000');
      const gate = new Int32Array(workerData.gate);
      if (Atomics.add(gate, 0, 1) === 0) Atomics.wait(gate, 0, 1, 2000);
      else Atomics.notify(gate, 0);
      const outcome = db.prepare("INSERT OR IGNORE INTO generation_slots VALUES (?, 'retry', 'reserved', NULL)").run(workerData.run);
      parentPort.postMessage(outcome.changes === 1);
      db.close();
    `, { eval: true, workerData: { dbPath, gate, run: competing.run_id } });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => { if (code) reject(new Error('SQLite contender exited ' + code)); });
  })));
  assert(ledger.markSent(competing.run_id, 'retry', 'fourth'));
  assert.equal(contenders.filter(Boolean).length, 1);
  assert.equal(ledger.usage(competing.run_id).calls, 4);
  console.log('Server: retry 2, invalid 2/no third, disabled 0, 401 1, unknown network 1; timeout + read-only recovery 1; duplicate and fourth-slot arbitration passed on SQLite');
} finally {
  replica.close();
  ledger.close();
  rmSync(folder, { recursive: true });
}

const values = new Map<string, string>();
const storage: Storage = {
  get length() { return values.size; },
  key: (index) => [...values.keys()][index] ?? null,
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => { values.set(key, value); },
  removeItem: (key) => { values.delete(key); },
  clear: () => values.clear(),
};
for (let count = 1; count <= 3; count++) {
  const input = fresh();
  assert.equal(reserveSessionGeneration(storage, input)?.count, count);
  assert.equal(reserveSessionGeneration(storage, input)?.count, count);
  assert.equal(readGenerationSession(storage).pending?.request_id, input.request_id);
  completeSessionGeneration(storage, input);
}
assert.equal(readGenerationSession(storage).count, 3);
assert.equal(reserveSessionGeneration(storage, fresh()), null);

const abort = new AbortController();
for (const [status, reason] of [[401, 'unauthorized'], [404, 'not_configured'], [429, 'budget'], [503, 'network']] as const) {
  const result = await requestScenario(fresh(), false, abort.signal, () => {}, async () => new Response('', { status }));
  assert.equal(result.fallback_reason, reason);
  assert.equal(result.bundle.scenario.start_building_id, 'SY');
}
const mockQoderCalls: string[] = [];
const qoder = qoderProvider({ token: 'placeholder', agentId: 'agent_test', environmentId: 'env_test' }, async (input, init) => {
  const url = String(input);
  mockQoderCalls.push((init?.method ?? 'GET') + ' ' + new URL(url).pathname);
  if (url.endsWith('/sessions')) return Response.json({ id: 'sess_test' });
  if (init?.method === 'POST') return Response.json({ accepted: [] });
  return Response.json({ data: [{ type: 'agent.message', content: [{ type: 'text', text: valid }] }] });
});
const fakeSession = await qoder.prepare(fresh(), abort.signal);
assert.equal(await qoder.send(fakeSession, 'synthetic prompt', abort.signal), valid);
assert.deepEqual(mockQoderCalls, ['POST /api/v1/cloud/sessions', 'POST /api/v1/cloud/sessions/sess_test/events', 'GET /api/v1/cloud/sessions/sess_test/events']);
console.log('Browser adapter: persisted session cap 3, duplicate reservation, HTTP 401/404/429/503 fallback; Qoder wire contract synthetic HTTP passed');
