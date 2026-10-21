import { Pressable, View } from 'react-native';

import type { ContextPassage } from '@/core/retrieval/context';
import type { StringKey } from '@/i18n';
import { AppText, Badge, Card } from '@/ui/components';
import { radius, space, useColors } from '@/ui/theme';
import { useT } from '@/ui/useT';

export interface SegmentView {
  text: string;
  cites: string[];
  grounded: boolean;
}

export type AnswerKind = 'ai' | 'extractive' | 'local';

export interface AnswerData {
  kind: AnswerKind;
  segments: SegmentView[];
  notices: string[];
  passages: ContextPassage[];
  /** the verbatim source text the answer refers to */
  quote: string;
  quotePage: number;
  needsMoreContext?: boolean;
  task: string;
}

/** Keeps the author's text and the model's words visually and verbally apart. */
export function AnswerView({
  data,
  onGoto,
  onShowOriginal,
}: {
  data: AnswerData;
  onGoto: (blockId: string) => void;
  onShowOriginal: () => void;
}) {
  const t = useT();
  const c = useColors();
  const numberOf = (id: string) => Math.max(1, data.passages.findIndex((p) => p.id === id) + 1);
  const usedIds = [...new Set(data.segments.flatMap((s) => s.cites))];

  return (
    <View style={{ gap: space.md }} testID="answer">
      <Card style={{ gap: 6, borderLeftWidth: 4, borderLeftColor: c.accent }} >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <AppText variant="label" muted>
            {t('learn.source')} · {t('reader.page', { n: data.quotePage })}
          </AppText>
          <Pressable onPress={onShowOriginal} accessibilityRole="button" testID="answer-original">
            <AppText variant="caption" color={c.accent}>
              {t('reader.showOriginal')}
            </AppText>
          </Pressable>
        </View>
        <AppText selectable style={{ fontFamily: 'serif', fontSize: 16, lineHeight: 24 }} testID="answer-quote">
          {data.quote}
        </AppText>
      </Card>

      <View style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Badge label={data.kind === 'ai' ? 'AI' : data.kind === 'extractive' ? 'AI ✕' : '⌕'} tone={data.kind === 'ai' ? 'warn' : 'neutral'} />
          <AppText variant="heading">
            {t(data.kind === 'ai' ? 'learn.ai.label' : data.kind === 'extractive' ? 'learn.extractive.label' : 'learn.local.label')}
          </AppText>
        </View>
        <AppText variant="caption" muted>
          {t(data.kind === 'ai' ? 'learn.ai.disclaimer' : 'learn.local.hint')}
        </AppText>
        {data.notices.map((n) => (
          <AppText key={n} variant="caption" color={c.warn}>
            {t(`learn.notice.${n}` as StringKey)}
          </AppText>
        ))}
        {data.needsMoreContext ? (
          <AppText variant="caption" color={c.warn}>
            {t('learn.notice.needs_more')}
          </AppText>
        ) : null}
      </View>

      {data.segments.map((seg, i) => (
        <View
          key={i}
          testID={seg.grounded ? 'segment-grounded' : 'segment-ungrounded'}
          style={{
            gap: 6,
            padding: space.md,
            borderRadius: radius.md,
            borderWidth: 1,
            borderStyle: seg.grounded ? 'solid' : 'dashed',
            borderColor: seg.grounded ? c.border : c.warn,
            backgroundColor: seg.grounded ? c.surface : c.warnBg,
          }}
        >
          {data.task === 'explain_formula' || data.task === 'explain_figure' ? (
            <AppText variant="label" muted>
              {i + 1}
            </AppText>
          ) : null}
          <AppText selectable>{seg.text}</AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            {seg.cites.map((id) => {
              const p = data.passages.find((x) => x.id === id);
              if (!p) return null;
              return (
                <Pressable
                  key={id}
                  accessibilityRole="button"
                  accessibilityLabel={p.label}
                  onPress={() => onGoto(p.blockId)}
                  testID={`cite-${id}`}
                  style={{ backgroundColor: c.surfaceAlt, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}
                >
                  <AppText variant="caption" color={c.accent} style={{ fontWeight: '700' }}>
                    [{numberOf(id)}] {p.label.split(',')[0]}
                  </AppText>
                </Pressable>
              );
            })}
            {!seg.grounded && data.kind === 'ai' ? (
              <AppText variant="caption" color={c.warn}>
                {t('learn.ungrounded')}
              </AppText>
            ) : null}
          </View>
        </View>
      ))}

      {usedIds.length ? (
        <View style={{ gap: 4 }}>
          <AppText variant="label" muted>
            {t('learn.sources')}
          </AppText>
          {usedIds.map((id) => {
            const p = data.passages.find((x) => x.id === id);
            return p ? (
              <Pressable key={id} onPress={() => onGoto(p.blockId)}>
                <AppText variant="caption">
                  [{numberOf(id)}] {p.label}
                </AppText>
              </Pressable>
            ) : null;
          })}
        </View>
      ) : null}
    </View>
  );
}
