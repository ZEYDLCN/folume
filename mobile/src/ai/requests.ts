import type { ContextPassage } from '@/core/retrieval/context';

import type {
  CompareRequest,
  ExplainRequest,
  ImageRef,
  Passage,
  QuizRequest,
} from './types.generated';

export type { CompareRequest, ExplainRequest, QuizRequest };
export type { CompareResponse, ExplainResponse, QuizResponse, AiStatus, Question, Segment } from './types.generated';
export type Task = ExplainRequest['task'];
export type Level = ExplainRequest['level'];

/** Passages as the gateway wants them: stripped of anything that identifies where they came from. */
export function toApiPassages(passages: ContextPassage[]): Passage[] {
  return passages.map((p) => ({ id: p.id, text: p.text, kind: p.kind, label: p.label }));
}

export interface ExplainParams {
  task: Task;
  passages: ContextPassage[];
  question?: string;
  language: string;
  targetLanguage?: string;
  level: Level;
  title: string;
  abstract?: string | null;
  images?: { passageId: string; mime: 'image/png' | 'image/jpeg'; dataB64: string; role: ImageRef['role'] }[];
}

/** The selection is always the first passage (see buildContext). */
export function buildExplainRequest(p: ExplainParams): ExplainRequest {
  return {
    task: p.task,
    passages: toApiPassages(p.passages),
    selection_id: p.passages[0].id,
    question: p.question?.trim() || null,
    language: p.language,
    target_language: p.task === 'translate' ? (p.targetLanguage ?? p.language) : null,
    level: p.level,
    paper: { title: p.title, abstract: p.abstract ?? null },
    images: (p.images ?? []).map((i) => ({ passage_id: i.passageId, mime: i.mime, data_b64: i.dataB64, role: i.role })),
  };
}

export function buildQuizRequest(p: {
  sectionTitle: string;
  passages: ContextPassage[];
  count: number;
  language: string;
  level: Level;
  title: string;
}): QuizRequest {
  return {
    section_title: p.sectionTitle,
    passages: toApiPassages(p.passages),
    count: p.count,
    language: p.language,
    level: p.level,
    paper: { title: p.title, abstract: null },
  };
}

export function buildCompareRequest(p: {
  concept: string;
  a: ContextPassage[];
  b: ContextPassage[];
  titleA: string;
  titleB: string;
  language: string;
}): CompareRequest {
  // ids must be unique across both papers: renumber B after A
  const offset = p.a.length;
  const b = p.b.map((x, i) => ({ ...x, id: `p${offset + i + 1}` }));
  return {
    concept: p.concept,
    a: toApiPassages(p.a),
    b: toApiPassages(b),
    title_a: p.titleA,
    title_b: p.titleB,
    language: p.language,
  };
}
