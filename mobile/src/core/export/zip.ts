/** A small ZIP writer (stored, no compression) and reader: enough for EPUB and for bundles of Markdown with images. */

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array | string;
}

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const MAX_ENTRIES = 0xffff;

function dosTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getUTCFullYear());
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

/** Writes entries in the given order, uncompressed. The same input and time give the same bytes. */
export function zipStore(entries: ZipEntry[], when: Date = new Date(Date.UTC(1980, 0, 1))): Uint8Array {
  if (entries.length > MAX_ENTRIES) throw new Error('too many entries for a ZIP file');
  const enc = new TextEncoder();
  const seen = new Set<string>();
  const items = entries.map((e) => {
    if (!e.name || e.name.startsWith('/') || e.name.split('/').includes('..') || e.name.includes('\\')) {
      throw new Error(`unsafe entry name: ${e.name}`);
    }
    if (seen.has(e.name)) throw new Error(`duplicate entry: ${e.name}`);
    seen.add(e.name);
    const data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    return { name: enc.encode(e.name), data, crc: crc32(data) };
  });
  const total = items.reduce((n, i) => n + 30 + i.name.length + i.data.length + 46 + i.name.length, 22);
  if (total > 0xffffffff) throw new Error('archive too large for a ZIP file');
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  const { time, date } = dosTime(when);
  let pos = 0;
  const offsets: number[] = [];
  for (const i of items) {
    offsets.push(pos);
    view.setUint32(pos, LOCAL, true);
    view.setUint16(pos + 4, 20, true);
    view.setUint16(pos + 6, 0x0800, true); // names are UTF-8
    view.setUint16(pos + 8, 0, true); // stored
    view.setUint16(pos + 10, time, true);
    view.setUint16(pos + 12, date, true);
    view.setUint32(pos + 14, i.crc, true);
    view.setUint32(pos + 18, i.data.length, true);
    view.setUint32(pos + 22, i.data.length, true);
    view.setUint16(pos + 26, i.name.length, true);
    view.setUint16(pos + 28, 0, true);
    out.set(i.name, pos + 30);
    out.set(i.data, pos + 30 + i.name.length);
    pos += 30 + i.name.length + i.data.length;
  }
  const centralStart = pos;
  items.forEach((i, n) => {
    view.setUint32(pos, CENTRAL, true);
    view.setUint16(pos + 4, 20, true);
    view.setUint16(pos + 6, 20, true);
    view.setUint16(pos + 8, 0x0800, true);
    view.setUint16(pos + 10, 0, true);
    view.setUint16(pos + 12, time, true);
    view.setUint16(pos + 14, date, true);
    view.setUint32(pos + 16, i.crc, true);
    view.setUint32(pos + 20, i.data.length, true);
    view.setUint32(pos + 24, i.data.length, true);
    view.setUint16(pos + 28, i.name.length, true);
    view.setUint32(pos + 42, offsets[n], true);
    out.set(i.name, pos + 46);
    pos += 46 + i.name.length;
  });
  view.setUint32(pos, END, true);
  view.setUint16(pos + 8, items.length, true);
  view.setUint16(pos + 10, items.length, true);
  view.setUint32(pos + 12, pos - centralStart, true);
  view.setUint32(pos + 16, centralStart, true);
  return out;
}

/** Reads an archive written by `zipStore` (stored entries). Used by tests and the end-to-end checks. */
export function unzip(zip: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let end = zip.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== END) end--;
  if (end < 0) throw new Error('not a ZIP file');
  const count = view.getUint16(end + 10, true);
  let pos = view.getUint32(end + 16, true);
  const dec = new TextDecoder();
  const files = new Map<string, Uint8Array>();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(pos, true) !== CENTRAL) throw new Error('damaged ZIP directory');
    const method = view.getUint16(pos + 10, true);
    const crc = view.getUint32(pos + 16, true);
    const size = view.getUint32(pos + 24, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const local = view.getUint32(pos + 42, true);
    const name = dec.decode(zip.subarray(pos + 46, pos + 46 + nameLen));
    if (method !== 0) throw new Error(`entry ${name} is compressed`);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = zip.slice(start, start + size);
    if (crc32(data) !== crc) throw new Error(`CRC mismatch in ${name}`);
    files.set(name, data);
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}
