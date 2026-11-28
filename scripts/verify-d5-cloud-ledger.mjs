import assert from 'node:assert/strict';
import { createD5Service } from '../cloud-verify/functions/d5-service.mjs';
import { createD5Routes } from '../cloud-verify/functions/d5-routes.mjs';
import { fallbackResult } from '../cloud-verify/functions/d5-bundle.mjs';
import { application } from '../cloud-verify/functions/routes.mjs';

const objects = new Map();
const storage = {
  async download(path) {
    if (!objects.has(path)) throw Object.assign(new Error('missing'), { status: 404 });
    const text = objects.get(path);
    return { text: async () => text };
  },
  async upload(path, bytes, { upsert }) {
    if (!upsert && objects.has(path)) throw new Error('exists');
    objects.set(path, new TextDecoder().decode(bytes));
  },
  async list(prefix) {
    return [...objects.keys()].filter((key) => key.startsWith(prefix + '/')).map((key) => ({ name: key.split('/').filter(Boolean).at(-1), path: key }));
  },
};

function createDb() {
  const tables = new Map([
    ['d5_generation_runs', new Map()],
    ['d5_generation_slots', new Map()],
    ['d5_generation_results', new Map()],
  ]);
  let competing;
  let failFinalRun;
  let rejectRelease = false;
  const pk = (table, row) => {
    if (table === 'd5_generation_runs') return `${row.user_hash}|${row.run_id}`;
    if (table === 'd5_generation_slots') return `${row.user_hash}|${row.run_id}|${row.slot}|${row.event}`;
    return `${row.user_hash}|${row.run_id}|${row.kind}`;
  };
  function from(table) {
    const map = tables.get(table);
    const filters = [];
    let max = Infinity;
    let patch;
    const query = {
      insert(row) {
        if (failFinalRun && table === 'd5_generation_results' && row.kind === 'final' && row.run_id === failFinalRun) {
          throw new Error('write unavailable');
        }
        if (table === 'd5_generation_results' && row.kind === 'result' && competing && row.run_id === competing.runId) {
          const key = pk(table, row);
          if (!map.has(key)) map.set(key, { ...row, payload: JSON.stringify(competing.result) });
        }
        const key = pk(table, row);
        if (map.has(key)) return { error: { code: '23505' } };
        map.set(key, { ...row });
        return { data: [row], error: null };
      },
      select() { return query; },
      update(value) { patch = value; return query; },
      eq(column, value) { filters.push([column, value]); return query; },
      limit(value) { max = value; return query; },
      order() { return query; },
      then(resolve) {
        if (rejectRelease && patch?.payload === '{"state":"released"}') {
          resolve({ error: { code: '503' } });
          return;
        }
        const selected = [...map.values()].filter((row) => filters.every(([column, value]) => row[column] === value)).slice(0, max);
        if (patch) for (const row of selected) Object.assign(row, patch);
        resolve({
          data: selected.map(row => ({ ...row })),
          error: null,
        });
      },
    };
    return query;
  }
  return {
    from,
    tableRows: (table) => [...tables.get(table).values()],
    setCompeting(value) { competing = value; },
    setFailFinal(runId) { failFinalRun = runId; },
    rejectRelease(value) { rejectRelease = value; },
  };
}

const candidate = JSON.stringify({
  start_building_id: 'N7', road_id: 'R-N7E', first_report_at: 30, confirmed_at: 90,
  escalation_at: 140, t_end: 300, perspective: 'witness',
});
const replies = new Map();
let sessions = 0;
let outboundRequests = 0;
let modelSends = 0;
let getCount = 0;
let hangGetIndex = -1;
const ok = (value) => ({ ok: true, status: 200, json: async () => value });

