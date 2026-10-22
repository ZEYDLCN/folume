import { translate } from '@/i18n';

import type { ReaderStrings } from './protocol';

/** UI strings the reader runtime shows inside the WebView, in the current language. */
export function readerStrings(): ReaderStrings {
  const t = translate;
  return {
    page: t('rt.page'),
    tap_to_zoom: t('rt.tap_to_zoom'),
    show_in_book: t('rt.show_in_book'),
    show_original: t('rt.show_original'),
    table: t('rt.table'),
    table_image: t('rt.table_image'),
    table_uncertain: t('rt.table_uncertain'),
    citation: t('rt.citation'),
    go_to_reference: t('rt.go_to_reference'),
    conversion_warning: t('rt.conversion_warning'),
    conversion_note: t('rt.conversion_note'),
    bookmark: t('rt.bookmark'),
    close: t('rt.close'),
    equation: t('rt.equation'),
    figure: t('rt.figure'),
    loading: t('rt.loading'),
    empty_unsupported: t('rt.empty_unsupported'),
    footnote: t('rt.footnote'),
    original_pages: t('rt.original_pages'),
    figure_text: t('rt.figure_text'),
    table_text: t('rt.table_text'),
    check: t('rt.check'),
    check_hint: t('rt.check_hint'),
    check_start: t('rt.check_start'),
    back: t('rt.back'),
    go_to: t('rt.go_to'),
    open_doi: t('rt.open_doi'),
    add_to_library: t('rt.add_to_library'),
    defined_on: t('rt.defined_on'),
    go_to_definition: t('rt.go_to_definition'),
  };
}
