/**
 * Offline comprehension questions: a key sentence of the section with its main term blanked out and three
 * distractor terms from the same section. Runs on the device, so no text leaves it (works with AI off).
 * Deterministic for a given input. Mirrors backend/src/folume/ai/extractive.py.
 */
export interface QuizPassage {
  id: string;
  text: string;
}

export type QuestionType = 'mcq' | 'truefalse' | 'short' | 'cloze';

export interface Question {
  id: string;
  type: QuestionType;
  prompt: string;
  choices: string[];
  answer: string;
  explanation: string;
  cites: string[];
  concept: string | null;
}

const DEFINES =
  /\b(we define|is defined as|are defined as|denotes?|refers? to|is called|are called|we call|known as|stands for|abbreviated)\b/i;
const STOP = new Set(
  ('the of and to in is that for with as on we by this are from an be at which our can it or not has have using these ' +
    'their its such than then there where when what each also into over under between').split(' '),
);

export function sentences(text: string): string[] {
  return text
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý(\[“"])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function terms(text: string): string[] {
  const counts = new Map<string, number>();
  for (const w of text.match(/[A-Za-zÀ-ɏ][\w-]+/g) ?? []) {
    const lw = w.toLowerCase();
    if (STOP.has(lw) || lw.length < 5) continue;
    counts.set(lw, (counts.get(lw) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([w]) => w);
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function clozeQuestions(passages: QuizPassage[], count: number): Question[] {
  const rand = rng(passages.reduce((n, p) => n + p.text.length, 0));
  const pool = [...new Set(passages.flatMap((p) => terms(p.text).slice(0, 6)))];
  const candidates: { score: number; sentence: string; passage: QuizPassage; term: string }[] = [];
  for (const p of passages) {
    for (const s of sentences(p.text)) {
      if (s.length < 50 || s.length > 320) continue;
      const ts = terms(s).filter((t) => s.toLowerCase().includes(t));
      if (!ts.length) continue;
      candidates.push({ score: DEFINES.test(s) ? 3 : 1, sentence: s, passage: p, term: ts[0] });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const out: Question[] = [];
  const used = new Set<string>();
  for (const c of candidates) {
    if (out.length >= count) break;
    if (used.has(c.term)) continue;
    const distractors = shuffle(pool.filter((t) => t !== c.term && Math.abs(t.length - c.term.length) < 8), rand);
    if (distractors.length < 3) continue;
    // blank every occurrence, otherwise a repeated term gives the answer away
    const blanked = c.sentence.replace(new RegExp(c.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '_____');
    if (blanked === c.sentence) continue;
    used.add(c.term);
    out.push({
      id: `q${out.length + 1}`,
      type: 'cloze',
      prompt: blanked,
      choices: shuffle([c.term, ...distractors.slice(0, 3)], rand),
      answer: c.term,
      explanation: c.sentence,
      cites: [c.passage.id],
      concept: c.term,
    });
  }
  return out;
}