const env = new Map([['QODER_PAT', 'test-pat']]);
globalThis.Deno = { env: { get: (key) => env.get(key) } };
globalThis.fetch = async (url, options = {}) => {
  outboundRequests += 1;
  const path = new URL(url).pathname;
  if (path.endsWith('/models')) return ok({ data: [{ id: 'model-x', enabled: true }] });
  if (path.endsWith('/agents')) return ok({ id: 'agent_test1', version: 1 });
  if (path.endsWith('/environments')) return ok({ id: 'env_test1' });
  if (path.endsWith('/sessions')) {
    const id = 'sess_test' + (++sessions);
    replies.set(id, candidate);
    return ok({ id });
  }
  if (path.endsWith('/events') && options.method === 'POST') {
    modelSends += 1;
    return ok({ ok: true });
  }
  if (path.endsWith('/events')) {
    getCount += 1;
    if (getCount === hangGetIndex) {
      return new Promise((_, reject) => options.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    }
    const id = path.split('/sessions/')[1].split('/')[0];
    return ok({ data: [
      { type: 'user.message', content: [{ type: 'text', text: 'prompt' }] },
      { type: 'agent.message', content: [{ type: 'text', text: replies.get(id) }] },
    ] });
  }
  throw new Error('unexpected path ' + path);
};

const db = createDb();
const userHash = 'a'.repeat(64);
const service = createD5Service({ db, storage });
const request = {
  run_id: 'ledger-check-run-0001', request_id: 'ledger-check-req-0001',
  template_id: 'TPL-NIGHT-DORM-01', modifiers: ['night', 'heavy_rain'],
};

const diag = await service.diag();
assert.equal(diag.configured, true);
assert.equal(diag.ledger, 'database');
assert.equal(diag.selected_model, 'model-x');
await service.warm(userHash);

const [a, b] = await Promise.all([service.generate(userHash, request), service.generate(userHash, request)]);
assert.deepEqual([a.status, b.status].sort(), ['pending', 'ready']);
const ready = a.status === 'ready' ? a : b;
assert.equal(ready.result.selection, 'generated');
assert.equal(ready.result.provider, 'qoder');
assert.equal(ready.result.calls, 1);
assert.equal(ready.result.upstream_state, 'complete');
assert.equal(ready.result.fallback_reason, null);
assert.equal(db.tableRows('d5_generation_runs').length, 1);
assert.equal(db.tableRows('d5_generation_results').length, 1);

const again = await service.generate(userHash, request);
assert.equal(again.status, 'ready');
assert.equal(again.result.calls, 1);
assert.deepEqual(again.result, ready.result);
console.log('D5 regression: atomic request claim; concurrent loser reads the stored terminal and sends once');

const disputed = { ...request, run_id: 'disputed-result-run-1' };
db.setCompeting({ runId: disputed.run_id, result: fallbackResult(disputed, 'budget', 0, 1) });
const disputedReply = await service.generate(userHash, disputed);
db.setCompeting(undefined);
assert.equal(disputedReply.result.fallback_reason, 'budget');
assert.deepEqual(disputedReply, await service.recover(userHash, disputed));
assert(!disputedReply.trace);
assert.equal(db.tableRows('d5_generation_results').filter((row) => row.run_id === disputed.run_id).length, 1);
console.log('D5 regression: rejected result write returns the persisted result, never an unsaved generated candidate');

const conflict = await service.generate(userHash, { ...request, request_id: 'ledger-check-req-0002' });
assert.equal(conflict.result.fallback_reason, 'conflict');
assert.equal(conflict.result.calls, 0);

const seedRun = 'ledger-seed-run-0001';
const seeded = await service.seed(userHash, { ...request, run_id: seedRun, request_id: 'ledger-seed-req-0001' }, ['scenario', 'reports', 'review']);
assert.equal(seeded.usage.calls, 3);
const sendsBeforeRace = modelSends;
const races = await Promise.all([
  service.claimLastSlot(userHash, { ...request, run_id: seedRun, request_id: 'ledger-seed-req-0001' }),
  service.claimLastSlot(userHash, { ...request, run_id: seedRun, request_id: 'ledger-seed-req-0001' }),
]);
assert.deepEqual(races.map((race) => race.status).sort(), ['ready', 'taken']);
assert.equal(modelSends, sendsBeforeRace + 1);
assert.equal((await service.stats(userHash, seedRun)).usage.calls, 4);

const interruptRun = 'ledger-interrupt-run-0001';
const interruptRequest = { ...request, run_id: interruptRun, request_id: 'ledger-interrupt-req-0001' };
hangGetIndex = getCount + 2;
const interrupted = await service.interrupt(userHash, interruptRequest);
assert.equal(interrupted.accepted, true);
assert.equal(interrupted.result.upstream_state, 'unknown');
assert.equal(interrupted.result.calls, 1);
const sendsBeforeRecovery = modelSends;
db.setFailFinal(interruptRun);
await assert.rejects(service.recover(userHash, interruptRequest), { message: 'write unavailable' });
assert.equal((await service.stats(userHash, interruptRun)).usage.upstream_state, 'unknown');
db.setFailFinal(undefined);
const recovered = await service.recover(userHash, interruptRequest);
assert.equal(recovered.status, 'ready');
assert.equal(recovered.result.selection, 'generated');
assert.equal(recovered.result.calls, 1);
assert.equal(modelSends, sendsBeforeRecovery);

class BackendError extends Error {
  constructor(code, status) {
    super(code);
    this.status = status;
  }
}
const user = { user_id: 'd5-test-user' };
const appRoute = application({ db, storage, BackendError, requireUser: () => user });
const routeHash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(user.user_id))).toString('hex');
const route = createD5Routes({ db, storage, BackendError });
function invoke(path, method = 'GET', input = request, query = '') {
  const httpRequest = new Request('https://test.invalid' + path + query, {
    method, headers: { 'Content-Type': 'application/json', 'x-d5-test': '1' },
    body: method === 'POST' ? JSON.stringify(input) : undefined,
  });
  return route({ request: httpRequest }, path, user);
}
function queryFor(run) {
  const params = new URLSearchParams({ run_id: run.run_id, request_id: run.request_id, template_id: run.template_id });
  for (const modifier of run.modifiers) params.append('modifiers', modifier);
  return '?' + params.toString();
}

