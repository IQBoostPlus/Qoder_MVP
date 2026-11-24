// Real Qoder Cloud Agent generation for the private D5 verification site.
// Credentials are read only from the Function environment (QODER_PAT).
// The live Sites rollout requires a verified write authority for request, slot and result state.
import {
  GENERATION_WAIT_MS, ValidationError, assembleBundle, fallbackResult, generationPrompt,
  parseCandidate, validateBundle, validateRequest,
} from './d5-bundle.mjs';
import { generateReports } from './d6-shared.mjs';
import { createDatabaseLedger } from './d5-db-ledger.mjs';
import { createCloudAgentsClient } from './cloud-agents.mjs';

const ORIGIN = 'https://api.qoder.com.cn';
const INSTANCE = crypto.randomUUID();
const encoder = new TextEncoder();
const MODEL_WAIT_MS = 14_500;
const ANONYMOUS_RESOURCE_SCOPE = 'campus-drill:d5:anonymous:v1:resources';
const DIAGNOSTIC_BODY_LIMIT = 4096;
const DIAGNOSTIC_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const activeAgentDiagnostics = new Set();

export class ProviderError extends Error {
  constructor(reason, definitive = false, detail = {}) {
    super(reason);
    this.reason = reason;
    this.definitive = definitive;
    this.stage = detail.stage ?? null;
    this.status = Number.isInteger(detail.status) ? detail.status : null;
    this.request_id = safeCorrelationId(detail.request_id);
  }
}

export function safeCorrelationId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,80}$/.test(value) ? value : null;
}

function responseDetail(response) {
  const requestId = safeCorrelationId(response.headers?.get('x-request-id')) ?? safeCorrelationId(response.headers?.get('x-qoder-request-id'));
  return { http_status: response.status, ...(requestId ? { request_id: requestId } : {}) };
}

function detailOf(error) {
  return {
    reason: error instanceof ProviderError ? error.reason : 'network',
    ...(error?.stage ? { stage: error.stage } : {}),
    ...(Number.isInteger(error?.status) ? { http_status: error.status } : {}),
    ...(typeof error?.request_id === 'string' ? { request_id: error.request_id } : {}),
  };
}

// Error values are upstream-controlled. Keep symbolic fields and only retain
// free-text clauses made entirely of known diagnostic terms.
const messageWords = new Set([
  'a accepts access accessible account agent allow allowed already an and api available be cannot configuration conflict',
  'create current denied deprecated does empty enabled error exist exists expected failed field for format found has have id in',
  'invalid is key length match maximum minimum missing model must name no not of one only or parameter permission permitted',
  'provide provided rejected request required service specified string supported system the this to too type unknown',
  'unsupported use valid validation value version was with your',
].join(' ').split(' '));

function safeErrorFields(envelope, requestValues) {
  const error = envelope?.error;
  const fields = {};
  const field_status = {};
  const exactValues = requestValues.map((value) => value.toLowerCase());
  const safeSymbol = (value) => /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/i.test(value) && value.length <= 64 &&
    !/^(?:sk|pat|bearer|ghp|qoder_pat|token|secret|authorization|cookie)[_-]|[0-9a-f]{16}|[a-z0-9]{24}/i.test(value) &&
    !exactValues.some((part) => part.length > 3 && value.toLowerCase().includes(part));
  for (const field of ['type', 'code', 'param', 'message']) {
    if (!error || !Object.hasOwn(error, field)) { field_status[field] = 'absent'; continue; }
    const value = error[field];
    let safe;
    if (field === 'message' && typeof value === 'string') {
      safe = value.split(/\r?\n|(?<=[.!?]) +/).map((clause) => clause.trim()).filter((clause) =>
        /^[a-z .,!?:-]+$/i.test(clause) && clause.match(/[a-z]+/gi)?.every((word) => messageWords.has(word.toLowerCase()) &&
          !exactValues.includes(word.toLowerCase())) && !exactValues.some((part) => part.length > 3 && clause.toLowerCase().includes(part)),
      ).join(' ').slice(0, 200) || undefined;
    } else if (field === 'code' && Number.isSafeInteger(value) && Math.abs(value) <= 99999999) safe = value;
    else if (typeof value === 'string' && field !== 'message' && safeSymbol(value)) safe = value;
    field_status[field] = safe === undefined ? 'omitted' : 'retained';
    if (safe !== undefined) fields[field] = safe;
  }
  return { body_status: Object.values(field_status).every((status) => status === 'absent') ? 'fields_missing' : 'parsed', error: fields, field_status };
}

