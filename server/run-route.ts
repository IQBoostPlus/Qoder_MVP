import { record } from '../src/scenario-generation/bundle.ts';
import { assertRunUpdate, stable, validateRun } from '../src/run-store/validation.ts';
import { RunStoreError, type StoredRun } from '../src/run-store/contracts.ts';
import { createRunRepository, type RunDatabase } from './run-repository.ts';

export type { RunDatabase } from './run-repository.ts';

export async function readRunAccess(request: Request): Promise<{ id: string; owner: string } | null> {
  const key = request.headers.get('x-run-key');
  const id = new URL(request.url).searchParams.get('run_id');
  if (!key || !/^[a-f0-9]{64}$/.test(key) || !id || !/^[\w-]{12,80}$/.test(id)) return null;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return { id, owner: Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('') };
}

export function createRunRoute(db: RunDatabase | null, enabled: () => boolean) {
  const repository = db ? createRunRepository(db) : null;
  const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
  return async function handle(request: Request): Promise<Response> {
    if (!enabled() || !repository) return json({ code: 'CLOUD_UNAVAILABLE' }, 503);
    if (request.headers.get('sec-fetch-site') === 'cross-site') return json({ code: 'CROSS_ORIGIN' }, 403);
    if (request.method !== 'GET' && request.method !== 'PUT') return json({ code: 'METHOD' }, 405);
    const access = await readRunAccess(request);
    if (!access) return json({ code: 'NOT_FOUND' }, 404);
    const { id, owner } = access;
    try {
      const stored: StoredRun | null = await repository.read(id, owner);
      if (request.method === 'GET') return stored ? json({ run: stored }) : json({ code: 'NOT_FOUND' }, 404);
      if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ code: 'CONTENT_TYPE' }, 415);
      const stream = request.body?.pipeThrough(new TextDecoderStream());
      if (!stream) return json({ code: 'REQUEST' }, 400);
      let body = '';
      const reader = stream.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          body += value;
          if (body.length > 1_000_000) { await reader.cancel(); return json({ code: 'TOO_LARGE' }, 413); }
        }
      } finally { reader.releaseLock(); }
      const input: unknown = JSON.parse(body);
      if (!record(input) || typeof input.expected_revision !== 'number' || !Number.isSafeInteger(input.expected_revision) ||
        input.expected_revision < 0) return json({ code: 'REQUEST' }, 400);
      const incoming = validateRun(input.run);
      if (incoming.run_id !== id) return json({ code: 'REQUEST' }, 400);
      if (stored && stable(incoming) === stable(stored)) return json({ revision: stored.revision });
      if (!stored) {
        if (input.expected_revision !== 0) return json({ code: 'CONFLICT' }, 409);
      } else {
        if (input.expected_revision !== stored.revision || incoming.revision <= stored.revision) return json({ code: 'CONFLICT' }, 409);
        assertRunUpdate(stored, { ...incoming, revision: stored.revision + 1 });
      }
      const write = await repository.save(incoming, owner, input.expected_revision);
      if (write === 'conflict') return json({ code: 'CONFLICT' }, 409);
      if (write === 'missing') return json({ code: 'NOT_FOUND' }, 404);
      return json({ revision: incoming.revision });
    } catch (error) {
      if (error instanceof SyntaxError) return json({ code: 'REQUEST' }, 400);
      if (error instanceof RunStoreError) return json({ code: error.code }, error.code === 'CONFLICT' ? 409 : 422);
      return json({ code: 'CLOUD_UNAVAILABLE' }, 503);
    }
  };
}
