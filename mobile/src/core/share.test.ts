import { runInNewContext } from 'vm';

import { bookmarklet, importLink, paperFromShared } from './share';

describe('paperFromShared', () => {
  it('takes the link when one is handed over', () => {
    expect(paperFromShared({ url: 'https://arxiv.org/abs/2401.01234' })).toBe('https://arxiv.org/abs/2401.01234');
    expect(paperFromShared({ url: '  https://example.org/paper.pdf  ', text: 'ignored https://other.org/x' })).toBe('https://example.org/paper.pdf');
  });

  it('finds the paper in shared text, as Android hands over a page: title and link in one string', () => {
    expect(paperFromShared({ text: 'Sparse Routing for Efficient Transformers https://arxiv.org/abs/2401.01234v2' })).toBe('https://arxiv.org/abs/2401.01234v2');
    expect(paperFromShared({ text: 'Look at this paper!! https://arxiv.org/abs/2401.01234.' })).toBe('https://arxiv.org/abs/2401.01234');
    expect(paperFromShared({ text: '(see https://doi.org/10.1145/3292500.3330701)' })).toBe('https://doi.org/10.1145/3292500.3330701');
  });

  it('knows an arXiv id or a DOI written on its own', () => {
    expect(paperFromShared({ text: 'must read: arXiv:2401.01234 today' })).toBe('arXiv:2401.01234');
    expect(paperFromShared({ text: 'DOI 10.1145/3292500.3330701, very good' })).toBe('10.1145/3292500.3330701');
    expect(paperFromShared({ text: 'hep-th/9901001' })).toBe('hep-th/9901001');
  });

  it('prefers what names a paper over an ordinary link', () => {
    expect(paperFromShared({ text: 'https://twitter.com/x/status/1 and also https://arxiv.org/abs/2401.01234' })).toBe('https://arxiv.org/abs/2401.01234');
    expect(paperFromShared({ text: 'https://example.org/a and https://example.org/b' })).toBe('https://example.org/a');
    expect(paperFromShared({ text: 'paper.pdf is at https://example.org/paper.pdf' })).toBe('https://example.org/paper.pdf');
  });

  it('looks at the title last, then gives up', () => {
    expect(paperFromShared({ title: 'https://arxiv.org/abs/2401.01234' })).toBe('https://arxiv.org/abs/2401.01234');
    expect(paperFromShared({ text: 'just some words, nothing to open.', title: 'A title' })).toBeNull();
    expect(paperFromShared({})).toBeNull();
  });

  it('never hands on a script, a file or a data address', () => {
    expect(paperFromShared({ url: 'javascript:alert(1)' })).toBeNull();
    expect(paperFromShared({ text: 'data:text/html,<script>1</script> file:///etc/passwd' })).toBeNull();
    expect(paperFromShared({ text: 'mailto:me@example.org' })).toBeNull();
  });

  it('copes with very long or odd input', () => {
    expect(paperFromShared({ text: 'x '.repeat(5_000) + 'https://arxiv.org/abs/2401.01234' })).toBe('https://arxiv.org/abs/2401.01234');
    // a share is a page title and a link, not a book: only the first 20,000 characters are read
    expect(paperFromShared({ text: 'x '.repeat(50_000) + 'https://arxiv.org/abs/2401.01234' })).toBeNull();
    expect(paperFromShared({ text: 'a'.repeat(5000) })).toBeNull();
  });
});

describe('importLink', () => {
  it('opens the app on its library with the paper to add', () => {
    expect(importLink('https://folume.example.org', 'https://arxiv.org/abs/2401.01234')).toBe('https://folume.example.org/?import=https%3A%2F%2Farxiv.org%2Fabs%2F2401.01234');
  });
  it('copes with a trailing slash and an app that lives under a path', () => {
    expect(importLink('http://localhost:8081/', '2401.01234')).toBe('http://localhost:8081/?import=2401.01234');
    expect(importLink('https://example.org/folume/', '2401.01234')).toBe('https://example.org/folume/?import=2401.01234');
  });
  it('escapes everything that could change what is asked for', () => {
    const link = importLink('https://a.org', 'https://x.org/p?a=1&import=evil#frag');
    expect(new URL(link).searchParams.get('import')).toBe('https://x.org/p?a=1&import=evil#frag');
    expect(new URL(link).hash).toBe('');
  });
});

describe('bookmarklet', () => {
  const code = bookmarklet('https://folume.example.org');

  it('is a javascript: address on one line that opens the app with the page being read', () => {
    expect(code.startsWith('javascript:')).toBe(true);
    expect(code).not.toMatch(/\n/);
    const opened: string[] = [];
    runInNewContext(decodeURIComponent(code.slice('javascript:'.length)), {
      window: { open: (u: string) => opened.push(u) },
      location: { href: 'https://arxiv.org/abs/2401.01234?x=1&y=2' },
      encodeURIComponent,
    });
    expect(opened).toEqual(['https://folume.example.org/?import=https%3A%2F%2Farxiv.org%2Fabs%2F2401.01234%3Fx%3D1%26y%3D2']);
  });

  it('keeps the app address out of reach of quotes and script endings', () => {
    const evil = bookmarklet("https://a.org/'+alert(1)+'</script>");
    const opened: string[] = [];
    const alerts: number[] = [];
    runInNewContext(decodeURIComponent(evil.slice('javascript:'.length)), {
      window: { open: (u: string) => opened.push(u) },
      location: { href: 'https://x.org/' },
      encodeURIComponent,
      alert: () => alerts.push(1),
    });
    expect(alerts).toEqual([]);
    expect(opened).toHaveLength(1);
  });
});
