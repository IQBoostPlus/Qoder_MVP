import { GENERATION_WAIT_MS, type FallbackReason, type GenerationRequest, type GenerationResult, type Issue } from '../src/scenario-generation/contracts.ts';
import { assembleBundle, fallbackResult, parseCandidate, validateBundle, ValidationError } from '../src/scenario-generation/bundle.ts';
import { GenerationLedger, type BudgetSlot } from './generation-ledger.ts';
import { generateReports } from './report-stage.ts';
import { generationPrompt, ProviderError, type GenerationProvider } from './generation-provider.ts';

export type GenerationReply =
  | { status: 'ready'; result: GenerationResult }
  | { status: 'pending'; calls: number; upstream_state: GenerationResult['upstream_state'] }
  | { status: 'missing' };

export function createGenerationService(ledger: GenerationLedger, provider?: GenerationProvider, waitMs = GENERATION_WAIT_MS, enableReports = false) {
  function read(request: GenerationRequest): GenerationReply {
    if (!ledger.matches(request)) return { status: 'missing' };
    const result = ledger.result(request);
    return result ? { status: 'ready', result } : { status: 'pending', ...ledger.usage(request.run_id) };
  }

  async function generate(request: GenerationRequest): Promise<GenerationReply> {
    const started = performance.now();
    const claim = ledger.claim(request);
    if (claim === 'existing') return read(request);
    if (claim === 'conflict') return { status: 'ready', result: fallbackResult(request, 'conflict', 0, null) };
    const issues: Issue[] = [];
    const signal = AbortSignal.timeout(waitMs);
    function finish(result: GenerationResult): GenerationReply {
      const final = { ...result, ...ledger.usage(request.run_id), issues, elapsed_ms: Math.round(performance.now() - started) };
      ledger.save(final);
      return { status: 'ready', result: final };
    }
    const fallback = (reason: FallbackReason) => finish({
      ...fallbackResult(request, reason), provider: provider?.name ?? null,
    });
    if (!provider) return fallback('not_configured');

    const activeProvider = provider;
    // The shared deadline applies even if an injected client ignores abort; it can never trigger another send.
    function bounded<T>(work: () => Promise<T>): Promise<T> {
      signal.throwIfAborted();
      return new Promise((resolve, reject) => {
        const stop = () => reject(signal.reason);
        signal.addEventListener('abort', stop, { once: true });
        Promise.resolve().then(work).then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
      });
    }

    for (const slot of ['scenario', 'retry'] as const satisfies readonly BudgetSlot[]) {
      if (signal.aborted) return fallback('timeout');
      if (!ledger.reserve(request.run_id, slot)) return fallback('budget');
      try {
        const session = await bounded(() => activeProvider.prepare(request, signal));
        signal.throwIfAborted();
        const prompt = generationPrompt(request, issues.at(-1));
        if (!ledger.markSent(request.run_id, slot, session)) return fallback('budget');
        const raw = await bounded(() => activeProvider.send(session, prompt, signal));
        ledger.markComplete(request.run_id, slot);
        const candidate = parseCandidate(raw, request);
        const bundle = validateBundle(assembleBundle(request, candidate, 'generated'), request, 'generated');
        const generated: GenerationResult = {
          ...fallbackResult(request, null), bundle, provider: activeProvider.name,
          selection: 'generated', scenario_source: 'generated',
        };
        if (!enableReports) return finish(generated);
        const runId = request.run_id;
        return finish(await generateReports(generated, {
          reserve: (name) => ledger.reserve(runId, name),
          prepare: () => bounded(() => activeProvider.prepare(request, signal)),
          markSent: (name, sessionId) => ledger.markSent(runId, name, sessionId),
          send: (sessionId, text) => bounded(() => activeProvider.send(sessionId, text, signal)),
          complete: (name) => ledger.markComplete(runId, name),
          usage: () => ledger.usage(runId),
        }, signal));
      } catch (error) {
        if (signal.aborted) return fallback('timeout');
        if (error instanceof ValidationError) {
          issues.push(error.issue);
          if (slot === 'retry') return fallback('invalid_candidate');
          continue;
        }
        if (error instanceof ProviderError) {
          if (error.definitive) ledger.markComplete(request.run_id, slot);
          return fallback(error.reason);
        }
        return fallback('network');
      }
    }
    return fallback('invalid_candidate');
  }

  async function recover(request: GenerationRequest): Promise<GenerationReply> {
    const reply = read(request);
    if (!provider?.read || reply.status !== 'ready' || reply.result.upstream_state !== 'unknown' ||
        reply.result.provider !== provider.name) return reply;
    const previous = reply.result;
    const attempt = ledger.unresolved(request.run_id);
    if (!attempt || previous.report_source !== 'preset' || attempt.slot === 'reports') return reply;
    let raw: string | null;
    try { raw = await provider.read(attempt.session_id, AbortSignal.timeout(2500)); }
    catch { return reply; }
    if (!raw) return reply;

    const issues = [...previous.issues];
    let result: GenerationResult;
    ledger.markComplete(request.run_id, attempt.slot);
    try {
      const candidate = parseCandidate(raw, request);
      const bundle = validateBundle(assembleBundle(request, candidate, 'generated'), request, 'generated');
      result = { ...previous, ...ledger.usage(request.run_id), bundle, selection: 'generated', scenario_source: 'generated', fallback_reason: null };
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      issues.push(error.issue);
      result = { ...previous, ...ledger.usage(request.run_id), issues, fallback_reason: 'invalid_candidate' };
    }
    ledger.recover(previous, result);
    return read(request);
  }

  return { generate, recover };
}