const legacyRequest = { ...request, run_id: 'legacy-storage-run-0001', request_id: 'legacy-storage-req-0001' };
const legacyRoot = `d5-generation/${routeHash}/${legacyRequest.run_id}`;
const legacyResult = {
  ...fallbackResult(legacyRequest, null), provider: 'qoder', selection: 'generated',
  scenario_source: 'generated', calls: 1, upstream_state: 'complete',
};
delete legacyResult.bundle;
objects.set(`${legacyRoot}/request.json`, JSON.stringify(legacyRequest));
objects.set(`${legacyRoot}/result.json`, JSON.stringify(legacyResult));
objects.set(`${legacyRoot}/slots/scenario/sent.json`, JSON.stringify({ session_id: 'sess_legacy', at: '2026-11-20T00:00:00.000Z' }));
objects.set(`${legacyRoot}/slots/scenario/complete.json`, JSON.stringify({ at: '2026-11-20T00:00:05.000Z' }));

const savedRun = { ...request, run_id: 'disabled-route-saved-run' };
const unknownRun = { ...request, run_id: 'disabled-route-unknown-run' };
await service.warm(routeHash);
const savedRunResult = await service.generate(routeHash, savedRun);
hangGetIndex = getCount + 2;
await service.interrupt(routeHash, unknownRun);
const unknownBefore = (await service.stats(routeHash, unknownRun.run_id)).result;
assert.equal(unknownBefore.result.upstream_state, 'unknown');

const legacyStats = await service.stats(routeHash, legacyRequest.run_id);
assert.equal(legacyStats.usage.calls, 1);
assert.equal(legacyStats.usage.upstream_state, 'complete');
assert.deepEqual(legacyStats.result.result, legacyResult);
assert.equal(db.tableRows('d5_generation_runs').filter((row) => row.run_id === legacyRequest.run_id).length, 0);
console.log('D5 regression: pre-migration Storage run remains readable and counted without creating database rows');

