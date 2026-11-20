// Legacy Sites Storage ledger used for evidence and closed-mode lookup.
// The cloud acceptance observed double claims with upsert:false. This
// implementation is not a proven atomic writer for live multi-instance use.
const SLOTS = ['scenario', 'reports', 'review', 'retry'];
const encoder = new TextEncoder();

function listEntries(result) {
  if (Array.isArray(result)) return result;
  for (const key of ['entries', 'data', 'objects', 'items']) {
    if (Array.isArray(result?.[key])) return result[key];
  }
  return [];
}

function entryName(entry) {
  if (typeof entry === 'string') return entry.split('/').filter(Boolean).pop();
  const value = entry?.name ?? entry?.path ?? entry?.key ?? entry?.object_path;
  return typeof value === 'string' ? value.split('/').filter(Boolean).pop() : null;
}

export function createStorageLedger({ storage, userHash, runId, now = () => new Date().toISOString() }) {
  if (!storage) throw new Error('storage_not_configured');
  if (typeof userHash !== 'string' || !/^[0-9a-f]{64}$/.test(userHash)) throw new Error('invalid_user_hash');
  if (typeof runId !== 'string' || !/^[\w-]{12,80}$/.test(runId)) throw new Error('invalid_run_id');

  const root = `d5-generation/${userHash}/${runId}`;
  const paths = {
    root,
    request: `${root}/request.json`,
    result: `${root}/result.json`,
    final: `${root}/final.json`,
    trace: `${root}/trace.json`,
    slot: (slot) => `${root}/slots/${slot}`,
    reserve: (slot) => `${root}/slots/${slot}/reserve.json`,
    sent: (slot) => `${root}/slots/${slot}/sent.json`,
    complete: (slot) => `${root}/slots/${slot}/complete.json`,
  };

  async function readJson(path) {
    try {
      const response = await storage.download(path);
      return JSON.parse(await response.text());
    } catch (error) {
      const parent = path.slice(0, path.lastIndexOf('/'));
      const name = path.slice(path.lastIndexOf('/') + 1);
      let exists = false;
      try {
        exists = listEntries(await storage.list(parent, { limit: 200, offset: 0 })).some((entry) => entryName(entry) === name);
      } catch {
        throw error;
      }
      if (exists) throw error;
      return null;
    }
  }

  async function createJson(path, value) {
    try {
      await storage.upload(path, encoder.encode(JSON.stringify(value)), {
        contentType: 'application/json; charset=utf-8',
        upsert: false,
      });
      return true;
    } catch (error) {
      const existing = await readJson(path);
      if (existing !== null) return false;
      throw error;
    }
  }

  async function writeJson(path, value) {
    await storage.upload(path, encoder.encode(JSON.stringify(value)), {
      contentType: 'application/json; charset=utf-8',
      upsert: true,
    });
  }

  async function readRequest() {
    return readJson(paths.request);
  }

  async function claim(request) {
    const created = await createJson(paths.request, request);
    if (created) return 'new';
    const existing = await readJson(paths.request);
    return JSON.stringify(existing) === JSON.stringify(request) ? 'existing' : 'conflict';
  }

  async function matches(request) {
    const existing = await readJson(paths.request);
    return JSON.stringify(existing) === JSON.stringify(request);
  }

  async function reserve(slot) {
    return createJson(paths.reserve(slot), { at: now() });
  }

  async function markSent(slot, sessionId, extra = {}) {
    return createJson(paths.sent(slot), { session_id: sessionId, at: now(), ...extra });
  }

  async function markComplete(slot) {
    return createJson(paths.complete(slot), { at: now() });
  }

  async function slotState(slot) {
    const [reserve, sent, complete] = await Promise.all([
      readJson(paths.reserve(slot)), readJson(paths.sent(slot)), readJson(paths.complete(slot)),
    ]);
    return { reserve, sent, complete };
  }

  async function usage({ completing } = {}) {
    const rows = await Promise.all(SLOTS.map(async (slot) => {
      const state = await slotState(slot);
      return { slot, ...state, complete: state.complete ?? (slot === completing && state.sent ? true : null) };
    }));
    return {
      calls: rows.filter((row) => row.sent || row.complete).length,
      shared_retry_used: rows.some((row) => row.slot === 'retry' && row.reserve),
      upstream_state: rows.some((row) => row.sent && !row.complete) ? 'unknown'
        : rows.some((row) => row.complete) ? 'complete' : 'not_sent',
    };
  }

  async function unresolved() {
    for (const slot of [...SLOTS].reverse()) {
      const state = await slotState(slot);
      if (state.sent && !state.complete && typeof state.sent.session_id === 'string') {
        return { slot, session_id: state.sent.session_id, sent_at: state.sent.at ?? null };
      }
    }
    return null;
  }

  async function save(result) {
    return createJson(paths.result, result);
  }

  async function readResult() {
    const final = await readJson(paths.final);
    if (final) return { result: final, final: true };
    const result = await readJson(paths.result);
    return result ? { result, final: false } : null;
  }

  async function recover(result) {
    return createJson(paths.final, result);
  }

  async function trace(value) {
    try { await writeJson(paths.trace, value); } catch { /* evidence only */ }
  }

  return { paths, readRequest, claim, matches, reserve, markSent, markComplete, usage, unresolved, save, readResult, recover, trace, slotState };
}
