// Real Qoder Cloud Agent generation for the private D5 verification site.
// Credentials are read only from the Function environment (QODER_PAT).
// The live Sites rollout requires a verified write authority for request, slot and result state.
import {
  GENERATION_WAIT_MS, ValidationError, assembleBundle, fallbackResult, generationPrompt,
  parseCandidate, validateBundle, validateRequest,
} from './d5-bundle.mjs';
import { createDatabaseLedger } from './d5-db-ledger.mjs';

const ORIGIN = 'https://api.qoder.com.cn';
const INSTANCE = crypto.randomUUID();
const encoder = new TextEncoder();
const MODEL_WAIT_MS = 14_500;

export class ProviderError extends Error {
  constructor(reason, definitive = false) {
    super(reason);
    this.reason = reason;
    this.definitive = definitive;
  }
}

function token() {
  const value = typeof Deno !== 'undefined' ? Deno.env.get('QODER_PAT') : undefined;
  if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value)) throw new ProviderError('not_configured', true);
  return value;
}

export function qoderConfigured() {
  try { token(); return true; } catch { return false; }
}

async function digest(value) {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function redactId(id) {
  return typeof id === 'string' ? { prefix: id.slice(0, 16), fingerprint: await digest(id) } : null;
}

async function api(path, { method = 'GET', body, signal, idempotencyKey } = {}) {
  if (!/^\/api\/v1\/cloud\/(agents|environments|sessions|models)(\/[A-Za-z0-9_-]+)*(\?[A-Za-z0-9_%=&.-]*)?$/.test(path)) {
    throw new ProviderError('network', true);
  }
  if (idempotencyKey !== undefined && !/^[A-Za-z0-9._:-]{1,200}$/.test(idempotencyKey)) throw new ProviderError('network', true);
  let response;
  try {
    response = await fetch(ORIGIN + path, {
      method, signal, redirect: 'error',
      headers: {
        Authorization: 'Bearer ' + token(), Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    throw new ProviderError(signal?.aborted ? 'timeout' : 'network', false);
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new ProviderError(response.status === 401 || response.status === 403 ? 'unauthorized' : 'network',
      response.status >= 400 && response.status < 500 && response.status !== 408);
  }
  try {
    return await response.json();
  } catch {
    throw new ProviderError('network', false);
  }
}

function assistantText(events) {
  if (!Array.isArray(events)) return null;
  for (const event of events) {
    const role = event?.role ?? event?.author?.role ?? event?.type;
    if (role !== 'assistant' && role !== 'agent.message') continue;
    const content = Array.isArray(event?.content) ? event.content : [];
    const text = content
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('');
    if (text) return text;
  }
  return null;
}

async function readSession(sessionId, signal) {
  const result = await api(`/api/v1/cloud/sessions/${encodeURIComponent(sessionId)}/events?order=asc&limit=100`, { signal });
  return assistantText(result?.data);
}

async function eventKinds(sessionId, signal) {
  const result = await api(`/api/v1/cloud/sessions/${encodeURIComponent(sessionId)}/events?order=asc&limit=100`, { signal });
  return Array.isArray(result?.data) ? result.data.map((event) => event?.type ?? event?.role ?? 'unknown') : [];
}

function pickModel(models) {
  const list = Array.isArray(models?.data) ? models.data : [];
  const preferred = ['fast'].find((id) => list.some((item) => item?.id === id && item.enabled !== false));
  const model = (preferred ? list.find((item) => item?.id === preferred) : undefined)
    ?? list.find((item) => typeof item?.id === 'string' && item.enabled !== false)
    ?? list.find((item) => typeof item?.id === 'string');
  return model?.id ?? null;
}

// Bumping the revision rotates the Agent bound to a new model without touching
// existing Session evidence or the Storage ledger layout.
const BINDING_REVISION = 2;

export async function ensureResources(storage, userHash) {
  const path = `d5-generation/${userHash}/resources.json`;
  const read = async () => {
    try { return JSON.parse(await (await storage.download(path)).text()); } catch { return null; }
  };
  const write = async (value) => {
    await storage.upload(path, encoder.encode(JSON.stringify(value)), { contentType: 'application/json; charset=utf-8', upsert: true });
  };
  let binding = await read();
  if (binding?.state === 'ready' && binding.revision === BINDING_REVISION) return binding;
  if (binding?.state === 'unknown') throw new ProviderError('network', false);
  if (binding?.state === 'creating' && !binding.agent_id) throw new ProviderError('network', false);
  if (binding?.state === 'creating' && binding.agent_id && !binding.environment_id) {
    const environment = await api('/api/v1/cloud/environments', { method: 'POST', body: { name: 'D5 scenario environment', config: { type: 'cloud' } } });
    if (typeof environment?.id !== 'string' || !/^env_[A-Za-z0-9_-]+$/.test(environment.id)) throw new ProviderError('network');
    binding = { ...binding, state: 'ready', revision: BINDING_REVISION, environment_id: environment.id };
    await write(binding);
    return binding;
  }
  if (binding && binding.state !== 'ready') throw new ProviderError('network', false);

  const claim = {
    state: 'creating', revision: BINDING_REVISION, created_at: new Date().toISOString(),
    model: null, agent_id: null, agent_version: null, environment_id: binding?.environment_id ?? null,
    replaced: binding ? { agent_id: binding.agent_id, model: binding.model } : null,
  };
  if (binding) {
    await write(claim);
  } else {
    try {
      await storage.upload(path, encoder.encode(JSON.stringify(claim)), { contentType: 'application/json; charset=utf-8', upsert: false });
    } catch {
      const existing = await read();
      if (existing?.state === 'ready' && existing.revision === BINDING_REVISION) return existing;
      throw new ProviderError('network', false);
    }
  }
  try {
    const models = await api('/api/v1/cloud/models');
    const model = pickModel(models);
    if (!model) throw new ProviderError('network', true);
    const agent = await api('/api/v1/cloud/agents', {
      method: 'POST', idempotencyKey: `d5-agent-${userHash.slice(0, 16)}-r${BINDING_REVISION}`,
      body: {
        name: 'D5 scenario generator', model,
        system: '你是校园应急桌面推演的剧本事实选择器。只输出一个符合给定 JSON Schema 的对象，不要代码块、解释或工具调用。',
      },
    });
    if (typeof agent?.id !== 'string' || !/^agent_[A-Za-z0-9_-]+$/.test(agent.id) || !Number.isInteger(agent.version)) {
      throw new ProviderError('network');
    }
    binding = { ...claim, model, agent_id: agent.id, agent_version: agent.version };
    await write(binding);
    let environmentId = claim.environment_id;
    if (!environmentId) {
      const environment = await api('/api/v1/cloud/environments', { method: 'POST', body: { name: 'D5 scenario environment', config: { type: 'cloud' } } });
      if (typeof environment?.id !== 'string' || !/^env_[A-Za-z0-9_-]+$/.test(environment.id)) throw new ProviderError('network');
      environmentId = environment.id;
    }
    binding = { ...binding, state: 'ready', environment_id: environmentId };
    await write(binding);
    return binding;
  } catch (error) {
    await write({ ...claim, state: 'unknown', reason: error instanceof ProviderError ? error.reason : 'network' });
    throw error;
  }
}

async function prepareSession(binding, request, signal) {
  const session = await api('/api/v1/cloud/sessions', {
    method: 'POST', signal,
    body: {
      agent: { type: 'agent', id: binding.agent_id, version: binding.agent_version },
      environment_id: binding.environment_id,
      title: 'D5 scenario ' + request.template_id,
      metadata: { app: 'd5', run_id: request.run_id, request_id: request.request_id },
    },
  });
  if (typeof session?.id !== 'string' || !/^sess_[A-Za-z0-9_-]+$/.test(session.id)) throw new ProviderError('network');
  return session.id;
}

async function sendPrompt(sessionId, prompt, signal) {
  await api(`/api/v1/cloud/sessions/${encodeURIComponent(sessionId)}/events`, {
    method: 'POST', signal, body: { events: [{ type: 'user.message', content: [{ type: 'text', text: prompt }] }] },
  });
}

async function waitReply(sessionId, signal) {
  for (;;) {
    if (signal?.aborted) throw new ProviderError('timeout');
    const text = await readSession(sessionId, signal);
    if (text) return text;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 350);
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new ProviderError('timeout')); }, { once: true });
    });
  }
}

