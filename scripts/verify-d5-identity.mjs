import assert from 'node:assert/strict';
import { describeIdentity, resolveIdentity } from '../cloud-verify/functions/d5-routes.mjs';
import { bindingStatus, ensureResources, ProviderError } from '../cloud-verify/functions/d5-service.mjs';
import { application } from '../cloud-verify/functions/routes.mjs';

globalThis.Deno = { env: { get: (name) => (name === 'QODER_PAT' ? 'test-token' : undefined) } };

const USER_HASH = 'a'.repeat(64);
const PATH = `d5-generation/${USER_HASH}/resources.json`;

function fakeStorage(initial = null, { failDownload = false, failUpload = false } = {}) {
  const files = new Map();
  if (initial) files.set(PATH, JSON.stringify(initial));
  return {
    files,
    async download(path) {
      if (failDownload) throw new Error('storage down');
      if (!files.has(path)) throw new Error('not found');
      return { text: async () => files.get(path) };
    },
    async upload(path, bytes, options) {
      if (failUpload) throw new Error('storage down');
      if (options?.upsert === false && files.has(path)) throw new Error('exists');
      files.set(path, new TextDecoder().decode(bytes));
    },
  };
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function mockFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname + new URL(url).search;
    const call = { path, method: options.method ?? 'GET', idempotencyKey: options.headers?.['Idempotency-Key'] ?? null };
    calls.push(call);
    return handler(path, options, call);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function readyUpstream() {
  return (path) => {
    if (path.endsWith('/models')) return json({ data: [{ id: 'fast', enabled: true }] });
    if (path.endsWith('/agents')) return json({ id: 'agent_test1', version: 3 });
    if (path.endsWith('/environments')) return json({ id: 'env_test1' });
    throw new Error('unexpected upstream path ' + path);
  };
}

// Identity resolution reads only platform-shaped fields and never echoes values.
assert.deepEqual(resolveIdentity({ user_id: '  abc  ' }), { field: 'user_id', value: 'abc' });
assert.deepEqual(resolveIdentity({ user_id: '', userId: 'u2' }), { field: 'userId', value: 'u2' });
assert.deepEqual(resolveIdentity({ user: { user_id: 'nested' } }), { field: 'user_id', value: 'nested' });
assert.equal(resolveIdentity({ user_id: '', id: 'site-owned-id' }), null);
assert.equal(resolveIdentity({ user_id: '   ' }), null);
assert.equal(resolveIdentity(null), null);
assert.equal(resolveIdentity(Object.create({ sub: 'inherited' })), null);

const described = describeIdentity({ user_id: 'secret-value', name: 'private-name', session_expires_at: 1, picture: '' });
assert.equal(described.user_id.non_empty, true);
assert.equal(described.user_id.type, 'string');
assert.equal(described.picture.non_empty, false);
assert.equal(described.session_expires_at.type, 'number');
assert.ok(!JSON.stringify(described).includes('secret-value'));
assert.ok(!JSON.stringify(described).includes('private-name'));

// Fresh binding: models -> agent -> environment, all steps persisted.
{
  const storage = fakeStorage();
  const mock = mockFetch(readyUpstream());
  const binding = await ensureResources(storage, USER_HASH);
  mock.restore();
  assert.equal(binding.state, 'ready');
  assert.equal(binding.model, 'fast');
  assert.equal(binding.agent_id, 'agent_test1');
  assert.equal(binding.environment_id, 'env_test1');
  assert.equal(binding.attempts, 1);
  assert.equal(binding.steps.models.status, 'ok');
  assert.equal(binding.steps.models.selected, 'fast');
  assert.equal(binding.steps.agent.status, 'ok');
  assert.equal(binding.steps.environment.status, 'ok');
  assert.equal(binding.steps.environment.http_status, 200);
  assert.equal(mock.calls.filter((call) => call.method === 'POST').length, 2);
}

// Ready binding at the current revision performs no upstream call or write.
{
  const ready = { state: 'ready', revision: 2, model: 'fast', agent_id: 'agent_x', agent_version: 1, environment_id: 'env_x' };
  const storage = fakeStorage(ready);
  const before = storage.files.get(PATH);
  const mock = mockFetch(readyUpstream());
  const binding = await ensureResources(storage, USER_HASH);
  mock.restore();
  assert.equal(binding.state, 'ready');
  assert.equal(mock.calls.length, 0);
  assert.equal(storage.files.get(PATH), before);
}

// A ready binding from an older revision rotates the agent and records the replacement.
{
  const old = { state: 'ready', revision: 1, model: 'old-model', agent_id: 'agent_old', agent_version: 1, environment_id: 'env_old' };
  const storage = fakeStorage(old);
  const mock = mockFetch(readyUpstream());
  const binding = await ensureResources(storage, USER_HASH);
  mock.restore();
  assert.equal(binding.state, 'ready');
  assert.equal(binding.revision, 2);
  assert.equal(binding.model, 'fast');
  assert.deepEqual(binding.replaced, { agent_id: 'agent_old', model: 'old-model' });
  assert.equal(binding.environment_id, 'env_old');
  assert.equal(binding.steps.environment.status, 'reused');
}

// Unknown binding with a persisted agent skips models/agent and only recreates the environment.
{
  const unknown = {
    state: 'unknown', revision: 2, model: 'fast', agent_id: 'agent_keep', agent_version: 2,
    reason: 'storage', failed_step: 'binding_write', attempts: 1, steps: { agent: { status: 'ok' } },
  };
  const storage = fakeStorage(unknown);
  const mock = mockFetch(readyUpstream());
  const binding = await ensureResources(storage, USER_HASH);
  mock.restore();
  assert.equal(binding.state, 'ready');
  assert.equal(binding.agent_id, 'agent_keep');
  assert.equal(binding.environment_id, 'env_test1');
  assert.equal(binding.steps.agent.status, 'reused');
  assert.equal(binding.reason, undefined);
  assert.equal(binding.failed_step, undefined);
  assert.equal(binding.attempts, 2);
  assert.equal(mock.calls.some((call) => call.path.endsWith('/models')), false);
  assert.equal(mock.calls.some((call) => call.path.endsWith('/agents')), false);
  assert.equal(mock.calls.filter((call) => call.path.endsWith('/environments')).length, 1);
}

// A failed environment retry keeps model/agent progress and records HTTP status plus correlation id.
{
  const unknown = {
    state: 'unknown', revision: 2, model: 'fast', agent_id: 'agent_keep', agent_version: 2,
    reason: 'network', failed_step: 'environment', attempts: 1,
    steps: { environment: { status: 'error', attempt: 1, outcome: 'rejected' } },
  };
  const storage = fakeStorage(unknown);
  const mock = mockFetch((path) => {
    if (path.endsWith('/environments')) return json({ error: 'unavailable' }, 503, { 'x-request-id': 'req-env-1' });
    throw new Error('unexpected path ' + path);
  });
  await assert.rejects(() => ensureResources(storage, USER_HASH), (error) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.reason, 'network');
    return true;
  });
  mock.restore();
  const saved = JSON.parse(storage.files.get(PATH));
  assert.equal(saved.state, 'unknown');
  assert.equal(saved.failed_step, 'environment');
  assert.equal(saved.model, 'fast');
  assert.equal(saved.agent_id, 'agent_keep');
  assert.equal(saved.reason, 'network');
  assert.equal(saved.http_status, 503);
  assert.equal(saved.request_id, 'req-env-1');
  assert.equal(saved.steps.environment.status, 'error');
  assert.equal(saved.steps.environment.http_status, 503);
  assert.equal(saved.steps.environment.stage, 'http');
  assert.equal(saved.steps.agent.status, 'reused');
}

