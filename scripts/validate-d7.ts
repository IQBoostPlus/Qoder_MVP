import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import raw from '../fixtures/canonical-run.json';
import type { CanonicalFixture } from '../src/contracts';
import { createEnginePort } from '../src/engine-port';
import { exportRun, newRun, updateRun } from '../src/run-store/local';
import { stable } from '../src/run-store/validation';
import { campusMap, templates } from '../src/scenario-generation/templates';
import { createReviewClient, localReview } from '../src/review-client';
import { REVIEW_WAIT_MS, type ReviewReply } from '../src/review-contract';
import { createScenarioHttp } from '../server/scenario-http';
import { createReviewService, presetReviewRoot, type ReviewProvider } from '../server/review-service';
import { parseReview, reviewFacts } from '../server/review-facts';
import { GenerationLedger } from '../server/generation-ledger';

const { scenario, action_catalog, ugc_reports, runs } = raw as CanonicalFixture;
const bundle = { scenario, action_catalog, ugc_reports };
const engine = createEnginePort(bundle, campusMap);
const fixture = newRun({ bundle, map: campusMap, origin: null });
const end = scenario.nodes.length - 1;
const finished = updateRun(fixture, { ...fixture.progress, node: end, furthest: end, started: true, finished: true }, runs[0]!.events, engine.scoreRound(runs[0]!.events));
const before = exportRun(finished);
const facts = reviewFacts(finished);
const first = facts.facts[0]!;
const good = { run_id: finished.run_id, items: [{ seq: first.seq, text: first.choices[0]! }] };
const threeItems = facts.facts.slice(0, 3).map(({ seq, choices }) => ({ seq, text: choices[0] }));
const rawGood = JSON.stringify(good);
assert.deepEqual(parseReview(rawGood, facts), good.items);
const completedA4 = { ...finished, events: runs[2]!.events, score: engine.scoreRound(runs[2]!.events) };
const retrospectiveFacts = reviewFacts(completedA4);
const retrospective = retrospectiveFacts.facts.find((fact) => fact.choices.some((text) => text.startsWith('本轮完成警戒后才提交疏散')))!;
assert.ok(retrospective);
assert.deepEqual(parseReview(JSON.stringify({ run_id: finished.run_id, items: [{ seq: retrospective.seq, text: retrospective.choices[2] }] }), retrospectiveFacts),
  [{ seq: retrospective.seq, text: retrospective.choices[2] }]);
assert.equal(parseReview('not-json', facts), 'invalid_output');
assert.equal(parseReview(JSON.stringify({ ...good, run_id: 'another-training' }), facts), 'bad_reference');
assert.equal(parseReview(JSON.stringify({ ...good, items: [{ seq: 999, text: first.choices[0] }] }), facts), 'bad_reference');
for (const [text, reason] of [['本轮没有提交该动作。', 'fact_mismatch'], ['本轮总分99。', 'fact_mismatch'], ['请立即疏散校内人员。', 'unsafe_text']]) {
  assert.equal(parseReview(JSON.stringify({ ...good, items: [{ seq: first.seq, text }] }), facts), reason);
}

