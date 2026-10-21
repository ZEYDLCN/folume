import type { Block } from '../../src/core/types';

/**
 * The text exactly as the runtime renders it (span texts concatenated, no `_`/`^` math markers).
 * Highlight offsets are always relative to this string.
 */
export function renderedText(block: Block): string {
  return block.spans.length ? block.spans.map((s) => s.text).join('') : block.text;
}
