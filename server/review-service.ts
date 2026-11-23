import type { StoredRun } from '../src/run-store/contracts.ts';
import type { GenerationRequest, GenerationResult } from '../src/scenario-generation/contracts.ts';
import { stable } from '../src/run-store/validation.ts';
import type { ReviewItem, ReviewReason, ReviewReply, ReviewSlot } from '../src/review-contract.ts';
import { parseReview, reviewFacts, reviewPrompt } from './review-facts.ts';

type Maybe<T> = T | Promise<T>;
export type Intent = { run_id: string; request_id: string };
export type Outcome = { source: ReviewReply['source']; items: ReviewItem[]; reason: ReviewReason | null };
export interface ReviewLedger {
  claimReview(slot: ReviewSlot, intent: Intent): Maybe<boolean>;
  readReview(slot: ReviewSlot): Maybe<{ intent: Intent; outcome: Outcome | null } | null>;
  saveReview(slot: ReviewSlot, outcome: Outcome): Maybe<void>;
  reserve(slot: ReviewSlot): Maybe<boolean>;
  markSent(slot: ReviewSlot, session: string): Maybe<boolean>;
  markComplete(slot: ReviewSlot): Maybe<void>;
  reviewSession(slot: ReviewSlot): Maybe<string | null>;
  usage(): Maybe<{ calls: number; shared_retry_used: boolean }>;
}
export interface ReviewProvider {
  name: 'simulated' | 'qoder';
  prepare(intent: Intent, signal: AbortSignal): Promise<string>;
  send(session: string, prompt: string, signal: AbortSignal): Promise<string>;
  read?(session: string, signal: AbortSignal): Promise<string | null>;
}

const summary = (reason: ReviewReason): Outcome => ({ source: 'summary', items: [], reason });
export function summaryReply(run_id: string, reason: ReviewReason, request_id: string | null = null, calls: number | null = null, status: ReviewReply['status'] = 'ready'): ReviewReply {
  return { run_id, request_id, status, ...summary(reason), calls, can_regenerate: false };
}

export function reviewOriginMatches(run: StoredRun, result: GenerationResult): boolean {
  const { bundle, origin } = run;
  if (!origin || !result.bundle) return false;
  return origin.selection === result.selection && origin.provider === result.provider && origin.report_source === result.report_source &&
    stable(origin.request) === stable(result.request) &&
    stable({ ...bundle.scenario, id: result.bundle.scenario.id }) === stable(result.bundle.scenario) &&
    stable(bundle.ugc_reports) === stable(result.bundle.ugc_reports) && stable(bundle.action_catalog) === stable(result.bundle.action_catalog);
}

export function usesGenerationBudget(run: StoredRun): boolean {
  return run.bundle.scenario.source === 'generated' || Boolean(run.origin && run.origin.selection !== 'preset');
}

export async function presetReviewRoot(runId: string): Promise<GenerationRequest> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('d7-preset:' + runId));
  const id = 'review_' + Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return { run_id: id, request_id: id, template_id: 'TPL-NIGHT-DORM-01', modifiers: [] };
}

export function createReviewService(ledger: ReviewLedger, provider?: ReviewProvider, waitMs = 14_500) {
  async function read(run: StoredRun, requestId?: string): Promise<ReviewReply> {
    const [first, retry, usage] = await Promise.all([ledger.readReview('review'), ledger.readReview('retry'), ledger.usage()]);
    const attempt = [retry, first].find((value) => value?.intent.run_id === run.run_id && (!requestId || value.intent.request_id === requestId));
    if (!attempt) return summaryReply(run.run_id, 'pending', requestId ?? null, usage.calls, 'missing');
    if (!attempt.outcome) return summaryReply(run.run_id, 'pending', attempt.intent.request_id, usage.calls, 'pending');
    return { ...attempt.intent, status: 'ready', ...attempt.outcome, calls: usage.calls,
      can_regenerate: Boolean(provider && attempt === first && !retry && !usage.shared_retry_used && usage.calls < 4) };
  }

  async function settle(run: StoredRun, slot: ReviewSlot, raw: string): Promise<void> {
    const parsed = parseReview(raw, reviewFacts(run));
    await ledger.markComplete(slot);
    await ledger.saveReview(slot, typeof parsed === 'string' ? summary(parsed)
      : { source: provider?.name === 'qoder' ? 'ai' : 'simulated', items: parsed, reason: null });
  }

  async function start(run: StoredRun, requestId: string, slot: ReviewSlot): Promise<ReviewReply> {
    const existing = await ledger.readReview(slot);
    if (existing?.intent.run_id === run.run_id && existing.intent.request_id === requestId) return read(run, requestId);
    const usage = await ledger.usage();
    if (existing) return summaryReply(run.run_id, existing.intent.run_id === run.run_id ? 'conflict' : 'budget', requestId, usage.calls);
    if (!provider) return summaryReply(run.run_id, 'not_configured', requestId, usage.calls);
    const input = reviewFacts(run);
    if (!input.facts.length) return summaryReply(run.run_id, 'no_actions', requestId, usage.calls);
    if (slot === 'retry') {
      const first = await ledger.readReview('review');
      if (first?.intent.run_id !== run.run_id || first.intent.request_id === requestId) return summaryReply(run.run_id, 'conflict', requestId, usage.calls);
      if (!first.outcome) return summaryReply(run.run_id, 'pending', first.intent.request_id, usage.calls, 'pending');
    }
    if (usage.calls >= 4 || (slot === 'retry' && usage.shared_retry_used)) return summaryReply(run.run_id, 'budget', requestId, usage.calls);
    const intent = { run_id: run.run_id, request_id: requestId };
    if (!await ledger.claimReview(slot, intent)) {
      const reply = await read(run, requestId);
      return reply.status === 'missing' ? summaryReply(run.run_id, 'conflict', requestId, reply.calls) : reply;
    }
    if (!await ledger.reserve(slot)) {
      await ledger.saveReview(slot, summary('budget'));
      return read(run, requestId);
    }
    const signal = AbortSignal.timeout(waitMs);
    let sent = false;
    try {
      const session = await provider.prepare(intent, signal);
      signal.throwIfAborted();
      if (!await ledger.markSent(slot, session)) return read(run, requestId);
      sent = true;
      const raw = await provider.send(session, reviewPrompt(input), signal);
      await settle(run, slot, raw);
    } catch (error) {
      const definitive = typeof error === 'object' && error !== null && 'definitive' in error && error.definitive === true;
      if (sent && !definitive) return read(run, requestId);
      if (sent) await ledger.markComplete(slot);
      await ledger.saveReview(slot, summary(signal.aborted ? 'timeout' : 'network'));
    }
    return read(run, requestId);
  }

  async function recover(run: StoredRun, requestId?: string): Promise<ReviewReply> {
    const reply = await read(run, requestId);
    if (reply.status !== 'pending' || !provider?.read || !reply.request_id) return reply;
    const retry = await ledger.readReview('retry');
    const slot = retry?.intent.request_id === reply.request_id && retry.intent.run_id === run.run_id ? 'retry' : 'review';
    const session = await ledger.reviewSession(slot);
    if (!session) return reply;
    let raw: string | null;
    try { raw = await provider.read(session, AbortSignal.timeout(2500)); } catch { return reply; }
    if (!raw) return reply;
    await settle(run, slot, raw);
    return read(run, requestId);
  }
  return { start, recover };
}
