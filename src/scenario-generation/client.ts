import { validateReportBatch } from './reports';
import { assembleBundle, fallbackResult, record, validateBundle, validateCandidate, validateRequest } from './bundle';
import { GENERATION_WAIT_MS, SESSION_LIMIT, type FallbackReason, type GenerationRequest, type GenerationResult, type Issue } from './contracts';
import { runAccessKey } from '../run-store/cloud';

const sessionKey = 'campus-drill-generation-v1';
const designatedRunKey = 'campus-drill-generation-test-run-v1';
const reasons: readonly FallbackReason[] = ['not_configured', 'unauthorized', 'network', 'timeout', 'invalid_candidate', 'budget', 'conflict'];
type SessionState = { count: number; pending: GenerationRequest | null };

export function nextGenerationRunId(storage: Storage): string {
  const designated = storage.getItem(designatedRunKey);
  return designated && /^[\w-]{12,80}$/.test(designated) ? designated : crypto.randomUUID();
}

export function readGenerationSession(storage: Storage): SessionState {
  const raw = storage.getItem(sessionKey);
  if (raw === null) return { count: 0, pending: null };
  const state: unknown = JSON.parse(raw);
  if (!record(state) || typeof state.count !== 'number' || !Number.isInteger(state.count) ||
      state.count < 0 || state.count > SESSION_LIMIT) throw new Error('Invalid generation session');
  return { count: state.count, pending: state.pending === null ? null : validateRequest(state.pending) };
}

export function reserveSessionGeneration(storage: Storage, request: GenerationRequest): SessionState | null {
  const state = readGenerationSession(storage);
  if (state.pending?.request_id === request.request_id) return state;
  if (state.count >= SESSION_LIMIT) return null;
  const next = { count: state.count + 1, pending: request };
  storage.setItem(sessionKey, JSON.stringify(next));
  return next;
}

export function completeSessionGeneration(storage: Storage, request: GenerationRequest): void {
  const state = readGenerationSession(storage);
  if (state.pending?.request_id === request.request_id) storage.setItem(sessionKey, JSON.stringify({ count: state.count, pending: null }));
}

function validateResponse(result: unknown, request: GenerationRequest): GenerationResult {
  if (!record(result) || JSON.stringify(validateRequest(result.request)) !== JSON.stringify(request)) throw new Error('Wrong response request');
  const { selection, scenario_source, report_source, provider, fallback_reason, elapsed_ms, calls, shared_retry_used, upstream_state } = result;
  const issues: unknown = result.issues;
  const reports = result.reports;
  function validIssue(issue: unknown): issue is Issue {
    return record(issue) && typeof issue.path === 'string' && issue.path.length <= 255 &&
      typeof issue.code === 'string' && issue.code.length <= 100 && typeof issue.message === 'string' && issue.message.length <= 255;
  }
  if ((selection !== 'generated' && selection !== 'fallback') ||
    (selection === 'generated' ? scenario_source !== 'generated' || fallback_reason !== null || provider === null
      : scenario_source !== 'fallback' || !reasons.some((reason) => reason === fallback_reason)) ||
    (scenario_source !== 'generated' && scenario_source !== 'fallback') ||
    (report_source !== 'preset' && report_source !== 'generated' && report_source !== 'fallback') || (provider !== null && provider !== 'simulated' && provider !== 'qoder') ||
    typeof elapsed_ms !== 'number' || !Number.isFinite(elapsed_ms) || elapsed_ms < 0 ||
    (calls !== null && (typeof calls !== 'number' || !Number.isInteger(calls) || calls < 0 || calls > 4)) ||
    (shared_retry_used !== null && typeof shared_retry_used !== 'boolean') ||
    (upstream_state !== 'complete' && upstream_state !== 'not_sent' && upstream_state !== 'unknown') ||
    !Array.isArray(issues) || issues.length > 2 || !issues.every(validIssue)) throw new Error('Invalid generation metadata');
  let bundle;
  let stage: GenerationResult['reports'];
  if (report_source === 'preset') {
    bundle = validateBundle(result.bundle, request, scenario_source);
    if (reports !== undefined) throw new Error('Unexpected report generation metadata');
  } else {
    if (selection !== 'generated' || !record(result.bundle) || !record(reports) ||
        reports.request_id !== request.request_id || reports.provider !== provider ||
        (report_source === 'generated' ? reports.fallback_reason !== null : !reasons.some((reason) => reason === reports.fallback_reason))) {
      throw new Error('Invalid report generation metadata');
    }
    if (report_source === 'fallback') bundle = validateBundle(result.bundle, request, scenario_source);
    else {
      const { ugc_reports, ...rest } = result.bundle;
      const preset = assembleBundle(request, validateCandidate(rest.candidate, request), scenario_source);
      bundle = validateBundle({ ...rest, ugc_reports: preset.ugc_reports }, request, scenario_source);
      bundle = { ...bundle, ugc_reports: validateReportBatch(ugc_reports, bundle.ugc_reports) };
    }
    stage = { request_id: request.request_id, provider, fallback_reason: reasons.find((reason) => reason === reports.fallback_reason) ?? null };
  }
  return {
    request, bundle, selection, scenario_source, reports: stage,
    report_source, provider, fallback_reason: reasons.find((reason) => reason === fallback_reason) ?? null,
    elapsed_ms, calls, shared_retry_used, upstream_state, issues,
  };
}

