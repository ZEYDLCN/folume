import { useState } from 'react';
import { View } from 'react-native';

import { annotatedPdf } from '@/core/export/annotatedPdf';
import { titleOf } from '@/core/docModel';
import type { Document } from '@/core/types';
import {
  EN_EXPORT_STRINGS, TR_EXPORT_STRINGS, exportPaper, slugify, type PaperFormat, type PaperLayout, type PaperTheme,
} from '@/core/export/paper';
import type { LibraryRepo } from '@/data/library';
import type { ReaderSettings } from '@/reader/protocol';
import { getStores } from '@/services/container';
import { shareBinaryFile } from '@/services/share';
import { AppSwitch, AppText, Button, Field, Row, Segmented, Sheet } from '@/ui/components';
import { space } from '@/ui/theme';
import { useT } from '@/ui/useT';
import { getLocale } from '@/i18n';

type Choice = PaperFormat | 'pdf';
const FORMATS: Choice[] = ['epub', 'html', 'markdown', 'text', 'xlsx', 'pdf'];

/** Turns the open paper into an EPUB, a web page, Markdown or plain text, on the device, and shares the file. */
export function ExportSheet({
  visible,
  onClose,
  doc,
  docId,
  library,
  settings,
}: {
  visible: boolean;
  onClose: () => void;
  doc: Document;
  docId: string;
  library: LibraryRepo;
  settings: ReaderSettings;
}) {
  const t = useT();
  const [format, setFormat] = useState<Choice>('epub');
  const [layout, setLayout] = useState<PaperLayout | null>(null);
  const [theme, setTheme] = useState<PaperTheme | null>(null);
  const [images, setImages] = useState(true);
  const [appendix, setAppendix] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ file: string; detail: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const [noTables, setNoTables] = useState(false);
  const [noPages, setNoPages] = useState(false);
  const [skipped, setSkipped] = useState(0);

  const pickedLayout = layout ?? settings.layout;
  const pickedTheme = theme ?? settings.theme;
  const styled = format === 'epub' || format === 'html';
  const simple = format === 'text' || format === 'xlsx' || format === 'pdf';

  const run = async () => {
    setBusy(true);
    setFailed(false);
    setResult(null);
    setNoTables(false);
    setNoPages(false);
    setSkipped(0);
    try {
      if (format === 'pdf') {
        const { annotations, ink } = getStores();
        const [marks, strokes] = await Promise.all([annotations.list(docId), ink.list(docId)]);
        const pageImages = new Map<number, Uint8Array>();
        for (const page of doc.pages) {
          if (!/\.jpe?g$/i.test(page.image)) continue;
          const bytes = await library.asset(docId, page.image);
          if (bytes) pageImages.set(page.number, bytes);
        }
        const made = annotatedPdf({ doc, pageImages, annotations: marks, ink: strokes });
        const file = `${slugify(titleOf(doc))}-annotated.pdf`;
        await shareBinaryFile(file, made.bytes, 'application/pdf');
        setSkipped(made.summary.skipped);
        setResult({ file, detail: t('export.pdf.detail', { pages: made.summary.pages, highlights: made.summary.highlights, notes: made.summary.notes, strokes: made.summary.strokes }) });
        return;
      }
      const out = await exportPaper(
        doc,
        format as PaperFormat,
        {
          layout: pickedLayout,
          theme: pickedTheme,
          fontFamily: settings.fontFamily === 'serif' ? 'serif' : 'sans',
          images,
          appendix,
          strings: getLocale() === 'tr' ? TR_EXPORT_STRINGS : EN_EXPORT_STRINGS,
        },
        (path) => library.asset(docId, path),
      );
      await shareBinaryFile(out.filename, out.bytes, out.mime);
      setResult({
        file: out.filename,
        detail: t('export.done.detail', { blocks: out.summary.blocks, images: out.summary.images, letters: out.summary.letters.toLocaleString() }),
      });
    } catch (e) {
      setFailed(true);
      setNoTables(e instanceof Error && e.message === 'no_tables');
      setNoPages(e instanceof Error && e.message === 'no_page_images');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t('export.title')}>
      <View testID="export-sheet" style={{ gap: space.lg }}>
        <AppText muted>{t('export.intro')}</AppText>
        <Field label={t('export.format')} hint={t(`export.hint.${format}`)}>
          <Segmented<Choice>
            value={format}
            onChange={setFormat}
            options={FORMATS.map((f) => ({ value: f, label: t(`export.format.${f}`) }))}
          />
        </Field>
        {styled ? (
          <Field label={t('export.layout')}>
            <Segmented<PaperLayout>
              value={pickedLayout}
              onChange={setLayout}
              options={[
                { value: 'book', label: t('typo.layout.book') },
                { value: 'magazine', label: t('typo.layout.magazine') },
              ]}
            />
          </Field>
        ) : null}
        {format === 'html' ? (
          <Field label={t('export.theme')}>
            <Segmented<PaperTheme>
              value={pickedTheme}
              onChange={setTheme}
              options={(['paper', 'sepia', 'dark', 'black'] as const).map((n) => ({ value: n, label: t(`typo.theme.${n}`) }))}
            />
          </Field>
        ) : null}
        {!simple ? (
          <View style={{ gap: 4 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <AppText style={{ flex: 1 }}>{t('export.images')}</AppText>
              <AppSwitch value={images} onValueChange={setImages} testID="export-images" />
            </Row>
            <AppText variant="caption" muted>
              {t('export.images.hint')}
            </AppText>
          </View>
        ) : null}
        {format !== 'xlsx' && format !== 'pdf' ? (
        <View style={{ gap: 4 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <AppText style={{ flex: 1 }}>{t('export.appendix')}</AppText>
            <AppSwitch value={appendix} onValueChange={setAppendix} testID="export-appendix" />
          </Row>
          <AppText variant="caption" muted>
            {t('export.appendix.hint')}
          </AppText>
        </View>
        ) : null}
        <Button
          label={busy ? t('export.working') : t('export.go')}
          icon="share-outline"
          onPress={() => void run()}
          disabled={busy}
          testID="export-go"
        />
        {result ? (
          <View testID="export-done" style={{ gap: 2 }}>
            <AppText style={{ fontWeight: '700' }}>{t('export.done', { file: result.file })}</AppText>
            <AppText variant="caption" muted>
              {result.detail}
            </AppText>
            {skipped ? (
              <AppText variant="caption" muted testID="export-skipped">
                {t('export.pdf.skipped', { n: skipped })}
              </AppText>
            ) : null}
          </View>
        ) : null}
        {failed ? (
          <AppText testID="export-error" color="#b45309">
            {t(noTables ? 'export.noTables' : noPages ? 'export.pdf.noPages' : 'export.error')}
          </AppText>
        ) : null}
      </View>
    </Sheet>
  );
}
