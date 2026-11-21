// Same-origin D5 routes for the private verification site.
import { ValidationError } from './d5-bundle.mjs';
import { ProviderError, createD5Service } from './d5-service.mjs';

const encoder = new TextEncoder();

async function digest(value) {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function envEnabled(name) {
  try {
    return globalThis.Deno?.env.get(name) === '1';
  } catch {
    return false;
  }
}

export function createD5Routes({ db, storage, BackendError }) {
  const service = createD5Service({ db, storage });

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
    const userHash = await digest(user.user_id);
    const method = request.method;

    try {
      const enabled = envEnabled('D5_ENABLE_QODER');
      if (path.startsWith('/api/d5/test/')) {
        if (!enabled || !envEnabled('D5_ENABLE_TEST_ROUTES')) fail('d5_test_routes_disabled', 404);
        if (request.headers.get('x-d5-test') !== '1') fail('test_header_required', 403);
      }
      if (path === '/api/d5/scenario' && (method === 'POST' || method === 'GET')) {
        const input = method === 'POST' ? await readBody(request) : query(url);
        const reply = !enabled ? await service.disabled(userHash, input, method)
          : method === 'GET' ? await service.recover(userHash, input) : await service.generate(userHash, input, envEnabled('D6_ENABLE_REPORTS'));
        return json(reply, reply.status === 'pending' ? 202 : reply.status === 'missing' ? 404 : 200);
      }
      if (path === '/api/d5/diag' && method === 'GET') {
        return enabled
          ? json({ ...await service.diag(), real_generation_enabled: true })
          : json({ configured: false, ledger: 'database', real_generation_enabled: false, instance: service.instance });
      }
      if (path === '/api/d5/instance' && method === 'GET') {
        return json({ instance: service.instance, request_id: ctx.requestId ?? null, at: new Date().toISOString() });
      }
      if (path === '/api/d5/warm' && method === 'POST') {
        if (!enabled) fail('d5_generation_disabled', 503);
        return json(await service.warm(userHash));
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
