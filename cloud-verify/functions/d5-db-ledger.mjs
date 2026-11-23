// Database-backed D5 ledger. Coordination uses append-only rows whose
// primary keys make the first writer the only writer; Storage remains the
// read-only fallback for runs recorded before this ledger existed.
import { createStorageLedger } from './d5-ledger.mjs';

const SLOTS = ['scenario', 'reports', 'review', 'retry'];
const RUNS = 'd5_generation_runs';
const SLOT_ROWS = 'd5_generation_slots';
const RESULT_ROWS = 'd5_generation_results';

function canonical(value) {
  return JSON.stringify(value);
}

export function createDatabaseLedger({ db, storage, userHash, runId, now = () => new Date().toISOString(), legacy }) {
  if (!db) throw new Error('database_not_configured');
  if (!storage) throw new Error('storage_not_configured');
  if (typeof userHash !== 'string' || !/^[0-9a-f]{64}$/.test(userHash)) throw new Error('invalid_user_hash');
  if (typeof runId !== 'string' || !/^[\w-]{12,80}$/.test(runId)) throw new Error('invalid_run_id');

  const base = { user_hash: userHash, run_id: runId };
  const legacyLedger = legacy ?? createStorageLedger({ storage, userHash, runId, now });

  async function rows(table, columns) {
    const result = await db.from(table).select(columns).eq('user_hash', userHash).eq('run_id', runId).limit(200);
    if (result?.error) throw new Error('database_read_failed');
    return Array.isArray(result?.data) ? result.data : [];
  }

  async function insertOnce(table, row, exists) {
    try {
      const result = await db.from(table).insert({ ...base, created_at: now(), ...row });
      if (!result?.error) return true;
    } catch (error) {
      if (await exists()) return false;
      throw error;
    }
    return false;
  }

  async function readRun() {
    const [run] = await rows(RUNS, 'request_json');
    return run ?? null;
  }

  async function runExists() {
    return (await rows(RUNS, 'run_id')).length > 0;
  }

  async function readLegacyRequest() {
    return legacyLedger.readRequest();
  }

  async function claim(request) {
    const wanted = canonical(request);
    const legacyRequest = await readLegacyRequest();
    if (legacyRequest) return canonical(legacyRequest) === wanted ? 'existing' : 'conflict';
    const created = await insertOnce(RUNS, { request_json: wanted }, async () => (await readRun()) !== null);
    if (created) return 'new';
    const run = await readRun();
    if (run) return run.request_json === wanted ? 'existing' : 'conflict';
    throw new Error('database_write_failed');
  }

  async function matches(request) {
    const wanted = canonical(request);
    const run = await readRun();
    if (run) return run.request_json === wanted;
    const legacyRequest = await readLegacyRequest();
    return legacyRequest ? canonical(legacyRequest) === wanted : false;
  }

  function summarize(slotRows) {
    const bySlot = new Map();
    for (const row of slotRows) {
      if (!bySlot.has(row.slot)) bySlot.set(row.slot, {});
      bySlot.get(row.slot)[row.event] = row;
    }
    return bySlot;
  }

  async function usage({ completing } = {}) {
    if (!(await runExists())) return legacyLedger.usage({ completing });
    const bySlot = summarize(await rows(SLOT_ROWS, 'slot,event,session_id'));
    const states = SLOTS.map((slot) => {
      const events = bySlot.get(slot) ?? {};
      return { slot, reserve: events.reserved ?? null, sent: events.sent ?? null, complete: events.complete ?? (slot === completing && events.sent ? true : null) };
    });
    return {
      calls: states.filter((state) => state.sent || state.complete).length,
      shared_retry_used: Boolean(bySlot.get('retry')?.reserved),
      upstream_state: states.some((state) => state.sent && !state.complete) ? 'unknown'
        : states.some((state) => state.complete) ? 'complete' : 'not_sent',
    };
  }

  async function unresolved() {
    if (!(await runExists())) return legacyLedger.unresolved();
    const bySlot = summarize(await rows(SLOT_ROWS, 'slot,event,session_id,created_at,meta'));
    for (const slot of [...SLOTS].reverse()) {
      const events = bySlot.get(slot) ?? {};
      if (slot === 'review' || JSON.parse(events.sent?.meta ?? '{}')?.phase === 'd7') continue;
      if (events.sent && !events.complete && typeof events.sent.session_id === 'string') {
        return { slot, session_id: events.sent.session_id, sent_at: events.sent.created_at ?? null };
      }
    }
    return null;
  }

  async function reserve(slot) {
    return insertOnce(SLOT_ROWS, { slot, event: 'reserved' }, async () => {
      const bySlot = summarize(await rows(SLOT_ROWS, 'slot,event'));
      return Boolean(bySlot.get(slot)?.reserved);
    });
  }

  async function markSent(slot, sessionId, extra = {}) {
    return insertOnce(SLOT_ROWS, { slot, event: 'sent', session_id: sessionId, meta: canonical(extra) }, async () => {
      const bySlot = summarize(await rows(SLOT_ROWS, 'slot,event'));
      return Boolean(bySlot.get(slot)?.sent);
    });
  }

  async function markComplete(slot) {
    return insertOnce(SLOT_ROWS, { slot, event: 'complete' }, async () => {
      const bySlot = summarize(await rows(SLOT_ROWS, 'slot,event'));
      return Boolean(bySlot.get(slot)?.complete);
    });
  }

  async function readResult() {
    const stored = await rows(RESULT_ROWS, 'kind,payload');
    const final = stored.find((row) => row.kind === 'final');
    if (final) return { result: JSON.parse(final.payload), final: true };
    const result = stored.find((row) => row.kind === 'result');
    if (result) return { result: JSON.parse(result.payload), final: false };
    return legacyLedger.readResult();
  }

  async function save(result) {
    const created = await insertOnce(RESULT_ROWS, { kind: 'result', payload: canonical(result) }, async () => {
      const stored = await rows(RESULT_ROWS, 'kind');
      return stored.some((row) => row.kind === 'result' || row.kind === 'final');
    });
    if (created) return true;
    const stored = await rows(RESULT_ROWS, 'kind');
    if (stored.length) return false;
    throw new Error('database_write_failed');
  }

  async function recover(result) {
    return insertOnce(RESULT_ROWS, { kind: 'final', payload: canonical(result) }, async () => {
      const stored = await rows(RESULT_ROWS, 'kind');
      return stored.some((row) => row.kind === 'final');
    });
  }

  async function trace(value) {
    return legacyLedger.trace(value);
  }

  function reviewLedger() {
    const prefix = (slot) => `d7:${slot}:`;
    async function readReview(slot) {
      const records = await rows(RESULT_ROWS, 'kind,payload');
      const intent = records.find((row) => row.kind === prefix(slot) + 'intent');
      const result = records.find((row) => row.kind === prefix(slot) + 'result');
      return intent ? { intent: JSON.parse(intent.payload), outcome: result ? JSON.parse(result.payload) : null } : null;
    }
    function record(slot, name, value) {
      const kind = prefix(slot) + name;
      return insertOnce(RESULT_ROWS, { kind, payload: canonical(value) }, async () =>
        (await rows(RESULT_ROWS, 'kind')).some((row) => row.kind === kind));
    }
    return {
      claimReview: (slot, intent) => record(slot, 'intent', intent), readReview,
      saveReview: (slot, result) => record(slot, 'result', result), reserve,
      markSent: (slot, session) => markSent(slot, session, { phase: 'd7' }), markComplete, usage,
      async reviewSession(slot) {
        const sent = (await rows(SLOT_ROWS, 'slot,event,session_id,meta')).find((row) => row.slot === slot && row.event === 'sent');
        return sent && JSON.parse(sent.meta ?? '{}')?.phase === 'd7' ? sent.session_id : null;
      },
    };
  }

  return { claim, matches, reserve, markSent, markComplete, usage, unresolved, save, readResult, recover, trace, reviewLedger, hasDatabaseRun: runExists };
}
