// Same-origin D5 routes. Normal generation uses platform identity.
import { ValidationError, fallbackResult, validateRequest } from './d5-bundle.mjs';
import { ProviderError, bindingFailure, createD5Service, diagnoseAnonymousAgent, qoderConfigured, safeCorrelationId } from './d5-service.mjs';
import { createDatabaseLedger } from './d5-db-ledger.mjs';
import { createReviewRoute, createRunRepository, presetReviewRoot, reviewOriginMatches, usesGenerationBudget } from './d6-shared.mjs';

const encoder = new TextEncoder();

async function digest(value) {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function envValue(name) {
  try {
    return globalThis.Deno?.env.get(name);
  } catch {
    return undefined;
  }
}
export const envEnabled = (name) => envValue(name) === '1';
export const anonymousExperimentEnabled = () => envEnabled('D5_ENABLE_ANON_EXPERIMENT');
export const agentDiagnosticEnabled = () => Boolean(envValue('D5_ANON_AGENT_DIAGNOSTIC_ID'));
export const agentDiagnosticPath = '/api/d5/agent-diagnostic';

// Only fields supplied by the platform's requireUser() result are considered.
// Browser-submitted values never reach this list.
export const IDENTITY_FIELDS = ['user_id', 'userId', 'uid', 'sub'];

function identityContainers(user) {
  if (!user || typeof user !== 'object' || Array.isArray(user)) return [];
  const nested = ['user', 'identity'].filter((key) => Object.hasOwn(user, key)).map((key) => user[key]);
  return [user, ...nested.filter((value) => value && typeof value === 'object' && !Array.isArray(value))];
}

export function resolveIdentity(user) {
  const containers = identityContainers(user);
  for (const field of IDENTITY_FIELDS) {
    for (const container of containers) {
      if (!Object.hasOwn(container, field)) continue;
      const value = container[field];
      if (typeof value === 'string' && value.trim()) return { field, value: value.trim() };
    }
  }
  return null;
}

// Field names, types and non-empty flags only; never the values themselves.
export function describeIdentity(user) {
  const fields = Object.create(null);
  const add = (prefix, object) => {
    if (!object || typeof object !== 'object') return;
    for (const key of Object.keys(object).sort().slice(0, 32)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(key)) continue;
      const value = object[key];
      fields[prefix + key] = {
        type: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
        non_empty: typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined,
      };
    }
  };
  add('', user);
  if (user?.user && typeof user.user === 'object') add('user.', user.user);
  if (user?.identity && typeof user.identity === 'object') add('identity.', user.identity);
  return fields;
}

