import { MemoryBlobStore } from '@/data/blobs';
import { MemoryKV } from '@/data/kv';
import { LibraryRepo } from '@/data/library';
import { createFakeServer } from '@/testing/fakeServer';
import { ieeeMl } from '@/testing/fixtures';

import { ApiError, FolumeApi } from './api';
import { ImportError, importPdf, type ImportProgress } from './importer';

function setup(serverOpts: Partial<Parameters<typeof createFakeServer>[0]> = {}, apiKey: string | null = null) {
  const server = createFakeServer({ doc: ieeeMl, ...serverOpts });
  const api = new FolumeApi({ baseUrl: 'http://srv/', apiKey }, server.fetch);
  const kv = new MemoryKV();
  const blobs = new MemoryBlobStore();
  const library = new LibraryRepo(kv, blobs);
  const deps = { api, blobs, library, sleep: async () => {}, readUri: async () => new Uint8Array([37, 80, 68, 70]) };
  return { server, api, kv, blobs, library, deps };
}

const pdf = { kind: 'bytes' as const, bytes: new TextEncoder().encode('%PDF-1.4 test'), name: 'paper.pdf' };

describe('importPdf', () => {
  it('uploads, converts, downloads every asset, stores locally and deletes the server job', async () => {
    const { server, blobs, library, deps } = setup({ processingPolls: 2 });
    const progress: ImportProgress[] = [];
    const entry = await importPdf(pdf, deps, (p) => progress.push(p));

    expect(entry).toMatchObject({ id: ieeeMl.id, title: 'Sparse Routing for Efficient Transformers', hasOriginalPdf: true });
    expect(await library.loadDocument(ieeeMl.id)).toMatchObject({ id: ieeeMl.id });
    for (const p of ieeeMl.pages) expect(await blobs.exists(`docs/${ieeeMl.id}/${p.image}`)).toBe(true);
    const withAsset = ieeeMl.blocks.filter((b) => b.asset);
    expect(withAsset.length).toBeGreaterThan(5);
    for (const b of withAsset) {
      const stored = await blobs.get(`docs/${ieeeMl.id}/${b.asset!.path}`);
      expect(new TextDecoder().decode(stored!)).toBe(`bytes-of:${b.asset!.path}`);
    }
    expect(await blobs.exists(`docs/${ieeeMl.id}/original.pdf`)).toBe(true);
    expect(server.deleted).toEqual(['job1']);

    const fractions = progress.map((p) => p.fraction);
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
    expect(progress[0].phase).toBe('uploading');
    expect(progress.at(-1)).toMatchObject({ phase: 'done', fraction: 1 });
    expect(new Set(progress.map((p) => p.phase))).toEqual(new Set(['uploading', 'converting', 'downloading', 'saving', 'done']));
  });

  it('sends the API key', async () => {
    const ok = setup({ requireKey: 'k' }, 'k');
    await expect(importPdf(pdf, ok.deps)).resolves.toBeTruthy();
    const bad = setup({ requireKey: 'k' }, 'wrong');
    await expect(importPdf(pdf, bad.deps)).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('maps upload rejections to import errors', async () => {
    const { deps } = setup({ failWith: { code: 'file_too_large', message: 'too big', status: 413 } });
    await expect(importPdf(pdf, deps)).rejects.toMatchObject({ name: 'ImportError', code: 'file_too_large' });
  });

  it('reports conversion failures and still deletes the job', async () => {
    const { server, library, deps } = setup({ failWith: { code: 'unreadable_pdf', message: 'broken' } });
    await expect(importPdf(pdf, deps)).rejects.toMatchObject({ code: 'unreadable_pdf' });
    expect(server.deleted).toEqual(['job1']);
    expect(await library.list()).toEqual([]);
  });

  it('reports an unreachable server', async () => {
    const api = new FolumeApi({ baseUrl: 'http://nowhere' }, (async () => {
      throw new TypeError('Network request failed');
    }) as typeof fetch);
    const lib = new LibraryRepo(new MemoryKV(), new MemoryBlobStore());
    await expect(importPdf(pdf, { api, blobs: new MemoryBlobStore(), library: lib, sleep: async () => {} }))
      .rejects.toMatchObject({ code: 'network' });
  });

  it('can be cancelled while converting', async () => {
    const { server, deps } = setup({ processingPolls: 50 });
    const ctrl = new AbortController();
    const result = importPdf(pdf, { ...deps, sleep: async () => ctrl.abort() }, () => {}, ctrl.signal);
    await expect(result).rejects.toBeInstanceOf(ImportError);
    await expect(result).rejects.toMatchObject({ code: 'cancelled' });
    expect(server.deleted).toEqual(['job1']);
  });

  it('stores nothing partial when an asset download fails', async () => {
    const { server, library, deps } = setup();
    const original = server.fetch;
    const flaky = (async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes('/assets/figures/') ? new Response('nope', { status: 500 }) : original(input, init)) as typeof fetch;
    const api = new FolumeApi({ baseUrl: 'http://srv' }, flaky);
    await expect(importPdf(pdf, { ...deps, api })).rejects.toBeInstanceOf(ImportError);
    expect(await library.list()).toEqual([]);
  });
});

describe('FolumeApi', () => {
  it('normalizes the base URL and surfaces structured errors', async () => {
    const { api } = setup();
    expect(api.baseUrl).toBe('http://srv');
    await expect(api.job('missing')).rejects.toMatchObject({ status: 404, code: 'job_not_found' });
    await expect(api.job('missing')).rejects.toBeInstanceOf(ApiError);
    expect((await api.health()).status).toBe('ok');
  });
});
