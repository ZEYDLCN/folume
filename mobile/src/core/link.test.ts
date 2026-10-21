import { classifyLink } from './link';

describe('classifyLink', () => {
  it.each([
    ['arXiv:2401.01234', 'arxiv', '2401.01234'],
    ['2401.01234v2', 'arxiv', '2401.01234v2'],
    ['https://arxiv.org/abs/2401.01234', 'arxiv', '2401.01234'],
    ['http://arxiv.org/pdf/2401.01234.pdf', 'arxiv', '2401.01234'],
    ['https://export.arxiv.org/abs/hep-th/9901001', 'arxiv', 'hep-th/9901001'],
    ['doi:10.48550/arXiv.2401.01234', 'arxiv', '2401.01234'],
    ['10.1145/3292500.3330701', 'doi', '10.1145/3292500.3330701'],
    ['DOI: 10.1109/5.771073', 'doi', '10.1109/5.771073'],
    ['https://doi.org/10.1109/5.771073', 'doi', '10.1109/5.771073'],
    ['https://www.example.org/papers/a.pdf', 'url', 'example.org'],
    ['example.org/papers/a.pdf', 'url', 'example.org'],
    ['  https://openreview.net/forum?id=ABC123  ', 'url', 'openreview.net'],
  ])('reads %s as %s', (raw, kind, label) => {
    expect(classifyLink(raw)).toEqual({ kind, label });
  });

  it.each([
    '',
    '   ',
    'not a link at all',
    'ftp://example.org/a.pdf',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'data:application/pdf;base64,AAAA',
    'http://user:secret@example.org/a.pdf',
    'https://',
    'https://exa mple.org',
    `https://example.org/${'a'.repeat(3000)}`,
  ])('refuses %j', (raw) => {
    expect(classifyLink(raw)).toBeNull();
  });
});
