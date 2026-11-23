import { record } from '../src/scenario-generation/bundle.ts';
import { validateRun } from '../src/run-store/validation.ts';
import type { StoredRun } from '../src/run-store/contracts.ts';
import { createReviewService, summaryReply, type ReviewLedger, type ReviewProvider } from './review-service.ts';
import { readRunAccess } from './run-route.ts';

interface Options {
  enabled(): boolean;
  load(id: string, owner: string): Promise<StoredRun | null>;
  storeLocal?(run: StoredRun, owner: string): StoredRun | null;
  open(run: StoredRun, owner: string, create: boolean): Promise<{ ledger: ReviewLedger; provider?: ReviewProvider } | null>;
}

export function createReviewRoute(options: Options) {
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  return async (request: Request): Promise<Response> => {
    if (request.headers.get('sec-fetch-site') === 'cross-site') return json({ code: 'CROSS_ORIGIN' }, 403);
    if (request.method !== 'GET' && request.method !== 'POST') return json({ code: 'METHOD' }, 405);
    const access = await readRunAccess(request);
    if (!access) return json({ code: 'NOT_FOUND' }, 404);
    const { id, owner } = access;
    if (!options.enabled()) return json(summaryReply(id, 'not_configured'));
    try {
      let run = await options.load(id, owner);
      let requestId = new URL(request.url).searchParams.get('request_id') ?? undefined;
      let retry = false;
      if (request.method === 'POST') {
        if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ code: 'CONTENT_TYPE' }, 415);
        const reader = request.body?.pipeThrough(new TextDecoderStream()).getReader();
        if (!reader) return json({ code: 'REQUEST' }, 400);
        let text = '';
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            text += value;
            if (text.length > 1_000_000) { await reader.cancel(); return json({ code: 'TOO_LARGE' }, 413); }
          }
        } finally { reader.releaseLock(); }
        const input: unknown = JSON.parse(text);
        if (!record(input) || typeof input.request_id !== 'string' || !/^[\w-]{12,80}$/.test(input.request_id) ||
            (input.mode !== 'start' && input.mode !== 'retry')) return json({ code: 'REQUEST' }, 400);
        requestId = input.request_id;
        retry = input.mode === 'retry';
        if (input.run !== undefined && options.storeLocal) {
          const incoming = validateRun(input.run);
          if (incoming.run_id !== id || !incoming.progress.finished) return json({ code: 'REQUEST' }, 400);
          run = options.storeLocal(incoming, owner);
        }
      }
      if (requestId !== undefined && !/^[\w-]{12,80}$/.test(requestId)) return json({ code: 'REQUEST' }, 400);
      if (!run || !run.progress.finished) return json(summaryReply(id, 'not_synced', requestId ?? null, null, 'missing'), 404);
      if (!run.events.some(({ kind }) => kind === 'action')) return json(summaryReply(id, 'no_actions', requestId ?? null, null));
      const scope = await options.open(run, owner, request.method === 'POST');
      if (!scope) return json(summaryReply(id, 'origin_unverified', requestId ?? null));
      const service = createReviewService(scope.ledger, scope.provider);
      const reply = request.method === 'POST' ? await service.start(run, requestId!, retry ? 'retry' : 'review')
        : await service.recover(run, requestId);
      return json(reply, reply.status === 'pending' ? 202 : reply.status === 'missing' ? 404 : 200);
    } catch (error) {
      if (error instanceof SyntaxError) return json({ code: 'REQUEST' }, 400);
      return json(summaryReply(id, 'network'), 503);
    }
  };
}
