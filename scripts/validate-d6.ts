import assert from 'node:assert/strict';
import { effectScope } from 'vue';
import raw from '../fixtures/canonical-run.json';
import type { CanonicalFixture, RunEvent } from '../src/contracts';
import { createEnginePort } from '../src/engine-port';
import { useDrillRound } from '../src/composables/useDrillRound';
import { createLocalRunStore, exportRun, importRun, newRun, updateRun } from '../src/run-store/local';
import { stable } from '../src/run-store/validation';
import { RunStoreError, type StoredRun } from '../src/run-store/contracts';
import { fallbackResult, ValidationError } from '../src/scenario-generation/bundle';
import type { GenerationRequest } from '../src/scenario-generation/contracts';
import { campusMap, templates } from '../src/scenario-generation/templates';
import { reportCandidates, validateReportBatch } from '../src/scenario-generation/reports';
import { GenerationLedger } from '../server/generation-ledger';
import { createGenerationService } from '../server/generation-service';
import { createRunRoute, type RunDatabase } from '../server/run-route';
import type { RunSelect, RunTable, RunUpdate } from '../server/run-repository';

const canonical = raw as CanonicalFixture;
const { scenario, ugc_reports, action_catalog } = canonical;
const bundle = { scenario, ugc_reports, action_catalog };
const map = new Map<string, string>();
const storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); },
  removeItem: (key: string) => { map.delete(key); } };
const store = createLocalRunStore(() => storage);
const engine = createEnginePort(bundle, campusMap);
const end = scenario.nodes.length - 1;
function seed(events: RunEvent[], initial = newRun({ bundle, map: campusMap, origin: null })) {
  store.createRun(initial);
  const full = updateRun(initial, { node: end, furthest: end, started: true, finished: true, speed: 4, elapsed_ms: 7800 },
    events, engine.scoreRound(events));
  store.saveRun(full, initial.revision);
  const restored = createLocalRunStore(() => storage).active()!;
  assert.equal(stable(restored), stable(full));
  const score = createEnginePort(restored.bundle, restored.map).scoreRound(restored.events);
  assert.equal(stable(score), stable(importRun(exportRun(restored)).score));
  return full;
}
const completed = canonical.runs.map(({ events }) => seed(events));
assert.deepEqual(completed.map((run) => run.score!.total), [83,44,90]);
const jia = canonical.runs[0]!;
const attempts: RunEvent[] = [];
for (const event of jia.events) {
  const seq = attempts.length + 1;
  const payload = event.kind === 'action'
    ? engine.judgeAction({ action_id: event.payload.action_id, target_id: event.payload.target_id, submitted_at_sim: event.t_sim, seq, prior_events: attempts })
    : { ...event.payload, seq };
  attempts.push({ ...event, seq, payload } as RunEvent);
  if (event.kind === 'action' && event.payload.action_id === 'A3') {
    const a4 = engine.judgeAction({ action_id: 'A4', target_id: 'N7', submitted_at_sim: event.t_sim, seq: seq + 1, prior_events: attempts });
    assert.equal(a4.status, 'rejected');
    attempts.push({ kind: 'action', payload: a4, seq: seq + 1, t_sim: event.t_sim });
  }
}
assert.equal(seed(attempts).score?.total, 83);
const inFlight = jia.events.filter(({ t_sim }) => t_sim <= 140);
const initial = newRun({ bundle, map: campusMap, origin: null });
store.createRun(initial);
const partial = updateRun(initial, { node: scenario.nodes.findIndex((n) => n.t_sim === 100),
  furthest: scenario.nodes.findIndex((n) => n.t_sim === 140), started: true, finished: false, speed: 4, elapsed_ms: 4000 }, inFlight, null);
