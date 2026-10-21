import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DAY_MS, previewIntervals, statsOf, type Card as ReviewCard, type Grade } from '@/core/learning/srs';
import { getStores } from '@/services/container';
import type { StringKey } from '@/i18n';
import { AppText, Button, Card, IconButton, ProgressBar } from '@/ui/components';
import { space, useColors } from '@/ui/theme';
import { useT } from '@/ui/useT';

const GRADES: Grade[] = ['again', 'hard', 'good', 'easy'];

export default function ReviewScreen() {
  const t = useT();
  const c = useColors();
  const router = useRouter();
  const [queue, setQueue] = useState<ReviewCard[] | null>(null);
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(0);
  const [shown, setShown] = useState(false);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [stats, setStats] = useState({ total: 0, learned: 0 });

  const load = useCallback(async () => {
    const { cards, library } = getStores();
    const due = await cards.due();
    setQueue(due);
    setTotal(due.length);
    setDone(0);
    setShown(false);
    const all = await cards.listAll();
    const s = statsOf(all, Date.now());
    setStats({ total: s.total, learned: s.learned });
    setTitles(Object.fromEntries((await library.list()).map((e) => [e.id, e.title])));
  }, []);
  useFocusEffect(useCallback(() => void load(), [load]));

  const card = queue?.[0];
  const when = (ms: number): string => {
    const min = Math.round(ms / 60000);
    if (min < 60) return t('review.in.min', { n: Math.max(1, min) });
    const days = Math.round(ms / DAY_MS);
    return days < 30 ? t('review.in.day', { n: Math.max(1, days) }) : t('review.in.month', { n: Math.round(days / 30) });
  };

  const answer = async (grade: Grade) => {
    if (!card || !queue) return;
    const updated = await getStores().cards.grade(card.docId, card.id, grade);
    const rest = queue.slice(1);
    // a card that was missed comes back in this session once the rest has been seen
    if (updated && grade === 'again') rest.push(updated);
    setQueue(rest);
    setDone((n) => n + 1);
    setShown(false);
  };

  const remove = async () => {
    if (!card || !queue) return;
    await getStores().cards.remove(card.docId, card.id);
    setQueue(queue.slice(1));
    setTotal((n) => n - 1);
    setShown(false);
  };

  const intervals = card ? previewIntervals(card, Date.now()) : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm }}>
        <IconButton icon="chevron-back" label={t('common.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} testID="screen-back" />
        <View style={{ flex: 1 }}>
          <AppText variant="heading">{t('review.title')}</AppText>
          {queue && queue.length ? (
            <AppText variant="caption" muted testID="review-progress">
              {t('review.progress', { i: Math.min(done + 1, total), n: total })}
            </AppText>
          ) : null}
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, maxWidth: 720, width: '100%', alignSelf: 'center', flexGrow: 1 }} testID="review">
        {queue && queue.length > 0 && card ? (
          <>
            <ProgressBar value={total ? done / total : 0} height={6} />
            <Card style={{ gap: space.md, borderLeftWidth: 5, borderLeftColor: c.accent }} testID="review-card">
              <AppText variant="label" muted>
                {t(`review.kind.${card.kind === 'concept' ? 'concept' : 'quiz'}` as StringKey)} · {titles[card.docId] ?? ''}
              </AppText>
              <AppText style={{ fontSize: 20, lineHeight: 30 }} testID="review-front">{card.front}</AppText>
              {shown ? (
                <View style={{ gap: space.sm, borderTopWidth: 1, borderTopColor: c.border, paddingTop: space.md }}>
                  <AppText style={{ fontFamily: 'serif', fontSize: 17, lineHeight: 26 }} testID="review-back">{card.back}</AppText>
                  {card.blockIds.length ? (
                    <Pressable accessibilityRole="button" onPress={() => router.push(`/reader/${card.docId}?block=${card.blockIds[0]}`)} testID="review-source">
                      <AppText variant="caption" color={c.accent}>
                        {t('review.source')} · {t('reader.page', { n: card.page })}
                      </AppText>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </Card>
            {shown && intervals ? (
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                {GRADES.map((g) => (
                  <Pressable
                    key={g}
                    accessibilityRole="button"
                    accessibilityLabel={t(`review.${g}` as StringKey)}
                    onPress={() => void answer(g)}
                    testID={`grade-${g}`}
                    style={{ flex: 1, minHeight: 58, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surfaceAlt, gap: 2 }}
                  >
                    <AppText style={{ fontWeight: '700' }}>{t(`review.${g}` as StringKey)}</AppText>
                    <AppText variant="caption" muted>{when(intervals[g])}</AppText>
                  </Pressable>
                ))}
              </View>
            ) : (
              <Button label={t('review.show')} onPress={() => setShown(true)} testID="review-show" />
            )}
            <Pressable accessibilityRole="button" onPress={() => void remove()} testID="review-delete" style={{ alignSelf: 'center' }}>
              <AppText variant="caption" muted>{t('review.delete')}</AppText>
            </Pressable>
          </>
        ) : null}

        {queue && queue.length === 0 ? (
          <Card style={{ gap: space.md, marginTop: space.xl }} testID="review-empty">
            <AppText variant="heading">{done > 0 ? t('review.finished') : t('review.empty')}</AppText>
            <AppText muted>{done > 0 ? t('review.finished.body', { n: done }) : t('review.empty.hint')}</AppText>
            {stats.total > 0 ? <AppText variant="caption" muted>{t('review.stats', stats)}</AppText> : null}
          </Card>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