const beforeDisable = outboundRequests;
const dbSizesBefore = ['d5_generation_runs', 'd5_generation_slots', 'd5_generation_results'].map((table) => db.tableRows(table).length);
const legacyAgentPaths = ['/api/d1/agent', '/api/d2/agent/init', '/api/d2/agent/send'];
const postLegacyAgent = (path) => appRoute({ request: new Request(`https://test.invalid/functions/v1/app${path}`, { method: 'POST' }) });
env.set('D5_ENABLE_TEST_ROUTES', '1');
for (const disabledFlag of [undefined, '0', 'true']) {
  if (disabledFlag === undefined) env.delete('D5_ENABLE_QODER');
  else env.set('D5_ENABLE_QODER', disabledFlag);
  const response = await invoke('/api/d5/diag');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.real_generation_enabled, false);
  assert.equal(body.ledger, 'database');
  const fresh = { ...request, run_id: 'disabled-route-fresh-run' };
  const post = await invoke('/api/d5/scenario', 'POST', fresh);
  const freshBody = await post.json();
  assert.equal(freshBody.result.selection, 'fallback');
  assert.equal(freshBody.result.fallback_reason, 'not_configured');
  assert.equal(freshBody.result.calls, 0);
  assert.equal(freshBody.result.upstream_state, 'not_sent');
  assert.equal(freshBody.result.bundle.scenario.template_id, fresh.template_id);
  assert.equal((await invoke('/api/d5/scenario', 'GET', fresh, queryFor(fresh))).status, 404);
  const cached = await invoke('/api/d5/scenario', 'GET', savedRun, queryFor(savedRun));
  assert.deepEqual((await cached.json()).result, savedRunResult.result);
  assert.deepEqual((await (await invoke('/api/d5/scenario', 'POST', savedRun)).json()).result, savedRunResult.result);
  const legacy = await invoke('/api/d5/scenario', 'GET', legacyRequest, queryFor(legacyRequest));
  assert.deepEqual((await legacy.json()).result, legacyResult);
  const unknown = await invoke('/api/d5/scenario', 'GET', unknownRun, queryFor(unknownRun));
  assert.deepEqual((await unknown.json()).result, unknownBefore.result);
  await assert.rejects(invoke('/api/d5/warm', 'POST'), { message: 'd5_generation_disabled' });
  for (const [endpoint, method] of [['seed', 'POST'], ['last-slot', 'POST'], ['interrupt', 'POST'], ['upstream', 'GET']]) {
    await assert.rejects(invoke('/api/d5/test/' + endpoint, method), { message: 'd5_test_routes_disabled' });
  }
  for (const path of legacyAgentPaths) {
    await assert.rejects(postLegacyAgent(path), { message: 'agent_test_routes_disabled', status: 404 });
  }
}
const normalGet = globalThis.Deno.env.get;
globalThis.Deno.env.get = () => { throw new Error('env denied'); };
assert.equal((await (await invoke('/api/d5/diag')).json()).real_generation_enabled, false);
globalThis.Deno.env.get = normalGet;
assert.equal(outboundRequests, beforeDisable);
assert.deepEqual(['d5_generation_runs', 'd5_generation_slots', 'd5_generation_results'].map((table) => db.tableRows(table).length), dbSizesBefore);
env.set('D5_ENABLE_QODER', '1');
env.delete('D5_ENABLE_TEST_ROUTES');
await assert.rejects(invoke('/api/d5/test/seed', 'POST'), { message: 'd5_test_routes_disabled' });
for (const path of legacyAgentPaths) {
  await assert.rejects(postLegacyAgent(path), { message: 'agent_test_routes_disabled', status: 404 });
}
assert.equal((await (await invoke('/api/d5/diag')).json()).real_generation_enabled, true);

let activeIdentity = 'local-owner-a';
const publicApp = application({ db, storage, BackendError, requireUser: async () => ({ user: { userId: activeIdentity } }) });
const appRequest = { ...request, run_id: 'application-owned-run', request_id: 'application-owned-request' };
const scenarioRoute = 'https://test.invalid/functions/v1/app/api/d5/scenario';
const publicSend = await publicApp({ request: new Request(scenarioRoute, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(appRequest),
}) });
assert.equal(publicSend.status, 200);
const generated = (await publicSend.json()).result;
assert.equal(generated.selection, 'generated');
assert.equal(generated.provider, 'qoder');
assert.equal(generated.calls, 1);
assert.equal(generated.upstream_state, 'complete');
const publicRead = () => publicApp({ request: new Request(scenarioRoute + queryFor(appRequest)) });
const sendsBeforeRead = modelSends;
activeIdentity = 'local-owner-b';
assert.equal((await publicRead()).status, 404);
activeIdentity = 'local-owner-a';
assert.deepEqual((await (await publicRead()).json()).result, generated);
assert.equal(modelSends, sendsBeforeRead);
console.log('Sites application mock: asynchronous owner generates once, another owner gets 404 and the original owner reads back the same result.');

const normalFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  assert.equal(new URL(url).pathname, '/api/v1/cloud/models');
  return Response.json({}, { status: 502, headers: { 'x-request-id': 'local-models-error' } });
};
try {
  activeIdentity = 'local-owner-resource-failure';
  const request = { ...appRequest, run_id: 'binding-failure-run' };
  const reply = await publicApp({ request: new Request(scenarioRoute, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
  }) });
  assert.equal(reply.status, 200);
  const { result, trace } = await reply.json();
  assert.equal(result.selection, 'fallback');
  assert.equal(result.fallback_reason, 'network');
  assert.equal(result.calls, 0);
  assert.equal(result.upstream_state, 'not_sent');
  assert.equal(trace.binding_error.failed_step, 'models');
  assert.equal(trace.binding_error.http_status, 502);
  assert.equal(db.tableRows('d5_generation_slots').filter((row) => row.run_id === request.run_id).length, 0);
} finally { globalThis.fetch = normalFetch; }

