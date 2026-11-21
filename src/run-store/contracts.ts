import type { RunEvent, ScoreResult } from '../contracts';
import type { MapSource } from '../fixture-port';
import type { GenerationResult, RoundData } from '../scenario-generation/contracts';

export interface RunProgress {
  node: number;
  furthest: number;
  started: boolean;
  finished: boolean;
  speed: number;
  elapsed_ms: number;
}

export type RunOrigin = Pick<GenerationResult, 'request' | 'selection' | 'provider' | 'fallback_reason' |
  'report_source' | 'calls' | 'shared_retry_used' | 'upstream_state' | 'reports'>;

export interface StoredRun {
  schema_version: 1;
  run_id: string;
  scenario_id: string;
  revision: number;
  created_at: string;
  updated_at: string;
  engine_version: 'd4-1';
  map_version: 'd2-1';
  bundle: RoundData;
  map: MapSource;
  origin: RunOrigin | null;
  progress: RunProgress;
  events: RunEvent[];
  score: ScoreResult | null;
}

export type RunStoreErrorCode = 'UNAVAILABLE' | 'CORRUPT' | 'VERSION' | 'CONFLICT';
export class RunStoreError extends Error {
  constructor(readonly code: RunStoreErrorCode, message: string) { super(message); }
}
