import { clone, ieeeMl, mlCompanion } from '@/testing/fixtures';

import { blockFullText, completenessVerdict, documentLetterCount, documentText, letterCount } from './completeness';

describe('letterCount', () => {
  it('counts letters and digits after Unicode folding and ignores layout and punctuation', () => {
    expect(letterCount('ﬁnd-\nings, 10%')).toBe(10); // f i n d i n g s 1 0
    expect(letterCount('x² + µ')).toBe(3);
    expect(letterCount('— … ( ) .')).toBe(0);
    expect(letterCount('')).toBe(0);
  });
});

describe('document text', () => {
  it('puts the removed prefix back in front of a block, and adds the text of images', () => {
    const heading = ieeeMl.blocks.find((b) => b.type === 'heading' && b.prefix)!;
    expect(blockFullText(heading).startsWith(heading.prefix as string)).toBe(true);
    const figure = ieeeMl.blocks.find((b) => b.type === 'figure' && b.inner_text)!;
    expect(blockFullText(figure)).toContain((figure.inner_text as string).split(/\s+/)[0]);
  });

  it('holds exactly the letters the converter counted in the PDF', () => {
    for (const doc of [ieeeMl, mlCompanion]) {
      const c = doc.quality.completeness!;
      expect(c.complete).toBe(true);
      // the converter counted letters in Python; the app counts them again in TypeScript
      expect(documentLetterCount(doc)).toBe(c.letters_in_pdf - c.duplicates - c.hidden);
    }
  });

  it('includes the omitted headers and footers in full', () => {
    const omitted = ieeeMl.quality.omitted[0];
    expect(documentText(ieeeMl)).toContain(omitted.text);
  });
});

describe('completenessVerdict', () => {
  it('says complete when nothing is missing', () => {
    expect(completenessVerdict(ieeeMl).kind).toBe('complete');
  });

  it('says recovered when stray text had to be put back', () => {
    const doc = clone(ieeeMl);
    doc.quality.completeness!.recovered = 40;
    expect(completenessVerdict(doc).kind).toBe('recovered');
  });

  it('says incomplete, with the numbers, when letters are missing', () => {
    const doc = clone(ieeeMl);
    Object.assign(doc.quality.completeness!, { complete: false, missing: 12, extra: 0 });
    expect(completenessVerdict(doc)).toMatchObject({ kind: 'incomplete', missing: 12, extra: 0 });
  });

  it('says unavailable when there is no text layer to compare with', () => {
    const doc = clone(ieeeMl);
    doc.quality.completeness = null;
    expect(completenessVerdict(doc).kind).toBe('unavailable');
    const scanned = clone(ieeeMl);
    scanned.quality.grade = 'unsupported';
    expect(completenessVerdict(scanned).kind).toBe('unavailable');
  });
});
