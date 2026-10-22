import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { pickContinue } from '@/core/continueReading';
import { LibraryCard } from '@/features/library/LibraryCard';
import { LinkSheet } from '@/features/library/LinkSheet';
import { TagsSheet } from '@/features/library/TagsSheet';
import { ImportOverlay } from '@/features/library/ImportOverlay';
import type { LibraryEntry } from '@/data/library';
import { getKnowledge, getStores } from '@/services/container';
import { sameWanted } from '@/data/userdata';
import { pickPdf } from '@/services/picker';
import type { PdfSource } from '@/services/importer';
import { useImport } from '@/services/useImport';
import { AppText, Button, Card, IconButton, ProgressBar } from '@/ui/components';
import { Logo } from '@/ui/Logo';
import { radius, serif, space, useColors } from '@/ui/theme';
import { useT } from '@/ui/useT';

export default function LibraryScreen() {
  const t = useT();
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null);
  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [tagging, setTagging] = useState<LibraryEntry | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkInitial, setLinkInitial] = useState('');
  const params = useLocalSearchParams<{ import?: string }>();
  const [due, setDue] = useState(0);
  const [wanted, setWanted] = useState(0);
  const lastSource = useRef<PdfSource | null>(null);

  // a link, DOI or arXiv id handed over by a reference list, a shared link or the browser extension
  const requested = Array.isArray(params.import) ? params.import[0] : params.import;
  useEffect(() => {
    if (!requested) return;
    setLinkInitial(requested);
    setLinkOpen(true);
    router.setParams({ import: undefined });
  }, [requested, router]);

  const refresh = useCallback(async () => {
    const stores = getStores();
    setEntries(await stores.library.list());
    setDue((await stores.cards.stats()).due);
    setWanted((await stores.want.list()).filter((w) => w.state === 'todo').length);
  }, []);
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const imp = useImport(
    useCallback(
      (entry: LibraryEntry) => {
        // a paper from the reading list that has now been added counts as read-in-progress: take it off the list
        void getStores().want.list().then(async (list) => {
          for (const w of list) if (w.state === 'todo' && sameWanted(w, { doi: entry.doi, arxivId: entry.arxivId ?? null, url: null, title: entry.title })) await getStores().want.setState(w.id, 'done');
          void refresh();
        });
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
      getKnowledge().forget(entry.id);
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

  const allTags = useMemo(() => [...new Set((entries ?? []).flatMap((e) => e.tags))].sort((a, b) => a.localeCompare(b)), [entries]);
  // a filter whose tag no longer exists must not leave the library looking empty
  const activeTag = tagFilter && allTags.includes(tagFilter) ? tagFilter : null;

  // offered above the list while the library is not filtered, and only when there is more than one paper to choose from
  const resume = useMemo(() => (entries && entries.length > 1 && !query.trim() && !activeTag ? pickContinue(entries) : null), [entries, query, activeTag]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (entries ?? [])
      .filter((e) => !activeTag || e.tags.includes(activeTag))
      .filter((e) => !q || `${e.title} ${e.authors.join(' ')} ${e.tags.join(' ')}`.toLowerCase().includes(q));
  }, [entries, query, activeTag]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['left', 'right']}>
      <View style={{ flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center' }}>
        <View
          style={{
            backgroundColor: c.brand,
            borderBottomLeftRadius: radius.xl,
            borderBottomRightRadius: radius.xl,
            paddingTop: insets.top + space.sm,
            paddingHorizontal: space.lg,
            paddingBottom: space.lg,
            gap: space.md,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Logo size={38} tile />
            <View style={{ flex: 1 }}>
              <AppText variant="title" color={c.brandText} style={{ fontSize: 26, lineHeight: 30 }}>
                Folume
              </AppText>
            </View>
            <View>
              <IconButton icon="albums-outline" label={t('library.reviewOpen')} onPress={() => router.push('/review')} testID="open-review" color={c.brandText} />
              {due > 0 ? (
                <View pointerEvents="none" style={{ position: 'absolute', top: 2, right: 0, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }} accessibilityLabel={t('library.reviewDue', { n: due })} testID="review-badge">
                  <AppText variant="caption" color="#fff" style={{ fontSize: 11, lineHeight: 14, fontWeight: '700' }}>{due > 99 ? '99+' : due}</AppText>
                </View>
              ) : null}
            </View>
            <View>
              <IconButton icon="bookmarks-outline" label={t('library.wantOpen')} onPress={() => router.push('/want')} testID="open-want" color={c.brandText} />
              {wanted > 0 ? (
                <View pointerEvents="none" style={{ position: 'absolute', top: 2, right: 0, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }} testID="want-badge">
                  <AppText variant="caption" color="#fff" style={{ fontSize: 11, lineHeight: 14, fontWeight: '700' }}>{wanted > 99 ? '99+' : wanted}</AppText>
                </View>
              ) : null}
            </View>
            <IconButton icon="settings-outline" label={t('settings.title')} onPress={() => router.push('/settings')} testID="open-settings" color={c.brandText} />
          </View>
          <Pressable
            onPress={() => router.push('/search')}
            accessibilityRole="search"
            accessibilityLabel={t('library.searchOpen')}
            testID="open-search"
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, height: 48, borderRadius: radius.pill, paddingHorizontal: space.lg, backgroundColor: c.surface }}
          >
            <Ionicons name="search" size={19} color={c.muted} />
            <AppText muted style={{ flex: 1 }}>
              {t('library.searchPill')}
            </AppText>
          </Pressable>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }} testID="library-shortcuts">
            {(
              [
                ['open-ask', 'chatbubbles-outline', t('library.ask'), '/ask'],
                ['open-projects', 'grid-outline', t('library.projects'), '/projects'],
                ['open-notes', 'create-outline', t('notes.title'), '/notes'],
              ] as const
            ).map(([testID, icon, label, href]) => (
              <Pressable
                key={testID}
                accessibilityRole="button"
                accessibilityLabel={label}
                onPress={() => router.push(href)}
                testID={testID}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.18)' }}
              >
                <Ionicons name={icon} size={16} color={c.brandText} />
                <AppText variant="caption" color={c.brandText} style={{ fontWeight: '600' }}>
                  {label}
                </AppText>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {entries && entries.length > 3 ? (
          <TextInput
            value={query}
            onChangeText={setQuery}
            accessibilityLabel={t('library.search')}
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

        {allTags.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: space.md, gap: 8 }} testID="tag-filter">
            {[null, ...allTags].map((tag) => {
              const on = (tag ?? null) === activeTag;
              return (
                <Pressable
                  key={tag ?? 'all'}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => setTagFilter(tag)}
                  testID={`filter-${tag ?? 'all'}`}
                  style={{ backgroundColor: on ? c.accent : c.surfaceAlt, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 }}
                >
                  <AppText variant="caption" color={on ? c.accentText : c.text} style={{ fontWeight: '600' }}>
                    {tag ?? t('library.filter.all')}
                  </AppText>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        <FlatList
          data={shown}
          ListHeaderComponent={
            <View style={{ gap: space.md }}>
              {resume ? (
                <Pressable
                  onPress={() => router.push(`/reader/${resume.id}`)}
                  accessibilityRole="button"
                  accessibilityLabel={`${t('library.continue')}: ${resume.title}`}
                  testID="continue-card"
                >
                  <Card style={{ gap: space.sm, borderRadius: radius.xl, padding: space.xl, backgroundColor: c.surface }}>
                    <AppText variant="label" color={c.accent}>
                      {t('library.continue')}
                    </AppText>
                    <AppText variant="heading" numberOfLines={2} style={{ fontSize: 23, lineHeight: 29 }}>
                      {resume.title}
                    </AppText>
                    <AppText variant="caption" muted>
                      {t('library.progress', { n: Math.round(resume.percent) })}
                    </AppText>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.xs }}>
                      <View style={{ flex: 1 }}>
                        <ProgressBar value={resume.percent / 100} height={6} />
                      </View>
                      <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="play" size={22} color={c.accentText} style={{ marginLeft: 3 }} />
                      </View>
                    </View>
                  </Card>
                </Pressable>
              ) : null}
              {shown.length ? <AppText variant="heading" style={{ fontSize: 22 }}>{t('library.title')}</AppText> : null}
            </View>
          }
          keyExtractor={(e) => e.id}
          contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 120, flexGrow: 1 }}
          renderItem={({ item }) => (
            <LibraryCard
              entry={item}
              onOpen={() => router.push(`/reader/${item.id}`)}
              onDelete={() => confirmDelete(item)}
              onTags={() => setTagging(item)}
              onConnections={() => router.push(`/connections/${item.id}`)}
            />
          )}
          ListEmptyComponent={
            entries === null ? undefined : entries.length === 0 ? (
              <Card style={{ gap: space.md, marginTop: space.xl }}>
                <Logo size={64} tile />
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
          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
            <Button label={t('library.import')} icon="document-attach-outline" onPress={startImport} testID="import-button" />
            <Button label={t('library.importLink')} icon="link-outline" variant="secondary" onPress={() => setLinkOpen(true)} testID="import-link-button" />
          </View>
        </View>
      </View>

      <LinkSheet
        visible={linkOpen}
        initial={linkInitial}
        onClose={() => setLinkOpen(false)}
        onSubmit={(url, label) => {
          setLinkOpen(false);
          const source: PdfSource = { kind: 'url', url, name: label };
          lastSource.current = source;
          void imp.start(source);
        }}
      />

      <TagsSheet
        visible={tagging !== null}
        title={tagging?.title ?? ''}
        tags={tagging?.tags ?? []}
        suggestions={allTags}
        onClose={() => setTagging(null)}
        onSave={async (tags) => {
          if (tagging) await getStores().library.setTags(tagging.id, tags);
          setTagging(null);
          void refresh();
        }}
      />

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