async function readAgentError(response, signal, requestValues) {
  const tooLarge = { body_status: 'limit_reached' };
  if (Number(response.headers.get('content-length')) > DIAGNOSTIC_BODY_LIMIT) {
    void response.body?.cancel().catch(() => {});
    return tooLarge;
  }
  if (!response.body) return { body_status: 'empty' };
  let reader;
  try { reader = response.body.getReader({ mode: 'byob' }); }
  catch { void response.body.cancel().catch(() => {}); return { body_status: 'byte_stream_unavailable' }; }
  const bytes = new Uint8Array(DIAGNOSTIC_BODY_LIMIT);
  let offset = 0;
  let onAbort;
  const aborted = new Promise((_, reject) => { onAbort = () => reject(signal.reason); });
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    signal.throwIfAborted();
    while (offset < bytes.length) {
      const { done, value } = await Promise.race([reader.read(new Uint8Array(bytes.length - offset)), aborted]);
      if (value?.length) { bytes.set(value, offset); offset += value.length; }
      if (done) break;
    }
  } catch { return { body_status: signal.aborted ? 'read_timeout' : 'read_failed' }; }
  finally {
    signal.removeEventListener('abort', onAbort);
    void reader.cancel().catch(() => {});
  }
  if (offset === bytes.length) return tooLarge;
  if (!offset) return { body_status: 'empty' };
  try { return safeErrorFields(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, offset))), requestValues); }
  catch { return { body_status: 'non_json' }; }
}