console.log('Sites route mock: off flags, zero outbound fetches and zero ledger writes with credentials present; cached reads and D1/D2/D5 test gates verified');
console.log('D5 service mock: database claim, dedup, conflict, last-slot race, interrupt and recovery passed');
console.log(JSON.stringify({ sessions, interrupted: interrupted.interrupted, recovered_state: recovered.result.upstream_state }));

{
  const quotaDb = createDb();
  const service = createD5Service({ db: quotaDb, storage });
  const publicBudget = { limit: 1, agent_id: 'agent_configured', environment_id: 'env_configured' };
  const keyDigest = 'd'.repeat(64);
  const one = { ...request, run_id: 'public-quota-failed-first', request_id: 'quota-release-first-request' };
  const two = { ...request, run_id: 'public-quota-second-winner', request_id: 'quota-release-second-request' };
  const tickets = () => quotaDb.tableRows('d5_generation_results').filter(({ run_id }) => run_id === 'public-scenario-budget-v1');
  quotaDb.rejectRelease(true);
  globalThis.fetch = async (url, options) => {
    if (new URL(url).pathname.endsWith('/sessions')) return Response.json({}, { status: 401 });
    return normalFetch(url, options);
  };
  let rejected;
  try { rejected = (await service.publicScenario(one, 'POST', keyDigest, publicBudget)).result; }
  finally { globalThis.fetch = normalFetch; }
  assert.equal(rejected.fallback_reason, 'unauthorized');
  const reserved = tickets()[0];
  assert.equal(JSON.parse(reserved.payload).request_id, one.request_id);
  const newService = createD5Service({ db: quotaDb, storage });
  const succeeded = (await newService.publicScenario(two, 'POST', keyDigest, publicBudget)).result;
  assert.equal(succeeded.selection, 'generated');
  const winner = tickets()[0];
  assert.equal(JSON.parse(winner.payload).request_id, two.request_id);
  assert.equal(JSON.parse(winner.payload).state, 'success');
  quotaDb.rejectRelease(false);
  assert.deepEqual((await newService.publicScenario(one, 'GET', keyDigest, publicBudget)).result, rejected);
  assert.deepEqual(tickets()[0], winner);
  assert.equal(quotaDb.tableRows('d5_generation_runs').filter(({ run_id }) => run_id === one.run_id).length, 1);
  assert.equal(quotaDb.tableRows('d5_generation_slots').filter(({ run_id }) => run_id === one.run_id).length, 1);
  assert.equal(quotaDb.tableRows('d5_generation_results').filter(({ run_id }) => run_id === one.run_id).length, 1);
  console.log('Public quota recovery: failed settlement after durable fallback repaired by next claim; late read cannot overwrite the new owner.');

  const legacyDb = createDb();
  legacyDb.from('d5_generation_results').insert({ ...winner, payload: '{}' });
  const oldService = createD5Service({ db: legacyDb, storage });
  const old = await oldService.publicScenario(two, 'POST', keyDigest, publicBudget);
  assert.equal(old.result.fallback_reason, 'budget');
  assert.equal(legacyDb.tableRows('d5_generation_results').find(({ run_id }) => run_id === winner.run_id).payload, '{}');
  console.log('Public quota compatibility: legacy tickets without an owner are preserved.');

  const writeFailureDb = createDb();
  const writing = createD5Service({ db: writeFailureDb, storage });
  writeFailureDb.setFailFinal(one.run_id);
  const before = modelSends;
  await assert.rejects(writing.publicScenario(one, 'POST', keyDigest, publicBudget));
  assert.equal(modelSends, before + 1);
  const reservation = writeFailureDb.tableRows('d5_generation_results').find(({ run_id }) => run_id === 'public-scenario-budget-v1');
  assert.equal(JSON.parse(reservation.payload).state, 'reserved');
  assert.equal((await writing.publicScenario(one, 'POST', keyDigest, publicBudget)).status, 'pending');
  assert.equal((await writing.publicScenario(two, 'POST', keyDigest, publicBudget)).result.fallback_reason, 'budget');
  writeFailureDb.setFailFinal(null);
  const recovered = await writing.publicScenario(one, 'GET', keyDigest, publicBudget);
  assert.equal(recovered.result.selection, 'generated');
  assert.equal(JSON.parse(reservation.payload).state, 'success');
  assert.equal(modelSends, before + 1);
  console.log('Public quota persistence: failed terminal write stays reserved; only durable GET recovery can finalize the success.');
}