export function createD5Routes({ db, storage, BackendError }) {
  const service = createD5Service({ db, storage });
  const runs = db ? createRunRepository(db) : null;

  function fail(code, status) {
    throw new BackendError(code, status);
  }

  function json(value, status = 200) {
    return new Response(JSON.stringify(value), {
      status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  async function readBody(request) {
    if (!(request.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) fail('invalid_content_type', 415);
    const text = await request.text();
    if (encoder.encode(text).length > 4096) fail('request_too_large', 413);
    try {
      const value = JSON.parse(text);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      return value;
    } catch {
      fail('invalid_json', 400);
    }
  }

  function query(url) {
    return {
      run_id: url.searchParams.get('run_id'), request_id: url.searchParams.get('request_id'),
      template_id: url.searchParams.get('template_id'), modifiers: url.searchParams.getAll('modifiers'),
    };
  }

  function mapError(error) {
    if (error instanceof BackendError) return error;
    if (error instanceof ValidationError) return new BackendError('invalid_request', 400);
    if (error instanceof ProviderError) {
      if (error.reason === 'storage') return new BackendError('backend_storage_unavailable', 503);
      return new BackendError(error.reason === 'not_configured' ? 'ai_not_configured' : error.reason === 'unauthorized' ? 'ai_access_denied' : 'ai_service_unavailable', error.reason === 'unauthorized' ? 401 : 503);
    }
    return new BackendError('d5_internal', 503);
  }

  return async function handleD5(ctx, path, user) {
    const request = ctx.request;
    const url = new URL(request.url);
    if (url.pathname.includes('/api/d5/') && (request.headers.get('sec-fetch-site') ?? '') === 'cross-site') {
      fail('same_origin_required', 415);
    }
    const identity = resolveIdentity(user);
    const method = request.method;

    try {
      const experiment = anonymousExperimentEnabled();
      const diagnosticId = envValue('D5_ANON_AGENT_DIAGNOSTIC_ID');
      const enabled = !experiment && !diagnosticId && envEnabled('D5_ENABLE_QODER');
      const scenario = path === '/api/d5/scenario' && (method === 'POST' || method === 'GET');
      const diagnostic = Boolean(diagnosticId) && path === agentDiagnosticPath && method === 'POST';
      if (experiment && (scenario || diagnostic)) {
        const origin = request.headers.get('origin');
        const fetchSite = request.headers.get('sec-fetch-site');
        const publicOrigin = envValue('D5_ANON_EXPERIMENT_PUBLIC_ORIGIN') ?? '';
        let expectedOrigin = url.origin;
        // Sites may forward to an internal URL. Only the deployment can override this reference.
        const originSyntax = /^https:\/\/(?:[a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]*[a-z\d])?)*\.?|\[[a-f\d:.]+\])(?::\d+)?\/?$/i;
        if (publicOrigin === publicOrigin.trim() && originSyntax.test(publicOrigin)) {
          try { expectedOrigin = new URL(publicOrigin).origin; } catch { /* keep the original reference */ }
        }
        if (origin && origin !== expectedOrigin || fetchSite && !['none', 'same-origin'].includes(fetchSite)) fail('same_origin_required', 415);
        if (scenario && diagnosticId) fail('agent_diagnostic_only', 503);
        const input = diagnostic ? await readBody(request) : validateRequest(method === 'POST' ? await readBody(request) : query(url));
        if (diagnostic && (Object.keys(input).length !== 1 || typeof input.run_id !== 'string')) fail('invalid_request', 400);
        const binding = /^([\w-]{12,80}):([0-9a-f]{64})$/.exec(envValue('D5_ANON_EXPERIMENT_BINDING') ?? '');
        if (!binding) {
          if (diagnostic) fail('not_found', 404);
          return json({ status: 'ready', result: fallbackResult(input, 'not_configured', 0, 0) });
        }
        const key = request.headers.get('x-run-key');
        if (input.run_id !== binding[1] || !key || !/^[0-9a-f]{64}$/.test(key)) fail('not_found', 404);
        const owner = await digest(key);
        let mismatch = 0;
        for (let index = 0; index < owner.length; index++) mismatch |= owner.charCodeAt(index) ^ binding[2].charCodeAt(index);
        if (mismatch) fail('not_found', 404);
        if (diagnostic) return json(await diagnoseAnonymousAgent(storage, diagnosticId));
        const reply = await service.anonymousScenario(input, method, owner);
        return json(reply, reply.status === 'pending' ? 202 : reply.status === 'missing' ? 404 : 200);
      }
      if (path === '/api/d5/diag' && method === 'GET') {
        const [binding, emptyBinding, upstream] = await Promise.all([
          identity ? service.bindingStatus(storage, await digest(identity.value)) : null,
          service.bindingStatus(storage, await digest('')),
          enabled && identity ? service.diag() : { configured: false, ledger: 'database', instance: service.instance },
        ]);
        return json({
          ...upstream,
          real_generation_enabled: enabled,
          anonymous_experiment_enabled: experiment,
          anonymous_provider_configured: experiment && qoderConfigured(),
          request_id: safeCorrelationId(ctx.requestId),
          identity: {
            authenticated: Boolean(user),
            resolved: identity ? { field: identity.field, type: 'string', non_empty: true } : null,
            fields: describeIdentity(user),
          },
          binding,
          empty_identity_binding: emptyBinding,
        });
      }
      if (path === '/api/d5/instance' && method === 'GET') {
        return json({ instance: service.instance, request_id: safeCorrelationId(ctx.requestId), at: new Date().toISOString() });
      }
      if (path.startsWith('/api/d5/test/')) {
        if (!enabled || !envEnabled('D5_ENABLE_TEST_ROUTES')) fail('d5_test_routes_disabled', 404);
        if (request.headers.get('x-d5-test') !== '1') fail('test_header_required', 403);
      }
      if (!identity) fail(user && typeof user === 'object' ? 'identity_unavailable' : 'identity_required', 401);
      const userHash = await digest(identity.value);
      if (path === '/api/d7/review') {
        return createReviewRoute({
          enabled: () => enabled && envEnabled('D7_ENABLE_REVIEW') && envEnabled('D6_ENABLE_RUN_SYNC') && runs !== null,
          load: (id, owner) => runs.read(id, owner),
          async open(run, owner, create) {
            const generated = usesGenerationBudget(run);
            const root = generated ? run.origin?.request : await presetReviewRoot(run.run_id);
            if (!root || typeof root.run_id !== 'string' || !/^[\w-]{12,80}$/.test(root.run_id)) return null;
            const ledger = createDatabaseLedger({ db, storage, userHash: generated ? userHash : owner, runId: root.run_id });
            if (generated) {
              if (!await ledger.hasDatabaseRun() || !await ledger.matches(root)) return null;
              const result = await ledger.readResult();
              if (!result || !reviewOriginMatches(run, result.result)) return null;
            } else if (create && await ledger.claim(root) === 'conflict') return null;
            return { ledger: ledger.reviewLedger(), provider: service.reviewProvider(userHash) };
          },
        })(request);
      }
      if (path === '/api/d5/scenario' && (method === 'POST' || method === 'GET')) {
        const input = method === 'POST' ? await readBody(request) : query(url);
        const reply = !enabled ? await service.disabled(userHash, input, method)
          : method === 'GET' ? await service.recover(userHash, input) : await service.generate(userHash, input, envEnabled('D6_ENABLE_REPORTS'));
        return json(reply, reply.status === 'pending' ? 202 : reply.status === 'missing' ? 404 : 200);
      }
      if (path === '/api/d5/warm' && method === 'POST') {
        if (!enabled) fail('d5_generation_disabled', 503);
        try {
          return json(await service.warm(userHash));
        } catch (error) {
          const code = error?.reason === 'storage' ? 'backend_storage_unavailable'
            : error?.reason === 'not_configured' ? 'ai_not_configured' : 'ai_service_unavailable';
          const { request_id: upstreamRequestId, ...diagnostics } = bindingFailure(error);
          return json({ code, ...diagnostics, request_id: safeCorrelationId(ctx.requestId),
            upstream_request_id: upstreamRequestId ?? null }, 503);
        }
      }
      if (path === '/api/d5/stats' && method === 'GET') {
        const runId = url.searchParams.get('run_id');
        if (typeof runId !== 'string' || !/^[\w-]{12,80}$/.test(runId)) fail('invalid_run_id', 400);
        return json(await service.stats(userHash, runId));
      }
      if (path === '/api/d5/test/seed' && method === 'POST') {
        const input = await readBody(request);
        return json(await service.seed(userHash, input, ['scenario', 'reports', 'review']));
      }
      if (path === '/api/d5/test/last-slot' && method === 'POST') {
        const reply = await service.claimLastSlot(userHash, await readBody(request));
        return json(reply, reply.status === 'taken' ? 409 : reply.status === 'missing' ? 404 : reply.status === 'precondition' ? 409 : 200);
      }
      if (path === '/api/d5/test/interrupt' && method === 'POST') {
        const reply = await service.interrupt(userHash, await readBody(request));
        return json(reply, reply.status === 'exists' ? 409 : reply.status === 'budget' ? 409 : 200);
      }
      if (path === '/api/d5/test/upstream' && method === 'GET') {
        const runId = url.searchParams.get('run_id');
        if (typeof runId !== 'string' || !/^[\w-]{12,80}$/.test(runId)) fail('invalid_run_id', 400);
        return json(await service.upstream(userHash, runId));
      }
      return null;
    } catch (error) {
      throw mapError(error);
    }
  };
}
