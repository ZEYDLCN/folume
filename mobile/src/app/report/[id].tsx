import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { completenessVerdict } from '@/core/completeness';
import { titleOf } from '@/core/docModel';
import type { Document } from '@/core/types';
import type { StringKey } from '@/i18n';
import { getStores } from '@/services/container';
import { AppText, Badge, Button, Card, Divider, IconButton, ProgressBar } from '@/ui/components';
import { space, useColors } from '@/ui/theme';
import { useT } from '@/ui/useT';

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const fmt = (n: number) => n.toLocaleString();

export default function ReportScreen() {
  const id = first(useLocalSearchParams<{ id: string }>().id) as string;
  const router = useRouter();
  const t = useT();
  const c = useColors();
  const [doc, setDoc] = useState<Document | null>(null);

  useEffect(() => {
    void getStores().library.loadDocument(id).then(setDoc);
  }, [id]);

  if (!doc) return <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} />;
  const q = doc.quality;
  const l = q.ledger;
  const tone = q.grade === 'good' ? 'ok' : q.grade === 'fair' ? 'warn' : 'danger';
  const rank = { error: 0, warning: 1, info: 2 } as const;
  const issues = q.issues
    .filter((i) => i.flag.severity !== 'info' || i.block_id)
    .sort((a, b) => rank[a.flag.severity] - rank[b.flag.severity]);
  const ledgerRows: [StringKey, number][] = [
    ['report.ledger.total', l.total_chars],
    ['report.ledger.blocks', l.in_blocks],
    ['report.ledger.figures', l.in_figures],
    ['report.ledger.tables', l.in_tables],
    ['report.ledger.omitted', l.omitted],
    ['report.ledger.unaccounted', l.unaccounted],
  ];
  const verdict = completenessVerdict(doc);
  const comp = q.completeness;
  const verdictText =
    verdict.kind === 'complete'
      ? t('report.complete.complete', { n: fmt(verdict.letters) })
      : verdict.kind === 'recovered'
        ? t('report.complete.recovered', { n: fmt(verdict.letters), r: fmt(verdict.recovered) })
        : verdict.kind === 'incomplete'
          ? t('report.complete.incomplete', { missing: fmt(verdict.missing), extra: fmt(verdict.extra) })
          : t('report.complete.unavailable');
  const countKeys = ['heading', 'paragraph', 'figure', 'table', 'equation', 'reference'] as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm }}>
        <IconButton icon="chevron-back" label={t('common.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} testID="screen-back" />
        <AppText variant="heading" style={{ flex: 1 }}>
          {t('report.title')}
        </AppText>
      </View>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, maxWidth: 720, width: '100%', alignSelf: 'center' }} testID="report">
        <Card style={{ gap: space.md }}>
          <AppText numberOfLines={2} style={{ fontWeight: '700' }}>
            {titleOf(doc)}
          </AppText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <Badge label={t(`report.grade.${q.grade}` as StringKey)} tone={tone} />
            <AppText variant="caption" muted>
              {t('report.score')}: {Math.round(q.score * 100)}%
            </AppText>
          </View>
          <ProgressBar value={q.score} height={6} />
          <AppText>{t(`report.summary.${q.grade}` as StringKey)}</AppText>
          <AppText variant="caption" muted>
            {t('report.parser')}: {doc.parser.name} {doc.parser.version}
          </AppText>
        </Card>

        <Card style={{ gap: space.sm, borderLeftWidth: 5, borderLeftColor: verdict.kind === 'complete' ? c.ok : verdict.kind === 'recovered' ? c.warn : c.danger }} testID="completeness">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Badge label={verdict.kind === 'complete' ? '✓' : verdict.kind === 'recovered' ? '!' : '✕'} tone={verdict.kind === 'complete' ? 'ok' : verdict.kind === 'recovered' ? 'warn' : 'danger'} />
            <AppText variant="heading">{t('report.complete')}</AppText>
          </View>
          <AppText>{verdictText}</AppText>
          {comp && verdict.kind !== 'unavailable' ? (
            <AppText variant="caption" muted>
              {t('report.complete.parts', { text: fmt(comp.in_text), eq: fmt(comp.in_equations), tab: fmt(comp.in_tables), fig: fmt(comp.in_figures), om: fmt(comp.omitted) })}
            </AppText>
          ) : null}
          <AppText variant="caption" muted>
            {t('report.complete.how')}
          </AppText>
        </Card>

        <Card style={{ gap: space.sm }}>
          <AppText variant="heading">{t('report.counts')}</AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.lg }}>
            {countKeys.map((k) => (
              <View key={k} style={{ minWidth: 80 }}>
                <AppText variant="title" style={{ fontSize: 22 }}>
                  {q.counts[k] ?? 0}
                </AppText>
                <AppText variant="caption" muted>
                  {t(`report.count.${k}` as StringKey)}
                </AppText>
              </View>
            ))}
          </View>
        </Card>

        <Card style={{ gap: space.sm }} >
          <AppText variant="heading">{t('report.ledger')}</AppText>
          <AppText variant="caption" muted>
            {t('report.ledger.hint')}
          </AppText>
          {ledgerRows.map(([key, value]) => (
            <View key={key} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <AppText>{t(key)}</AppText>
              <AppText style={{ fontWeight: '700', color: key === 'report.ledger.unaccounted' && value > 0 ? c.warn : c.text }}>{fmt(value)}</AppText>
            </View>
          ))}
        </Card>

        <Card style={{ gap: space.sm }}>
          <AppText variant="heading">{t('report.issues')}</AppText>
          {issues.length === 0 ? <AppText muted>{t('report.issues.none')}</AppText> : null}
          {issues.map((i, n) => (
            <View key={n} style={{ gap: 6 }}>
              {n > 0 ? <Divider /> : null}
              <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
                <Badge label={i.flag.severity.toUpperCase()} tone={i.flag.severity === 'error' ? 'danger' : 'warn'} />
                <View style={{ flex: 1 }}>
                  <AppText>{t(`flag.${i.flag.code}` as StringKey)}</AppText>
                  {i.page ? (
                    <AppText variant="caption" muted>
                      {t('reader.page', { n: i.page })}
                    </AppText>
                  ) : null}
                </View>
                {i.block_id || i.page ? (
                  <Button
                    label={t('report.open')}
                    variant="secondary"
                    style={{ minHeight: 34, paddingHorizontal: 14 }}
                    onPress={() => router.push(i.block_id ? `/reader/${id}?block=${i.block_id}` : `/reader/${id}?mode=original&page=${i.page}`)}
                  />
                ) : null}
              </View>
            </View>
          ))}
        </Card>

        <Card style={{ gap: space.sm }}>
          <AppText variant="heading">{t('report.pages')}</AppText>
          {q.pages.map((p) => (
            <View key={p.page} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <AppText>{t('reader.page', { n: p.page })}</AppText>
              <AppText muted>
                {t(`report.layout.${p.layout}` as StringKey)} · {Math.round(p.confidence * 100)}%
              </AppText>
            </View>
          ))}
        </Card>

        <Card style={{ gap: space.sm }}>
          <AppText variant="heading">{t('report.omitted')}</AppText>
          <AppText variant="caption" muted>
            {t('report.omitted.hint')}
          </AppText>
          {q.omitted.length === 0 ? <AppText muted>—</AppText> : null}
          {q.omitted.map((o, n) => (
            <View key={n} style={{ gap: 2 }}>
              <AppText numberOfLines={1}>{o.preview || '…'}</AppText>
              <AppText variant="caption" muted>
                {t(`omit.${o.reason}` as StringKey)} · {t('reader.page', { n: o.page })} · {o.char_count}
              </AppText>
            </View>
          ))}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