function token() {
  let value;
  try { value = globalThis.Deno?.env.get('QODER_PAT'); } catch { throw new ProviderError('not_configured', true); }
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

async function api(path, { method = 'GET', body, signal, idempotencyKey, onResponse, captureAgent400 = false } = {}) {
  if (!/^\/api\/v1\/cloud\/(agents|environments|sessions|models)(\/[A-Za-z0-9_-]+)*(\?[A-Za-z0-9_%=&.-]*)?$/.test(path)) {
    throw new ProviderError('network', true, { stage: 'validation' });
  }
  if (idempotencyKey !== undefined && !/^[A-Za-z0-9._:-]{1,200}$/.test(idempotencyKey)) {
    throw new ProviderError('network', true, { stage: 'validation' });
  }
  const bearer = token();
  let response;
  try {
    response = await fetch(ORIGIN + path, {
      method, signal, redirect: 'error',
      headers: {
        Authorization: 'Bearer ' + bearer, Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    throw new ProviderError(signal?.aborted ? 'timeout' : 'network', false, { stage: 'transport' });
  }
  const detail = responseDetail(response);
  if (captureAgent400 && !DIAGNOSTIC_ID.test(detail.request_id ?? '')) delete detail.request_id;
  onResponse?.(detail);
  if (!response.ok) {
    const error = new ProviderError(response.status === 401 || response.status === 403 ? 'unauthorized' : 'network',
      response.status >= 400 && response.status < 500 && response.status !== 408,
      { stage: 'http', status: response.status, request_id: detail.request_id });
    if (captureAgent400 && method === 'POST' && path === '/api/v1/cloud/agents' && response.status === 400) {
      error.agent400 = await readAgentError(response, signal, [bearer, idempotencyKey, ...Object.values(body)]);
    } else void response.body?.cancel().catch(() => {});
    throw error;
  }
  try {
    return await response.json();
  } catch {
    throw new ProviderError('network', false, { stage: 'parse', status: response.status, request_id: detail.request_id });
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

const BINDING_PATH = (userHash) => `d5-generation/${userHash}/resources.json`;

function storageNotFound(error) {
  const code = String(error?.code ?? '').toLowerCase();
  const message = String(error?.message ?? '').toLowerCase();
  const status = error?.status ?? error?.statusCode;
  if (status != null) return Number(status) === 404;
  return code.includes('not_found') || code.includes('notfound')
    || message.includes('not found') || message.includes('not_found');
}

async function readBindingResult(storage, path) {
  try {
    const object = await storage.download(path);
    if (!object) return { ok: true, value: null };
    const value = JSON.parse(await object.text());
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, value: null };
    return { ok: true, value };
  } catch (error) {
    return storageNotFound(error) ? { ok: true, value: null } : { ok: false, value: null, error };
  }
}

function storageFailure(stage, error) {
  return new ProviderError('storage', false, {
    stage, status: error?.status ?? error?.statusCode, request_id: error?.request_id ?? error?.requestId,
  });
}

async function readBinding(storage, path) {
  const result = await readBindingResult(storage, path);
  if (!result.ok) throw storageFailure('binding_read', result.error);
  return result.value;
}

function diagnosticSteps(steps) {
  if (!steps || typeof steps !== 'object') return null;
  const safe = {};
  for (const name of ['binding_read', 'binding_write', 'models', 'agent', 'environment']) {
    const step = steps[name];
    if (!step || typeof step !== 'object') continue;
    const fields = {};
    for (const key of ['status', 'at', 'state', 'selected', 'reason', 'stage', 'outcome', 'request_id']) {
      const value = safeCorrelationId(step[key]);
      if (value) fields[key] = value;
    }
    for (const key of ['http_status', 'attempt', 'count', 'version', 'revision']) {
      if (Number.isSafeInteger(step[key])) fields[key] = step[key];
    }
    safe[name] = fields;
  }
  return safe;
}

function describeBinding(binding) {
  if (!binding) return { readable: true, exists: false };
  return {
    readable: true,
    exists: true,
    state: binding.state ?? null,
    revision: binding.revision ?? null,
    model: binding.model ?? null,
    reason: binding.reason ?? null,
    http_status: binding.http_status ?? null,
    request_id: safeCorrelationId(binding.request_id),
    failed_step: binding.failed_step ?? null,
    has_agent: Boolean(binding.agent_id),
    has_environment: Boolean(binding.environment_id),
    attempts: binding.attempts ?? null,
    created_at: binding.created_at ?? null,
    recovered_at: binding.recovered_at ?? null,
    steps: diagnosticSteps(binding.steps),
  };
}

export async function bindingStatus(storage, userHash) {
  const result = await readBindingResult(storage, BINDING_PATH(userHash));
  if (!result.ok) return { readable: false, exists: null };
  return describeBinding(result.value);
}

export function bindingFailure(error) {
  const failedStep = error?.failed_step ?? error?.stage ?? 'binding';
  const detail = detailOf(error);
  return { ...detail, failed_step: failedStep,
    steps: diagnosticSteps(error?.steps) ?? { [failedStep]: { status: 'error', ...detail } } };
}

async function prepareEnvironment(storage, userHash, previous, signal, mark) {
  const prior = previous?.steps?.environment;
  if (previous && !prior?.attempt && prior?.outcome !== 'rejected' &&
    (previous.failed_step === 'environment' || (previous.state !== 'ready' && !previous.steps))) {
    mark('environment', 'error', { stage: 'reconciliation_required', outcome: 'unknown' });
    throw new ProviderError('network', false, { stage: 'reconciliation_required' });
  }
  const attempt = (prior?.attempt ?? 1) + (prior?.outcome === 'rejected' ? 1 : 0);
  const marker = `d5-generation/${userHash}/environment-r${BINDING_REVISION}-${attempt}.json`;
  const metadata = { d5_binding: await digest(marker) };
  token();
  signal.throwIfAborted();
  const claim = crypto.randomUUID();
  let existing;
  try {
    await storage.upload(marker, encoder.encode(JSON.stringify({ claim })), { contentType: 'application/json', upsert: false });
  } catch (error) {
    existing = await readBinding(storage, marker);
    if (!existing) throw storageFailure('binding_write', error);
  }
  if (existing && existing.claim !== claim) {
    // Managed Environment creation does not document idempotent replay. A durable intent
    // makes later calls look for the original object instead of issuing another POST.
    let lookupReceipt;
    const cloud = createCloudAgentsClient({ origin: ORIGIN, diagnostics: () => {},
      fetchImpl: async (url, options) => {
        const response = await fetch(url, { ...options, signal: AbortSignal.any([signal, options.signal]) });
        lookupReceipt = responseDetail(response);
        return response;
      },
    });
    try {
      const found = await cloud.findResources('environments', metadata);
      if (found.length === 1 && /^env_[A-Za-z0-9_-]+$/.test(found[0].id)) {
        mark('environment', 'recovered', { ...lookupReceipt, attempt });
        return found[0].id;
      }
    } catch {
      const failure = new ProviderError('network', false, { stage: 'reconciliation',
        status: lookupReceipt?.http_status, request_id: lookupReceipt?.request_id });
      mark('environment', 'error', { ...detailOf(failure), attempt, outcome: 'unknown' });
      throw failure;
    }
    const failure = new ProviderError('network', false, { stage: 'reconciliation_required',
      status: lookupReceipt?.http_status, request_id: lookupReceipt?.request_id });
    mark('environment', 'error', { ...detailOf(failure), attempt, outcome: 'unknown' });
    throw failure;
  }

  let detail;
  try {
    const environment = await api('/api/v1/cloud/environments', {
      method: 'POST', signal, onResponse: (result) => { detail = result; },
      body: { name: 'D5 scenario environment', config: { type: 'cloud' }, metadata },
    });
    if (typeof environment?.id !== 'string' || !/^env_[A-Za-z0-9_-]+$/.test(environment.id)) {
      throw new ProviderError('network', false, { stage: 'shape', status: detail?.http_status, request_id: detail?.request_id });
    }
    mark('environment', 'ok', { ...detail, attempt });
    return environment.id;
  } catch (error) {
    const rejected = error.definitive && error.status !== 409;
    mark('environment', 'error', { ...detailOf(error), attempt, outcome: rejected ? 'rejected' : 'unknown' });
    throw error;
  }
}

export async function ensureResources(storage, userHash, signal = AbortSignal.timeout(MODEL_WAIT_MS), { agentOnly = false } = {}) {
  const path = BINDING_PATH(userHash);
  const write = async (value) => {
    try {
      await storage.upload(path, encoder.encode(JSON.stringify(value)), { contentType: 'application/json; charset=utf-8', upsert: true });
    } catch (error) {
      throw storageFailure('binding_write', error);
    }
  };
  let binding = await readBinding(storage, path);
  const validAgent = (value) => value?.revision === BINDING_REVISION && typeof value.model === 'string' && Boolean(value.model) &&
    typeof value.agent_id === 'string' && /^agent_[A-Za-z0-9_-]+$/.test(value.agent_id) && Number.isInteger(value.agent_version);
  if (agentOnly && binding?.agent_id) {
    if (validAgent(binding)) return { status: 'reused' };
    throw storageFailure('binding_read');
  }
  const steps = { ...(binding?.steps ?? {}) };
  let failedStep = 'unknown';
  const mark = (name, status, detail = {}) => {
    steps[name] = { status, at: new Date().toISOString(), ...detail };
    if (status === 'error') failedStep = name;
  };
  const save = async (next) => {
    if (next.state === 'ready') mark('binding_write', 'ok');
    const value = { ...next, updated_at: new Date().toISOString(), steps: { ...steps } };
    if (value.state === 'ready') {
      for (const key of ['reason', 'stage', 'failed_step', 'http_status', 'request_id']) delete value[key];
    }
    await write(value);
    return value;
  };

  mark('binding_read', 'ok', { state: binding?.state ?? null, revision: binding?.revision ?? null });
  if (binding?.state === 'ready' && binding.revision === BINDING_REVISION) {
    if (binding.model && binding.agent_id && Number.isInteger(binding.agent_version) && binding.environment_id && !agentOnly) return binding;
    throw storageFailure('binding_read');
  }
  if (binding?.state === 'creating' && Date.now() - Date.parse(binding.updated_at ?? binding.created_at) < MODEL_WAIT_MS) {
    throw new ProviderError('network', false, { stage: 'binding_claim' });
  }

  const previous = binding;
  const resumable = previous?.state === 'unknown' || (previous?.state === 'agent_ready' && validAgent(previous)) ||
    (previous?.state === 'creating' && (previous.steps || previous.agent_id));
  if (previous && !resumable && previous.state !== 'ready') throw new ProviderError('network', false);

  let model = resumable ? previous.model ?? null : null;
  let agentId = null;
  let agentVersion = null;
  if (resumable && typeof previous.agent_id === 'string' && previous.model && Number.isInteger(previous.agent_version)) {
    model = previous.model;
    agentId = previous.agent_id;
    agentVersion = previous.agent_version;
    mark('agent', 'reused');
  }

  binding = {
    ...(resumable ? previous : {}),
    state: 'creating',
    revision: BINDING_REVISION,
    created_at: previous?.created_at ?? new Date().toISOString(),
    model,
    agent_id: agentId,
    agent_version: agentVersion,
    environment_id: previous?.environment_id ?? null,
    replaced: resumable ? previous.replaced ?? null : previous ? { agent_id: previous.agent_id, model: previous.model } : null,
    attempts: (previous?.attempts ?? 0) + 1,
    ...(resumable ? { recovered_at: new Date().toISOString() } : {}),
  };
  if (previous) {
    binding = await save(binding);
  } else {
    try {
      await storage.upload(path, encoder.encode(JSON.stringify({ ...binding, steps })), { contentType: 'application/json; charset=utf-8', upsert: false });
    } catch (error) {
      const existing = await readBinding(storage, path);
      if (agentOnly && validAgent(existing)) return { status: 'reused' };
      if (!agentOnly && existing?.state === 'ready' && existing.revision === BINDING_REVISION) return existing;
      if (!existing) throw storageFailure('binding_write', error);
      throw new ProviderError('network', false, { stage: 'binding_claim' });
    }
  }

  let agentReceipt;
  try {
    if (!agentId) {
      if (!model) {
        let detail;
        try {
          const models = await api('/api/v1/cloud/models', { signal, onResponse: (result) => { detail = result; } });
          model = pickModel(models);
          if (!model) throw new ProviderError('network', true,
            { stage: 'shape', status: detail?.http_status, request_id: detail?.request_id });
          mark('models', 'ok', { ...detail, count: models.data.length, selected: model });
        } catch (error) {
          mark('models', 'error', detailOf(error));
          throw error;
        }
      }
      // The Agent API supports idempotent replay of the same request. Persist its model first.
      binding = { ...binding, model };
      binding = await save(binding);
      let agent;
      let detail;
      try {
        agent = await api('/api/v1/cloud/agents', {
          method: 'POST', signal, captureAgent400: agentOnly,
          onResponse: (result) => { detail = result; agentReceipt = result; },
          idempotencyKey: `d5-agent-${userHash.slice(0, 16)}-r${BINDING_REVISION}`,
          body: {
            name: 'D5 scenario generator', model,
            system: '你是校园应急桌面推演的剧本事实选择器。只输出一个符合给定 JSON Schema 的对象，不要代码块、解释或工具调用。',
          },
        });
      } catch (error) {
        mark('agent', 'error', detailOf(error));
        throw error;
      }
      if (typeof agent?.id !== 'string' || !/^agent_[A-Za-z0-9_-]+$/.test(agent.id) || !Number.isInteger(agent.version)) {
        mark('agent', 'error', { ...detail, reason: 'invalid_response', stage: 'shape' });
        throw new ProviderError('network', false, { stage: 'shape', status: detail?.http_status, request_id: detail?.request_id });
      }
      mark('agent', 'ok', { ...detail, version: agent.version });
      agentId = agent.id;
      agentVersion = agent.version;
      binding = { ...binding, model, agent_id: agentId, agent_version: agentVersion };
      if (agentOnly) {
        binding = await save({ ...binding, state: 'agent_ready' });
        return { status: 'agent_ready', ...agentReceipt };
      }
      binding = await save(binding);
    }
    if (agentOnly) return { status: 'reused' };
    let environmentId = binding.environment_id;
    if (environmentId) {
      mark('environment', 'reused');
    } else {
      environmentId = await prepareEnvironment(storage, userHash, previous, signal, mark);
    }
    binding = { ...binding, environment_id: environmentId };
    binding = await save({ ...binding, state: 'ready' });
    return binding;
  } catch (error) {
    if (error?.reason === 'storage') mark('binding_write', 'error', detailOf(error));
    if (failedStep === 'unknown') mark('environment', 'error', detailOf(error));
    error.failed_step = failedStep;
    error.steps = { ...steps };
    if (agentOnly && agentReceipt) error.agentReceipt = agentReceipt;
    try {
      binding = await save({ ...binding, state: 'unknown', ...detailOf(error), failed_step: failedStep });
    } catch {
      // Keep the original upstream error; the binding write failure is secondary.
    }
    throw error;
  }
}

export async function diagnoseAnonymousAgent(storage, diagnosticId, signal = AbortSignal.timeout(MODEL_WAIT_MS)) {
  if (!DIAGNOSTIC_ID.test(diagnosticId)) return { status: 'not_configured' };
  if (activeAgentDiagnostics.has(diagnosticId)) return { status: 'already_started' };
  activeAgentDiagnostics.add(diagnosticId);
  try { return await runAgentDiagnostic(storage, diagnosticId, signal); }
  finally { activeAgentDiagnostics.delete(diagnosticId); }
}

async function runAgentDiagnostic(storage, diagnosticId, signal) {
  const scope = await digest(ANONYMOUS_RESOURCE_SCOPE);
  const root = `d5-generation/${scope}/agent-diagnostics/${diagnosticId}`;
  const write = (name, value) => storage.upload(`${root}/${name}.json`, encoder.encode(JSON.stringify(value)),
    { contentType: 'application/json; charset=utf-8', upsert: false });
  const claimed = await readBindingResult(storage, `${root}/started.json`);
  if (!claimed.ok) return { status: 'record_unavailable' };
  if (claimed.value) return { status: 'already_started' };
  try { await write('started', { at: new Date().toISOString() }); }
  catch { return { status: 'claim_unavailable' }; }

  let evidence;
  try { evidence = await ensureResources(storage, scope, signal, { agentOnly: true }); }
  catch (error) {
    const failure = detailOf(error);
    const status = failure.reason === 'storage' ? 'binding_unavailable'
      : error?.definitive ? 'rejected' : 'outcome_unknown';
    const { request_id, http_status } = error.agentReceipt ?? failure;
    evidence = { status, failed_step: error?.failed_step ?? failure.stage ?? 'binding', ...failure,
      http_status: http_status ?? null, request_id: DIAGNOSTIC_ID.test(request_id ?? '') ? request_id : null,
      ...(error.agent400 && { agent_error: error.agent400 }) };
  }
  try { await write('result', { at: new Date().toISOString(), ...evidence }); }
  catch { return { status: 'record_unavailable', request_id: evidence.request_id ?? null }; }
  return { status: evidence.status, request_id: evidence.request_id ?? null };
}

async function prepareSession(binding, request, signal, onResponse) {
  const session = await api('/api/v1/cloud/sessions', {
    method: 'POST', signal, onResponse,
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

async function sendPrompt(sessionId, prompt, signal, onResponse) {
  return api(`/api/v1/cloud/sessions/${encodeURIComponent(sessionId)}/events`, {
    method: 'POST', signal, onResponse, body: { events: [{ type: 'user.message', content: [{ type: 'text', text: prompt }] }] },
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
  const experimentLedger = async (accessDigest) => createDatabaseLedger({ db, storage, accessDigest,
    userHash: await digest('campus-drill:d5:anonymous:v1:budget'), runId: 'd5-anonymous-experiment-v1' });

  async function generate(userHash, input, includeReports = false, accessDigest) {
    const request = validateRequest(input);
    const ledger = accessDigest ? await experimentLedger(accessDigest) : ledgerFor(userHash, request.run_id);
    const started = performance.now();
    const claim = await ledger.claim(request);
    if (claim === 'existing') return read(ledger, request);
    if (claim === 'conflict') return ready(fallbackResult(request, 'conflict', 0, 0));
    if (!(await ledger.matches(request))) return { status: 'pending', ...(await ledger.usage()) };

    const issues = [];
    const trace = { app: 'd5', instance: INSTANCE, template: request.template_id, modifiers: request.modifiers, phases: {}, started_at: new Date().toISOString(),
      ...(accessDigest ? { authorization: 'owner_bound_run_key' } : {}) };
    const deadline = bound(MODEL_WAIT_MS);
    async function finish(result, completing) {
      try {
        const usage = await ledger.usage({ completing });
        const final = { ...result, ...usage, issues, elapsed_ms: Math.round(performance.now() - started) };
        const saved = await ledger.save(final);
        if (saved && completing) {
          try { await ledger.markComplete(completing); }
          catch { trace.completion_marker_pending = true; }
        }
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
    const fallback = (reason, provider = null, completing) => finish({ ...fallbackResult(request, reason), provider }, completing);

    let binding;
    try {
      binding = await ensureResources(storage, userHash, deadline.signal);
      trace.model = binding.model;
      trace.agent = await redactId(binding.agent_id);
      trace.environment = await redactId(binding.environment_id);
    } catch (error) {
      trace.binding_error = bindingFailure(error);
      if (accessDigest && ['unauthorized', 'timeout'].includes(error?.reason)) return fallback(error.reason);
      return fallback(error?.reason === 'not_configured' ? 'not_configured' : 'network');
    }

    for (const slot of accessDigest ? ['scenario'] : ['scenario', 'retry']) {
      if (deadline.signal.aborted) return fallback('timeout', 'qoder');
      const usageBefore = await ledger.usage();
      if (!(await ledger.reserve(slot))) return followStoredRequest();
      trace.phases[slot] = { reserved_at: new Date().toISOString(), calls_before: usageBefore.calls };
      let session;
      try {
        session = await prepareSession(binding, request, deadline.signal, (detail) => { trace.phases[slot].session_response = detail; });
        trace.phases[slot].session = await redactId(session);
      } catch (error) {
        trace.phases[slot].failure = { step: 'session_create', ...detailOf(error) };
        return fallback(error?.reason ?? 'network');
      }
      if (accessDigest && deadline.signal.aborted) return fallback('timeout', 'qoder');
      if (!(await ledger.markSent(slot, session, { instance: INSTANCE, model: binding.model }))) return followStoredRequest();
      trace.phases[slot].sent_at = new Date().toISOString();
      let phase = 'send';
      try {
        const prompt = generationPrompt(request, issues.at(-1));
        const receipt = await sendPrompt(session, prompt, deadline.signal, (detail) => { trace.phases[slot].send_response = detail; });
        if (receipt?.accepted === true) trace.phases[slot].accepted = true;
        phase = 'reply';
        const text = await waitReply(session, deadline.signal);
        trace.phases[slot].reply_at = new Date().toISOString();
        if (!accessDigest) await ledger.markComplete(slot);
        const candidate = parseCandidate(text, request);
        const bundle = validateBundle(assembleBundle(request, candidate, 'generated'), request, 'generated');
        trace.candidate = candidate;
        const generated = { ...fallbackResult(request, null), bundle, provider: 'qoder', selection: 'generated', scenario_source: 'generated' };
        if (!includeReports || accessDigest) return finish(generated, accessDigest ? slot : undefined);
        return finish(await generateReports(generated, {
          reserve: (name) => ledger.reserve(name),
          prepare: () => prepareSession(binding, request, deadline.signal),
          markSent: async (name, sessionId) => {
            const saved = await ledger.markSent(name, sessionId, { instance: INSTANCE, model: binding.model, phase: 'reports', request_id: request.request_id });
            if (saved) trace.phases[name] = { phase: 'reports', session: await redactId(sessionId) };
            return saved;
          },
          send: async (sessionId, prompt) => {
            await sendPrompt(sessionId, prompt, deadline.signal);
            return waitReply(sessionId, deadline.signal);
          },
          complete: (name) => ledger.markComplete(name),
          usage: () => ledger.usage(),
        }, deadline.signal));
      } catch (error) {
        if (!(error instanceof ValidationError)) trace.phases[slot].failure = { step: phase, ...detailOf(error) };
        if (deadline.signal.aborted) return fallback('timeout', 'qoder');
        if (error instanceof ValidationError) {
          issues.push(error.issue);
          trace.phases[slot].issue = error.issue;
          if (accessDigest || slot === 'retry') return fallback('invalid_candidate', 'qoder', accessDigest ? slot : undefined);
          continue;
        }
        if (error instanceof ProviderError) {
          const completing = phase === 'send' && error.definitive ? slot : undefined;
          if (!accessDigest && error.definitive) await ledger.markComplete(slot);
          return fallback(error.reason, 'qoder', accessDigest ? completing : undefined);
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

  async function recover(userHash, input, accessDigest) {
    const request = validateRequest(input);
    const ledger = accessDigest ? await experimentLedger(accessDigest) : ledgerFor(userHash, request.run_id);
    if (!(await ledger.matches(request))) return { status: 'missing' };
    const stored = await ledger.readResult();
    const readCurrent = async () => stored ? ready(stored.result) : { status: 'pending', ...(await ledger.usage()) };
    if (!stored && !accessDigest) return readCurrent();
    if (stored && (stored.result.upstream_state !== 'unknown' || stored.result.provider !== 'qoder' || stored.final)) return readCurrent();
    const attempt = await ledger.unresolved();
    if (!attempt || (stored && stored.result.report_source !== 'preset') || attempt.slot === 'reports') return readCurrent();
    let text;
    const deadline = bound(2500);
    try {
      text = await readSession(attempt.session_id, deadline.signal);
    } catch {
      deadline.clear();
      return readCurrent();
    }
    deadline.clear();
    if (!text) return readCurrent();
    const before = stored?.result ?? { ...fallbackResult(request, 'network'), provider: 'qoder' };
    const issues = [...(before.issues ?? [])];
    let result;
    const usage = await ledger.usage({ completing: attempt.slot });
    try {
      const candidate = parseCandidate(text, request);
      const bundle = validateBundle(assembleBundle(request, candidate, 'generated'), request, 'generated');
      result = { ...before, ...usage, bundle, selection: 'generated', scenario_source: 'generated', provider: 'qoder', fallback_reason: null };
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      issues.push(error.issue);
      result = { ...before, ...usage, issues, fallback_reason: 'invalid_candidate' };
    }
    const saved = await ledger.recover(result);
    let completed = true;
    if (saved) {
      try { await ledger.markComplete(attempt.slot); }
      catch (error) { if (!accessDigest) throw error; completed = false; }
    }
    const reply = await read(ledger, request);
    return saved && accessDigest ? { ...reply, trace: { authorization: 'owner_bound_run_key',
      recovered_session: await redactId(attempt.session_id), reply_read: true, candidate_valid: result.selection === 'generated',
      completion_marker_pending: !completed } } : reply;
  }

  async function anonymousScenario(request, method, accessDigest) {
    if (method === 'POST' && !qoderConfigured()) return ready(fallbackResult(request, 'not_configured', 0, 0));
    try {
      if (method === 'GET') return await recover(null, request, accessDigest);
      return await generate(await digest(ANONYMOUS_RESOURCE_SCOPE), request, false, accessDigest);
    } catch {
      // An interrupted database operation may have committed. Never issue another model message.
      return ready(fallbackResult(request, 'network', 0, null));
    }
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
      const models = await api('/api/v1/cloud/models', { signal: AbortSignal.timeout(3500) });
      const list = Array.isArray(models?.data) ? models.data : [];
      result.model_count = list.length;
      result.selected_model = pickModel(models);
      result.models = list.slice(0, 40).map((model) => ({ id: model?.id ?? null, enabled: model?.enabled !== false, name: model?.name ?? null }));
    } catch (error) {
      result.models_error = error?.reason ?? 'network';
      result.models_error_detail = detailOf(error);
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
      agent: { fingerprint: await digest(binding.agent_id) },
      environment: { fingerprint: await digest(binding.environment_id) },
      binding: describeBinding(binding),
      instance: INSTANCE,
    };
  }

  function reviewProvider(userHash) {
    return {
      name: 'qoder',
      async prepare(intent, signal) {
        const binding = await ensureResources(storage, userHash, signal);
        return prepareSession(binding, { ...intent, template_id: 'D7 review' }, signal);
      },
      async send(session, prompt, signal) {
        await sendPrompt(session, prompt, signal);
        return waitReply(session, signal);
      },
      read: readSession,
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

  return { generate, recover, disabled, anonymousScenario, claimLastSlot, interrupt, diag, warm, seed, stats, upstream, bindingStatus, reviewProvider, instance: INSTANCE };
}

export { MODEL_WAIT_MS, GENERATION_WAIT_MS };
