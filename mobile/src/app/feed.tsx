import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CATEGORY_SUGGESTIONS, feedToWant, isNew, newestPublished, shelfOf, type FeedPaper, type FeedResponse } from '@/core/feed';
import { safeExternalUrl } from '@/core/links';
import type { LibraryEntry } from '@/data/library';
import type { Subscription, WantItem } from '@/data/userdata';
import type { StringKey } from '@/i18n';
import { ApiError } from '@/services/api';
import { getApi, getStores } from '@/services/container';
import { AppText, Badge, Button, Card, IconButton } from '@/ui/components';
import { radius, space, useColors } from '@/ui/theme';
import { useT } from '@/ui/useT';

type Load = { state: 'idle' } | { state: 'loading' } | { state: 'error'; key: StringKey } | { state: 'done'; res: FeedResponse; seenBefore: number };

const errorKey = (e: unknown): StringKey => {
  if (e instanceof ApiError) {
    if (e.code === 'network') return 'feed.error.network';
    if (e.code === 'feed_disabled') return 'feed.error.feed_disabled';
    if (e.code === 'feed_failed' || e.code === 'bad_feed') return 'feed.error.feed_failed';
    if (e.code === 'bad_query') return 'feed.error.bad_query';
  }
  return 'feed.error.unknown';
};

const day = (iso: string) => (Number.isFinite(Date.parse(iso)) ? new Date(iso).toISOString().slice(0, 10) : '');

