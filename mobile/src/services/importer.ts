import type { Document } from '@/core/types';
import type { BlobStore } from '@/data/blobs';
import { docPath, type LibraryEntry, type LibraryRepo } from '@/data/library';

import { ApiError, type FolumeApi } from './api';

/** A PDF chosen by the user, in the shape each platform provides it. */
export type PdfSource =
  | { kind: 'uri'; uri: string; name: string; size?: number }
  | { kind: 'blob'; blob: Blob; name: string }
  | { kind: 'bytes'; bytes: Uint8Array; name: string }
  /** a link to the paper: the server fetches it */
  | { kind: 'url'; url: string; name: string };

export type ImportPhase = 'fetching' | 'uploading' | 'converting' | 'downloading' | 'saving' | 'done';

export interface ImportProgress {
  phase: ImportPhase;
  /** overall progress, 0..1 */
  fraction: number;
  /** server-reported stage while converting */
  stage?: string;
}

export class ImportError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ImportError';
  }
}

export interface ImportDeps {
  api: FolumeApi;
  blobs: BlobStore;
  library: LibraryRepo;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  /** reads the bytes behind a `uri` source (native cache file); injectable for tests */
  readUri?: (uri: string) => Promise<Uint8Array>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function defaultReadUri(uri: string): Promise<Uint8Array> {
  const res = await fetch(uri);
  return new Uint8Array(await res.arrayBuffer());
}

export function buildForm(source: Exclude<PdfSource, { kind: 'url' }>): FormData {
  const form = new FormData();
  if (source.kind === 'uri') {
    // React Native's FormData streams `{ uri, name, type }` objects from disk
    form.append('file', { uri: source.uri, name: source.name, type: 'application/pdf' } as unknown as Blob);
  } else if (source.kind === 'blob') {
    form.append('file', source.blob, source.name);
  } else {
    form.append('file', new Blob([source.bytes as BlobPart], { type: 'application/pdf' }), source.name);
  }
  return form;
}

function assetPaths(doc: Document): string[] {
  const paths = new Set<string>(doc.pages.map((p) => p.image));
  for (const b of doc.blocks) if (b.asset) paths.add(b.asset.path);
  return [...paths];
}

async function mapLimit<T>(items: T[], limit: number, work: (item: T, index: number) => Promise<void>) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await work(items[i], i);
    }
  });
  await Promise.all(runners);
}

const USER_FACING = new Set([
  'not_a_pdf', 'file_too_large', 'too_many_pages', 'unreadable_pdf', 'busy', 'unauthorized',
  'invalid_url', 'url_not_allowed', 'fetch_failed', 'timeout', 'url_import_disabled', 'page_too_large', 'too_complex',
  'ocr_too_many_pages', 'ocr_failed',
]);

/**
 * Upload → convert on the server → download → store locally → delete the server job.
 * The server never keeps the paper: the job is deleted even when something fails half-way.
 */
export async function importPdf(
  source: PdfSource,
  deps: ImportDeps,
  onProgress: (p: ImportProgress) => void = () => {},
  signal?: AbortSignal,
): Promise<LibraryEntry> {
  const { api, blobs, library } = deps;
  const sleep = deps.sleep ?? defaultSleep;
  const poll = deps.pollIntervalMs ?? 700;
  const check = () => {
    if (signal?.aborted) throw new ImportError('cancelled', 'Import cancelled');
  };
  let jobId: string | null = null;
  try {
    const fromLink = source.kind === 'url';
    onProgress({ phase: fromLink ? 'fetching' : 'uploading', fraction: 0.02 });
    let job = source.kind === 'url' ? await api.uploadUrl(source.url) : await api.upload(buildForm(source));
    jobId = job.id;
    onProgress({ phase: fromLink ? 'fetching' : 'uploading', fraction: 0.1 });

    while (job.status === 'queued' || job.status === 'processing') {
      check();
      // while the server is still downloading the paper the phase says so; afterwards it is the same conversion
      const downloading = fromLink && job.stage === 'download';
      onProgress({
        phase: downloading ? 'fetching' : 'converting',
        fraction: 0.1 + 0.6 * Math.min(1, job.progress),
        stage: downloading ? undefined : job.stage,
      });
      await sleep(poll);
      job = await api.job(job.id);
    }
    if (job.status === 'failed') {
      throw new ImportError(job.error?.code ?? 'conversion_failed', job.error?.message ?? 'Conversion failed');
    }

    check();
    onProgress({ phase: 'downloading', fraction: 0.7 });
    const doc = await api.document(job.id);
    const paths = assetPaths(doc);
    let done = 0;
    await mapLimit(paths, 4, async (path) => {
      check();
      const bytes = await api.asset(job!.id, path);
      await blobs.put(`${docPath(doc.id)}/${path}`, bytes);
      done += 1;
      onProgress({ phase: 'downloading', fraction: 0.7 + 0.25 * (done / paths.length) });
    });

    onProgress({ phase: 'saving', fraction: 0.96 });
    let original: Uint8Array | null = null;
    if (source.kind === 'url') original = null; // the server fetched it and keeps nothing; the page images are the original
    else if (source.kind === 'bytes') original = source.bytes;
    else if (source.kind === 'blob') original = new Uint8Array(await source.blob.arrayBuffer());
    else original = await (deps.readUri ?? defaultReadUri)(source.uri).catch(() => null);
    if (original) await blobs.put(`${docPath(doc.id)}/original.pdf`, original);
    const entry = await library.addDocument(doc, doc.source.size_bytes, original !== null);
    onProgress({ phase: 'done', fraction: 1 });
    return entry;
  } catch (e) {
    if (e instanceof ImportError) throw e;
    if (e instanceof ApiError) {
      throw new ImportError(e.code === 'error' ? `http_${e.status}` : e.code, e.message);
    }
    throw new ImportError('unknown', e instanceof Error ? e.message : 'Import failed');
  } finally {
    if (jobId) await api.deleteJob(jobId).catch(() => undefined);
  }
}

export const isUserFacingImportError = (code: string) => USER_FACING.has(code) || code === 'network';