// A models failure is localized, preserving the exact upstream status and request id.
{
  const storage = fakeStorage();
  const mock = mockFetch((path) => {
    if (path.endsWith('/models')) return json({ error: 'bad gateway' }, 502, { 'x-qoder-request-id': 'req-models-1' });
    throw new Error('unexpected path ' + path);
  });
  await assert.rejects(() => ensureResources(storage, USER_HASH), (error) => error instanceof ProviderError);
  mock.restore();
  const saved = JSON.parse(storage.files.get(PATH));
  assert.equal(saved.state, 'unknown');
  assert.equal(saved.failed_step, 'models');
  assert.equal(saved.http_status, 502);
  assert.equal(saved.request_id, 'req-models-1');
  assert.equal(saved.steps.models.status, 'error');
  assert.equal(saved.steps.models.http_status, 502);
  assert.equal(saved.steps.models.stage, 'http');
}

// Binding diagnostics distinguish missing, unreadable and existing bindings without exposing IDs.
{
  const missing = await bindingStatus(fakeStorage(), USER_HASH);
  assert.deepEqual(missing, { readable: true, exists: false });
  const unreadable = await bindingStatus(fakeStorage(null, { failDownload: true }), USER_HASH);
  assert.deepEqual(unreadable, { readable: false, exists: null });
  const status = await bindingStatus(fakeStorage({
    state: 'unknown', revision: 2, model: 'fast', agent_id: 'agent_secret', environment_id: 'env_secret',
    reason: 'network', http_status: 503, failed_step: 'models', attempts: 1,
    steps: { models: { status: 'error', request_id: 'unsafe/value', credential: 'never-echo-this' } },
  }), USER_HASH);
  assert.equal(status.state, 'unknown');
  assert.equal(status.has_agent, true);
  assert.equal(status.has_environment, true);
  assert.equal(status.http_status, 503);
  assert.deepEqual(status.steps, { models: { status: 'error' } });
  assert.ok(!JSON.stringify(status).includes('agent_secret'));
  assert.ok(!JSON.stringify(status).includes('env_secret'));
}

