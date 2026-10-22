import { clone, ieeeMl } from '@/testing/fixtures';

import { buildQueue, speakable, Speaker, splitSentences, type SpeechEngine, type Utterance } from './speech';

const rendered = (b: { spans: { text: string }[]; text: string }) => (b.spans.length ? b.spans.map((s) => s.text).join('') : b.text);

describe('splitSentences', () => {
  const split = (t: string) => splitSentences(t).map((s) => t.slice(s.start, s.end));

  it('cuts at sentence ends and keeps the offsets exact', () => {
    expect(split('We study X. It works! Does it? Yes.')).toEqual(['We study X.', 'It works!', 'Does it?', 'Yes.']);
  });

  it('does not cut after abbreviations, initials, decimals or et al.', () => {
    expect(split('Smith et al. showed 3.14 is pi, e.g. here, in Fig. 2 and Eq. (3). Then J. R. Smith left.')).toEqual([
      'Smith et al. showed 3.14 is pi, e.g. here, in Fig. 2 and Eq. (3).',
      'Then J. R. Smith left.',
    ]);
  });

  it('keeps closing quotes and brackets with their sentence', () => {
    expect(split('He said “stop.” Then he left (quickly). Done.')).toEqual(['He said “stop.”', 'Then he left (quickly).', 'Done.']);
  });

  it('returns the whole text when there is no sentence end, and nothing for blanks', () => {
    expect(split('no end here')).toEqual(['no end here']);
    expect(split('   ')).toEqual([]);
  });

  it('covers every non-space character exactly once', () => {
    const t = 'First one. Second one! Third (maybe)? Fourth, e.g. this.';
    const covered = splitSentences(t).map((s) => t.slice(s.start, s.end)).join('');
    expect(covered.replace(/\s/g, '')).toBe(t.replace(/\s/g, ''));
  });
});

describe('speakable', () => {
  it('drops citation brackets and links, which are noise when heard', () => {
    expect(speakable('as shown in [9] and [1, 2] and [3–5], see https://x.org/a?b=1 now')).toBe('as shown in and and , see now'.replace(' ,', ','));
  });

  it('turns subscript and superscript markers into plain words', () => {
    expect(speakable('x_2 and 10^3')).toBe('x 2 and 10 3');
  });
});

describe('buildQueue', () => {
  it('lists the sentences of the readable blocks in order, with offsets into the text the reader draws', () => {
    const queue = buildQueue(ieeeMl);
    expect(queue.length).toBeGreaterThan(30);
    for (const u of queue) {
      const block = ieeeMl.blocks.find((b) => b.id === u.blockId)!;
      expect(rendered(block).slice(u.start, u.end)).toBe(u.text);
      expect(['title', 'heading', 'paragraph', 'list_item']).toContain(block.type);
    }
    const order = new Map(ieeeMl.blocks.map((b, i) => [b.id, i]));
    for (let i = 1; i < queue.length; i++) expect(order.get(queue[i].blockId)! >= order.get(queue[i - 1].blockId)!).toBe(true);
  });

  it('leaves out what is not worth hearing: authors, references, equations, figures, tables, code and footnotes', () => {
    const queue = buildQueue(ieeeMl);
    const kinds = new Set(queue.map((u) => ieeeMl.blocks.find((b) => b.id === u.blockId)!.type));
    for (const k of ['authors', 'reference', 'equation', 'figure', 'table', 'code', 'footnote', 'caption']) expect(kinds.has(k as never)).toBe(false);
  });

  it('starts at the block being read', () => {
    const middle = ieeeMl.blocks.filter((b) => b.type === 'paragraph')[5];
    const queue = buildQueue(ieeeMl, middle.id);
    expect(queue[0].blockId).toBe(middle.id);
    expect(queue.length).toBeLessThan(buildQueue(ieeeMl).length);
  });

  it('reads a heading without its number and skips sentences with nothing to say', () => {
    const doc = clone(ieeeMl);
    const p = doc.blocks.find((b) => b.type === 'paragraph')!;
    p.spans = [{ ...p.spans[0], text: '[1]. — . Real words follow here.' }];
    p.text = p.spans[0].text;
    const sentences = buildQueue(doc).filter((u) => u.blockId === p.id).map((u) => u.speak);
    expect(sentences).toEqual(['Real words follow here.']);
  });
});

