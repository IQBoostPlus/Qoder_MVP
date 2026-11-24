import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { application } from '../cloud-verify/functions/routes.mjs';
import { createDatabaseLedger } from '../cloud-verify/functions/d5-db-ledger.mjs';
import { createEnginePort } from '../src/engine-port.ts';
import { exportRun, newRun, updateRun } from '../src/run-store/local.ts';
import { stable } from '../src/run-store/validation.ts';
import { nextGenerationRunId, requestScenario } from '../src/scenario-generation/client.ts';
import { assembleBundle, fallbackResult } from '../src/scenario-generation/bundle.ts';
import { campusMap, templates } from '../src/scenario-generation/templates.ts';

const ddl = readFileSync(new URL('../db/migrations/d5-generation-ledger-baseline.sql', import.meta.url), 'utf8')
  .replaceAll(' app.', ' ').replaceAll(' DEFAULT now()', '');
const template = templates[0];
const input = { run_id: 'fix-designated-test-run', request_id: 'fix-designated-request', template_id: template.id, modifiers: template.modifiers };
const runKey = 'c'.repeat(64);
const wrongKey = 'a'.repeat(64);
const pat = 'test-only-qoder-credential';
const owner = (key) => createHash('sha256').update(key).digest('hex');
const base = 'https://sites.invalid';
const scenario = '/api/d5/scenario';
const exactQuery = (request) => new URLSearchParams(Object.entries(request).flatMap(([key, value]) =>
  Array.isArray(value) ? value.map((item) => [key, item]) : [[key, value]]));

class BackendError extends Error {
  constructor(code, status) { super(code); this.status = status; }
}

