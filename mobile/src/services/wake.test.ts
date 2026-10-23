import { FolumeApi } from './api';
import { wakeServer } from './wake';

const apiWith = (calls: string[], fail = false) =>
  new FolumeApi(
    { baseUrl: 'http://srv/' },
    (async (url: string) => {
      calls.push(url);
      if (fail) throw new TypeError('network');
      return new Response('{"status":"ok","version":"0"}');
    }) as unknown as typeof fetch,
  );

describe('wakeServer', () => {
  it('asks a server once so it is awake by the time a paper is sent', async () => {
    const calls: string[] = [];
    const seen = new Set<string>();
    await wakeServer(apiWith(calls), seen);
    await wakeServer(apiWith(calls), seen);
    expect(calls).toEqual(['http://srv/v1/health']);
  });

  it('asks again after the address changed', async () => {
    const calls: string[] = [];
    const seen = new Set<string>();
    await wakeServer(apiWith(calls), seen);
    await wakeServer(new FolumeApi({ baseUrl: 'http://other/' }, (async (u: string) => (calls.push(u), new Response('{}'))) as unknown as typeof fetch), seen);
    expect(calls).toEqual(['http://srv/v1/health', 'http://other/v1/health']);
  });

  it('never complains: an unreachable server is reported when something is actually sent to it', async () => {
    const calls: string[] = [];
    await expect(wakeServer(apiWith(calls, true), new Set())).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it('tries again next time when the server did not answer', async () => {
    const calls: string[] = [];
    const seen = new Set<string>();
    await wakeServer(apiWith(calls, true), seen);
    await wakeServer(apiWith(calls, true), seen);
    expect(calls).toHaveLength(2);
  });
});