class FakeEngine implements SpeechEngine {
  spoken: { text: string; rate: number; lang?: string }[] = [];
  stops = 0;
  private done: (() => void) | null = null;
  private fail: (() => void) | null = null;
  speak(text: string, opts: { lang?: string; rate: number }, h: { onDone(): void; onError(): void }) {
    this.spoken.push({ text, rate: opts.rate, lang: opts.lang });
    this.done = h.onDone;
    this.fail = h.onError;
  }
  stop() {
    this.stops += 1;
    this.done = null;
    this.fail = null;
  }
  finish() { const d = this.done; this.done = null; d?.(); }
  error() { const f = this.fail; this.fail = null; f?.(); }
}

const q = (n: number): Utterance[] => Array.from({ length: n }, (_, i) => ({ blockId: `b${i}`, start: 0, end: 5, text: `s${i}`, speak: `sentence ${i}` }));

describe('Speaker', () => {
  function make(n = 4) {
    const engine = new FakeEngine();
    const log: (string | null)[] = [];
    const states: string[] = [];
    const speaker = new Speaker(engine, q(n), { lang: 'en-US', rate: 1, onSentence: (u) => log.push(u ? u.speak : null), onState: (s) => states.push(s) });
    return { engine, speaker, log, states };
  }

  it('speaks sentence after sentence and finishes by itself', () => {
    const { engine, speaker, log, states } = make(3);
    speaker.play();
    engine.finish();
    engine.finish();
    engine.finish();
    expect(engine.spoken.map((s) => s.text)).toEqual(['sentence 0', 'sentence 1', 'sentence 2']);
    expect(log).toEqual(['sentence 0', 'sentence 1', 'sentence 2', null]);
    expect(states).toEqual(['playing', 'idle']);
    expect(speaker.state).toBe('idle');
  });

  it('pauses by stopping, and resumes from the same sentence', () => {
    const { engine, speaker } = make();
    speaker.play();
    engine.finish();
    speaker.pause();
    expect(speaker.state).toBe('paused');
    engine.finish(); // a late "done" from the stopped utterance must not move on
    expect(engine.spoken).toHaveLength(2);
    speaker.resume();
    expect(engine.spoken.map((s) => s.text)).toEqual(['sentence 0', 'sentence 1', 'sentence 1']);
  });

  it('jumps to the next and previous sentence, staying within the queue', () => {
    const { engine, speaker } = make(3);
    speaker.play();
    speaker.next();
    speaker.next();
    speaker.next(); // already on the last one
    speaker.prev();
    expect(engine.spoken.map((s) => s.text)).toEqual(['sentence 0', 'sentence 1', 'sentence 2', 'sentence 1']);
    speaker.prev();
    speaker.prev();
    expect(speaker.index).toBe(0);
  });

  it('applies a new speed from the next sentence and keeps the language', () => {
    const { engine, speaker } = make();
    speaker.play();
    speaker.setRate(1.5);
    engine.finish();
    expect(engine.spoken.map((s) => [s.rate, s.lang])).toEqual([[1, 'en-US'], [1.5, 'en-US']]);
  });

  it('skips a sentence the engine cannot speak instead of stopping', () => {
    const { engine, speaker } = make(3);
    speaker.play();
    engine.error();
    engine.finish();
    expect(engine.spoken.map((s) => s.text)).toEqual(['sentence 0', 'sentence 1', 'sentence 2']);
  });

  it('stops for good: nothing is spoken afterwards and the position is forgotten', () => {
    const { engine, speaker, log } = make();
    speaker.play();
    speaker.stop();
    engine.finish();
    expect(speaker.state).toBe('idle');
    expect(log[log.length - 1]).toBeNull();
    expect(engine.spoken).toHaveLength(1);
  });

  it('plays again from the beginning after it has finished', () => {
    const { engine, speaker } = make(2);
    speaker.play();
    engine.finish();
    engine.finish();
    expect(speaker.state).toBe('idle');
    speaker.resume();
    expect(engine.spoken.map((s) => s.text)).toEqual(['sentence 0', 'sentence 1', 'sentence 0']);
  });

  it('can start in the middle', () => {
    const { engine, speaker } = make(5);
    speaker.play(3);
    expect(engine.spoken[0].text).toBe('sentence 3');
  });
});
