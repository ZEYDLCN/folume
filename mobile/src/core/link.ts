/**
 * What a pasted text looks like, so the import dialog can say "arXiv 2401.01234" or "this is not a link" before
 * anything is sent. The server decides what is actually fetched (see backend/src/folume/fetch.py).
 */
export type LinkKind = 'arxiv' | 'doi' | 'url';

export interface LinkInfo {
  kind: LinkKind;
  /** shown back to the reader: the arXiv id, the DOI, or the host */
  label: string;
}

const ARXIV_NEW = String.raw`\d{4}\.\d{4,5}(?:v\d+)?`;
const ARXIV_OLD = String.raw`[a-z\-]+(?:\.[A-Z]{2})?/\d{7}(?:v\d+)?`;
const ARXIV_ID = new RegExp(`^(?:${ARXIV_NEW}|${ARXIV_OLD})$`);
const DOI = /^10\.\d{4,9}\/\S+$/;
const BARE_HOST = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#].*)?$/i;

export function classifyLink(raw: string): LinkInfo | null {
  const text = (raw ?? '').trim().replace(/^(arxiv|doi)\s*:\s*/i, (_m, p: string) => `${p.toLowerCase()}:`);
  if (!text || text.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(text)) return null;
  const bare = text.replace(/^(?:arxiv|doi):/i, '');
  if (ARXIV_ID.test(bare)) return { kind: 'arxiv', label: bare };
  if (DOI.test(bare)) {
    const m = /^10\.48550\/arxiv\.(.+)$/i.exec(bare);
    return m ? { kind: 'arxiv', label: m[1] } : { kind: 'doi', label: bare };
  }
  let candidate = text;
  if (!candidate.includes('://')) {
    if (/^(?:javascript|data|file|mailto|tel):/i.test(candidate) || !BARE_HOST.test(candidate)) return null;
    candidate = `https://${candidate}`;
  }
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (/(^|\.)arxiv\.org$/.test(host)) {
    const m = /^\/(?:abs|pdf)\/(.+?)(?:\.pdf)?\/?$/.exec(decodeURIComponent(url.pathname));
    if (m && ARXIV_ID.test(m[1])) return { kind: 'arxiv', label: m[1] };
  }
  if (host === 'doi.org' || host === 'dx.doi.org') {
    const doi = decodeURIComponent(url.pathname).replace(/^\//, '');
    if (DOI.test(doi)) return { kind: 'doi', label: doi };
  }
  return { kind: 'url', label: host.replace(/^www\./, '') };
}
