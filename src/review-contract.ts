export const REVIEW_WAIT_MS = 8_000;
export type ReviewSlot = 'review' | 'retry';
export type ReviewReason = 'pending' | 'timeout' | 'offline' | 'not_configured' | 'unauthorized' | 'not_synced'
  | 'no_actions' | 'invalid_output' | 'bad_reference' | 'fact_mismatch' | 'unsafe_text' | 'network'
  | 'budget' | 'conflict' | 'origin_unverified';
export interface ReviewItem { seq: number; text: string }
export interface ReviewReply {
  run_id: string;
  request_id: string | null;
  status: 'ready' | 'pending' | 'missing';
  source: 'ai' | 'simulated' | 'summary';
  items: ReviewItem[];
  reason: ReviewReason | null;
  calls: number | null;
  can_regenerate: boolean;
}
