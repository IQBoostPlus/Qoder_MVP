import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { application } from '../cloud-verify/functions/routes.mjs';
import { ensureResources } from '../cloud-verify/functions/d5-service.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const scope = hash('campus-drill:d5:anonymous:v1:resources');
const root = `d5-generation/${scope}`;
const binding = root + '/resources.json';
const probeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const upstreamId = '12345678-1234-4321-8aaa-123456789abc';
const privateRoot = `${root}/agent-diagnostics/${probeId}`;
const runId = 'fixture-diagnostic-round';
const key = 'c'.repeat(64);
const fakePat = 'pat_fixture_do_not_export_f93be';
const host = 'https://test.qoder.zone';
const routes = { diagnostic: '/api/d5/agent-diagnostic', scenario: '/api/d5/scenario' };
const models = 'GET /api/v1/cloud/models';
const agent = 'POST /api/v1/cloud/agents';
const environment = 'POST /api/v1/cloud/environments';
const validAgent = { id: 'agent_fixture', version: 2 };

class BackendError extends Error {
  constructor(code, status) { super(code); this.status = status; }
}

function fixture({ reject, previous, failBinding = false, failRecord = false, allowEnvironment = false, dropAgent = false } = {}) {
  const flags = new Map(Object.entries({ D5_ENABLE_ANON_EXPERIMENT: '1', D5_ANON_EXPERIMENT_PUBLIC_ORIGIN: host,
    D5_ANON_EXPERIMENT_BINDING: `${runId}:${hash(key)}`, D5_ANON_AGENT_DIAGNOSTIC_ID: probeId,
    D5_ENABLE_QODER: '1', D5_ENABLE_TEST_ROUTES: '1', D6_ENABLE_REPORTS: '1', D7_ENABLE_REVIEW: '1', QODER_PAT: fakePat }));
  const files = new Map(previous ? [[binding, JSON.stringify(previous)]] : []);
  const writes = [];
  const calls = [];
  const unexpected = [];
  let databaseTouches = 0;
  const storage = {
    async download(path) {
      if (!files.has(path)) throw Object.assign(new Error('missing'), { status: 404 });
      return { text: async () => files.get(path) };
    },
    async upload(path, bytes, { upsert }) {
      const text = new TextDecoder().decode(bytes);
      writes.push(text);
      if (!upsert && files.has(path)) throw new Error('existing');
      if ((failBinding && path === binding && JSON.parse(text).agent_id) || (failRecord && path.endsWith('/started.json'))) throw new Error('fixture write denied');
      files.set(path, text);
    },
  };
  const oldDeno = globalThis.Deno;
  const oldFetch = globalThis.fetch;
  globalThis.Deno = { env: { get: (name) => flags.get(name) } };
  globalThis.fetch = async (url, init) => {
    const target = new URL(url);
    const operation = `${init.method} ${target.pathname}`;
    calls.push({ operation, body: init.body, idempotencyKey: new Headers(init.headers).get('idempotency-key') });
    if (target.origin === 'https://api.qoder.com.cn') {
      if (operation === models) return Response.json({ data: [{ id: 'alt', enabled: true }, { id: 'fast', enabled: true }] });
      if (operation === agent) {
        if (dropAgent) throw new Error('fixture interrupted response');
        return reject ? reject() : Response.json(validAgent, { status: 201, headers: { 'x-request-id': upstreamId } });
      }
      if (allowEnvironment && operation === environment) return Response.json({ id: 'env_fixture' });
    }
    unexpected.push(operation);
    throw new Error('unexpected fixture operation');
  };
  const app = application({ db: { from() { databaseTouches++; throw new Error('diagnostic cannot touch the database'); } }, storage,
    requireUser: async () => { throw new BackendError('identity_required', 401); }, BackendError });
  const handle = async ({ path = routes.diagnostic, run = runId, access = key, origin = host } = {}) => {
    const request = new Request('http://127.0.0.1:8787/app' + path, { method: 'POST',
      headers: { origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', ...(access && { 'X-Run-Key': access }) },
      body: JSON.stringify({ run_id: run }),
    });
    try { return await app({ request }); }
    catch (error) {
      if (!(error instanceof BackendError)) throw error;
      return Response.json({ code: error.message }, { status: error.status });
    }
  };
  return { flags, files, writes, calls, storage, handle,
    evidence: () => JSON.parse(files.get(privateRoot + '/result.json')),
    close() {
      globalThis.fetch = oldFetch;
      globalThis.Deno = oldDeno;
      assert.deepEqual(unexpected, []);
      assert.equal(databaseTouches, 0);
    } };
}

const body400 = (value) => new Response(value, { status: 400, headers: { 'x-request-id': upstreamId } });
const reply = async (test) => {
  const response = await test.handle();
  assert.equal(response.status, 200);
  return response.json();
};

{
  const test = fixture({ reject: () => body400(JSON.stringify({ error: {
    type: 'invalid_request_error', code: 'invalid_model', param: 'model',
    message: `The model is not supported. Authorization: Bearer ${fakePat}\nhttps://secret.invalid/?token=${key}\n${'你是校园应急桌面推演的剧本事实选择器'}`,
  }, sensitive: fakePat })) });
  const captured = [];
  const priorConsole = [console.log, console.warn, console.error];
  [console.log, console.warn, console.error] = [0, 1, 2].map(() => (...args) => captured.push(args));
  try {
    const responses = await Promise.all([reply(test), reply(test)]);
    const publicResult = responses.find(({ status }) => status === 'rejected');
    assert.deepEqual(publicResult, { status: 'rejected', request_id: upstreamId });
    assert.equal(responses.filter(({ status }) => status === 'already_started').length, 1);
    const evidence = test.evidence();
    assert.equal(evidence.http_status, 400);
    assert.equal(evidence.request_id, upstreamId);
    assert.equal(evidence.failed_step, 'agent');
    assert.deepEqual(evidence.agent_error, { body_status: 'parsed',
      error: { type: 'invalid_request_error', code: 'invalid_model', param: 'model', message: 'The model is not supported.' },
      field_status: { type: 'retained', code: 'retained', param: 'retained', message: 'retained' } });
    assert.deepEqual(await reply(test), { status: 'already_started' });
    assert.deepEqual(test.calls.map(({ operation }) => operation), [models, agent]);
    for (const secret of [fakePat, key, 'Authorization:', 'secret.invalid', '剧本事实选择器']) {
      assert(!JSON.stringify([test.writes, publicResult, captured]).includes(secret));
    }
  } finally {
    [console.log, console.warn, console.error] = priorConsole;
    test.close();
  }
  console.log('FIX-v3 HTTP 400: private status, correlation, type/code/param and safe clause; no raw echo; replay closed. Agent=1 Environment=0 Session=0 Model=0');
}

const tooLarge = { bytes: 0, cancelled: false };
const largeBody = () => new ReadableStream({ type: 'bytes', pull(controller) {
  const request = controller.byobRequest;
  tooLarge.bytes += request.view.byteLength;
  request.view.fill(97);
  request.respond(request.view.byteLength);
}, cancel() { tooLarge.cancelled = true; } });

for (const [value, expected] of [[null, 'empty'], ['not json', 'non_json'], ['{"error":{}}', 'fields_missing'],
  [JSON.stringify({ error: { type: 'secret-echo-test', code: 'missing_field', param: key } }), 'parsed'],
  [largeBody(), 'limit_reached'], [new ReadableStream({ type: 'bytes' }), 'read_timeout']]) {
  const test = fixture({ reject: () => body400(value) });
  const oldTimeout = AbortSignal.timeout;
  if (expected === 'read_timeout') AbortSignal.timeout = () => {
    const timeout = new AbortController();
    setTimeout(() => timeout.abort(), 80);
    return timeout.signal;
  };
  try {
    assert.deepEqual(await reply(test), { status: 'rejected', request_id: upstreamId });
    const evidence = test.evidence();
    assert.equal(evidence.http_status, 400);
    assert.equal(evidence.agent_error.body_status, expected);
    if (expected === 'parsed') {
      assert.deepEqual(evidence.agent_error.error, { code: 'missing_field' });
      assert.deepEqual(evidence.agent_error.field_status, { type: 'omitted', code: 'retained', param: 'omitted', message: 'absent' });
    }
    assert.deepEqual(test.calls.map(({ operation }) => operation), [models, agent]);
    console.log(`FIX-v3 ${expected}: HTTP 400 preserved. Agent=1 Environment=0 Session=0 Model=0`);
  } finally { AbortSignal.timeout = oldTimeout; test.close(); }
}
assert.deepEqual(tooLarge, { bytes: 4096, cancelled: true });

let normalCreate;
{
  const test = fixture({ allowEnvironment: true });
  try {
    await ensureResources(test.storage, scope);
    normalCreate = test.calls.find(({ operation }) => operation === agent);
  } finally { test.close(); }
}

{
  const test = fixture({ allowEnvironment: true });
  try {
    assert.deepEqual(await reply(test), { status: 'agent_ready', request_id: upstreamId });
    assert.deepEqual(test.calls.map(({ operation }) => operation), [models, agent]);
    assert.deepEqual(test.calls[1], normalCreate);
    const partial = JSON.parse(test.files.get(binding));
    assert.deepEqual([partial.state, partial.model, partial.agent_id, partial.agent_version, partial.environment_id], ['agent_ready', 'fast', validAgent.id, validAgent.version, null]);
    console.log('FIX-v3 created: request and idempotency key match the normal path. Agent=1 Environment=0 Session=0 Model=0');
    test.flags.delete('D5_ANON_AGENT_DIAGNOSTIC_ID');
    assert.equal((await test.handle()).status, 401);
    assert.equal((await ensureResources(test.storage, scope)).state, 'ready');
    assert.deepEqual(test.calls.map(({ operation }) => operation), [models, agent, environment]);
    console.log('FIX-v3 post-close normal preparation: reused the confirmed Agent and created only Environment. Agent=0 Environment=1 Session=0 Model=0');
  } finally { test.close(); }
}

for (const [options, expected, operations] of [
  [{ previous: { state: 'agent_ready', revision: 2, model: 'fast', agent_id: validAgent.id, agent_version: validAgent.version } }, 'reused', []],
  [{ previous: { state: 'unknown', revision: 1, model: 'fast', agent_id: validAgent.id, agent_version: validAgent.version } }, 'binding_unavailable', []],
  [{ previous: { state: 'unknown', revision: 2, model: 'fast' } }, 'agent_ready', [agent]],
  [{ failBinding: true }, 'binding_unavailable', [models, agent]],
  [{ failRecord: true }, 'claim_unavailable', []],
  [{ dropAgent: true }, 'outcome_unknown', [models, agent]],
]) {
  const test = fixture(options);
  try {
    assert.equal((await reply(test)).status, expected);
    if (!options.failRecord) assert.equal((await reply(test)).status, 'already_started');
    assert.deepEqual(test.calls.map(({ operation }) => operation), operations);
    console.log(`FIX-v3 ${expected}: Agent=${operations.filter((operation) => operation === agent).length} Environment=0 Session=0 Model=0`);
  } finally { test.close(); }
}

{
  const test = fixture();
  try {
    for (const [options, status] of [[{ access: null }, 404], [{ access: '0'.repeat(64) }, 404], [{ run: 'fixture-wrong-round' }, 404],
      [{ origin: 'https://outside.invalid' }, 415], [{ path: routes.scenario }, 503]]) {
      assert.equal((await test.handle(options)).status, status);
    }
    test.flags.delete('D5_ANON_EXPERIMENT_BINDING');
    assert.equal((await test.handle()).status, 404);
    test.flags.delete('D5_ANON_AGENT_DIAGNOSTIC_ID');
    assert.equal((await test.handle()).status, 401);
    assert.deepEqual(test.calls, []);
    assert.deepEqual(test.writes, []);
    console.log('FIX-v3 authorization/ordinary button/default off: no private record or database access. Agent=0 Environment=0 Session=0 Model=0');
  } finally { test.close(); }
}
