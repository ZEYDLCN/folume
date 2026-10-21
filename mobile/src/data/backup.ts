import { parseBackup, parseRecordKey, serializeBackup, BACKUP_FORMAT, BACKUP_VERSION, type BackupError } from '@/core/sync/records';

import type { LibraryRepo } from './library';
import type { ApplyResult, RecordStore } from './records';

/** A JSON file with everything that is the reader's own. PDFs and page images are not in it: they come from the PDF. */
export async function createBackup(records: RecordStore, library: LibraryRepo, now: number = Date.now()): Promise<string> {
  const all = await records.collect();
  const docIds = new Set(all.map((r) => parseRecordKey(r.key)?.docId).filter((v): v is string => !!v));
  const entries = await library.list();
  return serializeBackup({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: now,
    papers: entries
      .filter((e) => docIds.has(e.id))
      .map((e) => ({ id: e.id, title: e.title, authors: e.authors, year: e.year, doi: e.doi })),
    records: all,
  });
}

export type RestoreResult = ({ ok: true; papers: number } & ApplyResult) | { ok: false; error: BackupError };

/** Merges a backup into what is on the device; whichever side edited a record last keeps it. */
export async function restoreBackup(records: RecordStore, text: string): Promise<RestoreResult> {
  const parsed = parseBackup(text);
  if (!parsed.ok) return parsed;
  const result = await records.apply(parsed.backup.records);
  return { ok: true, papers: parsed.backup.papers.length, ...result };
}
