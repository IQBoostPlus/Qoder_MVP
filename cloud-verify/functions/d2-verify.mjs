import { CAMPUS_MAP } from './d2-fixture.mjs';
import { createCloudAgentsClient } from './cloud-agents.mjs';

const CLOUD_API_ORIGIN = 'https://api.qoder.com.cn';
const APP_SCOPE = 'd2-cloud-acceptance-2026-11-18';
const MAX_MODEL_REQUESTS_PER_ROUND = 4;
const PRESET_FALLBACK = 'D2_FALLBACK_PRESET';
const MESSAGES = Object.freeze({
  m1: 'This is D2 acceptance message 1. Reply with exactly: D2_MSG_1_OK',
  m2: 'This is D2 acceptance message 2. Reply with exactly: D2_MSG_2_OK',
});
const TABLES = [
  ['campus_buildings', 'id'],
  ['road_segments', 'id'],
  ['disaster_templates', 'id'],
  ['action_catalog', 'id'],
  ['scenarios', 'id'],
  ['runs', 'id'],
  ['run_events', 'run_id'],
  ['ugc_reports', 'id'],
];

const encoder = new TextEncoder();

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}

async function digest(value) {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

function listEntries(result) {
  if (Array.isArray(result)) return result;
  for (const key of ['entries', 'data', 'objects', 'items']) {
    if (Array.isArray(result?.[key])) return result[key];
  }
  return [];
}

function entryName(entry) {
  if (typeof entry === 'string') return entry.split('/').pop();
  const value = entry?.name ?? entry?.path ?? entry?.key ?? entry?.object_path;
  return typeof value === 'string' ? value.split('/').pop() : null;
}

export function createD2Routes({ db, storage, BackendError }) {
  const fail = (code, status) => {
    throw new BackendError(code, status);
  };

  const requireStorage = () => {
    if (!storage) fail('storage_not_configured', 503);
  };

  async function readJson(path) {
    try {
      const response = await storage.download(path);
      const text = await response.text();
      return JSON.parse(text);
    } catch (error) {
      // Distinguish a missing object from an unreadable/transient storage failure.
      const parent = path.slice(0, path.lastIndexOf('/'));
      const name = path.slice(path.lastIndexOf('/') + 1);
      let exists;
      try {
        const listed = await storage.list(parent, { limit: 1000, offset: 0 });
        exists = listEntries(listed).some(entry => entryName(entry) === name);
      } catch {
        throw error;
      }
      if (exists) throw error;
      return null;
    }
  }

  async function writeJson(path, value) {
    try {
      await storage.upload(path, encoder.encode(JSON.stringify(value)), {
        contentType: 'application/json; charset=utf-8',
        upsert: true,
      });
    } catch {
      fail('storage_write_failed', 503);
    }
  }

  async function createJson(path, value) {
    try {
      await storage.upload(path, encoder.encode(JSON.stringify(value)), {
        contentType: 'application/json; charset=utf-8',
        upsert: false,
      });
      return true;
    } catch (error) {
      const existing = await readJson(path);
      if (existing !== null) return false;
      throw error;
    }
  }

  async function readBody(request) {
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) fail('invalid_content_type', 415);
    const text = await request.text();
    if (encoder.encode(text).length > 4096) fail('request_too_large', 413);
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      fail('invalid_json', 400);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid_json', 400);
    return value;
  }

  function validateTask(body) {
    const round = body.round;
    const logicalTask = body.logicalTask;
    if (typeof round !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(round)) fail('invalid_round', 400);
    if (typeof logicalTask !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(logicalTask)) fail('invalid_logical_task', 400);
    return { round, logicalTask };
  }

  async function taskPaths(user, round, logicalTask) {
    const userHash = await digest(user.user_id);
    const taskHash = await digest(`${user.user_id}\n${round}\n${logicalTask}`);
    const roundKey = await digest(`${user.user_id}\n${round}`);
    const root = `d2-verify/agents/${userHash}/${round}`;
    return {
      userHash,
      taskHash,
      roundKey,
      resourcesPath: `${root}/resources.json`,
      roundPath: `${root}/round.json`,
      sessionPath: `${root}/${taskHash}/session.json`,
      indexPath: `${root}/${taskHash}/index.json`,
      requestPath: requestHash => `${root}/${taskHash}/requests/${requestHash}.json`,
    };
  }

  async function redactId(id) {
    return {
      prefix: typeof id === 'string' ? id.slice(0, 16) : null,
      fingerprint: typeof id === 'string' ? await digest(id) : null,
    };
  }

  function cloudClient() {
    return createCloudAgentsClient({ origin: CLOUD_API_ORIGIN, diagnostics: () => {} });
  }

  async function pickModel(cloud) {
    const models = await cloud.request('/api/v1/cloud/models');
    const model = Array.isArray(models?.data)
      ? models.data.find(item => typeof item?.id === 'string' && item.enabled !== false)
        ?? models.data.find(item => typeof item?.id === 'string')
      : undefined;
    if (!model) fail('ai_model_unavailable', 503);
    return model.id;
  }

  async function readReplies(cloud, sessionId) {
    const history = await cloud.request(
      `/api/v1/cloud/sessions/${encodeURIComponent(sessionId)}/events?order=asc&limit=100`,
    );
    const events = Array.isArray(history?.data) ? history.data : [];
    const replies = [];
    for (const event of events) {
      const role = event?.role ?? event?.author?.role ?? event?.type;
      if (role !== 'assistant' && role !== 'agent.message') continue;
      const content = Array.isArray(event?.content) ? event.content : [];
      const text = content
        .filter(block => block?.type === 'text' && typeof block.text === 'string')
        .map(block => block.text)
        .join(' ')
        .trim();
      if (text) replies.push(text);
    }
    return { replies, eventCount: events.length };
  }

  async function pollForReply(cloud, sessionId, baseline, attempts = 15) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      try {
        const result = await readReplies(cloud, sessionId);
        if (result.replies.length > baseline) {
          return {
            reply: result.replies[result.replies.length - 1],
            newReplyCount: result.replies.length - baseline,
            eventCount: result.eventCount,
          };
        }
      } catch {
        // Keep polling; the final state stays pending and can be resumed.
      }
    }
    return { reply: null, newReplyCount: 0, eventCount: null };
  }

  function safeAgentError(error) {
    const code = error?.code === 'ai_not_configured' ? 'ai_not_configured'
      : error?.code === 'ai_access_denied' ? 'ai_access_denied'
      : error?.code === 'ai_rate_limited' ? 'ai_rate_limited'
      : error?.outcome === 'rejected' ? 'ai_request_rejected'
      : 'ai_service_unavailable';
    return new BackendError(code, error?.status === 429 ? 429 : 503);
  }

  async function ensureResources({ userHash, round, resourcesPath }) {
    let binding = await readJson(resourcesPath);
    if (binding?.state === 'ready' && binding.agent_id && binding.environment_id) {
      return { binding, agent_created: false, environment_created: false };
    }
    if (binding?.state === 'rejected') fail('agent_initialization_rejected', 409);
    if (binding?.state === 'unknown') fail('agent_initialization_unknown', 502);
    if (binding?.state === 'creating') {
      // A previous attempt is ambiguous. Never repeat a create without a persisted ID.
      if (!binding.agent_id) fail('agent_initialization_pending', 202);
      return resumeEnvironment({ userHash, round, resourcesPath, binding, agentCreated: false });
    }

    const claim = {
      state: 'creating',
      app_scope: APP_SCOPE,
      user_hash: userHash,
      round,
      created_at: new Date().toISOString(),
      agent_creations: 0,
      environment_creations: 0,
    };
    const created = await createJson(resourcesPath, claim);
    binding = created ? claim : await readJson(resourcesPath);
    if (!binding) fail('storage_read_failed', 503);
    if (binding.state === 'ready' && binding.agent_id && binding.environment_id) {
      return { binding, agent_created: false, environment_created: false };
    }
    if (!created) {
      if (binding.state === 'creating' && !binding.agent_id) fail('agent_initialization_pending', 202);
      return resumeEnvironment({ userHash, round, resourcesPath, binding, agentCreated: false });
    }

    const cloud = cloudClient();
    let modelId;
    try {
      modelId = await pickModel(cloud);
    } catch (error) {
      throw error instanceof BackendError ? error : safeAgentError(error);
    }
    let agent;
    try {
      agent = await cloud.request('/api/v1/cloud/agents', {
        method: 'POST',
        idempotencyKey: `d2-agent-${userHash.slice(0, 24)}-${round}`,
        body: {
          name: `D2 acceptance ${round}`,
          model: modelId,
          system: 'You are a connectivity check. Follow the single instruction exactly and do not use tools.',
        },
      });
      if (typeof agent?.id !== 'string' || !Number.isInteger(agent.version)) {
        fail('ai_response_invalid', 503);
      }
    } catch (error) {
      await writeJson(resourcesPath, {
        ...binding,
        state: error?.outcome === 'rejected' ? 'rejected' : 'unknown',
        error_code: error?.code ?? 'ai_service_unavailable',
        updated_at: new Date().toISOString(),
      });
      throw error instanceof BackendError ? error : safeAgentError(error);
    }

    binding = {
      ...binding,
      agent_id: agent.id,
      agent_version: agent.version,
      model_id: agent.model ?? null,
      agent_creations: 1,
      updated_at: new Date().toISOString(),
    };
    await writeJson(resourcesPath, binding);
    return resumeEnvironment({ userHash, round, resourcesPath, binding, agentCreated: true });
  }

  async function resumeEnvironment({ userHash, round, resourcesPath, binding, agentCreated }) {
    if (binding.environment_id) {
      const ready = { ...binding, state: 'ready', ready_at: binding.ready_at ?? new Date().toISOString() };
      await writeJson(resourcesPath, ready);
      return { binding: ready, agent_created: agentCreated, environment_created: false };
    }
    const cloud = cloudClient();
    let environment;
    try {
      environment = await cloud.request('/api/v1/cloud/environments', {
        method: 'POST',
        idempotencyKey: `d2-env-${userHash.slice(0, 24)}-${round}`,
        body: { name: `D2 acceptance environment ${round}`, config: { type: 'cloud' } },
      });
      if (typeof environment?.id !== 'string') fail('ai_response_invalid', 503);
    } catch (error) {
      await writeJson(resourcesPath, {
        ...binding,
        state: error?.outcome === 'rejected' ? 'rejected' : 'unknown',
        error_code: error?.code ?? 'ai_service_unavailable',
        updated_at: new Date().toISOString(),
      });
      throw error instanceof BackendError ? error : safeAgentError(error);
    }
    const ready = {
      ...binding,
      state: 'ready',
      environment_id: environment.id,
      environment_creations: 1,
      ready_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await writeJson(resourcesPath, ready);
    return { binding: ready, agent_created: agentCreated, environment_created: true };
  }

  async function ensureSession({ userHash, taskHash, round, logicalTask, sessionPath, roundPath, resources }) {
    let binding = await readJson(sessionPath);
    if (binding?.state === 'ready' && binding.session_id) {
      await registerSession(roundPath, taskHash);
      return { binding, session_created: false };
    }
    if (binding?.state === 'rejected') fail('session_initialization_rejected', 409);
    if (binding?.state === 'unknown') fail('session_initialization_unknown', 502);
    if (binding?.state === 'creating') fail('session_initialization_pending', 202);

    const claim = {
      state: 'creating',
      app_scope: APP_SCOPE,
      logical_task: logicalTask,
      task_hash: taskHash,
      round,
      created_at: new Date().toISOString(),
    };
    const created = await createJson(sessionPath, claim);
    binding = created ? claim : await readJson(sessionPath);
    if (!binding) fail('storage_read_failed', 503);
    if (!created) {
      if (binding.state === 'ready' && binding.session_id) return { binding, session_created: false };
      fail('session_initialization_pending', 202);
    }

    const cloud = cloudClient();
    let session;
    try {
      session = await cloud.request('/api/v1/cloud/sessions', {
        method: 'POST',
        idempotencyKey: `d2-session-${taskHash.slice(0, 40)}`,
        body: {
          agent: { type: 'agent', id: resources.agent_id, version: resources.agent_version },
          environment_id: resources.environment_id,
          title: `D2 acceptance ${round} ${logicalTask}`,
        },
      });
      if (typeof session?.id !== 'string') fail('ai_response_invalid', 503);
    } catch (error) {
      await writeJson(sessionPath, {
        ...binding,
        state: error?.outcome === 'rejected' ? 'rejected' : 'unknown',
        error_code: error?.code ?? 'ai_service_unavailable',
        updated_at: new Date().toISOString(),
      });
      throw error instanceof BackendError ? error : safeAgentError(error);
    }

    const ready = {
      ...binding,
      state: 'ready',
      session_id: session.id,
      session_creations: 1,
      ready_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await writeJson(sessionPath, ready);
    await registerSession(roundPath, taskHash);
    return { binding: ready, session_created: true };
  }

  async function readIndex(path) {
    return (await readJson(path)) ?? { requests: [], updated_at: null };
  }

  function summarize(record) {
    return {
      request: { prefix: record.request_prefix, fingerprint: record.request_fingerprint },
      message_id: record.message_id,
      status: record.state,
      accepted: record.accepted ?? 0,
      replies: record.replies ?? 0,
      reply: record.reply ?? null,
      new_reply_count: record.new_reply_count ?? 0,
      event_count: record.event_count ?? null,
      e2e_ms: record.e2e_ms ?? null,
      created_at: record.created_at ?? null,
      completed_at: record.completed_at ?? null,
      error_code: record.error_code ?? null,
    };
  }

  async function updateIndex(path, record) {
    const index = await readIndex(path);
    const requests = index.requests.filter(item => item.request_fingerprint !== record.request_fingerprint);
    requests.push({
      request_prefix: record.request_prefix,
      request_fingerprint: record.request_fingerprint,
      message_id: record.message_id,
      status: record.state,
      accepted: record.accepted ?? 0,
      replies: record.replies ?? 0,
      reply: record.reply ?? null,
      created_at: record.created_at ?? null,
      completed_at: record.completed_at ?? null,
    });
    await writeJson(path, { requests, updated_at: new Date().toISOString() });
  }

  async function readRound(path) {
    return (await readJson(path)) ?? { accepted: 0, requests: [], sessions: [] };
  }

  async function registerSession(path, taskHash) {
    const round = await readRound(path);
    const sessions = Array.isArray(round.sessions) ? round.sessions : [];
    if (sessions.includes(taskHash)) return;
    await writeJson(path, {
      ...round,
      sessions: [...sessions, taskHash],
      updated_at: new Date().toISOString(),
    });
  }

  async function incrementRound(path, record) {
    const round = await readRound(path);
    const exists = round.requests.some(item => item.request_fingerprint === record.request_fingerprint);
    const requests = exists
      ? round.requests
      : [...round.requests, { request_fingerprint: record.request_fingerprint, message_id: record.message_id }];
    await writeJson(path, {
      ...round,
      accepted: Math.max(round.accepted ?? 0, requests.length),
      requests,
      updated_at: new Date().toISOString(),
    });
  }

  async function agentSend({ user, body }) {
    requireStorage();
    const { round, logicalTask } = validateTask(body);
    const requestId = body.requestId;
    const messageId = body.messageId;
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9_.:-]{8,80}$/.test(requestId)) fail('invalid_request_id', 400);
    if (typeof messageId !== 'string' || !Object.hasOwn(MESSAGES, messageId)) fail('invalid_message_id', 400);

    const paths = await taskPaths(user, round, logicalTask);
    const [resources, session, roundState] = await Promise.all([
      readJson(paths.resourcesPath),
      readJson(paths.sessionPath),
      readRound(paths.roundPath),
    ]);
    if (resources?.state !== 'ready' || session?.state !== 'ready' || !session.session_id) {
      fail('agent_not_initialized', 409);
    }

    const requestHash = await digest(`${user.user_id}\n${round}\n${logicalTask}\n${requestId}`);
    const requestPrefix = requestId.slice(0, 16);
    const requestPath = paths.requestPath(requestHash);
    let record = await readJson(requestPath);
    if (record) {
      if (record.message_id !== messageId) fail('request_id_conflict', 409);
      if (record.state === 'completed') {
        return Response.json({ ok: true, replayed: true, ...summarize(record) });
      }
      if (record.state === 'sent_pending_reply') {
        return Response.json({
          ok: false,
          replayed: true,
          pending: true,
          code: 'reply_pending',
          ...summarize(record),
        }, { status: 202 });
      }
      if (record.state === 'failed' || record.state === 'unknown') {
        return Response.json({
          ok: false,
          replayed: true,
          code: record.state === 'failed' ? 'request_failed' : 'request_outcome_unknown',
          ...summarize(record),
        }, { status: 502 });
      }
      return Response.json({
        ok: false,
        replayed: true,
        code: 'request_in_progress',
        ...summarize(record),
      }, { status: 202 });
    }

    if ((roundState.accepted ?? 0) >= MAX_MODEL_REQUESTS_PER_ROUND) {
      return Response.json({
        ok: true,
        fallback: true,
        status: 'fallback',
        reply: PRESET_FALLBACK,
        accepted: 0,
        replies: 0,
        round_accepted: roundState.accepted,
        cap: MAX_MODEL_REQUESTS_PER_ROUND,
      });
    }

    const cloud = cloudClient();
    let baseline;
    try {
      baseline = await readReplies(cloud, session.session_id);
    } catch (error) {
      throw safeAgentError(error);
    }

    const claim = {
      state: 'claimed',
      message_id: messageId,
      request_prefix: requestPrefix,
      request_fingerprint: requestHash,
      baseline_assistant_count: baseline.replies.length,
      accepted: 0,
      replies: 0,
      created_at: new Date().toISOString(),
    };
    const created = await createJson(requestPath, claim);
    if (!created) {
      const existing = await readJson(requestPath);
      if (!existing) fail('storage_read_failed', 503);
      if (existing.message_id !== messageId) fail('request_id_conflict', 409);
      return Response.json({
        ok: false,
        replayed: true,
        code: 'request_in_progress',
        ...summarize(existing),
      }, { status: 202 });
    }

    record = { ...claim, state: 'sending', attempts: 1, updated_at: new Date().toISOString() };
    await writeJson(requestPath, record);
    const startedAt = Date.now();
    try {
      await cloud.request(`/api/v1/cloud/sessions/${encodeURIComponent(session.session_id)}/events`, {
        method: 'POST',
        body: {
          events: [{ type: 'user.message', content: [{ type: 'text', text: MESSAGES[messageId] }] }],
        },
      });
    } catch (error) {
      const outcome = error?.outcome;
      const state = outcome === 'not_sent' || outcome === 'rejected' ? 'failed' : 'unknown';
      record = {
        ...record,
        state,
        error_code: error?.code ?? 'ai_service_unavailable',
        updated_at: new Date().toISOString(),
      };
      await writeJson(requestPath, record);
      await updateIndex(paths.indexPath, record);
      return Response.json({
        ok: false,
        code: state === 'failed' ? 'message_not_accepted' : 'message_outcome_unknown',
        ...summarize(record),
      }, { status: state === 'failed' ? 502 : 502 });
    }

    record = {
      ...record,
      state: 'sent',
      accepted: 1,
      accepted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await writeJson(requestPath, record);
    await updateIndex(paths.indexPath, record);
    await incrementRound(paths.roundPath, record);

    const polled = await pollForReply(cloud, session.session_id, baseline.replies.length);
    const completedAt = new Date().toISOString();
    record = {
      ...record,
      state: polled.reply ? 'completed' : 'sent_pending_reply',
      replies: polled.reply ? 1 : 0,
      reply: polled.reply,
      new_reply_count: polled.newReplyCount,
      event_count: polled.eventCount,
      completed_at: polled.reply ? completedAt : null,
      e2e_ms: Date.now() - startedAt,
      updated_at: completedAt,
    };
    await writeJson(requestPath, record);
    await updateIndex(paths.indexPath, record);
    return Response.json(
      { ok: true, replayed: false, ...summarize(record) },
      { status: polled.reply ? 200 : 202 },
    );
  }

  async function agentResume({ user, body }) {
    requireStorage();
    const { round, logicalTask } = validateTask(body);
    const requestId = body.requestId;
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9_.:-]{8,80}$/.test(requestId)) fail('invalid_request_id', 400);
    const paths = await taskPaths(user, round, logicalTask);
    const session = await readJson(paths.sessionPath);
    if (session?.state !== 'ready' || !session.session_id) fail('agent_not_initialized', 409);
    const requestHash = await digest(`${user.user_id}\n${round}\n${logicalTask}\n${requestId}`);
    const requestPath = paths.requestPath(requestHash);
    let record = await readJson(requestPath);
    if (!record) fail('request_not_found', 404);
    if (record.state === 'completed') {
      return Response.json({ ok: true, replayed: true, ...summarize(record) });
    }
    if (record.state !== 'sent' && record.state !== 'sent_pending_reply') {
      return Response.json({ ok: false, code: 'request_not_resumable', ...summarize(record) }, { status: 202 });
    }
    const cloud = cloudClient();
    const baseline = Number.isSafeInteger(record.baseline_assistant_count)
      ? record.baseline_assistant_count
      : 0;
    const polled = await pollForReply(cloud, session.session_id, baseline);
    const completedAt = new Date().toISOString();
    record = {
      ...record,
      state: polled.reply ? 'completed' : 'sent_pending_reply',
      replies: polled.reply ? 1 : 0,
      reply: polled.reply,
      new_reply_count: polled.newReplyCount,
      event_count: polled.eventCount,
      completed_at: polled.reply ? completedAt : record.completed_at ?? null,
      e2e_ms: record.e2e_ms ?? null,
      updated_at: completedAt,
    };
    await writeJson(requestPath, record);
    await updateIndex(paths.indexPath, record);
    return Response.json(
      { ok: true, replayed: true, resumed: true, ...summarize(record) },
      { status: polled.reply ? 200 : 202 },
    );
  }

  async function agentState({ user, body }) {
    requireStorage();
    const { round, logicalTask } = validateTask(body);
    const paths = await taskPaths(user, round, logicalTask);
    const [resources, session, index, roundState] = await Promise.all([
      readJson(paths.resourcesPath),
      readJson(paths.sessionPath),
      readIndex(paths.indexPath),
      readRound(paths.roundPath),
    ]);
    const initialized = resources?.state === 'ready' && session?.state === 'ready' && !!session.session_id;
    const requests = index.requests ?? [];
    return Response.json({
      ok: true,
      initialized,
      binding_key: paths.taskHash.slice(0, 16),
      round,
      logical_task: logicalTask,
      agent: initialized ? {
        ...(await redactId(resources.agent_id)),
        version: resources.agent_version,
        model_id: resources.model_id ?? null,
      } : null,
      environment: initialized ? await redactId(resources.environment_id) : null,
      session: initialized ? await redactId(session.session_id) : null,
      creation_counts: initialized ? {
        agents: resources.agent_creations ?? 1,
        environments: resources.environment_creations ?? 1,
        sessions: session.session_creations ?? 1,
      } : { agents: 0, environments: 0, sessions: 0 },
      round_creation_counts: initialized ? {
        agents: resources.agent_creations ?? 1,
        environments: resources.environment_creations ?? 1,
        sessions: roundState.sessions?.length ?? 0,
      } : { agents: 0, environments: 0, sessions: 0 },
      requests,
      accepted_total: requests.reduce((sum, item) => sum + (item.accepted ?? 0), 0),
      reply_total: requests.reduce((sum, item) => sum + (item.replies ?? 0), 0),
      round_accepted: roundState.accepted ?? 0,
      round_cap: MAX_MODEL_REQUESTS_PER_ROUND,
      preset_fallback: PRESET_FALLBACK,
    });
  }

  async function agentInit({ user, body }) {
    requireStorage();
    const { round, logicalTask } = validateTask(body);
    const paths = await taskPaths(user, round, logicalTask);
    const resourcesResult = await ensureResources({
      userHash: paths.userHash,
      round,
      resourcesPath: paths.resourcesPath,
    });
    const sessionResult = await ensureSession({
      userHash: paths.userHash,
      taskHash: paths.taskHash,
      round,
      logicalTask,
      sessionPath: paths.sessionPath,
      roundPath: paths.roundPath,
      resources: resourcesResult.binding,
    });
    const binding = resourcesResult.binding;
    const session = sessionResult.binding;
    const roundState = await readRound(paths.roundPath);
    return Response.json({
      ok: true,
      replayed: !resourcesResult.agent_created && !sessionResult.session_created,
      binding_key: paths.taskHash.slice(0, 16),
      round,
      logical_task: logicalTask,
      agent: {
        ...(await redactId(binding.agent_id)),
        version: binding.agent_version,
        model_id: binding.model_id ?? null,
      },
      environment: await redactId(binding.environment_id),
      session: await redactId(session.session_id),
      created_this_call: {
        agents: resourcesResult.agent_created ? 1 : 0,
        environments: resourcesResult.environment_created ? 1 : 0,
        sessions: sessionResult.session_created ? 1 : 0,
      },
      creation_counts: {
        agents: binding.agent_creations ?? 1,
        environments: binding.environment_creations ?? 1,
        sessions: session.session_creations ?? 1,
      },
      round_creation_counts: {
        agents: binding.agent_creations ?? 1,
        environments: binding.environment_creations ?? 1,
        sessions: roundState.sessions?.length ?? 0,
      },
      round_accepted: roundState.accepted ?? 0,
      round_cap: MAX_MODEL_REQUESTS_PER_ROUND,
    });
  }

  function jsonValue(value) {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  function normalizeExpected() {
    const buildings = CAMPUS_MAP.buildings.map(item => ({
      id: item.id,
      name: item.name,
      zone: item.zone,
      category: item.category,
      floors: item.floors ?? null,
      capacity: item.capacity,
      risk_tag: item.risk_tag ?? null,
      polygon_json: item.polygon,
      adjacency_json: item.adjacency,
      is_training: 1,
    })).sort((a, b) => a.id.localeCompare(b.id));
    const roads = CAMPUS_MAP.road_segments.map(item => ({
      id: item.id,
      name: item.name,
      from_node_id: item.from,
      to_node_id: item.to,
      geometry_json: item.geometry,
      blocked: item.blocked ? 1 : 0,
      hazard: item.hazard ?? null,
      block_reason: item.block_reason ?? null,
      is_training: 1,
    })).sort((a, b) => a.id.localeCompare(b.id));
    return { buildings, roads };
  }

  function compareRecords(table, expected, actual) {
    const expectedById = new Map(expected.map(item => [item.id, item]));
    const actualById = new Map(actual.map(item => [item.id, item]));
    const missing = [...expectedById.keys()].filter(id => !actualById.has(id));
    const extra = [...actualById.keys()].filter(id => !expectedById.has(id));
    const diffs = [];
    for (const [id, expectedRow] of expectedById) {
      const actualRow = actualById.get(id);
      if (!actualRow) continue;
      for (const field of Object.keys(expectedRow)) {
        if (canonical(expectedRow[field]) !== canonical(actualRow[field] ?? null)) {
          diffs.push({
            table,
            id,
            field,
            expected: expectedRow[field],
            actual: actualRow[field] ?? null,
          });
        }
      }
    }
    return {
      expected_count: expected.length,
      actual_count: actual.length,
      missing_ids: missing,
      extra_ids: extra,
      diff_count: diffs.length,
      diffs: diffs.slice(0, 200),
    };
  }

  async function exactCount(table, column) {
    const result = await db.from(table).select(column, { count: 'exact' }).limit(1);
    if (result.error) fail('database_read_failed', 503);
    if (!Number.isSafeInteger(result.count) || result.count < 0) fail('count_unavailable', 503);
    return result.count;
  }

  async function verifyDatabase() {
    const counts = {};
    for (const [table, column] of TABLES) {
      counts[table] = await exactCount(table, column);
    }
    counts.d1_connectivity_check = await exactCount('d1_connectivity_check', 'id');

    const buildingsResult = await db.from('campus_buildings').select('*').order('id');
    if (buildingsResult.error) fail('database_read_failed', 503);
    const roadsResult = await db.from('road_segments').select('*').order('id');
    if (roadsResult.error) fail('database_read_failed', 503);

    const expected = normalizeExpected();
    const actualBuildings = (buildingsResult.data ?? []).map(row => ({
      id: row.id,
      name: row.name,
      zone: row.zone,
      category: row.category,
      floors: row.floors ?? null,
      capacity: row.capacity,
      risk_tag: row.risk_tag ?? null,
      polygon_json: jsonValue(row.polygon_json),
      adjacency_json: jsonValue(row.adjacency_json),
      is_training: row.is_training,
    })).sort((a, b) => a.id.localeCompare(b.id));
    const actualRoads = (roadsResult.data ?? []).map(row => ({
      id: row.id,
      name: row.name,
      from_node_id: row.from_node_id,
      to_node_id: row.to_node_id,
      geometry_json: jsonValue(row.geometry_json),
      blocked: row.blocked,
      hazard: row.hazard ?? null,
      block_reason: row.block_reason ?? null,
      is_training: row.is_training,
    })).sort((a, b) => a.id.localeCompare(b.id));

    const buildings = compareRecords('campus_buildings', expected.buildings, actualBuildings);
    const roads = compareRecords('road_segments', expected.roads, actualRoads);

    const buildingIds = new Set(CAMPUS_MAP.buildings.map(item => item.id));
    const allEndpoints = new Set([
      ...CAMPUS_MAP.buildings.map(item => item.id),
      ...CAMPUS_MAP.junctions.map(item => item.id),
    ]);
    const unresolved = [];
    for (const road of actualRoads) {
      if (!allEndpoints.has(road.from_node_id)) {
        unresolved.push({ table: 'road_segments', id: road.id, field: 'from_node_id', value: road.from_node_id });
      }
      if (!allEndpoints.has(road.to_node_id)) {
        unresolved.push({ table: 'road_segments', id: road.id, field: 'to_node_id', value: road.to_node_id });
      }
    }
    for (const building of actualBuildings) {
      for (const adjacent of building.adjacency_json ?? []) {
        if (!buildingIds.has(adjacent)) {
          unresolved.push({ table: 'campus_buildings', id: building.id, field: 'adjacency_json', value: adjacent });
        }
      }
    }

    const gates = CAMPUS_MAP.junctions.map(gate => ({
      id: gate.id,
      name: gate.name,
      kind: gate.kind,
      resolved: allEndpoints.has(gate.id),
      referenced_by_roads: actualRoads.filter(road => road.from_node_id === gate.id || road.to_node_id === gate.id).length,
    }));

    const expectedSha = await digest(canonical({
      buildings: expected.buildings,
      roads: expected.roads,
    }));
    const actualSha = await digest(canonical({
      buildings: actualBuildings,
      roads: actualRoads,
    }));
    const ok = buildings.diff_count === 0 && roads.diff_count === 0
      && buildings.missing_ids.length === 0 && buildings.extra_ids.length === 0
      && roads.missing_ids.length === 0 && roads.extra_ids.length === 0
      && unresolved.length === 0
      && expectedSha === actualSha;

    return Response.json({
      ok,
      schema_version: CAMPUS_MAP.schema_version,
      fixture_generated_at: CAMPUS_MAP.generated_at,
      observed_at: new Date().toISOString(),
      counts,
      buildings,
      roads,
      gates,
      unresolved_refs: unresolved,
      field_checks: expected.buildings.length * 10 + expected.roads.length * 9,
      checksums: {
        expected_sha256: expectedSha,
        actual_sha256: actualSha,
        match: expectedSha === actualSha,
      },
    });
  }

  return async function handleD2(ctx, path, user) {
    const method = ctx.request.method;
    if (path === '/api/d2/db/verify' && method === 'POST') {
      return verifyDatabase();
    }
    if (path === '/api/d2/agent/init' && method === 'POST') {
      return agentInit({ user, body: await readBody(ctx.request) });
    }
    if (path === '/api/d2/agent/send' && method === 'POST') {
      return agentSend({ user, body: await readBody(ctx.request) });
    }
    if (path === '/api/d2/agent/resume' && method === 'POST') {
      return agentResume({ user, body: await readBody(ctx.request) });
    }
    if (path === '/api/d2/agent/state' && method === 'POST') {
      return agentState({ user, body: await readBody(ctx.request) });
    }
    return null;
  };
}