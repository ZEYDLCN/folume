/**
 * "Send to Folume": the ways a paper reaches the app from elsewhere (a browser's share menu, an extension, a
 * bookmarklet, a deep link) all end in one address: the library with `?import=` set to the paper.
 */
import { classifyLink } from './link';

export interface Shared {
  url?: string | null;
  text?: string | null;
  title?: string | null;
}

const TRAILING = /[.,;:!?)\]}>'"”’»]+$/;
const LEADING = /^[(\[{<'"“‘«]+/;
const MAX_SCAN = 20_000;

/** How well a token names a paper: arXiv first, then DOI, then a web link, then a bare host name. */
function rank(token: string): number {
  const info = classifyLink(token);
  if (!info) return 0;
  if (info.kind === 'arxiv') return 4;
  if (info.kind === 'doi') return 3;
  return /^https?:\/\//i.test(token) ? 2 : 1;
}

function best(text: string): string | null {
  let found: { token: string; score: number } | null = null;
  for (const raw of text.slice(0, MAX_SCAN).split(/\s+/)) {
    const token = raw.replace(LEADING, '').replace(TRAILING, '');
    if (!token || token.length > 2048) continue;
    const score = rank(token);
    if (score > (found?.score ?? 0)) found = { token, score };
    if (found?.score === 4) break;
  }
  return found?.token ?? null;
}

/** The paper in what another app handed over: the link if there is one, else the best candidate in the text or title. */
export function paperFromShared(shared: Shared): string | null {
  const direct = (shared.url ?? '').trim();
  if (direct && classifyLink(direct)) return direct;
  return best(shared.text ?? '') ?? best(shared.title ?? '');
}

/** The address that opens the app and starts adding `target`. */
export function importLink(appUrl: string, target: string): string {
  const base = appUrl.trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
  return `${base}/?import=${encodeURIComponent(target)}`;
}

/** A bookmark that, clicked on a page, opens the app to add that page's paper. */
export function bookmarklet(appUrl: string): string {
  const base = JSON.stringify(appUrl.trim().replace(/[?#].*$/, '').replace(/\/+$/, '')).replace(/</g, '\\u003c');
  const body = `(function(){window.open(${base}+'/?import='+encodeURIComponent(location.href))})()`;
  return `javascript:${encodeURIComponent(body)}`;
}
