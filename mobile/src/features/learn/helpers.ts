import { bytesToBase64 } from '@/core/base64';
import type { Block } from '@/core/types';
import type { AiPrefs } from '@/state/settings';
import { getLocale, type StringKey } from '@/i18n';
import type { LibraryRepo } from '@/data/library';
import { ApiError } from '@/services/api';
import type { Task } from '@/ai/requests';

export type LearnTask = Task | 'local';

/** Which actions make sense for what the reader selected. */
export function tasksFor(block: Block, selectionText?: string): LearnTask[] {
  if (block.type === 'equation') return ['explain_formula', 'explain', 'ask', 'local'];
  if (block.type === 'figure' || block.type === 'table') return ['explain_figure', 'ask', 'local'];
  const short = !!selectionText && selectionText.trim().length <= 60;
  return short
    ? ['define_term', 'explain', 'why_matters', 'translate', 'ask', 'local']
    : ['explain', 'why_matters', 'simplify', 'translate', 'ask', 'local'];
}

export function answerLanguage(prefs: AiPrefs): string {
  return prefs.answerLanguage === 'auto' ? getLocale() : prefs.answerLanguage;
}

export function errorKey(e: unknown): StringKey {
  if (e instanceof ApiError) {
    if (e.code === 'network') return 'learn.error.network';
    if (e.code === 'rate_limited') return 'learn.error.rate_limited';
    if (e.code === 'ai_not_available') return 'learn.error.ai_not_available';
    if (e.code === 'unauthorized') return 'learn.error.unauthorized';
  }
  return 'learn.error.unknown';
}

const MAX_IMAGE_BYTES = 2_500_000;

/** The figure/equation/table image of a block as the gateway expects it, or null when absent or too large. */
export async function loadImageRef(
  library: LibraryRepo,
  docId: string,
  block: Block,
  passageId: string,
): Promise<{ passageId: string; mime: 'image/png'; dataB64: string; role: 'figure' | 'equation' | 'table' } | null> {
  if (!block.asset || !block.asset.path.endsWith('.png')) return null;
  const bytes = await library.asset(docId, block.asset.path);
  if (!bytes || bytes.length > MAX_IMAGE_BYTES) return null;
  return { passageId, mime: 'image/png', dataB64: bytesToBase64(bytes), role: block.asset.kind };
}
