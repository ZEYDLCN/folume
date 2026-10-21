import { tokenize } from './tokenize';

export interface SearchDoc {
  id: string;
  text: string;
}

export interface SearchHit {
  id: string;
  score: number;
}

/** Okapi BM25 over a small in-memory corpus (the blocks of one paper). */
export class Bm25Index {
  private readonly tf = new Map<string, Map<string, number>>();
  private readonly df = new Map<string, number>();
  private readonly len = new Map<string, number>();
  private readonly avgLen: number;

  constructor(
    docs: SearchDoc[],
    private readonly k1 = 1.4,
    private readonly b = 0.75,
  ) {
    let total = 0;
    for (const d of docs) {
      const counts = new Map<string, number>();
      for (const t of tokenize(d.text)) counts.set(t, (counts.get(t) ?? 0) + 1);
      this.tf.set(d.id, counts);
      const n = [...counts.values()].reduce((a, c) => a + c, 0);
      this.len.set(d.id, n);
      total += n;
      for (const t of counts.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    }
    this.avgLen = docs.length ? total / docs.length : 0;
  }

  get size(): number {
    return this.tf.size;
  }

  search(query: string, limit = 10, boost?: (id: string) => number): SearchHit[] {
    const terms = [...new Set(tokenize(query))];
    const n = this.tf.size;
    const hits: SearchHit[] = [];
    for (const [id, counts] of this.tf) {
      let score = 0;
      const dl = this.len.get(id) ?? 0;
      for (const t of terms) {
        const f = counts.get(t);
        if (!f) continue;
        const df = this.df.get(t) ?? 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        const phrase = t.includes('_') ? 1.6 : 1; // matching a pair of words is stronger evidence
        score += phrase * idf * ((f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * dl) / (this.avgLen || 1))));
      }
      if (score > 0) hits.push({ id, score: score * (boost ? boost(id) : 1) });
    }
    return hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
  }
}