export async function requestScenario(
  request: GenerationRequest, recover: boolean, signal: AbortSignal, onValidation: () => void,
  fetchFn = fetch, waitMs = GENERATION_WAIT_MS,
): Promise<GenerationResult> {
  const before = performance.now();
  // Leave time to mount the fallback bundle within the user-facing deadline.
  const deadline = AbortSignal.timeout(waitMs === GENERATION_WAIT_MS ? waitMs - 150 : waitMs);
  const active = AbortSignal.any([signal, deadline]);
  const query = new URLSearchParams({ run_id: request.run_id, request_id: request.request_id, template_id: request.template_id });
  for (const modifier of request.modifiers) query.append('modifiers', modifier);
  const configured = import.meta.env?.VITE_D5_SCENARIO_PATH;
  const url = typeof configured === 'string' && /^\/(?!\/)[\w/-]+$/.test(configured) ? configured : '/api/d5/scenario';
  try {
    const headers: Record<string, string> = typeof localStorage === 'undefined' ? {} : { 'X-Run-Key': runAccessKey(request.run_id) };
    const read = () => fetchFn(url + '?' + query.toString(), { signal: active, cache: 'no-store', redirect: 'error', headers });
    let response = recover ? await read() : await fetchFn(url, {
      method: 'POST', signal: active, redirect: 'error', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(request),
    });
    while (response.status === 202) {
      await response.body?.cancel();
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
      active.throwIfAborted();
      response = await read();
    }
    if (!response.ok) {
      const reason = response.status === 401 || response.status === 403 ? 'unauthorized'
        : response.status === 429 ? 'budget' : response.status === 404 && !recover ? 'not_configured' : 'network';
      return fallbackResult(request, reason, Math.round(performance.now() - before), recover || reason === 'network' ? null : 0);
    }
    if (!response.headers.get('content-type')?.includes('application/json')) {
      return fallbackResult(request, 'not_configured', Math.round(performance.now() - before), recover ? null : 0);
    }
    onValidation();
    try {
      const data: unknown = await response.json();
      active.throwIfAborted();
      if (!record(data) || data.status !== 'ready') throw new Error('Invalid response');
      const result = validateResponse(data.result, request);
      return { ...result, elapsed_ms: Math.round(performance.now() - before) };
    } catch {
      active.throwIfAborted();
      return fallbackResult(request, 'invalid_candidate', Math.round(performance.now() - before), null);
    }
  } catch {
    return fallbackResult(request, deadline.aborted ? 'timeout' : 'network', Math.round(performance.now() - before), null);
  }
}
