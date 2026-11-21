import { parseReportBatch, reportsPrompt } from '../src/scenario-generation/reports.ts';
import { ValidationError } from '../src/scenario-generation/bundle.ts';
import type { FallbackReason, GenerationResult } from '../src/scenario-generation/contracts.ts';

export type ReportsSlot = 'reports' | 'retry';
export interface ReportStageIO {
  reserve(slot: ReportsSlot): boolean | Promise<boolean>;
  prepare(): Promise<string>;
  markSent(slot: ReportsSlot, session: string): boolean | Promise<boolean>;
  send(session: string, prompt: string): Promise<string>;
  complete(slot: ReportsSlot): void | Promise<void>;
  usage(): Pick<GenerationResult, 'calls' | 'shared_retry_used' | 'upstream_state'> | Promise<Pick<GenerationResult, 'calls' | 'shared_retry_used' | 'upstream_state'>>;
}

// Called only by the owner of the scenario request, within the original deadline.
export async function generateReports(
  scenario: GenerationResult, io: ReportStageIO, signal: AbortSignal,
): Promise<GenerationResult> {
  if (scenario.selection !== 'generated' || scenario.provider === null) return scenario;
  const provider = scenario.provider;
  const correlation = { request_id: scenario.request.request_id, provider };
  const preset = scenario.bundle.ugc_reports;
  async function fallback(reason: FallbackReason): Promise<GenerationResult> {
    const usage = await Promise.resolve().then(() => io.usage()).catch(() => ({
      calls: null, shared_retry_used: null, upstream_state: 'unknown' as const,
    }));
    return { ...scenario, ...usage, report_source: 'fallback', reports: { ...correlation, fallback_reason: reason } };
  }
  let lastIssue: { code: string; path: string } | undefined;
  for (const slot of ['reports', 'retry'] as const) {
    try {
      if (signal.aborted || (await io.usage()).upstream_state === 'unknown') return fallback('timeout');
      if (!await io.reserve(slot)) return fallback(lastIssue ? 'invalid_candidate' : 'budget');
      const session = await io.prepare();
      if (signal.aborted) return fallback('timeout');
      if (!await io.markSent(slot, session)) return fallback('budget');
      const candidate = await io.send(session, reportsPrompt(preset, lastIssue));
      await io.complete(slot);
      const reports = parseReportBatch(candidate, preset);
      return { ...scenario, ...await io.usage(), bundle: { ...scenario.bundle, ugc_reports: reports },
        report_source: 'generated', reports: { ...correlation, fallback_reason: null } };
    } catch (error) {
      if (signal.aborted) return fallback('timeout');
      if (error instanceof ValidationError) { lastIssue = error.issue; continue; }
      if (typeof error === 'object' && error !== null && 'definitive' in error && error.definitive === true) {
        try { await io.complete(slot); } catch { return fallback('network'); }
      }
      return fallback(typeof error === 'object' && error !== null && 'reason' in error && error.reason === 'unauthorized' ? 'unauthorized' : 'network');
    }
  }
  return fallback('invalid_candidate');
}