store.saveRun(partial, 1);
const restored = store.loadRun(partial.run_id)!;
const scope = effectScope();
try {
  const drill = scope.run(() => useDrillRound(restored.bundle, engine, { judgeAction: engine.judgeAction, restored, clockPaused: true }))!;
  assert.equal(drill.readClock(), 4000);
  assert.equal(drill.playing.value, false);
  assert.equal(drill.canWrite.value, false);
  assert.equal(drill.submitAction('A1', 'N7'), null);
  drill.goToTime(140);
  const snapshot = engine.snapshotRound(drill.currentEvents.value, 140);
  assert.equal(snapshot.roads.find((road) => road.road_id === 'R-N7E')?.formally_closed, false);
  assert.equal(engine.snapshotRound(drill.currentEvents.value, 165).roads.find((road) => road.road_id === 'R-N7E')?.formally_closed, true);
  assert.equal(drill.submitVerdict('U1', '真报', 'N7')?.seq, inFlight.length + 1);
} finally { scope.stop(); }
store.saveRun(partial, 1);
assert.throws(() => store.saveRun({ ...partial, revision: 3 }, 1), (e) => e instanceof RunStoreError && e.code === 'CONFLICT');
const corrupt = structuredClone(partial);
corrupt.events[0]!.payload.seq = 900;
assert.throws(() => importRun(JSON.stringify(corrupt)), (e) => e instanceof RunStoreError && e.code === 'CORRUPT');
assert.throws(() => importRun('{"schema_version":900}'), (e) => e instanceof RunStoreError && e.code === 'VERSION');
assert.throws(() => createLocalRunStore(() => { throw new Error('disabled'); }).active(),
  (e) => e instanceof RunStoreError && e.code === 'UNAVAILABLE');
assert.equal(store.loadRun(completed[0]!.run_id)?.score?.total, 83);
console.log('D6 fixed scores 83/44/90/83; refresh import, read-only historical node, earlier road state, active action and seq preserved; stale, corrupt and unavailable rejected.');

function requestFor(template: typeof templates[number]): GenerationRequest {
  return { run_id: crypto.randomUUID(), request_id: crypto.randomUUID(), template_id: template.id, modifiers: template.modifiers };
}
const simulatedAttempts: StoredRun[] = [];
for (const template of templates) {
  const req = requestFor(template);
  let sends = 0;
  const ledger = new GenerationLedger(':memory:');
  try {
    const provider = { name: 'simulated' as const, prepare: async () => crypto.randomUUID(),
      send: async (_: string, prompt: string) => {
        sends++;
        const parsed = JSON.parse(prompt);
        return parsed.task === 'd6_reports'
          ? JSON.stringify(parsed.slots.map((slot: { text: string[] }) => ({ ...slot, text: slot.text[1] })))
          : JSON.stringify(template.preset);
      } };
    const service = createGenerationService(ledger, provider, 5000, true);
    const reply = await service.generate(req);
    assert(reply.status === 'ready');
    const { result } = reply;
    assert.equal(sends, 2);
    assert.equal(result.calls, 2);
    assert.equal(result.report_source, 'generated');
    const preset = fallbackResult(req, null).bundle.ugc_reports;
    assert.notEqual(result.bundle.ugc_reports[0]?.text, preset[0]?.text);
    assert.deepEqual(await service.generate(req), reply);
    assert.deepEqual(await service.recover(req), reply);
    assert.equal(sends, 2);
    const candidates = reportCandidates(preset).map((r) => ({ ...r, text: r.text[1] }));
    assert.equal(validateReportBatch(candidates, preset).length, 10);
    for (const invalid of [candidates.slice(1), [...candidates, candidates[0]], [candidates[1], ...candidates.slice(1)],
      [{ ...candidates[0], text: 'GATE3 新增灾情' }, ...candidates.slice(1)],
      [{ ...candidates[0], category: 'other' }, ...candidates.slice(1)],
      [{ ...candidates[0], priority: candidates[1]?.priority }, ...candidates.slice(1)],
      [{ ...candidates[0], judgment_windows: [] }, ...candidates.slice(1)],
      ...['fake-building', template.preset.road_id].map((id) => [{ ...candidates[0],
        event_truth: { ...candidates[0]?.event_truth, building_id: id } }, ...candidates.slice(1)])]) {
      assert.throws(() => validateReportBatch(invalid, preset), ValidationError);
    }
    const { request, selection, provider: sourceProvider, fallback_reason, report_source, calls,
      shared_retry_used, upstream_state, reports } = result;
    const savedBundle = { scenario: result.bundle.scenario, ugc_reports: result.bundle.ugc_reports,
      action_catalog: result.bundle.action_catalog };
    const resetAttempt = newRun({ bundle: savedBundle, map: campusMap,
      origin: { request, selection, provider: sourceProvider, fallback_reason, report_source, calls, shared_retry_used, upstream_state, reports } });
    assert.notEqual(resetAttempt.run_id, result.request.run_id);
    assert.equal(resetAttempt.origin?.request.run_id, result.request.run_id);
    simulatedAttempts.push(resetAttempt);
    console.log(template.id, '10 generated reports; two sends; immutable labels; invalid batches and replay verified');
  } finally { ledger.close(); }
}
for (const failAt of ['scenario', 'reports'] as const) {
  const t = templates[0]!;
  const req = requestFor(t);
  const ledger = new GenerationLedger(':memory:');
  let failed = false;
  try {
    const service = createGenerationService(ledger, { name: 'simulated', prepare: async () => 'session_test',
      send: async (_id, prompt) => {
        const data = JSON.parse(prompt);
        const stage = data.task === 'd6_reports' ? 'reports' : 'scenario';
        if (stage === failAt && !failed) { failed = true; return '{}'; }
        return stage === 'scenario' ? JSON.stringify(t.preset)
          : JSON.stringify(data.slots.map((slot: { text: string[] }) => ({ ...slot, text: slot.text[1] })));
      } }, 5000, true);
    const reply = await service.generate(req);
    assert(reply.status === 'ready');
    assert.equal(reply.result.calls, 3);
    assert.equal(reply.result.report_source, 'generated');
    assert.equal(ledger.reserve(req.run_id, 'retry'), false);
    assert(ledger.reserve(req.run_id, 'review'));
    assert(ledger.markSent(req.run_id, 'review', 'review'));
    assert.equal(ledger.usage(req.run_id).calls, 4);
    assert.equal(ledger.reserve(req.run_id, 'review'), false);
  } finally { ledger.close(); }
}
{
  const t = templates[0]!;
  const req = requestFor(t);
  const ledger = new GenerationLedger(':memory:');
  const timer = setTimeout(() => {}, 100);
  try {
    const provider = { name: 'simulated' as const, prepare: async () => 'session_test',
      send: async (_id: string, prompt: string) => {
        if (JSON.parse(prompt).task === 'd6_reports') return new Promise<string>(() => {});
        return JSON.stringify(t.preset);
      } };
    const service = createGenerationService(ledger, provider, 35, true);
    const reply = await service.generate(req);
    assert(reply.status === 'ready');
    assert.equal(reply.result.selection, 'generated');
    assert.equal(reply.result.report_source, 'fallback');
    assert.equal(reply.result.reports?.fallback_reason, 'timeout');
    assert.equal(reply.result.calls, 2);
    assert.equal(reply.result.upstream_state, 'unknown');
    assert.deepEqual(await service.recover(req), reply);
  } finally { clearTimeout(timer); ledger.close(); }
}
console.log('D6 shared-retry competition, reserved review slot, four-call cap and original-deadline report fallback verified.');

