import { ieeeMl } from '@/testing/fixtures';

import { buildFeedbackBundle } from './feedback';
import { unzip } from './export/zip';

const NOW = new Date(Date.UTC(2026, 9, 22, 9, 0, 0));
const jpg = Uint8Array.from([255, 216, 255, 224, 1, 2, 3]);

describe('buildFeedbackBundle', () => {
  const block = ieeeMl.blocks.find((b) => b.type === 'paragraph' && b.source[0].page === 2)!;
  const bundle = buildFeedbackBundle({ doc: ieeeMl, blockId: block.id, note: 'These two paragraphs are one.', appVersion: '0.1.0', pageImage: jpg, now: NOW });
  const files = unzip(bundle.bytes);
  const report = JSON.parse(new TextDecoder().decode(files.get('report.json')));

  it('is a zip with a report and the page picture, named so it can be told apart', () => {
    expect([...files.keys()].sort()).toEqual(['page-2.jpg', 'report.json']);
    expect(files.get('page-2.jpg')).toEqual(jpg);
    expect(bundle.filename).toMatch(/^folume-feedback-[A-Za-z0-9]{1,8}-b\d+\.zip$/);
  });

  it('says exactly what the converter produced for the block, and around it', () => {
    expect(report.format).toBe('folume-feedback');
    expect(report.note).toBe('These two paragraphs are one.');
    expect(report.createdAt).toBe('2026-10-22T09:00:00.000Z');
    expect(report.block).toEqual(JSON.parse(JSON.stringify(block)));
    expect(report.before.id).toBe(ieeeMl.blocks[ieeeMl.blocks.indexOf(block) - 1].id);
    expect(report.after.id).toBe(ieeeMl.blocks[ieeeMl.blocks.indexOf(block) + 1].id);
    expect(report.page).toMatchObject({ number: 2 });
    expect(report.paper.schema_version).toBe(ieeeMl.schema_version);
    expect(report.paper.parser).toEqual(ieeeMl.parser);
    expect(report.quality.grade).toBe(ieeeMl.quality.grade);
    expect(report.quality.completeness.complete).toBe(true);
  });

  it('leaves out the rest of the paper: other blocks only appear as ids and types next to the one reported', () => {
    const text = new TextDecoder().decode(files.get('report.json'));
    const other = ieeeMl.blocks.find((b) => b.type === 'paragraph' && b.id !== block.id && ![report.before.id, report.after.id].includes(b.id))!;
    expect(text).not.toContain(other.text.slice(0, 60));
    expect(JSON.stringify(report.before)).not.toContain('spans');
  });

  it('works without a picture and is reproducible', () => {
    const bare = buildFeedbackBundle({ doc: ieeeMl, blockId: block.id, note: '', appVersion: '0.1.0', now: NOW });
    expect([...unzip(bare.bytes).keys()]).toEqual(['report.json']);
    expect(buildFeedbackBundle({ doc: ieeeMl, blockId: block.id, note: '', appVersion: '0.1.0', now: NOW }).bytes).toEqual(bare.bytes);
  });

  it('refuses a block that is not in the paper', () => {
    expect(() => buildFeedbackBundle({ doc: ieeeMl, blockId: 'nope', note: '', appVersion: '1' })).toThrow(/block/i);
  });
});