function fixture({ mode = 'valid', failInsert, appUrl = `${base}/functions/v1/app` } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(ddl);
  const otherTables = new Map();
  const ledgerRows = (name) => sqlite.prepare(`SELECT * FROM ${name}`).all();
  const files = new Map();
  const flags = new Map(Object.entries({ QODER_PAT: pat, D5_ENABLE_ANON_EXPERIMENT: '1',
    D5_ANON_EXPERIMENT_BINDING: input.run_id + ':' + owner(runKey), D6_ENABLE_RUN_SYNC: '1',
    D5_ENABLE_QODER: '1', D5_ENABLE_TEST_ROUTES: '1', D6_ENABLE_REPORTS: '1', D7_ENABLE_REVIEW: '1' }));

  function from(name) {
    const ledgerTable = name.startsWith('d5_generation_');
    if (!ledgerTable && !otherTables.has(name)) otherTables.set(name, new Map());
    const rows = otherTables.get(name);
    const filters = [];
    let max = Infinity;
    let patch;
    const key = (row) => name === 'run_events' ? `${row.run_id}:${row.seq}` : row.id;
    const query = {
      select: () => query,
      eq(column, value) { filters.push([column, value]); return query; },
      limit(count) { max = count; return query; },
      update(value) { patch = value; return query; },
      then(resolve) {
        const all = ledgerTable ? ledgerRows(name) : [...rows.values()];
        const selected = all.filter((row) => filters.every(([column, value]) => row[column] === value)).slice(0, max);
        if (patch) for (const row of selected) Object.assign(row, patch);
        return resolve({ data: structuredClone(selected), error: null });
      },
      insert(inputRows) {
        for (const row of Array.isArray(inputRows) ? inputRows : [inputRows]) {
          if (failInsert?.(name, row)) return { error: { code: '503' } };
          if (ledgerTable) {
            const columns = Object.keys(row);
            try {
              sqlite.prepare(`INSERT INTO ${name} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(row));
            } catch (error) {
              if (error.errcode === 1555) return { error: { code: '23505' } };
              throw error;
            }
          } else {
            if (rows.has(key(row))) return { error: { code: '23505' } };
            rows.set(key(row), structuredClone(row));
          }
        }
        return { error: null };
      },
    };
    return query;
  }

  const storage = {
    async list(prefix) { return [...files.keys()].filter((path) => path.startsWith(prefix + '/')); },
    async download(path) {
      if (!files.has(path)) throw Object.assign(new Error('missing'), { status: 404 });
      return { text: async () => files.get(path) };
    },
    async upload(path, bytes, { upsert }) {
      if (!upsert && files.has(path)) throw Object.assign(new Error('exists'), { status: 409 });
      files.set(path, new TextDecoder().decode(bytes));
    },
  };

  let identityChecks = 0;
  function instance() {
    const handle = application({ db: { from }, storage, BackendError, requireUser: async ({ request }) => {
      identityChecks++;
      if (request.headers.get('x-test-identity') === 'signed-in') return { user_id: 'legacy-test-identity' };
      throw new BackendError('identity_required', 401);
    } });
    return async (path, { method = 'GET', payload, key = runKey, headers = {} } = {}) => {
      const request = new Request(appUrl + path, { method,
        ...(payload && { body: JSON.stringify(payload) }),
        headers: { 'Content-Type': 'application/json', ...(key && { 'X-Run-Key': key }), ...headers },
      });
      try { return await handle({ request, requestId: 'sites-fixture-request' }); }
      catch (error) {
        if (!(error instanceof BackendError)) throw error;
        return Response.json({ code: error.message }, { status: error.status });
      }
    };
  }

  const calls = { upstream: 0, sessions: 0, messages: 0, reads: 0 };
  let recoverable = false;
  const cloud = async (url, options = {}) => {
    assert.equal(new URL(url).origin, 'https://api.qoder.com.cn');
    assert(!String(options.body).includes(runKey));
    calls.upstream++;
    const path = new URL(url).pathname;
    if (path.endsWith('/models')) return Response.json({ data: [{ id: 'fixture-model', enabled: true }] });
    if (path.endsWith('/agents')) return Response.json({ id: 'agent_fixture', version: 1 });
    if (path.endsWith('/environments')) return Response.json({ id: 'env_fixture' });
    if (path.endsWith('/sessions')) return Response.json({ id: `sess_anonymous_${++calls.sessions}` });
    assert(path.endsWith('/events'));
    if (options.method === 'POST') {
      const events = JSON.parse(options.body).events;
      assert.equal(events.length, 1);
      assert.equal(events[0].type, 'user.message');
      calls.messages++;
      if (mode === 'lost') throw new Error('fixture lost the send response');
      return Response.json({ accepted: true }, { status: 202, headers: { 'x-request-id': 'upstream-fixture-accepted' } });
    }
    calls.reads++;
    if (mode === 'timeout' && !recoverable) {
      return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('fixture deadline')), { once: true }));
    }
    const text = mode === 'invalid' ? '{}' : JSON.stringify(template.preset);
    return Response.json({ data: mode === 'lost' && !recoverable ? [] : [{ type: 'agent.message', content: [{ type: 'text', text }] }] });
  };

  const originalFetch = globalThis.fetch;
  const originalDeno = globalThis.Deno;
  globalThis.fetch = cloud;
  globalThis.Deno = { env: { get: (key) => flags.get(key) } };
  return { instance, flags, calls, files, ledgerRows, identityChecks: () => identityChecks,
    legacyLedger: (runId) => createDatabaseLedger({ db: { from }, storage, runId, userHash: owner('legacy-test-identity') }),
    allowReply() { recoverable = true; },
    close() { globalThis.fetch = originalFetch; globalThis.Deno = originalDeno; sqlite.close(); },
  };
}

const auth = { 'x-test-identity': 'signed-in' };
const lookup = (request = input) => scenario + '?' + exactQuery(request);
const post = (handle, payload = input, extra = {}) => handle(scenario, { method: 'POST', payload, ...extra });
const result = async (promise) => (await (await promise).json()).result;

// Sites may give the Function an internal URL while the browser sends the public origin.
{
  const appUrl = 'http://127.0.0.1:8787/app';
  const internalOrigin = new URL(appUrl + scenario).origin;
  const publicOrigin = 'https://campus-drill-anon-test-kqvhf8qsvw2.qoder.zone';
  const originSetting = 'D5_ANON_EXPERIMENT_PUBLIC_ORIGIN';
  assert.notEqual(internalOrigin, publicOrigin);
  const sameOrigin = { origin: publicOrigin, 'sec-fetch-site': 'same-origin' };

  for (const fetchSite of ['same-origin', 'none', undefined]) {
    const test = fixture({ appUrl });
    try {
      test.flags.set(originSetting, 'https://CAMPUS-DRILL-ANON-TEST-KQVHF8QSVW2.QODER.ZONE:443/');
      const headers = { origin: publicOrigin, ...(fetchSite !== undefined && { 'sec-fetch-site': fetchSite }) };
      const handle = test.instance();
      const response = await post(handle, input, { headers });
      const body = await response.json();
      assert.equal(response.status, 200, `hosted public POST (${fetchSite ?? 'no Fetch Metadata'}): HTTP ${response.status} ${body.code ?? body.status}`);
      assert.equal(body.result.selection, 'generated');
      assert.equal(body.result.calls, 1);
      assert.deepEqual(await result(handle(lookup(), { headers: { 'sec-fetch-site': 'same-origin' } })), body.result);
      assert.equal(test.calls.sessions, 1);
      assert.equal(test.calls.messages, 1);
    } finally { test.close(); }
  }
  console.log('FIX-v2 hosted POST: public origin with internal responder URL -> 200/generated, one synthetic message per fixture; none, absent Fetch Metadata and GET without Origin pass.');

  const blocked = fixture({ appUrl });
  try {
    blocked.flags.set(originSetting, publicOrigin);
    const handle = blocked.instance();
    const response = await post(handle, input, { key: '0'.repeat(64), headers: sameOrigin });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { code: 'not_found' });
    const outside = await post(handle, input, { key: '0'.repeat(64), headers: { origin: 'https://elsewhere.invalid' } });
    assert.equal(outside.status, 415);
    assert.deepEqual(await outside.json(), { code: 'same_origin_required' });
    for (const headers of [
      ...['https://elsewhere.invalid', 'https://other.qoder.zone', internalOrigin].map(origin => ({ ...sameOrigin, origin })),
      ...['cross-site', 'same-site'].map(site => ({ ...sameOrigin, 'sec-fetch-site': site })),
      { ...sameOrigin, origin: 'https://elsewhere.invalid', host: 'elsewhere.invalid', 'x-forwarded-host': 'elsewhere.invalid' },
      { ...sameOrigin, origin: publicOrigin.toUpperCase() },
    ]) {
      const rejected = await post(handle, input, { headers });
      assert.equal(rejected.status, 415);
      assert.deepEqual(await rejected.json(), { code: 'same_origin_required' });
    }
    assert.deepEqual(blocked.calls, { upstream: 0, sessions: 0, messages: 0, reads: 0 });
    for (const table of ['runs', 'slots', 'results']) assert.equal(blocked.ledgerRows('d5_generation_' + table).length, 0);
  } finally { blocked.close(); }
  console.log('FIX-v2 hosted negatives: zero key -> business 404; other origins and cross-/same-site -> 415; zero gateway calls and ledger rows.');

  for (const declared of [undefined, '', 'not a URL', 'http://127.0.0.1:8787', 'https://[bad]', 'https://.', 'https://example..com',
    `${publicOrigin}:99999`, `${publicOrigin},https://elsewhere.invalid`, 'https://*.qoder.zone',
    'https://user:pass@campus-drill-anon-test-kqvhf8qsvw2.qoder.zone', `${publicOrigin}/subpath`, `${publicOrigin}/.`,
    `${publicOrigin}?`, `${publicOrigin}#`, `${publicOrigin}\n`]) {
    const test = fixture({ appUrl });
    try {
      if (declared !== undefined) test.flags.set(originSetting, declared);
      const handle = test.instance();
      assert.equal((await post(handle, input, { headers: sameOrigin })).status, 415, JSON.stringify(declared));
      const accepted = await post(handle, input, { headers: { ...sameOrigin, origin: internalOrigin } });
      assert.equal(accepted.status, 200, JSON.stringify(declared));
      assert.equal((await accepted.json()).result.selection, 'generated');
      assert.equal(test.calls.messages, 1);
    } finally { test.close(); }
  }
  console.log('FIX-v2 missing or invalid declaration: public POST remains 415 and internal-origin POST reaches generation.');
}

{
  const test = fixture();
  try {
    const left = test.instance();
    const right = test.instance();
    for (const [extra, data, status] of [
      [{ key: null }, input, 404], [{ key: wrongKey }, input, 404], [{}, { ...input, run_id: 'other-designated-test-run' }, 404],
      [{ headers: { origin: 'https://elsewhere.invalid' } }, input, 415],
      [{ headers: { 'sec-fetch-site': 'same-site' } }, input, 415],
    ]) assert.equal((await post(left, data, extra)).status, status);
    assert.equal((await left(lookup(), { key: null })).status, 404);
    assert.equal((await left(lookup())).status, 404);
    assert.equal(test.identityChecks(), 0);
    assert.equal(test.calls.upstream, 0);
    assert.equal(test.files.size, 0);
    assert.equal(test.ledgerRows('d5_generation_runs').length, 0);
    assert.equal(test.ledgerRows('d5_generation_slots').length, 0);

    // The anonymous route does not open other diagnostics or sending paths.
    const restricted = [
      ['/api/d5/diag', 'GET'], ['/api/d5/stats?run_id=' + input.run_id, 'GET'], ['/api/d5/warm', 'POST'],
      ['/api/d5/test/interrupt', 'POST'], ['/api/d7/review', 'POST'], ['/api/d1/agent', 'POST'],
      ['/api/d2/agent/init', 'POST'], ['/api/d2/agent/send', 'POST'],
    ];
    for (const [path, method] of restricted) assert.equal((await left(path, { method })).status, 401);
    const diag = await (await left('/api/d5/diag', { headers: auth })).json();
    assert.equal(diag.anonymous_experiment_enabled, true);
    assert.equal(diag.real_generation_enabled, false);
    for (const [path, method] of restricted.slice(2)) {
      const response = await left(path, { method, headers: { ...auth, 'x-d5-test': '1' }, payload: input });
      assert(response.status >= 400);
    }
    assert.equal(test.calls.upstream, 0);

    const pair = await Promise.all([post(left), post(right)]);
    assert.deepEqual(pair.map(({ status }) => status).sort(), [200, 202]);
    const first = await pair.find(({ status }) => status === 200).json();
    assert.equal(first.result.selection, 'generated');
    assert.equal(first.result.provider, 'qoder');
    assert.equal(first.result.report_source, 'preset');
    assert.equal(first.result.calls, 1);
    assert.equal(first.trace.phases.scenario.accepted, true);
    assert.equal(first.trace.phases.scenario.send_response.http_status, 202);
    assert.equal(first.trace.phases.scenario.send_response.request_id, 'upstream-fixture-accepted');
    assert.deepEqual(test.ledgerRows('d5_generation_slots').map(({ slot, event }) => [slot, event]).sort(),
      [['scenario', 'complete'], ['scenario', 'reserved'], ['scenario', 'sent']]);
    assert.equal(test.ledgerRows('d5_generation_runs').length, 1);
    assert.equal(test.ledgerRows('d5_generation_results').length, 1);
    assert.equal([...test.files.keys()].filter((path) => path.endsWith('/resources.json')).length, 1);
    assert(![...test.files.keys()].some((path) => path.includes(owner(''))));

    const restarted = test.instance();
    assert.deepEqual(await result(restarted(lookup())), first.result);
    assert.deepEqual(await result(post(restarted)), first.result);
    assert.equal((await restarted(lookup(), { key: wrongKey })).status, 404);
    const changed = { ...input, request_id: 'replacement-request-id' };
    assert.equal((await result(post(restarted, changed))).fallback_reason, 'conflict');
    assert.equal((await restarted(lookup(changed))).status, 404);
    test.flags.set('D5_ANON_EXPERIMENT_BINDING', input.run_id + ':' + owner(wrongKey));
    assert.equal((await restarted(lookup(), { key: wrongKey })).status, 404);
    const newerRun = { ...changed, run_id: 'replacement-fixture-run' };
    test.flags.set('D5_ANON_EXPERIMENT_BINDING', newerRun.run_id + ':' + owner(wrongKey));
    assert.equal((await result(post(restarted, newerRun, { key: wrongKey }))).fallback_reason, 'conflict');
    assert.equal(test.calls.sessions, 1);
    assert.equal(test.calls.messages, 1);
    assert.equal(test.calls.reads, 1);
    const evidence = JSON.stringify([first, ...test.files.values()]);
    for (const secret of [runKey, owner(runKey), pat]) assert(!evidence.includes(secret));

    const past = { ...input, run_id: 'past-signed-in-generation' };
    const pastResult = fallbackResult(past, 'network', 0, 0);
    const pastLedger = test.legacyLedger(past.run_id);
    assert.equal(await pastLedger.claim(past), 'new');
    assert.equal(await pastLedger.save(pastResult), true);
    test.flags.set('D5_ENABLE_ANON_EXPERIMENT', '0');
    test.flags.set('D5_ENABLE_QODER', '0');
    assert.equal((await restarted(lookup())).status, 401);
    assert.equal((await post(restarted)).status, 401);
    assert.equal((await result(post(restarted, changed, { headers: auth }))).fallback_reason, 'not_configured');
    assert.equal(test.calls.messages, 1);
    assert.deepEqual(await result(restarted(lookup(past), { headers: auth })), pastResult);
    assert.equal(test.ledgerRows('d5_generation_runs').length, 2);
    console.log('FIX authorization/one send: 2 app handlers share SQLite primary keys; anonymous POST 200/202, generated qoder/1, isolated rotation, exact GET, 1 Session, 1 synthetic accepted message. Closed and protected routes pass.');

    const { scenario: frozen, action_catalog, ugc_reports } = assembleBundle(input, template.preset, 'fallback');
    const data = { scenario: { ...frozen, source: 'preset' }, action_catalog, ugc_reports };
    const run = newRun({ bundle: data, map: campusMap, origin: null });
    const end = frozen.nodes.length - 1;
    const done = updateRun(run, { ...run.progress, started: true, finished: true, node: end, furthest: end }, [],
      createEnginePort(data, campusMap).scoreRound([]));
    const d6 = '/api/d6/runs?run_id=' + run.run_id;
    assert.equal((await restarted(d6, { method: 'PUT', payload: { expected_revision: 0, run: done } })).status, 200);
    const replay = (await (await restarted(d6)).json()).run;
    assert.equal(stable(replay), stable(done));
    assert.equal((await restarted(d6, { key: wrongKey })).status, 404);
    assert(!exportRun(replay).includes(runKey));
    assert(!exportRun(replay).includes(pat));
    console.log('FIX closed preset/D6: saved and independently read a frozen preset round, rejected wrong key, export contains neither run key nor service credential.');
  } finally { test.close(); }
}

for (const mode of ['invalid', 'lost', 'timeout']) {
  const test = fixture({ mode });
  try {
    const handler = test.instance();
    const fallback = await result(post(handler));
    assert.equal(fallback.fallback_reason, { invalid: 'invalid_candidate', lost: 'network', timeout: 'timeout' }[mode]);
    assert.equal(fallback.calls, 1);
    assert.equal(fallback.upstream_state, mode === 'invalid' ? 'complete' : 'unknown');
    assert.equal(fallback.report_source, 'preset');
    assert.equal((await result(post(handler, { ...input, request_id: 'second-request-id' }))).fallback_reason, 'conflict');
    if (mode !== 'invalid') test.allowReply();
    const reply = await (await test.instance()(lookup())).json();
    assert.equal(reply.result.selection, mode === 'invalid' ? 'fallback' : 'generated');
    if (mode !== 'invalid') assert.equal(reply.trace.reply_read, true);
    assert.equal(test.calls.sessions, 1);
    assert.equal(test.calls.messages, 1);
    console.log(`FIX ${mode}: ${fallback.fallback_reason}/${fallback.upstream_state}, readback=${reply.result.selection}, 1 synthetic message, no retry or reports.`);
  } finally { test.close(); }
}

for (const affected of ['claim', 'slot', 'sent', 'result', 'binding', 'provider']) {
  const test = fixture({ failInsert: (name, row) =>
    affected === 'claim' && name === 'd5_generation_runs' || affected === 'slot' && row.event === 'reserved' ||
    affected === 'sent' && row.event === 'sent' || affected === 'result' && row.kind === 'result' });
  try {
    if (affected === 'binding') test.flags.delete('D5_ANON_EXPERIMENT_BINDING');
    if (affected === 'provider') test.flags.delete('QODER_PAT');
    const handler = test.instance();
    const fallback = await result(post(handler));
    assert.equal(fallback.selection, 'fallback');
    assert.equal(fallback.fallback_reason, ['binding', 'provider'].includes(affected) ? 'not_configured' : 'network');
    if (affected === 'result') assert.equal((await result(test.instance()(lookup()))).selection, 'generated');
    else assert.equal(test.calls.messages, 0);
    assert.equal(test.calls.messages, affected === 'result' ? 1 : 0);
    console.log(`FIX ${affected} unavailable: ${fallback.fallback_reason}, ${test.calls.messages} synthetic messages.`);
  } finally { test.close(); }
}

{
  const test = fixture();
  const previousLocal = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const browserData = new Map([['campus-d6.key.' + input.run_id, runKey], ['campus-drill-generation-test-run-v1', input.run_id]]);
  const storage = { getItem: (name) => browserData.get(name) ?? null, setItem: (name, value) => browserData.set(name, value) };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  try {
    const handle = test.instance();
    const wire = [];
    const browserFetch = async (path, init) => {
      assert.equal(new Headers(init.headers).get('x-run-key'), runKey);
      assert(!path.includes(runKey) && !String(init.body).includes(runKey));
      wire.push(init.method ?? 'GET');
      return handle(path, { method: init.method, payload: init.body && JSON.parse(init.body) });
    };
    assert.equal(nextGenerationRunId(storage), input.run_id);
    for (const recover of [false, true]) {
      const reply = await requestScenario(input, recover, new AbortController().signal, () => {}, browserFetch);
      assert.equal(reply.selection, 'generated');
      assert.equal(reply.provider, 'qoder');
      assert.equal(reply.calls, 1);
    }
    assert.deepEqual(wire, ['POST', 'GET']);
    assert.equal(test.calls.messages, 1);
    console.log('FIX browser request adapter: designated run selected; same key on normal POST and GET, absent from URL/body, 1 synthetic message.');
  } finally {
    if (previousLocal) Object.defineProperty(globalThis, 'localStorage', previousLocal);
    else Reflect.deleteProperty(globalThis, 'localStorage');
    test.close();
  }
}
