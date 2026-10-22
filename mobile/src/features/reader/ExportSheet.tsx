import { useState } from 'react';
import { View } from 'react-native';

import type { Document } from '@/core/types';
import {
  EN_EXPORT_STRINGS, TR_EXPORT_STRINGS, exportPaper, type PaperFormat, type PaperLayout, type PaperTheme,
} from '@/core/export/paper';
import type { LibraryRepo } from '@/data/library';
import type { ReaderSettings } from '@/reader/protocol';
import { shareBinaryFile } from '@/services/share';
import { AppSwitch, AppText, Button, Field, Row, Segmented, Sheet } from '@/ui/components';
import { space } from '@/ui/theme';
import { useT } from '@/ui/useT';
import { getLocale } from '@/i18n';

const FORMATS: PaperFormat[] = ['epub', 'html', 'markdown', 'text', 'xlsx'];

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
  const [format, setFormat] = useState<PaperFormat>('epub');
  const [layout, setLayout] = useState<PaperLayout | null>(null);
  const [theme, setTheme] = useState<PaperTheme | null>(null);
  const [images, setImages] = useState(true);
  const [appendix, setAppendix] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ file: string; detail: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const [noTables, setNoTables] = useState(false);

  const pickedLayout = layout ?? settings.layout;
  const pickedTheme = theme ?? settings.theme;
  const styled = format === 'epub' || format === 'html';

  const run = async () => {
    setBusy(true);
    setFailed(false);
    setResult(null);
    try {
      const out = await exportPaper(
        doc,
        format,
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
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t('export.title')}>
      <View testID="export-sheet" style={{ gap: space.lg }}>
        <AppText muted>{t('export.intro')}</AppText>
        <Field label={t('export.format')} hint={t(`export.hint.${format}`)}>
          <Segmented<PaperFormat>
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
        {format !== 'text' && format !== 'xlsx' ? (
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
        {format !== 'xlsx' ? (
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
          </View>
        ) : null}
        {failed ? (
          <AppText testID="export-error" color="#b45309">
            {t(noTables ? 'export.noTables' : 'export.error')}
          </AppText>
        ) : null}
      </View>
    </Sheet>
  );
}
