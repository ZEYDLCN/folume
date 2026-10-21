import { safeExternalUrl } from './links';

describe('safeExternalUrl', () => {
  it('allows web, mail and DOI links', () => {
    expect(safeExternalUrl('https://example.org/paper?id=1')).toBe('https://example.org/paper?id=1');
    expect(safeExternalUrl(' http://example.org ')).toBe('http://example.org/');
    expect(safeExternalUrl('mailto:author@university.edu')).toBe('mailto:author@university.edu');
    expect(safeExternalUrl('doi:10.1234/abc.def')).toBe('https://doi.org/10.1234/abc.def');
  });

  it('drops everything that could run code or open another app', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'intent://scan/#Intent;scheme=zxing;end',
      'tel:+900000000',
      'myapp://do/something',
      'https://',
      'example.org/no-scheme',
      'java\nscript:alert(1)',
      'mailto:not an address',
      '',
      `https://example.org/${'a'.repeat(3000)}`,
    ]) {
      expect(safeExternalUrl(bad)).toBeNull();
    }
    expect(safeExternalUrl(undefined)).toBeNull();
    expect(safeExternalUrl(42)).toBeNull();
  });
});
