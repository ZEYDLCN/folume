import { base64ToBytes, bytesToBase64, mimeForPath, toDataUri } from './base64';

describe('base64', () => {
  it('matches the reference encoder for all remainder lengths', () => {
    for (const text of ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar']) {
      const bytes = new TextEncoder().encode(text);
      expect(bytesToBase64(bytes)).toBe(Buffer.from(text).toString('base64'));
      expect(Buffer.from(base64ToBytes(bytesToBase64(bytes))).toString()).toBe(text);
    }
  });

  it('round-trips arbitrary binary data', () => {
    const bytes = new Uint8Array(1000).map((_, i) => (i * 37) % 256);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it('builds data URIs and guesses mime types', () => {
    expect(toDataUri(new Uint8Array([1, 2, 3]), 'image/png')).toBe('data:image/png;base64,AQID');
    expect(mimeForPath('figures/f0001.png')).toBe('image/png');
    expect(mimeForPath('pages/p001.jpg')).toBe('image/jpeg');
  });
});
