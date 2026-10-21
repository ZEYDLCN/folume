import { crc32, unzip, zipStore } from './zip';

const enc = (s: string) => new TextEncoder().encode(s);

describe('crc32', () => {
  it('matches the standard check values', () => {
    expect(crc32(enc('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
    expect(crc32(enc('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });
});

describe('zipStore', () => {
  it('round trips files, names and bytes', () => {
    const bin = Uint8Array.from({ length: 1000 }, (_, i) => (i * 7) & 255);
    const zip = zipStore([
      { name: 'mimetype', data: 'application/epub+zip' },
      { name: 'a/b/c.txt', data: 'héllo wörld ı ş ğ' },
      { name: 'img.png', data: bin },
      { name: 'empty', data: new Uint8Array(0) },
    ]);
    const files = unzip(zip);
    expect([...files.keys()]).toEqual(['mimetype', 'a/b/c.txt', 'img.png', 'empty']);
    expect(new TextDecoder().decode(files.get('a/b/c.txt'))).toBe('héllo wörld ı ş ğ');
    expect(files.get('img.png')).toEqual(bin);
    expect(files.get('empty')!.length).toBe(0);
  });

  it('writes the first entry first and uncompressed with no extra field (what EPUB requires of its mimetype file)', () => {
    const zip = zipStore([{ name: 'mimetype', data: 'application/epub+zip' }, { name: 'x', data: 'y' }]);
    const text = new TextDecoder('latin1').decode(zip.subarray(0, 60));
    expect(text.startsWith('PK\u0003\u0004')).toBe(true);
    expect(text.slice(30)).toMatch(/^mimetypeapplication\/epub\+zip/);
    const view = new DataView(zip.buffer, zip.byteOffset);
    expect(view.getUint16(8, true)).toBe(0); // stored
    expect(view.getUint16(28, true)).toBe(0); // no extra field
  });

  it('is deterministic for the same input and time', () => {
    const when = new Date(Date.UTC(2026, 0, 2, 3, 4, 6));
    const a = zipStore([{ name: 'a', data: 'x' }], when);
    const b = zipStore([{ name: 'a', data: 'x' }], when);
    expect(a).toEqual(b);
  });

  it('refuses duplicate names, unsafe names and too many entries', () => {
    expect(() => zipStore([{ name: 'a', data: '' }, { name: 'a', data: '' }])).toThrow(/duplicate/i);
    expect(() => zipStore([{ name: '../evil', data: '' }])).toThrow(/name/i);
    expect(() => zipStore([{ name: '/abs', data: '' }])).toThrow(/name/i);
    expect(() => zipStore(Array.from({ length: 65536 }, (_, i) => ({ name: `f${i}`, data: '' })))).toThrow(/too many/i);
  });

  it('detects a damaged archive when reading it back', () => {
    const zip = zipStore([{ name: 'a.txt', data: 'hello hello hello' }]);
    const bad = zip.slice();
    bad[40] ^= 0xff; // flip a byte of the file data
    expect(() => unzip(bad)).toThrow(/crc/i);
    expect(() => unzip(enc('not a zip file at all, really not'))).toThrow(/zip/i);
  });
});