/** New papers on arXiv for the topics the reader follows. */
export default function FeedScreen() {
  const t = useT();
  const c = useColors();
  const router = useRouter();
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [category, setCategory] = useState('');
  const [keywords, setKeywords] = useState('');
  const [load, setLoad] = useState<Load>({ state: 'idle' });
  const [library, setLibrary] = useState<LibraryEntry[]>([]);
  const [want, setWant] = useState<WantItem[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const run = useRef(0);

  const refreshShelves = useCallback(async () => {
    const { library: lib, want: w } = getStores();
    setLibrary(await lib.list());
    setWant(await w.list());
  }, []);

  const fetchFor = useCallback(async (sub: Subscription) => {
    const id = ++run.current;
    setLoad({ state: 'loading' });
    try {
      const res = await getApi().feed({ category: sub.category, q: sub.query, limit: 25 });
      if (id !== run.current) return;
      setLoad({ state: 'done', res, seenBefore: sub.seenUpTo });
      // what was just shown counts as seen the next time
      await getStores().subs.markSeen(sub.id, newestPublished(res.items));
    } catch (e) {
      if (id === run.current) setLoad({ state: 'error', key: errorKey(e) });
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const list = await getStores().subs.list();
        setSubs(list);
        await refreshShelves();
        const current = list.find((s) => s.id === active) ?? list[0];
        if (current && (load.state === 'idle' || current.id !== active)) {
          setActive(current.id);
          void fetchFor(current);
        }
      })();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const follow = async () => {
    const sub = await getStores().subs.add({ category: category.trim() || null, query: keywords.trim() || null });
    setCategory('');
    setKeywords('');
    const list = await getStores().subs.list();
    setSubs(list);
    const target = sub ?? list.find((s) => s.category === (category.trim() || null) && s.query === (keywords.trim() || null));
    if (target) {
      setActive(target.id);
      void fetchFor(target);
    }
  };

  const select = (s: Subscription) => {
    setActive(s.id);
    setNotice(null);
    void fetchFor(s);
  };

  const unfollow = async (s: Subscription) => {
    await getStores().subs.remove(s.id);
    const list = await getStores().subs.list();
    setSubs(list);
    if (active === s.id) {
      setActive(list[0]?.id ?? null);
      setLoad({ state: 'idle' });
      if (list[0]) void fetchFor(list[0]);
    }
  };

  const toList = async (p: FeedPaper) => {
    const res = await getStores().want.add([feedToWant(p)]);
    setNotice(res.added ? t('feed.listed') : t('want.add.duplicate'));
    await refreshShelves();
  };

  const card = (p: FeedPaper, seenBefore: number) => {
    const shelf = shelfOf(p, library, want);
    const expanded = open.has(p.id);
    const link = safeExternalUrl(p.abs_url);
    return (
      <Card key={p.id} style={{ gap: space.sm }} testID={`feed-paper-${p.id.replace(/[^A-Za-z0-9]/g, '_')}`}>
        <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', alignItems: 'center' }}>
          {isNew(p, seenBefore) ? <Badge label={t('feed.new')} tone="ok" /> : null}
          {shelf === 'library' ? <Badge label={t('feed.inLibrary')} /> : shelf === 'want' ? <Badge label={t('feed.onList')} /> : null}
          <AppText variant="caption" muted>
            {[p.primary_category, day(p.published)].filter(Boolean).join(' · ')}
          </AppText>
        </View>
        <AppText style={{ fontWeight: '700', fontSize: 16, lineHeight: 21 }}>{p.title}</AppText>
        <AppText variant="caption" muted numberOfLines={2}>
          {p.authors.slice(0, 4).join(', ') + (p.authors.length > 4 ? ' et al.' : '')}
        </AppText>
        <Pressable accessibilityRole="button" onPress={() => setOpen((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} testID={`feed-toggle-${p.id.replace(/[^A-Za-z0-9]/g, '_')}`}>
          <AppText numberOfLines={expanded ? undefined : 3} style={{ fontFamily: 'serif' }}>
            {p.summary}
          </AppText>
          <AppText variant="caption" color={c.accent}>
            {expanded ? t('feed.less') : t('feed.more')}
          </AppText>
        </Pressable>
        <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
          {shelf === null ? <Button label={t('feed.toList')} icon="bookmark-outline" variant="secondary" onPress={() => void toList(p)} testID={`feed-want-${p.id.replace(/[^A-Za-z0-9]/g, '_')}`} /> : null}
          {shelf !== 'library' ? <Button label={t('feed.toLibrary')} icon="download-outline" variant="secondary" onPress={() => router.dismissTo({ pathname: '/', params: { import: p.id } })} testID={`feed-import-${p.id.replace(/[^A-Za-z0-9]/g, '_')}`} /> : null}
          {link ? <IconButton icon="open-outline" label={t('feed.open')} onPress={() => void Linking.openURL(link)} /> : null}
        </View>
      </Card>
    );
  };

  const newCount = load.state === 'done' ? load.res.items.filter((p) => isNew(p, load.seenBefore)).length : 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm }}>
        <IconButton icon="chevron-back" label={t('common.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} testID="screen-back" />
        <AppText variant="heading" style={{ flex: 1 }}>
          {t('feed.title')}
        </AppText>
      </View>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, maxWidth: 720, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled" testID="feed-screen">
        <AppText muted>{t('feed.intro')}</AppText>

        <View style={{ gap: space.sm }}>
          <TextInput
            value={category}
            onChangeText={setCategory}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={t('feed.category')}
            placeholder={t('feed.category')}
            placeholderTextColor={c.muted}
            testID="feed-category"
            style={{ height: 46, borderRadius: radius.md, paddingHorizontal: space.md, backgroundColor: c.surfaceAlt, color: c.text }}
          />
          <TextInput
            value={keywords}
            onChangeText={setKeywords}
            onSubmitEditing={() => void follow()}
            accessibilityLabel={t('feed.keywords')}
            placeholder={t('feed.keywords')}
            placeholderTextColor={c.muted}
            testID="feed-keywords"
            style={{ height: 46, borderRadius: radius.md, paddingHorizontal: space.md, backgroundColor: c.surfaceAlt, color: c.text }}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }} accessibilityLabel={t('feed.suggestions')}>
            {CATEGORY_SUGGESTIONS.map(([code, label]) => (
              <Pressable key={code} accessibilityRole="button" accessibilityLabel={`${code} ${label}`} onPress={() => setCategory(code)} testID={`feed-suggest-${code}`} style={{ backgroundColor: c.surfaceAlt, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
                <AppText variant="caption" style={{ fontWeight: '600' }}>
                  {code}
                </AppText>
              </Pressable>
            ))}
          </ScrollView>
          <Button label={t('feed.follow')} icon="add" disabled={!category.trim() && !keywords.trim()} onPress={() => void follow()} testID="feed-follow" />
        </View>

        {subs.length === 0 ? <AppText muted testID="feed-none">{t('feed.none')}</AppText> : null}
        {subs.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, alignItems: 'center' }} testID="feed-subs">
            {subs.map((s) => (
              <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: s.id === active ? c.accent : c.surfaceAlt, borderRadius: 999 }}>
                <Pressable accessibilityRole="button" accessibilityState={{ selected: s.id === active }} onPress={() => select(s)} testID={`feed-sub-${s.id}`} style={{ paddingLeft: 14, paddingRight: s.id === active ? 4 : 14, paddingVertical: 8 }}>
                  <AppText variant="caption" color={s.id === active ? c.accentText : c.text} style={{ fontWeight: '700' }}>
                    {s.name}
                  </AppText>
                </Pressable>
                {s.id === active ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={t('feed.unfollow')} onPress={() => void unfollow(s)} testID={`feed-unfollow-${s.id}`} hitSlop={6} style={{ paddingRight: 10, paddingLeft: 4, paddingVertical: 8 }}>
                    <AppText variant="caption" color={c.accentText} style={{ fontWeight: '700' }}>
                      ✕
                    </AppText>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </ScrollView>
        ) : null}

        {notice ? (
          <AppText color={c.accent} testID="feed-notice">
            {notice}
          </AppText>
        ) : null}

        {load.state === 'loading' ? (
          <View style={{ alignItems: 'center', gap: space.md, padding: space.xl }} testID="feed-loading">
            <ActivityIndicator color={c.accent} />
            <AppText muted>{t('feed.loading')}</AppText>
          </View>
        ) : null}
        {load.state === 'error' ? (
          <AppText color={c.danger} testID="feed-error">
            {t(load.key)}
          </AppText>
        ) : null}
        {load.state === 'done' ? (
          <View style={{ gap: space.md }} testID="feed-results">
            {load.res.stale ? <AppText variant="caption" color={c.warn}>{t('feed.stale')}</AppText> : null}
            {newCount ? (
              <AppText variant="label" testID="feed-new-count">
                {t('feed.newCount', { n: newCount })}
              </AppText>
            ) : null}
            {load.res.items.length === 0 ? <AppText muted testID="feed-empty">{t('feed.empty')}</AppText> : null}
            {load.res.items.map((p) => card(p, load.seenBefore))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
