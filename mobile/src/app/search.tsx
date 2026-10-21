import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { SearchResult } from '@/core/knowledge/search';
import type { LibraryEntry } from '@/data/library';
import { getKnowledge } from '@/services/container';
import { AppText, Card, IconButton } from '@/ui/components';
import { radius, space, useColors } from '@/ui/theme';
import { useT } from '@/ui/useT';

/** The matched words stand out inside the snippet, so it is clear why a block was found. */
function Snippet({ hit }: { hit: SearchResult }) {
  const c = useColors();
  const parts: { text: string; match: boolean }[] = [];
  let at = 0;
  for (const [s, e] of hit.ranges) {
    if (s > at) parts.push({ text: hit.snippet.slice(at, s), match: false });
    parts.push({ text: hit.snippet.slice(s, e), match: true });
    at = e;
  }
  if (at < hit.snippet.length) parts.push({ text: hit.snippet.slice(at), match: false });
  return (
    <Text style={{ color: c.text, fontSize: 15, lineHeight: 22 }}>
      {parts.map((p, i) => (
        <Text key={i} style={p.match ? { backgroundColor: c.warnBg, fontWeight: '700' } : undefined}>
          {p.text}
        </Text>
      ))}
    </Text>
  );
}

export default function SearchScreen() {
  const t = useT();
  const c = useColors();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [papers, setPapers] = useState<LibraryEntry[]>([]);
  const [hits, setHits] = useState<SearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const run = useRef(0);

  useEffect(() => {
    const q = query.trim();
    const id = ++run.current;
    if (q.length < 2) {
      setPapers([]);
      setHits([]);
      setSearched(false);
      setBusy(false);
      return;
    }
    setBusy(true);
    const timer = setTimeout(async () => {
      const knowledge = getKnowledge();
      const [p, h] = await Promise.all([knowledge.papersMatching(q), knowledge.search(q, { limit: 40 })]);
      if (id !== run.current) return;
      setPapers(p);
      setHits(h);
      setSearched(true);
      setBusy(false);
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm, gap: space.xs }}>
        <IconButton icon="chevron-back" label={t('common.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} testID="screen-back" />
        <TextInput
          testID="search-input"
          autoFocus
          value={query}
          onChangeText={setQuery}
          placeholder={t('search.placeholder')}
          placeholderTextColor={c.muted}
          returnKeyType="search"
          style={{ flex: 1, height: 44, borderRadius: radius.pill, paddingHorizontal: space.lg, backgroundColor: c.surfaceAlt, color: c.text }}
        />
        {busy ? <ActivityIndicator color={c.accent} style={{ width: 40 }} /> : <View style={{ width: 40 }} />}
      </View>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, maxWidth: 720, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled" testID="search-results">
        {!searched && !busy ? <AppText muted>{t('search.hint')}</AppText> : null}
        {searched && !papers.length && !hits.length ? <AppText muted testID="search-empty">{t('search.empty')}</AppText> : null}

        {papers.length ? (
          <View style={{ gap: space.sm }}>
            <AppText variant="label" muted>{t('search.papers')}</AppText>
            {papers.map((p) => (
              <Pressable key={p.id} accessibilityRole="button" onPress={() => router.push(`/reader/${p.id}`)} testID={`paper-hit-${p.id}`}>
                <Card style={{ gap: 4 }}>
                  <AppText variant="heading" numberOfLines={2}>{p.title}</AppText>
                  <AppText variant="caption" muted numberOfLines={1}>{[p.authors.join(', '), p.year ?? '', p.tags.join(' · ')].filter(Boolean).join(' · ')}</AppText>
                </Card>
              </Pressable>
            ))}
          </View>
        ) : null}

        {hits.length ? (
          <View style={{ gap: space.sm }}>
            <AppText variant="label" muted>{t('search.passages')}</AppText>
            {hits.map((h) => (
              <Pressable key={`${h.docId}:${h.blockId}`} accessibilityRole="button" onPress={() => router.push(`/reader/${h.docId}?block=${h.blockId}`)} testID="search-hit">
                <Card style={{ gap: 6 }}>
                  <AppText variant="caption" muted numberOfLines={1}>
                    {h.title}
                  </AppText>
                  <Snippet hit={h} />
                  <AppText variant="caption" muted numberOfLines={1}>
                    {[h.section, t('reader.page', { n: h.page })].filter(Boolean).join(' · ')}
                  </AppText>
                </Card>
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