function memoryDb() {
  type Row = Record<string, unknown>;
  const tables: Record<string, Map<string, Row>> = {
    runs: new Map(), scenarios: new Map(), ugc_reports: new Map(), run_events: new Map(), disaster_templates: new Map(),
  };
  let failUpdate = false;
  let eventsBeforeFailure: number | null = null;
  const primary = (table: string, row: Row) => table === 'run_events' ? `${row.run_id}:${row.seq}` : String(row.id);
  const project = (row: Row, columns: string) => Object.fromEntries(columns.split(',').map((column) => {
    const name = column.trim();
    return [name, structuredClone(row[name])];
  }));
  const table = (name: string): RunTable => ({
    select(columns: string) {
      const filters: [string, unknown][] = [];
      let limit = Infinity;
      const build = (): RunSelect<Row> => ({
        eq(column: string, value: unknown) { filters.push([column, value]); return build(); },
        limit(count: number) { limit = count; return build(); },
        then(resolve, reject) {
          const data = [...tables[name]!.values()].filter((row) => filters.every(([column, value]) => row[column] === value))
            .slice(0, limit).map((row) => project(row, columns));
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      });
      return build();
    },
    insert(rows: Row | Row[]) {
      const failureBoundary = name === 'run_events' ? eventsBeforeFailure : null;
      if (name === 'run_events') eventsBeforeFailure = null;
      let inserted = 0;
      for (const row of Array.isArray(rows) ? rows : [rows]) {
        if (inserted === failureBoundary) return Promise.resolve({ data: null, error: { code: 'XX000' } });
        const key = primary(name, row);
        if (tables[name]!.has(key)) return Promise.resolve({ data: null, error: { code: '23505' } });
        tables[name]!.set(key, structuredClone(row));
        inserted++;
      }
      return Promise.resolve({ data: null, error: null });
    },
    update(patch: Row) {
      const filters: [string, unknown][] = [];
      let columns: string | null = null;
      const build = (): RunUpdate<Row> => ({
        eq(column: string, value: unknown) { filters.push([column, value]); return build(); },
        select(selected: string) { columns = selected; return build(); },
        then(resolve, reject) {
          if (failUpdate) { failUpdate = false; return Promise.resolve({ data: null, error: { code: 'XX000' } }).then(resolve, reject); }
          const data: Row[] = [];
          for (const [key, row] of tables[name]!) {
            if (!filters.every(([column, value]) => row[column] === value)) continue;
            const next = { ...row, ...structuredClone(patch) };
            tables[name]!.set(key, next);
            if (columns) data.push(project(next, columns));
          }
          return Promise.resolve({ data: columns ? data : null, error: null }).then(resolve, reject);
        },
      });
      return build();
    },
  });
  return { db: { from: table } as RunDatabase, tables, failNextUpdate: () => { failUpdate = true; },
    failEventInsertAfter: (count: number) => { eventsBeforeFailure = count; } };
}

const mem = memoryDb();
const route = createRunRoute(mem.db, () => true);
const key = '9'.repeat(64);
const headers = { 'Content-Type': 'application/json', 'X-Run-Key': key };
const fresh = newRun({ bundle, map: campusMap, origin: null });
const pathFor = (run: { run_id: string }) => 'https://example.test/api/d6/runs?run_id=' + run.run_id;
const put = (run: unknown, expected: number, url = pathFor(run as { run_id: string }), extra = headers) =>
  new Request(url, { method: 'PUT', headers: extra, body: JSON.stringify({ run, expected_revision: expected }) });
assert.equal((await createRunRoute(mem.db, () => false)(put(fresh, 0))).status, 503);
assert.equal((await route(put(fresh, 0))).status, 200);
assert.equal((await route(put(fresh, 0))).status, 200);
assert.equal(mem.tables.runs!.size, 1);
assert.equal((await route(new Request(pathFor(fresh)))).status, 404);
assert.equal((await route(put(fresh, 0, pathFor(fresh), { 'Content-Type': 'application/json', 'X-Run-Key': '0'.repeat(64) }))).status, 404);
assert.equal(mem.tables.scenarios!.size, 1);
const fetched = await route(new Request(pathFor(fresh), { headers }));
assert.equal(stable((await fetched.json()).run), stable(fresh));

const variedBundle = { ...bundle, scenario: { ...scenario, id: 'scenario-template-variation',
  standard_actions: scenario.standard_actions.map((item) => item.action_id === 'A5' ? { ...item, target_id: 'N7' } : item) } };
const varied = newRun({ bundle: variedBundle, map: campusMap, origin: null }, crypto.randomUUID());
assert.equal((await route(put(varied, 0))).status, 200);
const variedFetched = await route(new Request(pathFor(varied), { headers }));
const variedActions = (await variedFetched.json()).run.bundle.scenario.standard_actions as { action_id: string; target_id: string }[];
assert.equal(variedActions.find((item) => item.action_id === 'A5')?.target_id, 'N7');
assert.equal(mem.tables.disaster_templates!.size, 1);

for (const attempt of simulatedAttempts) {
  assert.equal((await route(put(attempt, 0))).status, 200);
  const cloud = await route(new Request(pathFor(attempt), { headers }));
  assert.equal(cloud.status, 200);
  assert.deepEqual((await cloud.json()).run, importRun(exportRun(attempt)));
}
console.log('D6 all three simulated generated bundles round-trip through PUT, independent GET and exported JSON.');

const second = updateRun(fresh, { node: 0, furthest: 0, started: true, finished: false, speed: 4, elapsed_ms: 1200 },
  completed[0]!.events.slice(0, 2), null);
assert.equal((await route(put(second, 1))).status, 200);
const third = updateRun(second, { node: 1, furthest: 1, started: true, finished: false, speed: 4, elapsed_ms: 1800 },
  completed[0]!.events.slice(0, 3), null);
mem.failNextUpdate();
assert.equal((await route(put(third, 2))).status, 503);
const half = await route(new Request(pathFor(fresh), { headers }));
const halfRun = (await half.json()).run;
assert.equal(halfRun.revision, 2);
assert.equal(halfRun.events.length, 2);
assert.equal((await route(put(third, 2))).status, 200);
const afterRetry = await route(new Request(pathFor(fresh), { headers }));
assert.equal((await afterRetry.json()).run.events.length, 3);
const altered: RunEvent = { kind: 'verdict', seq: 2, t_sim: 45,
  payload: { seq: 2, report_id: 'U1', judged_at_sim: 45, verdict: '真报', location: 'N7', supersedes_seq: null } };
const conflict = updateRun(third, { node: 1, furthest: 1, started: true, finished: false, speed: 4, elapsed_ms: 2400 },
  [third.events[0]!, altered], null);
assert.equal((await route(put(conflict, 3))).status, 409);
assert.equal((await route(put({ ...third, revision: 4 }, 2))).status, 409);
const lateId = crypto.randomUUID();
let late = newRun({ bundle, map: campusMap, origin: null }, lateId);
for (let step = 1; step <= 4; step++) {
  late = updateRun(late, { node: 0, furthest: 0, started: true, finished: false, speed: 4, elapsed_ms: step * 100 }, [], null);
}
assert.equal(late.revision, 5);
assert.equal((await route(put(late, 0))).status, 200);
assert.equal((await (await route(new Request(pathFor(late), { headers }))).json()).run.revision, 5);
let jumped = updateRun(late, { node: 0, furthest: 0, started: true, finished: false, speed: 4, elapsed_ms: 900 }, [], null);
jumped = updateRun(jumped, { node: 0, furthest: 0, started: true, finished: false, speed: 4, elapsed_ms: 1200 }, [], null);
assert.equal(jumped.revision, 7);
assert.equal((await route(put(jumped, 5))).status, 200);
assert.equal((await (await route(new Request(pathFor(jumped), { headers }))).json()).run.revision, 7);
assert.equal((await route(put(jumped, 5))).status, 200);

function changeVerdict(events: RunEvent[], seq: number): RunEvent[] {
  return events.map((event) => {
    if (event.seq !== seq) return event;
    assert.equal(event.kind, 'verdict');
    return { ...event, payload: { ...event.payload, verdict: event.payload.verdict === '真报' ? '待核' : '真报' } };
  });
}
const extension = updateRun(third, { ...third.progress, node: end, furthest: end }, completed[0]!.events.slice(0, 7), null);
const get = async (run: { run_id: string }) => route(new Request(pathFor(run), { headers }));
mem.failEventInsertAfter(2);
assert.equal((await route(put(extension, third.revision))).status, 503);
assert.equal(mem.tables.run_events!.get(`${third.run_id}:5`)?.seq, 5);
assert.equal(mem.tables.run_events!.has(`${third.run_id}:6`), false);
assert.equal(stable((await (await get(third)).json()).run), stable(third));
assert.equal((await route(put({ ...extension, events: changeVerdict(extension.events, 5) }, third.revision))).status, 409);
assert.equal(stable((await (await get(third)).json()).run), stable(third));
assert.equal((await route(put(extension, third.revision))).status, 200);
assert.equal(stable((await (await get(third)).json()).run), stable(extension));

const finishedFirstWrite = completed[0]!;
mem.failEventInsertAfter(2);
assert.equal((await route(put(finishedFirstWrite, 0))).status, 503);
assert.equal(mem.tables.run_events!.get(`${finishedFirstWrite.run_id}:2`)?.seq, 2);
assert.equal((await get(finishedFirstWrite)).status, 404);
const alternateEvents = changeVerdict(finishedFirstWrite.events, 2);
assert.equal((await route(put({ ...finishedFirstWrite, events: alternateEvents, score: engine.scoreRound(alternateEvents) }, 0))).status, 409);
assert.equal((await get(finishedFirstWrite)).status, 404);
assert.equal((await route(put(finishedFirstWrite, 0))).status, 200);
assert.equal(stable((await (await get(finishedFirstWrite)).json()).run), stable(finishedFirstWrite));
assert.equal((await route(put(finishedFirstWrite, 0))).status, 200);
console.log('D6 partial event inserts: previous revision remains readable, conflicting pending sequence rejected, identical retry restores the full run; unfinished first commit stays invisible.');
console.log('D6 endpoint contract mock: closed, capability isolation, idempotent duplicate, initial and multi-step revision sync, revision conflict and half-write commit marker passed.');
