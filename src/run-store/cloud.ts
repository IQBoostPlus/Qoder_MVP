import { RunStoreError, type StoredRun } from './contracts';
import { validateRun } from './validation';

export function cloudRunPath(): string | null {
  const value = import.meta.env?.VITE_D6_RUN_PATH;
  return typeof value === 'string' && /^\/(?!\/)[\w/-]+$/.test(value) ? value : null;
}

// Keep the capability separate from the run snapshot and export.
export function runAccessKey(id: string): string {
  const name = 'campus-d6.key.' + id;
  const known = localStorage.getItem(name);
  if (known && /^[a-f0-9]{64}$/.test(known)) return known;
  const key = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  localStorage.setItem(name, key);
  return key;
}
export async function syncRun(path: string, run: StoredRun): Promise<void> {
  const url = path + '?' + new URLSearchParams({ run_id: run.run_id });
  const headers = { 'X-Run-Key': runAccessKey(run.run_id), 'Content-Type': 'application/json' };
  const response = await fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(5000) });
  if (!response.ok && response.status !== 404) throw new RunStoreError('UNAVAILABLE', '云端未同步');
  const remote = response.ok ? validateRun((await response.json()).run) : null;
  const expected_revision = remote?.revision ?? 0;
  const write = await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ run, expected_revision }),
    signal: AbortSignal.timeout(5000) });
  if (write.status === 409) throw new RunStoreError('CONFLICT', '云端版本冲突，本机记录已保留');
  if (!write.ok || (await write.json()).revision !== run.revision) throw new RunStoreError('UNAVAILABLE', '云端未同步');
}
