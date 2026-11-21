import type { CanonicalFixture, Scenario, ScenarioModifiers } from '../contracts';

export type RoundData = Pick<CanonicalFixture, 'scenario' | 'ugc_reports' | 'action_catalog'>;
export type TemplateId = 'TPL-NIGHT-DORM-01' | 'TPL-LAB-LEAK-01' | 'TPL-GYM-CROWD-01';
export type Modifier = keyof ScenarioModifiers;
export interface GenerationRequest {
  run_id: string;
  request_id: string;
  template_id: TemplateId;
  modifiers: Modifier[];
}
export interface Candidate {
  start_building_id: string;
  road_id: string;
  first_report_at: number;
  confirmed_at: number;
  escalation_at: number;
  t_end: number;
  perspective: 'witness' | 'staff';
}
export type FallbackReason = 'not_configured' | 'unauthorized' | 'network' | 'timeout' | 'invalid_candidate' | 'budget' | 'conflict';
export interface Issue { path: string; code: string; message: string }
export interface ScenarioBundle extends RoundData {
  candidate: Candidate;
}
export interface GenerationResult {
  request: GenerationRequest;
  bundle: ScenarioBundle;
  selection: 'preset' | 'generated' | 'fallback';
  report_source: 'preset' | 'generated' | 'fallback';
  reports?: { request_id: string; provider: 'qoder' | 'simulated' | null; fallback_reason: FallbackReason | null };
  provider: 'qoder' | 'simulated' | null;
  fallback_reason: FallbackReason | null;
  scenario_source: Scenario['source'];
  elapsed_ms: number;
  calls: number | null;
  shared_retry_used: boolean | null;
  upstream_state: 'not_sent' | 'complete' | 'unknown';
  issues: Issue[];
}
export const GENERATION_WAIT_MS = 15_000;
export const SESSION_LIMIT = 3;
export const ROUND_LIMIT = 4;
