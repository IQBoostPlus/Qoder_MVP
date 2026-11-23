import { DatabaseSync } from 'node:sqlite';
import type { GenerationRequest, GenerationResult } from '../src/scenario-generation/contracts';
import type { StoredRun } from '../src/run-store/contracts';
import type { Intent, Outcome, ReviewLedger } from './review-service.ts';

export type BudgetSlot = 'scenario' | 'reports' | 'review' | 'retry';
type SlotState = 'reserved' | 'sent' | 'complete';
interface Slot { state: SlotState; session_id: string | null }
interface LedgerRow { request: string; result: string | null }

export class GenerationLedger {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA busy_timeout=2000;
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS generation_requests (
        run_id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL,
        request TEXT NOT NULL, result TEXT
      );
      CREATE TABLE IF NOT EXISTS generation_slots (
        run_id TEXT NOT NULL REFERENCES generation_requests(run_id),
        slot TEXT NOT NULL CHECK (slot IN ('scenario','reports','review','retry')),
        state TEXT NOT NULL CHECK (state IN ('reserved','sent','complete')),
        session_id TEXT, PRIMARY KEY (run_id, slot)
      );
      CREATE TABLE IF NOT EXISTS generation_review_records (
        run_id TEXT NOT NULL REFERENCES generation_requests(run_id),
        kind TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (run_id, kind)
      );
      CREATE TABLE IF NOT EXISTS generation_review_runs (
        run_id TEXT PRIMARY KEY, owner TEXT NOT NULL, snapshot TEXT NOT NULL
      );
    `);
  }

  claim(request: GenerationRequest): 'new' | 'existing' | 'conflict' {
    const result = this.db.prepare('INSERT OR IGNORE INTO generation_requests VALUES (?, ?, ?, NULL)')
      .run(request.run_id, request.request_id, JSON.stringify(request));
    if (result.changes === 1) return 'new';
    return this.matches(request) ? 'existing' : 'conflict';
  }

  private lookup(runId: string, requestId: string): LedgerRow | undefined {
    return this.db.prepare('SELECT request, result FROM generation_requests WHERE run_id=? AND request_id=?').get(runId, requestId) as LedgerRow | undefined;
  }

  matches(request: GenerationRequest): boolean {
    return this.lookup(request.run_id, request.request_id)?.request === JSON.stringify(request);
  }

  result(request: GenerationRequest): GenerationResult | null {
    const row = this.lookup(request.run_id, request.request_id);
    return row?.result ? JSON.parse(row.result) as GenerationResult : null;
  }

  reserve(runId: string, slot: BudgetSlot): boolean {
    return this.db.prepare('INSERT OR IGNORE INTO generation_slots VALUES (?, ?, ?, NULL)')
      .run(runId, slot, 'reserved').changes === 1;
  }

  markSent(runId: string, slot: BudgetSlot, sessionId: string): boolean {
    return this.db.prepare('UPDATE generation_slots SET state=?, session_id=? WHERE run_id=? AND slot=? AND state=?')
      .run('sent', sessionId, runId, slot, 'reserved').changes === 1;
  }

  markComplete(runId: string, slot: BudgetSlot): void {
    this.db.prepare('UPDATE generation_slots SET state=? WHERE run_id=? AND slot=? AND state=?')
      .run('complete', runId, slot, 'sent');
  }

  usage(runId: string) {
    const rows = this.db.prepare('SELECT slot, state, session_id FROM generation_slots WHERE run_id=? ORDER BY rowid').all(runId) as
      unknown as Array<Slot & { slot: BudgetSlot }>;
    return {
      calls: rows.filter((row) => row.state !== 'reserved').length,
      shared_retry_used: rows.some((row) => row.slot === 'retry'),
      upstream_state: rows.some((row) => row.state === 'sent') ? 'unknown' as const
        : rows.some((row) => row.state === 'complete') ? 'complete' as const : 'not_sent' as const,
    };
  }

  unresolved(runId: string): { slot: BudgetSlot; session_id: string } | undefined {
    return this.db.prepare(`SELECT slot, session_id FROM generation_slots AS slots
      WHERE run_id=? AND state='sent' AND session_id IS NOT NULL AND slot<>'review'
      AND NOT EXISTS (SELECT 1 FROM generation_review_records AS reviews WHERE reviews.run_id=slots.run_id AND reviews.kind=slots.slot || ':sent')
      ORDER BY rowid DESC LIMIT 1`)
      .get(runId) as { slot: BudgetSlot; session_id: string } | undefined;
  }

  save(result: GenerationResult): void {
    this.db.prepare('UPDATE generation_requests SET result=? WHERE run_id=? AND request_id=? AND result IS NULL')
      .run(JSON.stringify(result), result.request.run_id, result.request.request_id);
  }

  recover(previous: GenerationResult, result: GenerationResult): void {
    this.db.prepare('UPDATE generation_requests SET result=? WHERE run_id=? AND request_id=? AND result=?')
      .run(JSON.stringify(result), result.request.run_id, result.request.request_id, JSON.stringify(previous));
  }

  reviewRun(id: string, owner: string): StoredRun | null {
    const row = this.db.prepare('SELECT snapshot FROM generation_review_runs WHERE run_id=? AND owner=?').get(id, owner);
    return row ? JSON.parse(String(row.snapshot)) as StoredRun : null;
  }

  storeReviewRun(run: StoredRun, owner: string): StoredRun | null {
    this.db.prepare('INSERT OR IGNORE INTO generation_review_runs VALUES (?, ?, ?)').run(run.run_id, owner, JSON.stringify(run));
    return this.reviewRun(run.run_id, owner);
  }

  reviewLedger(runId: string): ReviewLedger {
    const read = <T>(kind: string): T | null => {
      const row = this.db.prepare('SELECT payload FROM generation_review_records WHERE run_id=? AND kind=?').get(runId, kind);
      return row ? JSON.parse(String(row.payload)) as T : null;
    };
    const insert = (kind: string, payload: unknown) => this.db.prepare('INSERT OR IGNORE INTO generation_review_records VALUES (?, ?, ?)')
      .run(runId, kind, JSON.stringify(payload)).changes === 1;
    return {
      claimReview: (slot, intent) => insert(`${slot}:intent`, intent),
      readReview: (slot) => {
        const intent = read<Intent>(`${slot}:intent`);
        return intent ? { intent, outcome: read<Outcome>(`${slot}:result`) } : null;
      },
      saveReview: (slot, outcome) => { insert(`${slot}:result`, outcome); },
      reserve: (slot) => this.reserve(runId, slot),
      markSent: (slot, session) => {
        this.db.exec('BEGIN IMMEDIATE');
        try {
          const sent = this.markSent(runId, slot, session);
          if (sent) insert(`${slot}:sent`, session);
          this.db.exec('COMMIT');
          return sent;
        } catch (error) { this.db.exec('ROLLBACK'); throw error; }
      },
      markComplete: (slot) => this.markComplete(runId, slot),
      reviewSession: (slot) => read<string>(`${slot}:sent`),
      usage: () => this.usage(runId),
    };
  }

  close(): void { this.db.close(); }
}