const ledger = new GenerationLedger(':memory:');
try {
  const root = await presetReviewRoot(finished.run_id);
  assert.notEqual(root.run_id, finished.run_id);
  ledger.claim(root);
  for (const slot of ['scenario', 'retry', 'reports'] as const) {
    assert(ledger.reserve(root.run_id, slot));
    assert(ledger.markSent(root.run_id, slot, `session_${slot}`));
    ledger.markComplete(root.run_id, slot);
  }
  let sends = 0;
  let finishSend: (text: string) => void = () => {};
  let didSend: () => void = () => {};
  const sent = new Promise<void>((resolve) => { didSend = resolve; });
  const provider: ReviewProvider = { name: 'simulated', prepare: async () => 'session_review',
    send: () => new Promise<string>((resolve) => { sends++; finishSend = resolve; didSend(); }) };
  const service = createReviewService(ledger.reviewLedger(root.run_id), provider);
  const initialId = 'review-first-request';
  const work = service.start(finished, initialId, 'review');
  await sent;
  assert.equal(finished.score?.total, 83);
  assert.equal((await service.recover(finished, initialId)).status, 'pending');
  assert.equal((await service.start(finished, 'review-other-start', 'review')).reason, 'conflict');
  assert.equal((await service.start(finished, 'review-early-retry', 'retry')).status, 'pending');
  finishSend(rawGood);
  const ready = await work;
  assert.equal(ready.calls, 4);
  assert.equal(ready.can_regenerate, false);
  assert.equal((await service.start(finished, 'review-blocked-retry', 'retry')).reason, 'budget');
  assert.equal((await service.recover(finished, initialId)).source, 'simulated');
  assert.equal(sends, 1);
  assert.equal(exportRun(finished), before);

  const secondRun = { ...finished, run_id: crypto.randomUUID() };
  const second = await presetReviewRoot(secondRun.run_id);
  ledger.claim(second);
  let recovered = false;
  let secondSends = 0;
  const secondText = JSON.stringify({ ...good, run_id: secondRun.run_id });
  const uncertain = createReviewService(ledger.reviewLedger(second.run_id), {
    name: 'qoder', prepare: async () => 'session_unknown',
    send: async () => { if (++secondSends === 1) throw new Error('lost reply'); return secondText; },
    read: async () => recovered ? secondText : null,
  });
  assert.equal((await uncertain.start(secondRun, initialId, 'review')).status, 'pending');
  assert.equal((await uncertain.start(secondRun, 'review-too-early', 'retry')).status, 'pending');
  assert.equal(ledger.unresolved(second.run_id), undefined);
  recovered = true;
  assert.equal((await uncertain.recover(secondRun, initialId)).can_regenerate, true);
  const retransmitted = await Promise.all([uncertain.start(secondRun, 'review-retry-request', 'retry'), uncertain.start(secondRun, 'review-racing-request', 'retry')]);
  assert.equal(retransmitted.filter(({ source }) => source === 'ai').length, 1);
  assert.equal((await uncertain.recover(secondRun)).calls, 2);
  assert.equal((await uncertain.recover(secondRun)).can_regenerate, false);
  assert.equal(secondSends, 2);
} finally { ledger.close(); }

const updates: ReviewReply[] = [];
const calls: string[] = [];
let scheduled: (() => void) | undefined;
let resolveBrowser: (value: ReviewReply) => void = () => {};
const browser = createReviewClient((action) => {
  calls.push(action);
  return action === 'read' ? Promise.resolve(localReview(finished.run_id, 'pending', 'browser-request', true))
    : new Promise((resolve) => { resolveBrowser = resolve; });
}, (value) => updates.push(value), { schedule: (callback, ms) => { assert.equal(ms, REVIEW_WAIT_MS); scheduled = callback; return callback; }, cancel() {} });
const browserWork = browser.execute('start', finished, 'browser-request');
assert.equal(updates[0]?.reason, 'pending');
assert.equal(finished.score?.total, 83);
scheduled?.();
assert.equal(updates.at(-1)?.reason, 'timeout');
assert.deepEqual(calls, ['start', 'read']);
browser.detach();
const last = updates.length;
resolveBrowser({ ...localReview(finished.run_id, 'pending', 'browser-request'), source: 'ai', items: good.items });
await browserWork;
assert.equal(updates.length, last);

const recoveredReply: ReviewReply = { ...localReview(finished.run_id, 'pending', 'browser-request'), source: 'ai', items: good.items };
const recoveryBrowser = createReviewClient((action) => action === 'read' ? Promise.resolve(recoveredReply)
  : new Promise((resolve) => { resolveBrowser = resolve; }), (value) => updates.push(value),
  { schedule: (callback) => { scheduled = callback; return callback; }, cancel() {} });
const recoveryWork = recoveryBrowser.execute('start', finished, 'browser-request');
scheduled?.();
await Promise.resolve();
assert.equal(updates.at(-1), recoveredReply);
resolveBrowser(localReview(finished.run_id, 'pending', 'browser-request', true));
await recoveryWork;
assert.equal(updates.at(-1), recoveredReply);

const zero = updateRun(newRun({ bundle, map: campusMap, origin: null }), finished.progress, [], engine.scoreRound([]));
const api = createScenarioHttp({ D5_SIMULATE: 'valid', D7_ENABLE_REVIEW: '1' });
const http = createServer((request, response) => { void api.handle(request, response, () => response.writeHead(404).end()); });
await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
try {
  const address = http.address();
  assert.ok(address && typeof address === 'object');
  const endpoint = `http://127.0.0.1:${address.port}/api/d7/review?run_id=${finished.run_id}`;
  const headers = { 'x-run-key': 'a'.repeat(64), 'content-type': 'application/json' };
  const request = { mode: 'start', request_id: 'node-review-request', run: finished };
  const saved = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(request) });
  assert.equal(saved.status, 200);
  const result = await saved.json();
  assert.equal(result.source, 'simulated');
  assert.deepEqual(result.items, threeItems);
  assert.equal(result.calls, 1);
  assert.deepEqual(await (await fetch(endpoint, { headers })).json(), result);
  assert.equal((await fetch(endpoint, { headers: { 'x-run-key': 'b'.repeat(64) } })).status, 404);
  const response = await fetch(endpoint.replace(finished.run_id, zero.run_id), { method: 'POST', headers,
    body: JSON.stringify({ ...request, run: zero }) });
  assert.equal((await response.json()).reason, 'no_actions');
} finally { await new Promise<void>((resolve) => http.close(() => resolve())); api.close(); }
console.log('D7 Node/SQLite: normal HTTP start and GET, wrong-key refusal, zero action summary, 8-second UI cutoff, late isolation, grounded output and four-slot concurrency pass.');

