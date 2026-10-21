import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Platform, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LibraryCard } from '@/features/library/LibraryCard';
import { ImportOverlay } from '@/features/library/ImportOverlay';
import type { LibraryEntry } from '@/data/library';
import { getStores } from '@/services/container';
import { pickPdf } from '@/services/picker';
import type { PdfSource } from '@/services/importer';
import { useImport } from '@/services/useImport';
import { AppText, Button, Card, IconButton } from '@/ui/components';
import { radius, space, useColors } from '@/ui/theme';
import { useT } from '@/ui/useT';

export default function LibraryScreen() {
  const t = useT();
  const c = useColors();
  const router = useRouter();
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null);
  const [query, setQuery] = useState('');
  const lastSource = useRef<PdfSource | null>(null);

  const refresh = useCallback(async () => setEntries(await getStores().library.list()), []);
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const imp = useImport(
    useCallback(
      (entry: LibraryEntry) => {
        void refresh();
        router.push(`/reader/${entry.id}`);
      },
      [refresh, router],
    ),
  );

  const startImport = async () => {
    const source = await pickPdf();
    if (!source) return;
    lastSource.current = source;
    void imp.start(source);
  };

  const confirmDelete = (entry: LibraryEntry) => {
    const run = async () => {
      await getStores().library.remove(entry.id);
      void refresh();
    };
    const message = t('library.delete.body', { title: entry.title });
    if (Platform.OS === 'web') {
      if (window.confirm(`${t('library.delete.title')}\n\n${message}`)) void run();
    } else {
      Alert.alert(t('library.delete.title'), message, [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.delete'), style: 'destructive', onPress: () => void run() },
      ]);
    }
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !entries) return entries ?? [];
    return entries.filter((e) => `${e.title} ${e.authors.join(' ')} ${e.tags.join(' ')}`.toLowerCase().includes(q));
  }, [entries, query]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingTop: space.md }}>
          <View style={{ flex: 1 }}>
            <AppText variant="title">{t('library.title')}</AppText>
          </View>
          <IconButton icon="create-outline" label={t('notes.title')} onPress={() => router.push('/notes')} testID="open-notes" />
          <IconButton icon="settings-outline" label={t('settings.title')} onPress={() => router.push('/settings')} testID="open-settings" />
        </View>

        {entries && entries.length > 3 ? (
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('library.search')}
            placeholderTextColor={c.muted}
            style={{
              marginHorizontal: space.lg,
              marginTop: space.md,
              paddingHorizontal: space.lg,
              height: 42,
              borderRadius: radius.pill,
              backgroundColor: c.surfaceAlt,
              color: c.text,
            }}
          />
        ) : null}

        <FlatList
          data={shown}
          keyExtractor={(e) => e.id}
          contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 120, flexGrow: 1 }}
          renderItem={({ item }) => (
            <LibraryCard entry={item} onOpen={() => router.push(`/reader/${item.id}`)} onDelete={() => confirmDelete(item)} />
          )}
          ListEmptyComponent={
            entries === null ? undefined : entries.length === 0 ? (
              <Card style={{ gap: space.md, marginTop: space.xl }}>
                <AppText variant="heading">{t('library.empty.title')}</AppText>
                <AppText muted>{t('library.empty.body')}</AppText>
                <View style={{ gap: space.sm }}>
                  {(['library.empty.point1', 'library.empty.point2', 'library.empty.point3'] as const).map((k) => (
                    <AppText key={k}>• {t(k)}</AppText>
                  ))}
                </View>
                <AppText variant="caption" muted>
                  {t('library.empty.privacy')}
                </AppText>
              </Card>
            ) : (
              <AppText muted style={{ textAlign: 'center', marginTop: space.xl }}>
                {t('library.noMatch')}
              </AppText>
            )
          }
        />

        <View style={{ position: 'absolute', left: 0, right: 0, bottom: space.xl, alignItems: 'center' }} pointerEvents="box-none">
          <Button label={t('library.import')} icon="document-attach-outline" onPress={startImport} testID="import-button" />
        </View>
      </View>

      <ImportOverlay
        state={imp.state}
        onCancel={imp.cancel}
        onDismiss={imp.dismiss}
        onRetry={() => {
          imp.dismiss();
          if (lastSource.current) void imp.start(lastSource.current);
        }}
      />
    </SafeAreaView>
  );
}
