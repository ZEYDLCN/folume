import { sha256Hex } from '@/core/sha256';
import type { StringKey } from '@/i18n';
import { useSettings } from '@/state/settings';

import { ApiError } from './api';
import { getApi, getSyncEngine } from './container';
import type { SyncReport } from './syncEngine';

export const MIN_SYNC_KEY_LENGTH = 8;

/** The server only ever sees this hash, never the key; the prefix keeps it from matching a hash made for another purpose. */
export const syncNamespace = (key: string): string => sha256Hex(`folume-sync-v1:${key.trim()}`);

export function syncErrorKey(e: unknown): StringKey {
  if (e instanceof ApiError) {
    if (e.code === 'sync_disabled') return 'sync.error.disabled';
    if (e.code === 'network') return 'sync.error.network';
    if (e.code === 'unauthorized') return 'sync.error.unauthorized';
    if (e.code === 'namespace_full') return 'sync.error.full';
  }
  return 'sync.error.unknown';
}

let inFlight: Promise<SyncReport> | null = null;

/** Runs one sync with the current settings; concurrent calls share the same run. */
export function runSync(): Promise<SyncReport> {
  const { syncKey, sync } = useSettings.getState();
  if (!sync.enabled || syncKey.trim().length < MIN_SYNC_KEY_LENGTH) return Promise.reject(new Error('sync is not set up'));
  inFlight ??= getSyncEngine()
    .run(syncNamespace(syncKey))
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export async function lastSyncAt(): Promise<number | null> {
  const { syncKey } = useSettings.getState();
  if (syncKey.trim().length < MIN_SYNC_KEY_LENGTH) return null;
  return (await getSyncEngine().meta(syncNamespace(syncKey))).lastSyncAt;
}

export async function eraseRemote(): Promise<number> {
  const { syncKey } = useSettings.getState();
  const ns = syncNamespace(syncKey);
  const res = await getApi().syncErase(ns);
  await getSyncEngine().reset(ns);
  return res.deleted;
}
