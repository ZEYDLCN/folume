import { ApiError, FolumeApi } from './api';

const answer = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('FolumeApi.feed', () => {
  it('asks for a category and keywords, with the key, and returns the papers', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string> });
      return new Response(JSON.stringify({ source: 'arxiv', items: [], cached: false, stale: false }), { status: 200 });
    }) as unknown as typeof fetch;
    const api = new FolumeApi({ baseUrl: 'http://localhost:8000/', apiKey: 'k' }, fetchFn);
    const res = await api.feed({ category: 'cs.LG', q: 'sparse routing & more', limit: 15 });
    expect(res.items).toEqual([]);
    const url = new URL(calls[0].url);
    expect(url.origin + url.pathname).toBe('http://localhost:8000/v1/feed/arxiv');
    expect(url.searchParams.get('category')).toBe('cs.LG');
    expect(url.searchParams.get('q')).toBe('sparse routing & more');
    expect(url.searchParams.get('limit')).toBe('15');
    expect(calls[0].headers['X-API-Key']).toBe('k');
  });

  it('leaves out what is not asked for', async () => {
    let seen = '';
    const fetchFn = (async (url: string) => {
      seen = url;
      return new Response('{"source":"arxiv","items":[],"cached":false,"stale":false}', { status: 200 });
    }) as unknown as typeof fetch;
    await new FolumeApi({ baseUrl: 'http://x' }, fetchFn).feed({ category: null, q: 'graphs' });
    expect(seen).toBe('http://x/v1/feed/arxiv?q=graphs');
  });

  it('turns the server’s reasons into errors', async () => {
    const off = new FolumeApi({ baseUrl: 'http://x' }, answer(404, { error: { code: 'feed_disabled', message: 'off' } }) as unknown as typeof fetch);
    await expect(off.feed({ category: 'cs.LG' })).rejects.toMatchObject({ code: 'feed_disabled', status: 404 });
    const down = new FolumeApi({ baseUrl: 'http://x' }, answer(502, { error: { code: 'feed_failed', message: 'later' } }) as unknown as typeof fetch);
    await expect(down.feed({ category: 'cs.LG' })).rejects.toBeInstanceOf(ApiError);
    const none = new FolumeApi({ baseUrl: 'http://x' }, (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch);
    await expect(none.feed({ category: 'cs.LG' })).rejects.toMatchObject({ code: 'network' });
  });
});