// An uncertain Agent POST is retried with exactly the same model, payload, and documented idempotency key.
{
  const storage = fakeStorage();
  const agentRequests = [];
  const mock = mockFetch((path, options, call) => {
    if (path.endsWith('/agents')) {
      agentRequests.push({ body: options.body, key: call.idempotencyKey });
      if (agentRequests.length === 1) throw new Error('connection lost');
    }
    return readyUpstream()(path);
  });
  try {
    await assert.rejects(() => ensureResources(storage, USER_HASH), { failed_step: 'agent' });
    assert.equal(JSON.parse(storage.files.get(PATH)).model, 'fast');
    assert.equal((await ensureResources(storage, USER_HASH)).state, 'ready');
    assert.deepEqual(agentRequests[0], agentRequests[1]);
    assert.equal(mock.calls.filter((call) => call.path.endsWith('/models')).length, 1);
  } finally { mock.restore(); }
}

// A failed checkpoint after an upstream success retains the resource for recovery.
{
  const storage = fakeStorage();
  const upload = storage.upload.bind(storage);
  let failOnce = true;
  storage.upload = async (path, bytes, options) => {
    if (failOnce && JSON.parse(new TextDecoder().decode(bytes)).state === 'ready') {
      failOnce = false;
      throw new Error('transient storage failure');
    }
    await upload(path, bytes, options);
  };
  const mock = mockFetch(readyUpstream());
  try {
    await assert.rejects(() => ensureResources(storage, USER_HASH), { reason: 'storage' });
    const saved = JSON.parse(storage.files.get(PATH));
    assert.equal(saved.failed_step, 'binding_write');
    assert.equal(saved.environment_id, 'env_test1');
    const calls = mock.calls.length;
    const recovered = await ensureResources(storage, USER_HASH);
    assert.equal(recovered.state, 'ready');
    assert.equal(recovered.failed_step, undefined);
    assert.equal(mock.calls.length, calls);
  } finally {
    mock.restore();
  }
}

// The Managed Environment API can complete the original POST even if the reply is lost.
{
  const storage = fakeStorage();
  let created;
  let visible = false;
  const mock = mockFetch((path, options) => {
    if (path === '/api/v1/cloud/environments' && options.method === 'POST') {
      created = { id: 'env_recovered', metadata: JSON.parse(options.body).metadata };
      throw new Error('connection lost');
    }
    if (path.startsWith('/api/v1/cloud/environments?')) return json({ data: visible ? [created] : [], has_more: false });
    return readyUpstream()(path);
  });
  try {
    await assert.rejects(() => ensureResources(storage, USER_HASH), { stage: 'transport', failed_step: 'environment' });
    await assert.rejects(() => ensureResources(storage, USER_HASH), { stage: 'reconciliation_required' });
    visible = true;
    const binding = await ensureResources(storage, USER_HASH);
    assert.equal(binding.environment_id, 'env_recovered');
    assert.equal(binding.steps.environment.status, 'recovered');
    assert.equal(binding.failed_step, undefined);
    assert.equal(mock.calls.filter((call) => call.path === '/api/v1/cloud/environments' && call.method === 'POST').length, 1);
  } finally { mock.restore(); }
}

// A legacy uncertain environment without a recoverable association is never blindly created again.
{
  const storage = fakeStorage({ state: 'unknown', revision: 2, model: 'fast', agent_id: 'agent_keep', agent_version: 1,
    failed_step: 'environment' });
  const mock = mockFetch(readyUpstream());
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(() => ensureResources(storage, USER_HASH), { stage: 'reconciliation_required' });
    }
    assert.equal(mock.calls.length, 0);
  } finally { mock.restore(); }
}

