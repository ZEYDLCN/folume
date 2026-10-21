import type { KeyValueStore } from './kv';

export const TOMBSTONES_KEY = 'folume:v1:tombstones';

/** Deletions that have to reach other devices: record key -> when it was deleted. */
export type Tombstones = Record<string, number>;

export async function readTombstones(kv: KeyValueStore): Promise<Tombstones> {
  return (await kv.get<Tombstones>(TOMBSTONES_KEY)) ?? {};
}

/** Call inside the shared lock, together with the delete itself. */
export async function markDeleted(kv: KeyValueStore, recordKey: string, at: number): Promise<void> {
  const t = await readTombstones(kv);
  t[recordKey] = Math.max(t[recordKey] ?? 0, at);
  await kv.set(TOMBSTONES_KEY, t);
}

export async function clearTombstone(kv: KeyValueStore, recordKey: string): Promise<void> {
  const t = await readTombstones(kv);
  if (recordKey in t) {
    delete t[recordKey];
    await kv.set(TOMBSTONES_KEY, t);
  }
}
