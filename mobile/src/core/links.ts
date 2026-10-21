/**
 * Links in a converted document are data from a server, not code: only plain web, mail and DOI links are ever opened.
 * Anything else (javascript:, data:, file:, intent:, custom app schemes) is dropped.
 */
export function safeExternalUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const url = raw.trim();
  if (url.length === 0 || url.length > 2048 || /[\u0000-\u001f\u007f]/.test(url)) return null;
  const doi = /^doi:\s*(10\.\d{4,9}\/\S+)$/i.exec(url);
  if (doi) return `https://doi.org/${doi[1]}`;
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(url);
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  if (scheme === 'http' || scheme === 'https') {
    try {
      const parsed = new URL(url);
      return parsed.hostname ? parsed.toString() : null;
    } catch {
      return null;
    }
  }
  return scheme === 'mailto' && /^mailto:[^\s@]+@[^\s@]+$/i.test(url) ? url : null;
}