// A storage outage must never be treated as a fresh binding.
for (const failure of ['failDownload', 'failUpload']) {
  const storage = fakeStorage(null, { [failure]: true });
  const mock = mockFetch(readyUpstream());
  try {
    await assert.rejects(() => ensureResources(storage, USER_HASH), { reason: 'storage' });
    assert.equal(storage.files.size, 0);
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
}

// Warm reports a platform Storage error separately from an upstream Cloud Agents error.
{
  class BackendError extends Error {
    constructor(code, status) { super(code); this.status = status; }
  }
  globalThis.Deno.env.get = (name) => ({ QODER_PAT: 'test-token', D5_ENABLE_QODER: '1' })[name];
  const warm = (storage) => application({ db: {}, storage, BackendError, requireUser: () => ({ uid: 'test-warm-user' }) })({
    requestId: 'site-warm-request', request: new Request('https://test.invalid/functions/v1/app/api/d5/warm', { method: 'POST' }),
  });
  const mock = mockFetch(() => json({}, 403, { 'x-request-id': 'upstream-request' }));
  try {
    const storage = await warm(fakeStorage(null, { failDownload: true }));
    assert.equal(storage.status, 503);
    const storageError = await storage.json();
    assert.equal(storageError.code, 'backend_storage_unavailable');
    assert.equal(storageError.failed_step, 'binding_read');
    assert.equal(mock.calls.length, 0);
    const upstream = await warm(fakeStorage());
    assert.equal(upstream.status, 503);
    const upstreamError = await upstream.json();
    assert.equal(upstreamError.code, 'ai_service_unavailable');
    assert.equal(upstreamError.failed_step, 'models');
    assert.equal(upstreamError.http_status, 403);
    assert.equal(upstreamError.request_id, 'site-warm-request');
    assert.equal(upstreamError.steps.models.request_id, 'upstream-request');
  } finally { mock.restore(); }
}

// Exercise the deployed route entry with an asynchronous platform identity.
{
  class BackendError extends Error {
    constructor(code, status) { super(code); this.status = status; }
  }
  globalThis.Deno.env.get = (name) => ({ QODER_PAT: 'test-token', D5_ENABLE_QODER: '1' })[name];
  let user = null;
  let dbCalls = 0;
  const storage = fakeStorage();
  const emptyHash = Buffer.from(await crypto.subtle.digest('SHA-256', new Uint8Array())).toString('hex');
  const emptyPath = `d5-generation/${emptyHash}/resources.json`;
  const emptyEvidence = JSON.stringify({ state: 'unknown' });
  storage.files.set(emptyPath, emptyEvidence);
  const app = application({ db: { from() { dbCalls++; throw new Error('unexpected database call'); } }, storage, BackendError,
    requireUser: () => user });
  const invoke = (path, method, input) => app({ requestId: 'site-test-request',
    request: new Request('https://test.invalid/functions/v1/app/api/d5/' + path,
      { method, headers: { 'Content-Type': 'application/json', 'X-User-Id': 'browser-claimed' }, body: input && JSON.stringify(input) }) });
  const mock = mockFetch(readyUpstream());
  try {
    await assert.rejects(() => invoke('warm', 'POST'), { message: 'identity_required', status: 401 });
    user = Promise.resolve({ user_id: '   ' });
    await assert.rejects(() => invoke('scenario', 'POST', { user_id: 'browser-claimed' }), { message: 'identity_unavailable', status: 401 });
    const unresolved = await (await invoke('diag', 'GET')).json();
    assert.equal(unresolved.identity.resolved, null);
    assert.equal(unresolved.empty_identity_binding.state, 'unknown');
    assert.equal(mock.calls.length, 0);
    assert.equal(dbCalls, 0);
    assert.deepEqual([...storage.files], [[emptyPath, emptyEvidence]]);
    const keys = [];
    for (const id of ['test-user-a', 'test-user-b']) {
      user = Promise.resolve({ identity: { sub: id } });
      const diag = await (await invoke('diag', 'GET')).json();
      assert.equal(diag.identity.resolved.field, 'sub');
      assert.equal(diag.binding.exists, false);
      const warm = await invoke('warm', 'POST');
      assert.equal(warm.status, 200);
      const warmBody = await warm.json();
      assert.equal(warmBody.binding.state, 'ready');
      assert.equal(warmBody.binding.steps.environment.http_status, 200);
      const key = `d5-generation/${Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id))).toString('hex')}/resources.json`;
      keys.push(key);
      assert.ok(storage.files.has(key));
      const before = mock.calls.length;
      const snapshot = storage.files.get(key);
      const again = await invoke('warm', 'POST');
      assert.equal(again.status, 200);
      assert.deepEqual(await again.json(), warmBody);
      assert.equal(storage.files.get(key), snapshot);
      assert.equal(mock.calls.length, before);
    }
    assert.deepEqual([...storage.files.keys()].filter((path) => path.endsWith('/resources.json')), [emptyPath, ...keys]);
    assert.equal(storage.files.get(emptyPath), emptyEvidence);
  } finally {
    mock.restore();
  }
}

console.log('D5 identity resolution, route-level bucket isolation and binding diagnostics verified');
