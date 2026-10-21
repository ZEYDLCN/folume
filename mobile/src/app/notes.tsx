import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { notesToMarkdown } from '@/core/export/markdown';
import type { Annotation } from '@/data/annotations';
import type { LibraryEntry } from '@/data/library';
import { getStores } from '@/services/container';
import { shareTextFile } from '@/services/share';
import { AppText, Badge, Button, Card, IconButton, Segmented } from '@/ui/components';
import { space, useColors } from '@/ui/theme';
import { useT } from '@/ui/useT';

type Filter = 'all' | 'highlights' | 'notes' | 'ai';

export default function NotesScreen() {
  const t = useT();
  const c = useColors();
  const router = useRouter();
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [items, setItems] = useState<Annotation[]>([]);
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    const { library, annotations } = getStores();
    setEntries(await library.list());
    setItems(await annotations.listAll());
  }, []);
  useFocusEffect(useCallback(() => void load(), [load]));

  const shown = useMemo(
    () =>
      items.filter((a) =>
        filter === 'all' ? true : filter === 'highlights' ? a.note.trim() === '' : filter === 'notes' ? a.note.trim() !== '' && a.origin === 'user' : a.origin === 'ai',
      ),
    [items, filter],
  );
  const groups = useMemo(
    () => entries.map((e) => ({ entry: e, items: shown.filter((a) => a.docId === e.id).sort((a, b) => a.page - b.page || a.start - b.start) })).filter((g) => g.items.length),
    [entries, shown],
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm }}>
        <IconButton icon="chevron-back" label={t('common.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} testID="screen-back" />
        <AppText variant="heading" style={{ flex: 1 }}>
          {t('notes.title')}
        </AppText>
        {items.length ? (
          <IconButton
            icon="share-outline"
            label={t('notes.export')}
            testID="export-notes"
            onPress={() => void shareTextFile('folume-notes.md', notesToMarkdown(entries, items))}
          />
        ) : null}
      </View>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, maxWidth: 720, width: '100%', alignSelf: 'center' }} testID="notes-list">
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: t('notes.filter.all') },
            { value: 'highlights', label: t('notes.filter.highlights') },
            { value: 'notes', label: t('notes.filter.notes') },
            { value: 'ai', label: t('notes.filter.ai') },
          ]}
        />
        {groups.length === 0 ? <AppText muted>{t('notes.empty')}</AppText> : null}
        {groups.map(({ entry, items: list }) => (
          <View key={entry.id} style={{ gap: space.sm }}>
            <AppText variant="heading" numberOfLines={2}>
              {entry.title}
            </AppText>
            {list.map((a) => (
              <Card key={a.id} style={{ gap: 8, borderLeftWidth: 5, borderLeftColor: a.color }} testID={`note-${a.id}`}>
                {a.quote ? (
                  <AppText style={{ fontFamily: 'serif', fontSize: 16, lineHeight: 24 }}>“{a.quote}”</AppText>
                ) : null}
                {a.note.trim() ? (
                  <View style={{ gap: 4 }}>
                    {a.origin === 'ai' ? <Badge label={t('notes.ai.label')} tone="warn" /> : null}
                    <AppText>{a.note}</AppText>
                  </View>
                ) : null}
                <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
                  <AppText variant="caption" muted style={{ flex: 1 }}>
                    {t('reader.page', { n: a.page })}
                  </AppText>
                  <Pressable accessibilityRole="button" onPress={() => router.push(`/reader/${a.docId}?block=${a.blockId}`)}>
                    <AppText variant="caption" color={c.accent}>
                      {t('notes.openBook')}
                    </AppText>
                  </Pressable>
                  <Pressable accessibilityRole="button" onPress={() => router.push(`/reader/${a.docId}?mode=original&block=${a.blockId}&page=${a.page}`)}>
                    <AppText variant="caption" color={c.accent}>
                      {t('notes.openOriginal')}
                    </AppText>
                  </Pressable>
                </View>
              </Card>
            ))}
          </View>
        ))}
        {items.length ? <Button label={t('notes.export')} variant="secondary" icon="share-outline" onPress={() => void shareTextFile('folume-notes.md', notesToMarkdown(entries, items))} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