function ready(result, trace) {
  return { status: 'ready', result, trace };
}

async function read(ledger, request) {
  if (!(await ledger.matches(request))) return { status: 'missing' };
  const stored = await ledger.readResult();
  if (!stored) return { status: 'pending', ...(await ledger.usage()) };
  return ready(stored.result);
}

function bound(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer), controller };
}

export function createD5Service({ db, storage }) {
  if (!db) throw new Error('database_not_configured');
  const ledgerFor = (userHash, runId) => createDatabaseLedger({ db, storage, userHash, runId });

  async function generate(userHash, input) {
    const request = validateRequest(input);
    const ledger = ledgerFor(userHash, request.run_id);
    const started = performance.now();
    const claim = await ledger.claim(request);
    if (claim === 'existing') return read(ledger, request);
    if (claim === 'conflict') return ready(fallbackResult(request, 'conflict', 0, 0));
    if (!(await ledger.matches(request))) return { status: 'pending', ...(await ledger.usage()) };

    const issues = [];
    const trace = { app: 'd5', instance: INSTANCE, template: request.template_id, modifiers: request.modifiers, phases: {}, started_at: new Date().toISOString() };
    const deadline = bound(MODEL_WAIT_MS);
    async function finish(result) {
      try {
        const usage = await ledger.usage();
        const final = { ...result, ...usage, issues, elapsed_ms: Math.round(performance.now() - started) };
        const saved = await ledger.save(final);
        const reply = await read(ledger, request);
        if (!saved || reply.status !== 'ready' || JSON.stringify(reply.result) !== JSON.stringify(final)) return reply;
        trace.calls_after = usage.calls;
        trace.upstream_state = usage.upstream_state;
        trace.elapsed_ms = final.elapsed_ms;
        await ledger.trace(trace);
        return { ...reply, trace };
      } finally {
        deadline.clear();
      }
    }
    function followStoredRequest() {
      deadline.clear();
      return read(ledger, request);
    }
    const fallback = (reason, provider = null) => finish({ ...fallbackResult(request, reason), provider });

    let binding;
    try {
      binding = await ensureResources(storage, userHash);
      trace.model = binding.model;
      trace.agent = await redactId(binding.agent_id);
      trace.environment = await redactId(binding.environment_id);
    } catch (error) {
      return fallback(error?.reason === 'not_configured' ? 'not_configured' : 'network');
    }

    for (const slot of ['scenario', 'retry']) {
      if (deadline.signal.aborted) return fallback('timeout', 'qoder');
      const usageBefore = await ledger.usage();
      if (!(await ledger.reserve(slot))) return followStoredRequest();
      trace.phases[slot] = { reserved_at: new Date().toISOString(), calls_before: usageBefore.calls };
      let session;
      try {
        session = await prepareSession(binding, request, deadline.signal);
        trace.phases[slot].session = await redactId(session);
      } catch (error) {
        return fallback(error?.reason ?? 'network');
      }
      if (!(await ledger.markSent(slot, session, { instance: INSTANCE, model: binding.model }))) return followStoredRequest();
      trace.phases[slot].sent_at = new Date().toISOString();
      try {
        const prompt = generationPrompt(request, issues.at(-1));
        await sendPrompt(session, prompt, deadline.signal);
        const text = await waitReply(session, deadline.signal);
        trace.phases[slot].reply_at = new Date().toISOString();
        await ledger.markComplete(slot);
        const candidate = parseCandidate(text, request);
        const bundle = validateBundle(assembleBundle(request, candidate, 'generated'), request, 'generated');
        trace.candidate = candidate;
        return finish({ ...fallbackResult(request, null), bundle, provider: 'qoder', selection: 'generated', scenario_source: 'generated' });
      } catch (error) {
        if (deadline.signal.aborted) return fallback('timeout', 'qoder');
        if (error instanceof ValidationError) {
          issues.push(error.issue);
          trace.phases[slot].issue = error.issue;
          if (slot === 'retry') return fallback('invalid_candidate', 'qoder');
          continue;
        }
        if (error instanceof ProviderError) {
          if (error.definitive) await ledger.markComplete(slot);
          return fallback(error.reason === 'not_configured' ? 'not_configured' : error.reason, 'qoder');
        }
        return fallback('network', 'qoder');
      }
    }
    return fallback('invalid_candidate', 'qoder');
  }

  async function disabled(userHash, input, method) {
    const request = validateRequest(input);
    const ledger = ledgerFor(userHash, request.run_id);
    const reply = await read(ledger, request);
    if (method === 'GET' || reply.status !== 'missing') return reply;
    return ready(fallbackResult(request, 'not_configured', 0, 0));
  }

  async function recover(userHash, input) {
    const request = validateRequest(input);
    const ledger = ledgerFor(userHash, request.run_id);
    if (!(await ledger.matches(request))) return { status: 'missing' };
    const stored = await ledger.readResult();
    if (!stored) return { status: 'pending', ...(await ledger.usage()) };
    if (stored.result.upstream_state !== 'unknown' || stored.result.provider !== 'qoder' || stored.final) return ready(stored.result);
    const attempt = await ledger.unresolved();
    if (!attempt) return ready(stored.result);
    let text;
    const deadline = bound(2500);
    try {
      text = await readSession(attempt.session_id, deadline.signal);
    } catch {
      deadline.clear();
      return ready(stored.result);
    }
    deadline.clear();
    if (!text) return ready(stored.result);
    const issues = [...(stored.result.issues ?? [])];
    let result;
    const usage = await ledger.usage({ completing: attempt.slot });
    try {
      const candidate = parseCandidate(text, request);
      const bundle = validateBundle(assembleBundle(request, candidate, 'generated'), request, 'generated');
      result = { ...stored.result, ...usage, bundle, selection: 'generated', scenario_source: 'generated', provider: 'qoder', fallback_reason: null };
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      issues.push(error.issue);
      result = { ...stored.result, ...usage, issues, fallback_reason: 'invalid_candidate' };
    }
    const saved = await ledger.recover(result);
    if (saved) await ledger.markComplete(attempt.slot);
    return read(ledger, request);
  }

  // Test-only: two concurrent calls race the last slot. The winner performs a
  // real send; the loser is rejected before any send.
  async function claimLastSlot(userHash, input) {
    const request = validateRequest(input);
    const ledger = ledgerFor(userHash, request.run_id);
    if (!(await ledger.matches(request))) return { status: 'missing' };
    const before = await ledger.usage();
    if (before.calls !== 3) return { status: 'precondition', usage: before };
    if (!(await ledger.reserve('retry'))) return { status: 'taken', usage: before };
    const started = performance.now();
    const binding = await ensureResources(storage, userHash);
    const deadline = bound(MODEL_WAIT_MS);
    const trace = { app: 'd5-last-slot', instance: INSTANCE, model: binding.model, slot: 'retry' };
    let session;
    try {
      session = await prepareSession(binding, request, deadline.signal);
      trace.session = await redactId(session);
    } catch (error) {
      deadline.clear();
      return { status: 'ready', result: { ...fallbackResult(request, 'network'), ...(await ledger.usage()), elapsed_ms: Math.round(performance.now() - started) }, trace };
    }
    if (!(await ledger.markSent('retry', session, { instance: INSTANCE, model: binding.model }))) {
      deadline.clear();
      return { status: 'taken', usage: await ledger.usage() };
    }
    let result;
    try {
      await sendPrompt(session, generationPrompt(request), deadline.signal);
      const text = await waitReply(session, deadline.signal);
      await ledger.markComplete('retry');
      const candidate = parseCandidate(text, request);
      const bundle = validateBundle(assembleBundle(request, candidate, 'generated'), request, 'generated');
      trace.candidate = candidate;
      result = { ...fallbackResult(request, null), bundle, provider: 'qoder', selection: 'generated', scenario_source: 'generated' };
    } catch (error) {
      if (error instanceof ValidationError) {
        trace.issue = error.issue;
        result = fallbackResult(request, 'invalid_candidate');
      } else {
        result = fallbackResult(request, deadline.signal.aborted ? 'timeout' : 'network');
      }
    }
    deadline.clear();
    const usage = await ledger.usage();
    const final = { ...result, ...usage, elapsed_ms: Math.round(performance.now() - started) };
    const saved = await ledger.save(final);
    const reply = await read(ledger, request);
    if (!saved || reply.status !== 'ready' || JSON.stringify(reply.result) !== JSON.stringify(final)) return reply;
    await ledger.trace(trace);
    return { ...reply, trace };
  }

  // Test-only: send, prove upstream accepted the event, then abort the
  // outbound polling connection without waiting for the reply.
  async function interrupt(userHash, input) {
    const request = validateRequest(input);
    const ledger = ledgerFor(userHash, request.run_id);
    const claim = await ledger.claim(request);
    if (claim !== 'new') return { status: 'exists' };
    const started = performance.now();
    const binding = await ensureResources(storage, userHash);
    const deadline = bound(MODEL_WAIT_MS);
    const trace = { app: 'd5-interrupt', instance: INSTANCE, model: binding.model };
    if (!(await ledger.reserve('scenario'))) return { status: 'budget' };
    const session = await prepareSession(binding, request, deadline.signal);
    trace.session = await redactId(session);
    if (!(await ledger.markSent('scenario', session, { instance: INSTANCE, model: binding.model }))) return { status: 'budget' };
    const prompt = generationPrompt(request);
    await sendPrompt(session, prompt, deadline.signal);
    const kinds = await eventKinds(session, deadline.signal);
    trace.accepted_event_types = kinds;
    trace.accepted = kinds.includes('user.message');
    // Interrupt the Sites -> Cloud Agent polling connection.
    const poll = new AbortController();
    const pollTimer = setTimeout(() => poll.abort(), 120);
    try { await readSession(session, poll.signal); } catch { /* intended */ }
    clearTimeout(pollTimer);
    deadline.clear();
    const usage = await ledger.usage();
    const result = {
      ...fallbackResult(request, 'network'), ...usage, provider: 'qoder', issues: [],
      elapsed_ms: Math.round(performance.now() - started),
    };
    const saved = await ledger.save(result);
    const reply = await read(ledger, request);
    if (!saved || reply.status !== 'ready' || JSON.stringify(reply.result) !== JSON.stringify(result)) return reply;
    trace.interrupted_segment = 'sites_to_cloud_agent';
    trace.interrupted_at = new Date().toISOString();
    await ledger.trace(trace);
    return { ...reply, trace, interrupted: 'sites_to_cloud_agent', accepted: trace.accepted };
  }

  async function diag() {
    const result = { configured: qoderConfigured(), ledger: 'database', instance: INSTANCE };
    if (!result.configured) return result;
    try {
      const models = await api('/api/v1/cloud/models');
      const list = Array.isArray(models?.data) ? models.data : [];
      result.model_count = list.length;
      result.selected_model = pickModel(models);
      result.models = list.slice(0, 40).map((model) => ({ id: model?.id ?? null, enabled: model?.enabled !== false, name: model?.name ?? null }));
    } catch (error) {
      result.models_error = error?.reason ?? 'network';
    }
    return result;
  }

  async function upstream(userHash, runId) {
    const ledger = ledgerFor(userHash, runId);
    const attempt = await ledger.unresolved();
    if (!attempt) return { status: 'none' };
    const deadline = bound(6000);
    try {
      const history = await api(`/api/v1/cloud/sessions/${encodeURIComponent(attempt.session_id)}/events?order=asc&limit=100`, { signal: deadline.signal });
      const data = Array.isArray(history?.data) ? history.data : [];
      const reply = assistantText(data);
      return {
        status: 'ready', session: await redactId(attempt.session_id), slot: attempt.slot,
        event_types: data.map((event) => event?.type ?? event?.role ?? 'unknown'),
        reply_length: reply?.length ?? 0,
        reply_prefix: typeof reply === 'string' ? reply.slice(0, 300) : null,
        events: data.slice(-8).map((event) => ({
          type: event?.type ?? null, role: event?.role ?? null,
          blocks: Array.isArray(event?.content) ? event.content.map((block) => block?.type ?? null) : [],
        })),
      };
    } finally {
      deadline.clear();
    }
  }

  async function warm(userHash) {
    const binding = await ensureResources(storage, userHash);
    return {
      model: binding.model,
      agent: await redactId(binding.agent_id),
      environment: await redactId(binding.environment_id),
      instance: INSTANCE,
    };
  }

  async function seed(userHash, input, slots) {
    const request = validateRequest(input);
    const ledger = ledgerFor(userHash, request.run_id);
    const claim = await ledger.claim(request);
    if (claim === 'conflict') return { status: 'conflict' };
    for (const slot of slots) {
      if (!(await ledger.reserve(slot))) continue;
      await ledger.markSent(slot, 'sess_seed_' + slot, { seeded: true });
      await ledger.markComplete(slot);
    }
    return { status: 'seeded', usage: await ledger.usage(), instance: INSTANCE };
  }

  async function stats(userHash, runId) {
    const ledger = ledgerFor(userHash, runId);
    return { usage: await ledger.usage(), result: await ledger.readResult(), instance: INSTANCE };
  }

  return { generate, recover, disabled, claimLastSlot, interrupt, diag, warm, seed, stats, upstream, instance: INSTANCE };
}

export { MODEL_WAIT_MS, GENERATION_WAIT_MS };
