import { stable, validateRun } from '../src/run-store/validation.ts';
import { RunStoreError, type StoredRun } from '../src/run-store/contracts.ts';
import { campusMap } from '../src/scenario-generation/templates.ts';
import type { Building } from '../src/contracts.ts';

type Row = Record<string, unknown>;
interface DbError { code?: string }
interface DbResult<T> { data?: T[] | null; error?: DbError | null }
export interface RunSelect<T> extends PromiseLike<DbResult<T>> {
  eq(column: string, value: unknown): RunSelect<T>;
  limit(count: number): RunSelect<T>;
}
export interface RunUpdate<T> extends PromiseLike<DbResult<T>> {
  eq(column: string, value: unknown): RunUpdate<T>;
  select(columns: string): RunUpdate<T>;
}
export interface RunTable {
  select(columns: string): RunSelect<Row>;
  insert(rows: Row | Row[]): PromiseLike<DbResult<Row>>;
  update(patch: Row): RunUpdate<Row>;
}
export interface RunDatabase {
  from(table: string): RunTable;
}

const RUN_COLUMNS = 'id,scenario_id,d6_revision,d6_event_seq,d6_progress_json,d6_origin_json,d6_owner_hash,d6_created_at,d6_updated_at,score_json';
const TEMPLATE_COLUMNS = 'id,modifiers_json,start_building_id,standard_actions_json,critical_items_json';
const SCENARIO_COLUMNS = 'id,d6_bundle_json';
const REPORT_COLUMNS = 'id,scenario_id,appears_at_sim,category,text,event_truth_json,judgment_windows_json,priority,is_training';
const EVENT_COLUMNS = 'run_id,seq,t_sim,kind,payload_json';
const reportKey = (sid: string, id: string) => `${sid.length}:${sid}${id}`;

