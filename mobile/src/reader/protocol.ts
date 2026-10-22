/**
 * Messages between the React Native host and the reader runtime that runs inside a WebView
 * (an iframe on web). Both sides import these types; payloads travel as JSON strings.
 */
import type { Document } from '@/core/types';

export type ThemeName = 'paper' | 'sepia' | 'dark' | 'black';
export type FontFamily = 'serif' | 'sans';
export type Margin = 'narrow' | 'normal' | 'wide';
export type ReaderMode = 'book' | 'original';
/** How the converted paper is set: like a book (one measure) or like a magazine (masthead, kickers, columns). */
export type ReaderLayout = 'book' | 'magazine';
/** Scrolling, or screens that are turned (the text flows into columns and never scrolls vertically). */
export type ReaderFlow = 'scroll' | 'paged';

export interface ReaderSettings {
  theme: ThemeName;
  fontFamily: FontFamily;
  /** CSS pixels */
  fontSize: number;
  lineHeight: number;
  margin: Margin;
  justify: boolean;
  /** show informational conversion notes (not only warnings) next to blocks */
  showNotes: boolean;
  layout: ReaderLayout;
  flow: ReaderFlow;
}

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  theme: 'paper',
  fontFamily: 'serif',
  fontSize: 18,
  lineHeight: 1.6,
  margin: 'normal',
  justify: false,
  showNotes: false,
  layout: 'book',
  flow: 'scroll',
};

export interface ReaderStrings {
  page: string;
  tap_to_zoom: string;
  show_in_book: string;
  show_original: string;
  table: string;
  table_image: string;
  table_uncertain: string;
  citation: string;
  go_to_reference: string;
  conversion_warning: string;
  conversion_note: string;
  bookmark: string;
  close: string;
  equation: string;
  figure: string;
  loading: string;
  empty_unsupported: string;
  footnote: string;
  original_pages: string;
  figure_text: string;
  table_text: string;
  check: string;
  check_hint: string;
  check_start: string;
  back: string;
  go_to: string;
  open_doi: string;
  add_to_library: string;
  /** "Defined on page {n}" */
  defined_on: string;
  go_to_definition: string;
}

/** A term the paper defines, and where: shown when it is tapped in the text. */
export interface TermView {
  term: string;
  definition: string;
  blockId: string;
  page: number;
}

export interface Anchor {
  blockId: string;
  offset: number;
}

/** A user highlight/note as the runtime needs to paint it. */
export interface HighlightView {
  id: string;
  blockId: string;
  /** character offsets into the block's plain text (the text runtime renders) */
  start: number;
  end: number;
  color: string;
  hasNote: boolean;
}

export interface InitMessage {
  type: 'init';
  doc: Document;
  settings: ReaderSettings;
  mode: ReaderMode;
  anchor: Anchor | null;
  bookmarks: string[];
  highlights: HighlightView[];
  strings: ReaderStrings;
  /** a block to flash after the first layout (e.g. coming from a note) */
  focus: { blockId: string; page?: number } | null;
}

export type HostMessage =
  | InitMessage
  | { type: 'settings'; settings: ReaderSettings }
  | { type: 'mode'; mode: ReaderMode; blockId?: string }
  | { type: 'goto'; blockId: string; offset?: number; flash?: boolean }
  | { type: 'goto-page'; page: number; blockId?: string }
  /** turn a screen in the paged flow, or jump to the first/last one */
  | { type: 'page'; dir: 'next' | 'prev' | 'first' | 'last' }
  | { type: 'asset'; path: string; uri: string }
  | { type: 'bookmarks'; ids: string[] }
  | { type: 'highlights'; items: HighlightView[] }
  | { type: 'terms'; items: TermView[] }
  | { type: 'clear-selection' }
  | { type: 'highlight-block'; blockId: string | null };

export interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ReaderEvent =
  | { type: 'ready' }
  | { type: 'asset-request'; path: string }
  | {
      type: 'progress';
      blockId: string;
      offset: number;
      percent: number;
      page: number;
      /** paged flow only: which screen this is */
      view?: { index: number; count: number };
    }
  | { type: 'block-tap'; blockId: string; rect: SelectionRect }
  | { type: 'original-tap'; blockId: string | null; page: number }
  | { type: 'selection'; blockId: string; start: number; end: number; text: string; rect: SelectionRect }
  | { type: 'selection-clear' }
  | { type: 'flags'; blockId: string }
  | { type: 'quiz'; sectionId: string }
  | { type: 'highlight-tap'; id: string; rect: SelectionRect }
  | { type: 'link'; url: string }
  /** the reader asks to add a paper from the reference list to the library */
  | { type: 'import-ref'; doi: string | null; url: string | null; title: string | null }
  | { type: 'mode-changed'; mode: ReaderMode; blockId: string | null }
  | { type: 'log'; level: 'error' | 'warn' | 'info'; message: string };

export function parseReaderEvent(raw: string): ReaderEvent | null {
  try {
    const data = JSON.parse(raw);
    if (data && typeof data === 'object' && typeof data.type === 'string') {
      const { __folume, ...rest } = data as { __folume?: number } & Record<string, unknown>;
      void __folume;
      return rest as unknown as ReaderEvent;
    }
  } catch {
    /* not ours */
  }
  return null;
}
