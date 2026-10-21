import type { Question, QuestionType } from '@/core/learning/cloze';

import type { KeyValueStore } from './kv';
import { KEY } from './kv';

export interface QuizItemResult {
  qid: string;
  type: QuestionType;
  prompt: string;
  answer: string;
  explanation: string;
  concept: string | null;
  correct: boolean;
  /** blocks of the paper that contain the answer */
  blockIds: string[];
}

export interface QuizResult {
  id: string;
  docId: string;
  sectionId: string;
  sectionTitle: string;
  at: number;
  mode: 'ai' | 'local';
  items: QuizItemResult[];
  correct: number;
}

const key = (docId: string) => `${KEY.docPrefix(docId)}quiz`;

/** Results of understanding checks; missed questions feed the spaced-repetition review later. */
export class QuizRepo {
  constructor(
    private readonly kv: KeyValueStore,
    private readonly now: () => number = Date.now,
  ) {}

  async list(docId: string): Promise<QuizResult[]> {
    return ((await this.kv.get<QuizResult[]>(key(docId))) ?? []).sort((a, b) => b.at - a.at);
  }

  async listAll(): Promise<QuizResult[]> {
    const out: QuizResult[] = [];
    for (const k of await this.kv.keys('folume:v1:doc:')) {
      if (k.endsWith(':quiz')) out.push(...((await this.kv.get<QuizResult[]>(k)) ?? []));
    }
    return out.sort((a, b) => b.at - a.at);
  }

  async add(input: Omit<QuizResult, 'id' | 'at' | 'correct'>): Promise<QuizResult> {
    const result: QuizResult = {
      ...input,
      id: `q${this.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      at: this.now(),
      correct: input.items.filter((i) => i.correct).length,
    };
    await this.kv.set(key(input.docId), [...((await this.kv.get<QuizResult[]>(key(input.docId))) ?? []), result]);
    return result;
  }
}

export type { Question };
