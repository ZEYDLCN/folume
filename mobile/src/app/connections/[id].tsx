import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { indexDocument } from '@/core/docModel';
import { referencesToBibtex } from '@/core/export/citations';
import type { Concept } from '@/core/knowledge/concepts';
import type { Connection } from '@/core/knowledge/connections';
import { cardFromConcept } from '@/core/learning/cards';
import type { Document } from '@/core/types';
import type { LibraryEntry } from '@/data/library';
import { CompareSheet, type CompareTarget } from '@/features/connections/CompareSheet';
import { getKnowledge, getStores } from '@/services/container';
import { shareTextFile } from '@/services/share';
import type { StringKey } from '@/i18n';
import { useSettings } from '@/state/settings';
import { AppText, Badge, Button, Card, IconButton, ProgressBar } from '@/ui/components';
import { space, useColors } from '@/ui/theme';
import { useT } from '@/ui/useT';

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default function ConnectionsScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = first(params.id) as string;
  const t = useT();
  const c = useColors();
  const router = useRouter();
  const aiOn = useSettings((s) => s.ai.enabled);
  const [doc, setDoc] = useState<Document | null>(null);
  const [concepts, setConcepts] = useState<Concept[] | null>(null);
  const [related, setRelated] = useState<Connection[] | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [compare, setCompare] = useState<CompareTarget | null>(null);

  const load = useCallback(async () => {
    const { library } = getStores();
    const knowledge = getKnowledge();
    setDoc(await library.loadDocument(id));
    setTitles(Object.fromEntries((await library.list()).map((e: LibraryEntry) => [e.id, e.title])));
    setConcepts(await knowledge.conceptsOf(id));
    setRelated(await knowledge.related(id));
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const index = useMemo(() => (doc ? indexDocument(doc) : null), [doc]);
  const open = (docId: string, blockId: string | null) => router.push(blockId ? `/reader/${docId}?block=${blockId}` : `/reader/${docId}`);

  const addCard = async (concept: Concept) => {
    const input = cardFromConcept(id, concept, t('review.concept.front', { term: concept.term }));
    if (!input) return;
    await getStores().cards.add([input]);
    setAdded((s) => new Set(s).add(concept.key));
  };

  const exportRefs = async () => {
    if (doc) await shareTextFile('references.bib', referencesToBibtex(doc), 'application/x-bibtex');
  };

  const refCount = doc?.blocks.filter((b) => b.type === 'reference').length ?? 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm }}>
        <IconButton icon="chevron-back" label={t('common.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} testID="screen-back" />
        <View style={{ flex: 1 }}>
          <AppText variant="heading">{t('conn.title')}</AppText>
          <AppText variant="caption" muted numberOfLines={1}>{titles[id] ?? ''}</AppText>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, maxWidth: 720, width: '100%', alignSelf: 'center' }} testID="connections">
        <AppText variant="caption" muted>{t('conn.disclaimer')}</AppText>

        <View style={{ gap: space.sm }}>
          <AppText variant="label" muted>{t('conn.related')}</AppText>
          {related && related.length === 0 ? <AppText muted testID="conn-none">{t('conn.none')}</AppText> : null}
          {(related ?? []).slice(0, 8).map((conn) => (
            <Card key={conn.b} style={{ gap: space.sm }} testID={`related-${conn.b}`}>
              <Pressable accessibilityRole="button" onPress={() => open(conn.b, null)}>
                <AppText variant="heading" numberOfLines={2}>{titles[conn.b] ?? conn.b}</AppText>
              </Pressable>
              <View style={{ gap: 4 }}>
                <AppText variant="caption" muted>{t('conn.shared', { n: conn.shared.length })}</AppText>
                <ProgressBar value={conn.score} />
              </View>
              {conn.shared.slice(0, 5).map((s) => (
                <View key={s.key} style={{ gap: 6, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: c.border }} testID="shared-concept">
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
                    <AppText style={{ fontWeight: '700' }}>{s.term}</AppText>
                    <Badge label={t(`conn.relation.${s.relation}` as StringKey)} tone={s.relation === 'both_define' ? 'warn' : 'neutral'} />
                  </View>
                  {s.relation !== 'common' ? (
                    <AppText variant="caption" muted numberOfLines={2}>
                      {s.a.definition
                        ? `${t('conn.definedHere')}: ${s.a.definition.text}`
                        : `${t('conn.definedIn', { title: titles[conn.b] ?? '' })}: ${s.b.definition?.text ?? ''}`}
                    </AppText>
                  ) : null}
                  <View style={{ flexDirection: 'row', gap: space.md, flexWrap: 'wrap' }}>
                    <Pressable accessibilityRole="button" onPress={() => open(conn.a, s.a.blockId)}>
                      <AppText variant="caption" color={c.accent}>{t('conn.openHere')}</AppText>
                    </Pressable>
                    <Pressable accessibilityRole="button" onPress={() => open(conn.b, s.b.blockId)}>
                      <AppText variant="caption" color={c.accent}>{t('conn.openThere')}</AppText>
                    </Pressable>
                    {aiOn ? (
                      <Pressable
                        accessibilityRole="button"
                        testID="compare-open"
                        onPress={() => setCompare({ docA: conn.a, docB: conn.b, titleA: titles[conn.a] ?? '', titleB: titles[conn.b] ?? '', shared: s })}
                      >
                        <AppText variant="caption" color={c.accent}>{t('conn.compare')}</AppText>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              ))}
            </Card>
          ))}
        </View>

        <View style={{ gap: space.sm }}>
          <AppText variant="label" muted>{t('conn.concepts')}</AppText>
          {concepts && concepts.length === 0 ? <AppText muted>{t('conn.noConcepts')}</AppText> : null}
          {(concepts ?? []).slice(0, 15).map((cc) => (
            <Card key={cc.key} style={{ gap: 6 }} testID="concept">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
                <AppText style={{ fontWeight: '700', fontSize: 16 }}>{cc.term}</AppText>
                {cc.aliases.map((a) => <Badge key={a} label={a} />)}
                <AppText variant="caption" muted>{t('conn.mentions', { n: cc.count })}</AppText>
              </View>
              {cc.definition ? (
                <AppText style={{ fontFamily: 'serif', fontSize: 15, lineHeight: 22 }} numberOfLines={4}>{cc.definition.text}</AppText>
              ) : null}
              <View style={{ flexDirection: 'row', gap: space.md, flexWrap: 'wrap' }}>
                <Pressable accessibilityRole="button" onPress={() => open(id, cc.definition?.blockId ?? cc.blockIds[0] ?? null)}>
                  <AppText variant="caption" color={c.accent}>
                    {t('conn.openHere')}{cc.definition ? ` · ${t('reader.page', { n: cc.definition.page })}` : ''}
                  </AppText>
                </Pressable>
                {cc.definition ? (
                  <Pressable accessibilityRole="button" onPress={() => void addCard(cc)} disabled={added.has(cc.key)} testID="concept-add-review">
                    <AppText variant="caption" color={added.has(cc.key) ? c.muted : c.accent}>
                      {added.has(cc.key) ? t('conn.addedReview') : t('conn.addReview')}
                    </AppText>
                  </Pressable>
                ) : null}
              </View>
            </Card>
          ))}
        </View>

        {refCount > 0 && index ? (
          <Card style={{ gap: space.sm }}>
            <Button label={t('conn.exportRefs')} variant="secondary" icon="share-outline" onPress={() => void exportRefs()} testID="export-references" />
            <AppText variant="caption" muted>{t('conn.exportRefs.hint')}</AppText>
          </Card>
        ) : null}
      </ScrollView>
      <CompareSheet target={compare} onClose={() => setCompare(null)} onOpen={open} />
    </SafeAreaView>
  );
}
