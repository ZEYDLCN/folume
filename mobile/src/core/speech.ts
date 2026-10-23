/** Listening to a paper: which sentences to read, in what order, and a small player over any speech engine. */
import type { Block, Document } from './types';

export interface Utterance {
  blockId: string;
  /** offsets into the text the reader draws for this block (what highlights use) */
  start: number;
  end: number;
  text: string;
  /** what is actually said: citations and links removed */
  speak: string;
}

// words that usually start a sentence: after "X." one of these means the sentence ended, it was not an initial
const STARTERS = new Set(
  ('the this that these those it its we our they their he she in on for a an as at by if there then however thus here let note see since ' +
    'when while with each both such to but and so or once after before given using moreover furthermore finally first second third also instead ' +
    'where which what how why all some most many in').split(' '),
);

const ABBREVIATIONS = new Set(
  'e.g i.e et al vs fig figs eq eqs tab sec secs dr prof mr mrs ms approx cf resp no vol pp p ch ref refs inc ltd st'.split(' '),
);

/** Sentence ranges of `text` (leading and trailing white space excluded), cut at . ! ? … not after abbreviations or initials. */
export function splitSentences(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let from = 0;
  const re = /[.!?…]+["”’')\]]*(?=\s+)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const end = m.index + m[0].length;
    const after = /^\s+(.)/.exec(text.slice(end))?.[1] ?? '';
    const before = text.slice(from, m.index).match(/([\p{L}.]+)$/u)?.[1] ?? '';
    const word = before.replace(/\.$/, '').toLowerCase();
    const lastDot = text[m.index] === '.' && m[0].replace(/["”’')\]]/g, '').length === 1;
    const nextWord = /^\s+([\p{L}]+)/u.exec(text.slice(end))?.[1] ?? '';
    // "J. R. Smith": a single capital letter before a name is an initial; before "The", "It", "We"… it ends the sentence ("variable X. The")
    const initial = lastDot && /^\p{Lu}$/u.test(before.slice(-1)) && (before.length === 1 || before[before.length - 2] === '.') && !STARTERS.has(nextWord.toLowerCase());
    const abbreviation = lastDot && (ABBREVIATIONS.has(word) || ABBREVIATIONS.has(word.split('.').pop() ?? ''));
    const continues = /^[\p{Ll}]/u.test(after) && lastDot;
    if (initial || abbreviation || continues) continue;
    out.push({ start: from, end });
    from = end;
    while (from < text.length && /\s/.test(text[from])) from++;
  }
  if (from < text.length) out.push({ start: from, end: text.length });
  return out.filter((r) => text.slice(r.start, r.end).trim().length > 0).map((r) => {
    let { start, end } = r;
    while (/\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    return { start, end };
  });
}

/** What a voice should say: no `[12]` or `[1, 2]` citations, no web addresses, sub/superscript markers as spaces. */
export function speakable(text: string): string {
  return text
    .replace(/\[\s*\d+(?:\s*[,–-]\s*\d+)*\s*\]/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[_^]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

const READ = new Set<Block['type']>(['title', 'heading', 'paragraph', 'list_item']);
const rendered = (b: Block) => (b.spans.length ? b.spans.map((s) => s.text).join('') : b.text);

/** The sentences to hear, from `fromBlockId` (or the start): title, headings, paragraphs and list items. */
export function buildQueue(doc: Document, fromBlockId?: string | null): Utterance[] {
  const out: Utterance[] = [];
  let started = !fromBlockId;
  for (const b of doc.blocks) {
    if (!started && b.id === fromBlockId) started = true;
    if (!started || !READ.has(b.type)) continue;
    const text = rendered(b);
    for (const { start, end } of splitSentences(text)) {
      const sentence = text.slice(start, end);
      const speak = speakable(sentence);
      if (!/[\p{L}\p{N}]/u.test(speak)) continue;
      out.push({ blockId: b.id, start, end, text: sentence, speak });
    }
  }
  return out;
}

export interface SpeechEngine {
  speak(text: string, opts: { lang?: string; rate: number }, handlers: { onDone(): void; onError(): void }): void;
  stop(): void;
}

export type SpeakerState = 'idle' | 'playing' | 'paused';

/** Plays a queue one sentence at a time. Pausing stops the engine; resuming speaks the same sentence again. */
export class Speaker {
  private i = 0;
  private epoch = 0;
  private current: SpeakerState = 'idle';
  private rate: number;

  constructor(
    private readonly engine: SpeechEngine,
    private readonly queue: Utterance[],
    private readonly opts: { lang?: string; rate?: number; onSentence: (u: Utterance | null, index: number) => void; onState: (s: SpeakerState) => void },
  ) {
    this.rate = opts.rate ?? 1;
  }

  get state(): SpeakerState {
    return this.current;
  }
  get index(): number {
    return this.i;
  }
  get length(): number {
    return this.queue.length;
  }

  private set(state: SpeakerState): void {
    if (state !== this.current) {
      this.current = state;
      this.opts.onState(state);
    }
  }

  private say(): void {
    const u = this.queue[this.i];
    if (!u) {
      this.finish();
      return;
    }
    const mine = ++this.epoch;
    this.opts.onSentence(u, this.i);
    const next = () => {
      if (mine !== this.epoch || this.current !== 'playing') return;
      this.i += 1;
      this.say();
    };
    this.engine.speak(u.speak, { lang: this.opts.lang, rate: this.rate }, { onDone: next, onError: next });
  }

  private finish(): void {
    this.epoch += 1;
    this.engine.stop();
    this.set('idle');
    this.opts.onSentence(null, this.i);
  }

  play(from?: number): void {
    if (from !== undefined) this.i = Math.max(0, Math.min(this.queue.length - 1, from));
    this.engine.stop();
    this.set('playing');
    this.say();
  }

  pause(): void {
    if (this.current !== 'playing') return;
    this.epoch += 1;
    this.engine.stop();
    this.set('paused');
  }

  /** From a pause: the same sentence again. After the end: from the beginning. */
  resume(): void {
    if (this.current === 'paused') this.play();
    else if (this.current === 'idle') this.play(0);
  }

  stop(): void {
    this.i = 0;
    this.finish();
  }

  next(): void {
    this.seek(1);
  }
  prev(): void {
    this.seek(-1);
  }
  private seek(d: number): void {
    const to = Math.max(0, Math.min(this.queue.length - 1, this.i + d));
    if (to === this.i) return;
    if (this.current === 'playing') this.play(to);
    else {
      this.i = to;
      this.opts.onSentence(this.queue[to] ?? null, to);
    }
  }

  setRate(rate: number): void {
    this.rate = rate; // from the next sentence on
  }
}
