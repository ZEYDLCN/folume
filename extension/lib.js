// What the extension decides, kept apart from the browser so it can be tested: where the app is, and what to send.

export const DEFAULT_APP_URL = 'http://localhost:8081';

/** The app's address from what was typed: http(s) only, no credentials, no query or fragment, no trailing slash; or null. */
export function normalizeAppUrl(raw) {
  let url;
  try {
    url = new URL(String(raw ?? '').trim());
  } catch {
    return null;
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname || url.username || url.password) return null;
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

/** The address that opens the app and starts adding `target` (same shape as the app's own `importLink`). */
export function importLink(appUrl, target) {
  const base = normalizeAppUrl(appUrl);
  if (!base) throw new Error('bad_app_url');
  return `${base}/?import=${encodeURIComponent(target)}`;
}

const SENDABLE = /^https?:\/\//i;

/**
 * What to send for a click: a link that was right-clicked, else selected text that looks like a DOI or arXiv id,
 * else the page. Only web addresses, DOIs and arXiv ids are sent; the app and server decide what they mean.
 */
export function pickTarget({ linkUrl, selectionText, pageUrl, tabUrl } = {}) {
  const link = (linkUrl ?? '').trim();
  if (SENDABLE.test(link)) return link;
  const selected = (selectionText ?? '').trim().replace(/\s+/g, '');
  if (/^(?:arxiv:|doi:)?(?:10\.\d{4,9}\/\S+|\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?)$/i.test(selected)) return selected;
  for (const candidate of [pageUrl, tabUrl]) {
    if (SENDABLE.test((candidate ?? '').trim())) return candidate.trim();
  }
  return null;
}
