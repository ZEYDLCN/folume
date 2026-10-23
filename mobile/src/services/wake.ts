import type { FolumeApi } from './api';

const awake = new Set<string>();

/**
 * Free hosting lets a server sleep when it has not been used for a while, and the first request wakes it (up to a
 * minute). Asking as soon as the app opens means it is usually awake by the time a paper is added. Failures are
 * ignored here: an unreachable server is reported when something is actually sent to it.
 */
export async function wakeServer(api: FolumeApi, seen: Set<string> = awake): Promise<void> {
  if (seen.has(api.baseUrl)) return;
  try {
    await api.health();
    seen.add(api.baseUrl);
  } catch {
    /* not up yet; the import waits for it */
  }
}
