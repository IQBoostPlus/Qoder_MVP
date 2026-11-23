import { REVIEW_WAIT_MS, type ReviewReason, type ReviewReply } from './review-contract';
import { runAccessKey } from './run-store/cloud';
import type { StoredRun } from './run-store/contracts';

export function reviewPath(): string | null {
  const path = import.meta.env?.VITE_D7_REVIEW_PATH;
  return path === '/api/d7/review' || path === '/functions/v1/app/api/d7/review' ? path : null;
}

export function localReview(run_id: string, reason: ReviewReason, request_id: string | null = null, pending = false): ReviewReply {
  return { run_id, request_id, status: pending ? 'pending' : 'ready', source: 'summary', items: [], reason, calls: null, can_regenerate: false };
}

type Timer = { schedule: (task: () => void, ms: number) => unknown; cancel: (ticket: unknown) => void };
export function createReviewClient(transport: (action: 'read' | 'start' | 'retry', run: StoredRun, requestId: string | null) => Promise<ReviewReply>,
  publish: (reply: ReviewReply) => void, timer: Timer = {
    schedule: (task, ms) => setTimeout(task, ms), cancel: (ticket) => clearTimeout(ticket as ReturnType<typeof setTimeout>),
  }) {
  let turn = 0;
  async function execute(action: 'read' | 'start' | 'retry', run: StoredRun, requestId: string | null): Promise<void> {
    const ticket = ++turn;
    let expired = false;
    let recovered = false;
    let ready = false;
    const matches = (reply: ReviewReply) => ticket === turn && reply.run_id === run.run_id &&
      (!requestId || reply.request_id === requestId || (action === 'retry' && reply.status === 'pending'));
    if (action !== 'read') publish(localReview(run.run_id, 'pending', requestId, true));
    const deadline = timer.schedule(() => {
      if (ticket !== turn) return;
      expired = true;
      publish(localReview(run.run_id, 'timeout', requestId, true));
      if (action !== 'read') {
        void transport('read', run, requestId).then((reply) => {
          if (ready || !matches(reply) || reply.status === 'missing') return;
          recovered = reply.status === 'ready';
          publish(recovered ? reply : { ...reply, reason: 'timeout' });
        }).catch(() => {});
      }
    }, REVIEW_WAIT_MS);
    try {
      const reply = await transport(action, run, requestId);
      if (!recovered && matches(reply)) {
        ready = reply.status === 'ready';
        publish(expired && reply.status === 'pending' ? { ...reply, reason: 'timeout' } : reply);
      }
    } catch {
      if (!recovered && ticket === turn) publish(localReview(run.run_id, 'offline', requestId));
    } finally { timer.cancel(deadline); }
  }
  return { execute, detach: () => { turn++; } };
}

export async function requestReview(path: string, action: 'read' | 'start' | 'retry', run: StoredRun, requestId: string | null): Promise<ReviewReply> {
  const url = path + '?' + new URLSearchParams({ run_id: run.run_id, ...(action === 'read' && requestId ? { request_id: requestId } : {}) });
  const headers = { 'X-Run-Key': runAccessKey(run.run_id), 'Content-Type': 'application/json' };
  const reply = await fetch(url, action === 'read' ? { headers, cache: 'no-store', signal: AbortSignal.timeout(5000) }
    : { method: 'POST', headers, body: JSON.stringify({ mode: action, request_id: requestId, ...(path === '/api/d7/review' ? { run } : {}) }),
      signal: AbortSignal.timeout(20_000) });
  if (reply.status === 401 || reply.status === 403) return localReview(run.run_id, 'unauthorized', requestId);
  if (![200, 202, 404].includes(reply.status)) return localReview(run.run_id, 'network', requestId);
  const value = await reply.json() as ReviewReply;
  return Array.isArray(value.items) ? { ...value, request_id: value.request_id ?? requestId } : localReview(run.run_id, 'not_synced', requestId);
}
