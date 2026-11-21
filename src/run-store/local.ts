import type { RunEvent, ScoreResult } from '../contracts';
import { RunStoreError, type RunProgress, type StoredRun } from './contracts';
import { assertRunUpdate, newProgress, stable, validateRun } from './validation';

export const ACTIVE_RUN_KEY = 'campus-d6.active';
const keyFor = (id: string) => 'campus-d6.run.' + id;
export type StorageBackend = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Initial = Pick<StoredRun, 'bundle' | 'map' | 'origin'>;

export function newRun(initial: Initial, id = crypto.randomUUID(), at = new Date().toISOString()): StoredRun {
  return {
    schema_version: 1, engine_version: 'd4-1', map_version: 'd2-1',
    run_id: id, scenario_id: initial.bundle.scenario.id, revision: 1, created_at: at, updated_at: at,
    ...initial, progress: newProgress(initial.bundle.scenario.playback_speeds[0] ?? 1), events: [], score: null,
  };
}

export function updateRun(previous: StoredRun, progress: RunProgress, events: RunEvent[], score: ScoreResult | null): StoredRun {
  if (stable([previous.progress, previous.events, previous.score]) === stable([progress, events, score])) return previous;
  return { ...previous, revision: previous.revision + 1, updated_at: new Date(Math.max(Date.now(), Date.parse(previous.updated_at))).toISOString(),
    progress, events, score };
}

export function importRun(json: string): StoredRun {
  try { return validateRun(JSON.parse(json)); }
  catch (error) {
    if (error instanceof RunStoreError) throw error;
    throw new RunStoreError('CORRUPT', '存档 JSON 损坏');
  }
}
export const exportRun = (run: StoredRun): string => JSON.stringify(run, null, 2);

export function createLocalRunStore(resolveStorage: () => StorageBackend = () => localStorage) {
  function access<T>(operation: (storage: StorageBackend) => T): T {
    try { return operation(resolveStorage()); }
    catch (error) {
      if (error instanceof RunStoreError) throw error;
      throw new RunStoreError('UNAVAILABLE', '本机存储不可用或空间不足');
    }
  }
  function loadRun(id: string): StoredRun | null {
    const raw = access((storage) => storage.getItem(keyFor(id)));
    if (raw === null) return null;
    const run = importRun(raw);
    if (run.run_id !== id) throw new RunStoreError('CORRUPT', '存档轮次标识不匹配');
    return run;
  }
  function active(): StoredRun | null {
    const id = access((storage) => storage.getItem(ACTIVE_RUN_KEY));
    if (!id) return null;
    const run = loadRun(id);
    if (!run) throw new RunStoreError('CORRUPT', '活动轮次的存档缺失');
    return run;
  }
  function write(run: StoredRun): void {
    access((storage) => storage.setItem(keyFor(run.run_id), JSON.stringify(run)));
  }
  function createRun(run: StoredRun): void {
    validateRun(run);
    if (run.revision !== 1 || loadRun(run.run_id)) throw new RunStoreError('CONFLICT', '轮次已存在');
    write(run);
    access((storage) => storage.setItem(ACTIVE_RUN_KEY, run.run_id));
  }
  function saveRun(run: StoredRun, expectedRevision: number): void {
    const raw = access((storage) => storage.getItem(keyFor(run.run_id)));
    const previous = raw === null ? null : importRun(raw);
    if (!previous || previous.run_id !== run.run_id) throw new RunStoreError('CONFLICT', '轮次已变动，请刷新读取');
    if (stable(previous) === stable(run)) return;
    if (previous.revision !== expectedRevision) throw new RunStoreError('CONFLICT', '其他页面已保存此轮次，请刷新读取');
    assertRunUpdate(previous, run);
    validateRun(run);
    write(run);
  }
  function clearActive(id: string): void {
    access((storage) => {
      if (storage.getItem(ACTIVE_RUN_KEY) === id) storage.removeItem(ACTIVE_RUN_KEY);
    });
  }
  return { active, createRun, saveRun, loadRun, clearActive };
}