// Exercise the published dispatcher, including D6 snapshot access and D5/D7's shared database slots.
{
  type Row = Record<string, unknown>;
  const tables = new Map<string, Map<string, Row>>();
  const table = (name: string) => {
    if (!tables.has(name)) tables.set(name, new Map());
    const rows = tables.get(name)!;
    const filters: [string, unknown][] = [];
    let limit = Infinity;
    let patch: Row | null = null;
    const query = {
      select: () => query,
      eq(key: string, value: unknown) { filters.push([key, value]); return query; },
      limit(count: number) { limit = count; return query; },
      update(values: Row) { patch = values; return query; },
      then(resolve: (result: unknown) => unknown) {
        const selected = [...rows.entries()].filter(([, row]) => filters.every(([key, value]) => row[key] === value)).slice(0, limit);
        if (patch) for (const [key, row] of selected) rows.set(key, { ...row, ...patch });
        return resolve({ data: selected.map(([key]) => structuredClone(rows.get(key))), error: null });
      },
      insert(input: Row | Row[]) {
        const primary = (row: Row) => name.startsWith('d5_generation_')
          ? `${row.user_hash}:${row.run_id}:${row.slot ?? row.kind ?? ''}:${row.event ?? ''}`
          : name === 'run_events' ? `${row.run_id}:${row.seq}` : String(row.id);
        for (const row of Array.isArray(input) ? input : [input]) {
          const key = primary(row);
          if (rows.has(key)) return { error: { code: '23505' } };
          rows.set(key, structuredClone(row));
        }
        return { error: null };
      },
    };
    return query;
  };
  const objects = new Map<string, string>();
  const storage = {
    async list(prefix: string) {
      return [...objects.keys()].filter((path) => path.startsWith(prefix + '/'));
    },
    async download(path: string) {
      if (!objects.has(path)) throw Object.assign(new Error('missing'), { status: 404 });
      return { text: async () => objects.get(path) };
    },
    async upload(path: string, value: Uint8Array, options: { upsert: boolean }) {
      if (!options.upsert && objects.has(path)) throw new Error('exists');
      objects.set(path, new TextDecoder().decode(value));
    },
  };
  const binding = '../cloud-verify/functions/routes.mjs';
  const { application } = await import(binding);
  class BackendError extends Error { constructor(message: string, readonly status: number) { super(message); } }
  const flags: Record<string, string> = { D5_ENABLE_QODER: '1', D6_ENABLE_RUN_SYNC: '1', D7_ENABLE_REVIEW: '1', QODER_PAT: 'fixture' };
  Object.assign(globalThis, { Deno: { env: { get: (name: string) => flags[name] } } });
  const site = application({ db: { from: table }, storage, requireUser: async () => identity, BackendError });
  let identity: { user_id: string } | null = { user_id: 'fixture-account' };
  let sends = 0;
  let sessions = 0;
  const replies = new Map<string, string>();
  const originalFetch = globalThis.fetch;
  const dorm = templates[0]!;
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/models')) return Response.json({ data: [{ id: 'fast' }] });
    if (path.endsWith('/agents')) return Response.json({ id: 'agent_fixture', version: 1 });
    if (path.endsWith('/environments')) return Response.json({ id: 'env_fixture' });
    if (path.endsWith('/sessions')) return Response.json({ id: `sess_${++sessions}` });
    if (path.endsWith('/events')) {
      const id = path.split('/').at(-2)!;
      if (init?.method === 'POST') {
        sends++;
        const prompt = JSON.parse(JSON.parse(String(init.body)).events[0].content[0].text);
        replies.set(id, JSON.stringify(prompt.task === 'd7_review' ? { run_id: prompt.run_id,
          items: prompt.facts.slice(0, 3).map(({ seq, choices }: { seq: number; choices: string[] }) => ({ seq, text: choices[0] })) } : dorm.preset));
        return Response.json({ accepted: true });
      }
      return Response.json({ data: [{ type: 'agent.message', content: [{ type: 'text', text: replies.get(id) }] }] });
    }
    throw new Error('unexpected fixture endpoint');
  };
  const runKey = 'c'.repeat(64);
  const invoke = (path: string, method = 'GET', body?: unknown) => site({ request: new Request(`https://test.invalid/functions/v1/app${path}`,
    { method, headers: { 'Content-Type': 'application/json', 'X-Run-Key': runKey }, body: body ? JSON.stringify(body) : undefined }) }) as Promise<Response>;
  try {
    const root = { run_id: 'sites-generation-root', request_id: 'sites-generation-request', template_id: dorm.id, modifiers: dorm.modifiers };
    const gen = (await (await invoke('/api/d5/scenario', 'POST', root)).json()).result;
    assert.equal(gen.selection, 'generated');
    const roundBundle = { scenario: { ...gen.bundle.scenario, id: 'sites-frozen-scenario' }, action_catalog: gen.bundle.action_catalog, ugc_reports: gen.bundle.ugc_reports };
    const mapped = newRun({ bundle: roundBundle, map: campusMap, origin: { request: gen.request, selection: gen.selection, provider: gen.provider,
      fallback_reason: gen.fallback_reason, report_source: gen.report_source, calls: 0, shared_retry_used: false, upstream_state: gen.upstream_state } });
    assert.notEqual(mapped.run_id, root.run_id);
    const port = createEnginePort(roundBundle, campusMap);
    const at = gen.bundle.candidate.first_report_at as number;
    const action = port.judgeAction({ action_id: 'A1', target_id: roundBundle.scenario.start_building_id, submitted_at_sim: at, seq: 1, prior_events: [] });
    const events = [{ kind: 'action' as const, seq: 1, t_sim: at, payload: action }];
    const finalNode = roundBundle.scenario.nodes.length - 1;
    const done = updateRun(mapped, { ...mapped.progress, node: finalNode, furthest: finalNode, started: true, finished: true }, events, port.scoreRound(events));
    const suffix = `?run_id=${done.run_id}`;
    const review = '/api/d7/review' + suffix;
    const saved = '/api/d6/runs' + suffix;
    const start = { request_id: 'sites-review-request', mode: 'start' };
    assert.equal((await invoke(review, 'POST', start)).status, 404);
    assert.equal((await invoke(saved, 'PUT', { expected_revision: 0, run: done })).status, 200);
    const beforeReview = (await (await invoke(saved)).json()).run;
    flags.D7_ENABLE_REVIEW = '0';
    assert.equal((await (await invoke(review, 'POST', start)).json()).reason, 'not_configured');
    flags.D7_ENABLE_REVIEW = '1';
    identity = null;
    await assert.rejects(() => invoke(review, 'POST', start), { status: 401 });
    identity = { user_id: 'fixture-account' };
    assert.equal(sends, 1);
    const result = await (await invoke(review, 'POST', start)).json();
    assert.equal(result.source, 'ai');
    assert.equal(result.calls, 2);
    assert.equal(result.items[0].seq, 1);
    assert.deepEqual(await (await invoke(review)).json(), result);
    assert.equal(sends, 2);
    assert.equal(stable((await (await invoke(saved)).json()).run), stable(beforeReview));
    assert.equal(stable(beforeReview), stable(done));
    assert.equal(tables.get('d5_generation_runs')?.size, 1);
    assert.equal((await (await invoke(review, 'POST', { request_id: 'sites-review-retry', mode: 'retry' })).json()).calls, 3);
    assert.equal((await (await invoke(review, 'POST', { request_id: 'sites-review-extra', mode: 'retry' })).json()).can_regenerate, false);
    assert.equal(sends, 3);
    for (const run of [finished, zero]) {
      const query = `?run_id=${run.run_id}`;
      assert.equal((await invoke('/api/d6/runs' + query, 'PUT', { expected_revision: 0, run })).status, 200);
      const example = await (await invoke('/api/d7/review' + query, 'POST', start)).json();
      if (run === finished) assert.deepEqual(example.items, threeItems);
      else assert.equal(example.reason, 'no_actions');
    }
    assert.equal(sends, 4);
    console.log('D7 Sites mock: authenticated scenario and review share one root (different learner ID), server ignores client count, protected PUT/GET agree, explicit retry once, refresh no new send. Shared Node/Sites success and zero-action fixtures pass.');
  } finally { globalThis.fetch = originalFetch; Reflect.deleteProperty(globalThis, 'Deno'); }
}
