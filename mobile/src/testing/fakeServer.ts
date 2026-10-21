import type { Document } from '@/core/types';

/** In-memory stand-in for the conversion API, speaking the same HTTP contract. */
export interface FakeServerOptions {
  doc: Document;
  /** how many status polls report "processing" before the job completes */
  processingPolls?: number;
  failWith?: { code: string; message: string; status?: number };
  requireKey?: string;
  /** the link import fails the way the real server reports it, after the download stage */
  failUrl?: { code: string; message: string };
}

export function createFakeServer(opts: FakeServerOptions) {
  const jobs = new Map<string, { polls: number }>();
  const deleted: string[] = [];
  const calls: string[] = [];
  const urlBodies: { url: string }[] = [];
  const urlJobs = new Set<string>();
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const assetBytes = (path: string) => new TextEncoder().encode(`bytes-of:${path}`);

  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const path = url.pathname;
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (opts.requireKey && headers['X-API-Key'] !== opts.requireKey) {
      return json(401, { error: { code: 'unauthorized', message: 'Invalid API key' } });
    }
    if (path === '/v1/documents/from-url' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body ?? '{}')) as { url: string };
      urlBodies.push(body);
      if (!body.url || body.url.startsWith('javascript:')) {
        return json(422, { error: { code: 'invalid_url', message: 'This does not look like a link to a paper' } });
      }
      const id = `job${jobs.size + 1}`;
      jobs.set(id, { polls: 0 });
      urlJobs.add(id);
      return json(202, { id, status: 'processing', stage: 'download', progress: 0.01, error: null, expires_at: 0 });
    }
    if (path === '/v1/documents' && init?.method === 'POST') {
      if (opts.failWith && opts.failWith.status) {
        return json(opts.failWith.status, { error: { code: opts.failWith.code, message: opts.failWith.message } });
      }
      const id = `job${jobs.size + 1}`;
      jobs.set(id, { polls: 0 });
      return json(202, { id, status: 'processing', stage: 'extract', progress: 0.02, error: null, expires_at: 0 });
    }
    const m = path.match(/^\/v1\/jobs\/([^/]+)(?:\/(document|assets\/.+))?$/);
    if (m) {
      const [, id, rest] = m;
      const job = jobs.get(id);
      if (!job) return json(404, { error: { code: 'job_not_found', message: 'Unknown job' } });
      if (init?.method === 'DELETE') {
        jobs.delete(id);
        deleted.push(id);
        return new Response(null, { status: 204 });
      }
      if (!rest) {
        job.polls += 1;
        if (urlJobs.has(id) && opts.failUrl) {
          return json(200, { id, status: 'failed', stage: 'download', progress: 0.01, error: opts.failUrl, expires_at: 0 });
        }
        if (urlJobs.has(id) && job.polls === 1) {
          return json(200, { id, status: 'processing', stage: 'download', progress: 0.02, error: null, expires_at: 0 });
        }
        if (opts.failWith && !opts.failWith.status) {
          return json(200, { id, status: 'failed', stage: 'extract', progress: 0.3,
            error: { code: opts.failWith.code, message: opts.failWith.message }, expires_at: 0 });
        }
        const done = job.polls > (opts.processingPolls ?? 1);
        return json(200, { id, status: done ? 'done' : 'processing', stage: done ? 'done' : 'layout',
          progress: done ? 1 : 0.5, error: null, expires_at: 0 });
      }
      if (rest === 'document') return json(200, opts.doc);
      if (rest.startsWith('assets/')) {
        const bytes = assetBytes(rest.slice('assets/'.length));
        return new Response(bytes.buffer as ArrayBuffer, { status: 200 });
      }
    }
    if (path === '/v1/health') return json(200, { status: 'ok', version: 'test' });
    return json(404, { error: { code: 'not_found', message: path } });
  };
  return { fetch: fetchFn as typeof fetch, jobs, deleted, calls, assetBytes, urlBodies };
}
