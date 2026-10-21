/** The unit of sync and of backup: one small JSON record with a timestamp, addressed by a stable key. */
export interface SyncRecord {
  key: string;
  updatedAt: number;
  deleted: boolean;
  data: unknown | null;
}

export type RecordKind = 'ann' | 'state' | 'quiz' | 'card' | 'tags';

export function parseRecordKey(key: string): { kind: RecordKind; docId: string; id: string | null } | null {
  const m = /^(ann|state|quiz|card|tags)\/([A-Za-z0-9_.:-]{1,80})(?:\/([A-Za-z0-9_.:-]{1,80}))?$/.exec(key);
  if (!m) return null;
  const kind = m[1] as RecordKind;
  const needsId = kind === 'ann' || kind === 'quiz' || kind === 'card';
  if (needsId !== !!m[3]) return null;
  return { kind, docId: m[2], id: m[3] ?? null };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown) => typeof v === 'string';
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

/** Records come from another device or a file: check their shape before they touch local data. */
export function validRecordData(kind: RecordKind, data: unknown): boolean {
  if (!isObj(data)) return false;
  switch (kind) {
    case 'ann':
      return str(data.id) && str(data.docId) && str(data.blockId) && num(data.start) && num(data.end) && str(data.quote) && str(data.note) && num(data.updatedAt) && num(data.page);
    case 'quiz':
      return str(data.id) && str(data.docId) && Array.isArray(data.items) && num(data.at);
    case 'card':
      return str(data.id) && str(data.docId) && str(data.front) && str(data.back) && num(data.ease) && num(data.interval) && num(data.due) && num(data.updatedAt);
    case 'state':
      return num(data.updatedAt) && Array.isArray(data.bookmarks) && num(data.percent);
    case 'tags':
      return Array.isArray(data.tags) && data.tags.every(str) && num(data.updatedAt);
  }
}

export const BACKUP_FORMAT = 'folume-backup';
export const BACKUP_VERSION = 1;

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: number;
  /** titles of the papers the records belong to, so a restore can say what they are about */
  papers: { id: string; title: string; authors: string[]; year: number | null; doi: string | null }[];
  records: SyncRecord[];
}

export function serializeBackup(b: Backup): string {
  return JSON.stringify(b, null, 1);
}

export type BackupError = 'not_json' | 'wrong_format' | 'newer_version';

export function parseBackup(text: string): { ok: true; backup: Backup } | { ok: false; error: BackupError } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'not_json' };
  }
  if (!isObj(raw) || raw.format !== BACKUP_FORMAT || !Array.isArray(raw.records) || !num(raw.version)) return { ok: false, error: 'wrong_format' };
  if ((raw.version as number) > BACKUP_VERSION) return { ok: false, error: 'newer_version' };
  const records: SyncRecord[] = [];
  for (const r of raw.records) {
    if (!isObj(r) || !str(r.key) || !num(r.updatedAt)) continue;
    const parsed = parseRecordKey(r.key as string);
    if (!parsed) continue;
    const deleted = r.deleted === true;
    if (!deleted && !validRecordData(parsed.kind, r.data)) continue;
    records.push({ key: r.key as string, updatedAt: r.updatedAt as number, deleted, data: deleted ? null : r.data });
  }
  const papers = Array.isArray(raw.papers)
    ? raw.papers.filter(isObj).filter((p) => str(p.id) && str(p.title)).map((p) => ({
        id: p.id as string,
        title: p.title as string,
        authors: Array.isArray(p.authors) ? (p.authors as unknown[]).filter(str) as string[] : [],
        year: num(p.year) ? (p.year as number) : null,
        doi: str(p.doi) ? (p.doi as string) : null,
      }))
    : [];
  return { ok: true, backup: { format: BACKUP_FORMAT, version: raw.version as number, createdAt: num(raw.createdAt) ? (raw.createdAt as number) : 0, papers, records } };
}
