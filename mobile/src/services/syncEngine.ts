import type { SyncRecord } from '@/core/sync/records';
import type { KeyValueStore } from '@/data/kv';
import type { RecordStore } from '@/data/records';

import type { SyncPullResponse, SyncWireRecord } from './api';

export interface SyncTransport {
  syncPull(namespace: string, since: number, limit?: number): Promise<SyncPullResponse>;
  syncPush(namespace: string, records: SyncWireRecord[]): Promise<{ accepted: number; ignored: number; seq: number }>;
}

interface SyncMeta {
  /** server position this device has already read up to */
  cursor: number;
  /** record key -> updatedAt that the server is known to have */
  pushed: Record<string, number>;
  lastSyncAt: number | null;
}

export interface SyncReport {
  pulled: number;
  applied: number;
  pushed: number;
  at: number;
}

const metaKey = (namespace: string) => `folume:v1:sync:${namespace.slice(0, 16)}`;
const BATCH = 200;

/**
 * Pull what changed on the server, merge it (newest write wins per record), then push what changed here.
 * Pulling first means a device never overwrites a newer edit it simply has not seen yet.
 */
export class SyncEngine {
  constructor(
    private readonly records: RecordStore,
    private readonly kv: KeyValueStore,
    private readonly transport: SyncTransport,
    private readonly now: () => number = Date.now,
  ) {}

  async meta(namespace: string): Promise<{ lastSyncAt: number | null }> {
    const m = await this.kv.get<SyncMeta>(metaKey(namespace));
    return { lastSyncAt: m?.lastSyncAt ?? null };
  }

  async reset(namespace: string): Promise<void> {
    await this.kv.remove(metaKey(namespace));
  }

  async run(namespace: string): Promise<SyncReport> {
    const meta = (await this.kv.get<SyncMeta>(metaKey(namespace))) ?? { cursor: 0, pushed: {}, lastSyncAt: null };
    let pulled = 0;
    let applied = 0;

    for (;;) {
      const page = await this.transport.syncPull(namespace, meta.cursor, BATCH);
      const incoming: SyncRecord[] = page.records.map((r) => ({ key: r.key, updatedAt: r.updated_at, deleted: r.deleted, data: r.data }));
      const res = await this.records.apply(incoming);
      applied += res.applied;
      pulled += incoming.length;
      // what we just read is already on the server
      for (const r of incoming) meta.pushed[r.key] = Math.max(meta.pushed[r.key] ?? 0, r.updatedAt);
      meta.cursor = page.next;
      await this.save(namespace, meta);
      if (!page.has_more) break;
    }

    const local = await this.records.collect();
    const pending = local.filter((r) => r.updatedAt > (meta.pushed[r.key] ?? -1));
    let pushed = 0;
    for (let i = 0; i < pending.length; i += BATCH) {
      const batch = pending.slice(i, i + BATCH);
      await this.transport.syncPush(
        namespace,
        batch.map((r) => ({ key: r.key, updated_at: r.updatedAt, deleted: r.deleted, data: r.deleted ? null : r.data })),
      );
      for (const r of batch) meta.pushed[r.key] = r.updatedAt;
      pushed += batch.length;
      await this.save(namespace, meta);
    }

    meta.lastSyncAt = this.now();
    await this.save(namespace, meta);
    return { pulled, applied, pushed, at: meta.lastSyncAt };
  }

  private save(namespace: string, meta: SyncMeta): Promise<void> {
    return this.kv.set(metaKey(namespace), meta);
  }
}