function iso(value: unknown): string {
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error('database_timestamp_invalid');
  return date.toISOString();
}
function scoreFields(score: StoredRun['score']): Row {
  return score === null ? {
    score_json: null, total_score: null, discrimination: null, response: null, coverage: null, violation: null,
  } : {
    score_json: score, total_score: score.total, discrimination: score.discrimination,
    response: score.response, coverage: score.coverage, violation: score.violation,
  };
}
function buildingRow(building: Building): Row {
  return {
    id: building.id, name: building.name, zone: building.zone, category: building.category,
    floors: building.floors, capacity: building.capacity, risk_tag: building.risk_tag,
    polygon_json: building.polygon, adjacency_json: building.adjacency, is_training: 1,
  };
}
function scenarioRow(sid: string, frozen: Row): Row {
  const scenario = frozen.scenario as Row;
  return {
    id: sid, template_id: scenario.template_id, source: scenario.source, title: scenario.title,
    modifiers_json: scenario.modifiers, start_building_id: scenario.start_building_id, t_end: scenario.t_end,
    nodes_json: scenario.nodes, standard_actions_json: scenario.standard_actions,
    critical_items_json: scenario.critical_items, d6_bundle_json: frozen, is_training: 1,
  };
}
function reportRow(sid: string, report: Row): Row {
  return {
    id: reportKey(sid, String(report.id)), scenario_id: sid, appears_at_sim: report.appears_at_sim,
    category: report.category, text: report.text, event_truth_json: report.event_truth,
    judgment_windows_json: report.judgment_windows, priority: report.priority, is_training: 1,
  };
}
function eventRow(runId: string, event: StoredRun['events'][number]): Row {
  return { run_id: runId, seq: event.seq, t_sim: event.t_sim, kind: event.kind, payload_json: event.payload };
}
export function createRunRepository(db: RunDatabase) {
  async function select<T extends Row>(table: string, columns: string, filter: (query: RunSelect<T>) => RunSelect<T>, limit: number): Promise<T[]> {
    const result = await filter(db.from(table).select(columns) as unknown as RunSelect<T>).limit(limit);
    if (result?.error) throw new Error('database_read_failed');
    return Array.isArray(result?.data) ? result.data : [];
  }
  async function insert(table: string, rows: Row | Row[]): Promise<{ error?: DbError | null }> {
    try { return await db.from(table).insert(rows); }
    catch { throw new Error('database_write_failed'); }
  }
  const unique = (error: { error?: DbError | null } | undefined) => error?.error?.code === '23505';

  async function read(runId: string, owner: string): Promise<StoredRun | null> {
    const [head] = await select<Row>('runs', RUN_COLUMNS, (query) => query.eq('id', runId), 1);
    if (!head || head.d6_owner_hash !== owner || !Number.isSafeInteger(head.d6_revision) ||
      head.d6_revision === 0 || !Number.isSafeInteger(head.d6_event_seq)) return null;
    const sid = String(head.scenario_id);
    const [scene] = await select<Row>('scenarios', SCENARIO_COLUMNS, (query) => query.eq('id', sid), 1);
    const frozen = scene?.d6_bundle_json as Row | undefined;
    if (!frozen || !Array.isArray(frozen.report_ids)) throw new RunStoreError('CORRUPT', '数据库缺少冻结场景');
    const reportRows = await select<Row>('ugc_reports', REPORT_COLUMNS, (query) => query.eq('scenario_id', sid), 20);
    const byReport = new Map(reportRows.map((row) => [row.id, row]));
    const reports = frozen.report_ids.map((id) => {
      const row = byReport.get(reportKey(sid, String(id)));
      if (!row) throw new RunStoreError('CORRUPT', '数据库缺少上报行');
      return {
        id, category: row.category, appears_at_sim: row.appears_at_sim, text: row.text,
        event_truth: row.event_truth_json, judgment_windows: row.judgment_windows_json,
        priority: row.priority, is_training: row.is_training,
      };
    });
    const committed = Number(head.d6_event_seq);
    const eventRows = await select<Row>('run_events', EVENT_COLUMNS, (query) => query.eq('run_id', runId), 1000);
    const events = eventRows
      .filter((row) => Number.isSafeInteger(row.seq) && Number(row.seq) >= 1 && Number(row.seq) <= committed)
      .sort((a, b) => Number(a.seq) - Number(b.seq))
      .map((row) => ({ seq: row.seq, t_sim: row.t_sim, kind: row.kind, payload: row.payload_json }));
    const scenario = frozen.scenario as Row;
    return validateRun({
      schema_version: frozen.schema_version, engine_version: frozen.engine_version, map_version: frozen.map_version,
      run_id: head.id, scenario_id: scenario.id, revision: head.d6_revision,
      created_at: iso(head.d6_created_at), updated_at: iso(head.d6_updated_at),
      bundle: { scenario, ugc_reports: reports, action_catalog: frozen.action_catalog },
      map: frozen.map, origin: head.d6_origin_json ?? null, progress: head.d6_progress_json,
      events, score: head.score_json ?? null,
    });
  }

  async function ensureStartBuilding(snapshot: StoredRun): Promise<void> {
    const id = snapshot.bundle.scenario.start_building_id;
    const find = () => select('campus_buildings', 'id', (query) => query.eq('id', id), 1);
    if ((await find()).length) return;

    // Client snapshots cannot define rows in the shared campus map.
    const declared = snapshot.map.buildings.find((building) => building.id === id);
    const trusted = snapshot.map_version === 'd2-1' && campusMap.buildings.find((building) => building.id === id);
    if (!declared || !trusted || stable(buildingRow(declared)) !== stable(buildingRow(trusted))) {
      throw new RunStoreError('CORRUPT', '起始楼栋与可信地图不一致');
    }
    const result = await insert('campus_buildings', buildingRow(trusted));
    if (!result?.error) return;
    if (!unique(result) || !(await find()).length) throw new Error('database_write_failed');
  }

  async function ensureTemplate(frozen: Row): Promise<'ok' | 'conflict'> {
    const scenario = frozen.scenario as Row;
    const id = String(scenario.template_id);
    const wanted = {
      id, modifiers_json: scenario.modifiers, start_building_id: scenario.start_building_id,
      standard_actions_json: scenario.standard_actions, critical_items_json: scenario.critical_items,
    };
    const [existing] = await select<Row>('disaster_templates', TEMPLATE_COLUMNS, (query) => query.eq('id', id), 1);
    // AI rounds may vary actions within a template; the frozen scenario row is authoritative.
    if (existing) return 'ok';
    const result = await insert('disaster_templates', { ...wanted, name: id, description: 'D6 training template', is_training: 1 });
    if (!result?.error) return 'ok';
    if (!unique(result)) throw new Error('database_write_failed');
    const [raced] = await select<Row>('disaster_templates', TEMPLATE_COLUMNS, (query) => query.eq('id', id), 1);
    return raced ? 'ok' : 'conflict';
  }

  async function ensureScenario(sid: string, frozen: Row): Promise<'ok' | 'conflict'> {
    const [existing] = await select<Row>('scenarios', SCENARIO_COLUMNS, (query) => query.eq('id', sid), 1);
    if (existing) return stable(existing.d6_bundle_json) === stable(frozen) ? 'ok' : 'conflict';
    const result = await insert('scenarios', scenarioRow(sid, frozen));
    if (!result?.error) return 'ok';
    if (!unique(result)) throw new Error('database_write_failed');
    const [raced] = await select<Row>('scenarios', SCENARIO_COLUMNS, (query) => query.eq('id', sid), 1);
    return raced && stable(raced.d6_bundle_json) === stable(frozen) ? 'ok' : 'conflict';
  }

  async function ensureReports(sid: string, reports: StoredRun['bundle']['ugc_reports']): Promise<'ok' | 'conflict'> {
    const existing = await select<Row>('ugc_reports', REPORT_COLUMNS, (query) => query.eq('scenario_id', sid), 20);
    const byId = new Map(existing.map((row) => [row.id, row]));
    const wanted = reports.map((report) => reportRow(sid, report as unknown as Row));
    for (const row of wanted) {
      const found = byId.get(row.id);
      if (found && stable(found) !== stable(row)) return 'conflict';
    }
    const missing = wanted.filter((row) => !byId.has(row.id));
    if (!missing.length) return 'ok';
    const result = await insert('ugc_reports', missing);
    if (!result?.error) return 'ok';
    if (!unique(result)) throw new Error('database_write_failed');
    const after = await select<Row>('ugc_reports', REPORT_COLUMNS, (query) => query.eq('scenario_id', sid), 20);
    const settled = new Map(after.map((row) => [row.id, row]));
    return wanted.every((row) => settled.has(row.id) && stable(settled.get(row.id)) === stable(row)) ? 'ok' : 'conflict';
  }

  async function ensureEvents(runId: string, events: StoredRun['events']): Promise<'ok' | 'conflict'> {
    const existing = await select<Row>('run_events', EVENT_COLUMNS, (query) => query.eq('run_id', runId), 1000);
    existing.sort((a, b) => Number(a.seq) - Number(b.seq));
    if (existing.length > events.length) return 'conflict';
    for (let index = 0; index < existing.length; index++) {
      if (stable(existing[index]) !== stable(eventRow(runId, events[index]!))) return 'conflict';
    }
    if (existing.length === events.length) return 'ok';
    const result = await insert('run_events', events.slice(existing.length).map((event) => eventRow(runId, event)));
    if (!result?.error) return 'ok';
    if (!unique(result)) throw new Error('database_write_failed');
    const after = await select<Row>('run_events', EVENT_COLUMNS, (query) => query.eq('run_id', runId), 1000);
    after.sort((a, b) => Number(a.seq) - Number(b.seq));
    if (after.length !== events.length) return 'conflict';
    return after.every((row, index) => stable(row) === stable(eventRow(runId, events[index]!))) ? 'ok' : 'conflict';
  }

  async function save(snapshot: StoredRun, owner: string, expectedRevision: number): Promise<'saved' | 'conflict' | 'missing'> {
    if (!/^[0-9a-f]{64}$/.test(owner)) return 'missing';
    const [head] = await select<Row>('runs', RUN_COLUMNS, (query) => query.eq('id', snapshot.run_id), 1);
    if (head && head.d6_owner_hash !== owner) return 'missing';
    const sid = `d6:${owner}:${snapshot.scenario_id}`;
    if (head && head.scenario_id !== sid) return 'conflict';
    if ((head?.d6_revision ?? 0) !== expectedRevision) {
      const actual = await read(snapshot.run_id, owner);
      return actual && stable(actual) === stable(snapshot) ? 'saved' : 'conflict';
    }
    const frozen = {
      schema_version: snapshot.schema_version, engine_version: snapshot.engine_version,
      map_version: snapshot.map_version, map: snapshot.map, scenario: snapshot.bundle.scenario,
      action_catalog: snapshot.bundle.action_catalog,
      report_ids: snapshot.bundle.ugc_reports.map((report) => report.id),
    } as unknown as Row;
    await ensureStartBuilding(snapshot);
    if (await ensureTemplate(frozen) === 'conflict') return 'conflict';
    if (await ensureScenario(sid, frozen) === 'conflict') return 'conflict';
    if (await ensureReports(sid, snapshot.bundle.ugc_reports) === 'conflict') return 'conflict';

    const committed = snapshot.events.length;
    const fields = {
      scenario_id: sid, playback_speed: snapshot.progress.speed, d6_revision: snapshot.revision,
      d6_event_seq: committed, d6_progress_json: snapshot.progress, d6_origin_json: snapshot.origin,
      d6_owner_hash: owner, d6_created_at: snapshot.created_at, d6_updated_at: snapshot.updated_at,
      ended_at: snapshot.progress.finished ? snapshot.updated_at : null, ...scoreFields(snapshot.score),
    };
    if (!head) {
      const result = await insert('runs', {
        id: snapshot.run_id, branch: 'learner', started_at: snapshot.created_at, is_training: 1,
        // Revision zero reserves the run ID without exposing a partial first save.
        ...fields, d6_revision: 0, d6_event_seq: 0,
      });
      if (result?.error) {
        if (!unique(result)) throw new Error('database_write_failed');
        const [raced] = await select<Row>('runs', RUN_COLUMNS, (query) => query.eq('id', snapshot.run_id), 1);
        if (!raced) throw new Error('database_read_failed');
        if (raced.d6_owner_hash !== owner) return 'missing';
        const racedRun = await read(snapshot.run_id, owner);
        return racedRun && stable(racedRun) === stable(snapshot) ? 'saved' : 'conflict';
      }
    }
    if (await ensureEvents(snapshot.run_id, snapshot.events) === 'conflict') return 'conflict';
    const written = await db.from('runs').update(fields)
      .eq('id', snapshot.run_id).eq('d6_owner_hash', owner).eq('d6_revision', expectedRevision).select('id');
    if (written?.error) throw new Error('database_write_failed');
    if (Array.isArray(written?.data) && written.data.length) return 'saved';
    const actual = await read(snapshot.run_id, owner);
    return actual && stable(actual) === stable(snapshot) ? 'saved' : 'conflict';
  }

  return { read, save };
}
