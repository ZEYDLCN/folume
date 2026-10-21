import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { citationSourceOfEntry, toBibtex, toCslJson, toRis } from '@/core/export/citations';
import { notesToMarkdown } from '@/core/export/markdown';
import type { LibraryEntry } from '@/data/library';
import { createBackup, restoreBackup } from '@/data/backup';
import { getStores } from '@/services/container';
import { pickTextFile } from '@/services/picker';
import { shareTextFile } from '@/services/share';
import type { StringKey } from '@/i18n';
import { AppText, Button, Card, IconButton } from '@/ui/components';
import { space, useColors } from '@/ui/theme';
import { useT } from '@/ui/useT';

type Message = { tone: 'ok' | 'error'; text: string } | null;

export default function DataScreen() {
  const t = useT();
  const c = useColors();
  const router = useRouter();
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [message, setMessage] = useState<Message>(null);

  useFocusEffect(
    useCallback(() => {
      void getStores().library.list().then(setEntries);
    }, []),
  );

  const sources = entries.map(citationSourceOfEntry);
  const stamp = new Date().toISOString().slice(0, 10);

  const exportNotes = async () => {
    const { annotations, library } = getStores();
    await shareTextFile('folume-notes.md', notesToMarkdown(await library.list(), await annotations.listAll()));
  };

  const backup = async () => {
    const { records, library } = getStores();
    await shareTextFile(`folume-backup-${stamp}.json`, await createBackup(records, library), 'application/json');
  };

  const restore = async () => {
    const text = await pickTextFile();
    if (text === null) return;
    const res = await restoreBackup(getStores().records, text);
    if (!res.ok) {
      setMessage({ tone: 'error', text: t(`data.restore.error.${res.error}` as StringKey) });
      return;
    }
    const parts = [t('data.restore.done', { applied: res.applied, skipped: res.skipped })];
    if (res.invalid) parts.push(t('data.restore.invalid', { n: res.invalid }));
    setMessage({ tone: 'ok', text: parts.join(' ') });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm }}>
        <IconButton icon="chevron-back" label={t('common.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} testID="screen-back" />
        <AppText variant="heading">{t('data.title')}</AppText>
      </View>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, maxWidth: 720, width: '100%', alignSelf: 'center' }} testID="data-screen">
        <Card style={{ gap: space.md }}>
          <AppText variant="heading">{t('data.cite')}</AppText>
          <AppText muted>{t('data.cite.body')}</AppText>
          <AppText variant="caption" muted>{entries.length ? t('data.cite.count', { n: entries.length }) : t('data.empty')}</AppText>
          <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
            <Button label="BibTeX" variant="secondary" disabled={!entries.length} onPress={() => void shareTextFile('folume-library.bib', toBibtex(sources), 'application/x-bibtex')} testID="export-bibtex" style={{ flex: 1 }} />
            <Button label="RIS" variant="secondary" disabled={!entries.length} onPress={() => void shareTextFile('folume-library.ris', toRis(sources), 'application/x-research-info-systems')} testID="export-ris" style={{ flex: 1 }} />
            <Button label="CSL-JSON" variant="secondary" disabled={!entries.length} onPress={() => void shareTextFile('folume-library.json', toCslJson(sources), 'application/json')} testID="export-csl" style={{ flex: 1 }} />
          </View>
        </Card>

        <Card style={{ gap: space.md }}>
          <AppText variant="heading">{t('data.notes')}</AppText>
          <AppText muted>{t('data.notes.body')}</AppText>
          <Button label={t('data.notes.export')} variant="secondary" icon="share-outline" onPress={() => void exportNotes()} testID="export-notes-md" />
        </Card>

        <Card style={{ gap: space.md }}>
          <AppText variant="heading">{t('data.backup')}</AppText>
          <AppText muted>{t('data.backup.body')}</AppText>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button label={t('data.backup.create')} variant="secondary" icon="download-outline" onPress={() => void backup()} testID="backup-create" style={{ flex: 1 }} />
            <Button label={t('data.backup.restore')} variant="secondary" icon="push-outline" onPress={() => void restore()} testID="backup-restore" style={{ flex: 1 }} />
          </View>
          <AppText variant="caption" muted>{t('data.backup.merge')}</AppText>
          {message ? (
            <AppText color={message.tone === 'ok' ? c.ok : c.danger} testID={message.tone === 'ok' ? 'restore-ok' : 'restore-error'}>
              {message.text}
            </AppText>
          ) : null}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
