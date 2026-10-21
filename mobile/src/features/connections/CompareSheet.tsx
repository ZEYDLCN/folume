import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { AiClient } from '@/ai/client';
import { buildCompareRequest, type CompareResponse } from '@/ai/requests';
import { indexDocument, type DocIndex } from '@/core/docModel';
import type { SharedConcept } from '@/core/knowledge/connections';
import { sectionLabel, type ContextPassage } from '@/core/retrieval/context';
import { answerLanguage, errorKey } from '@/features/learn/helpers';
import { SendPreview } from '@/features/learn/SendPreview';
import { getApi, getStores } from '@/services/container';
import type { StringKey } from '@/i18n';
import { useSettings } from '@/state/settings';
import { AppText, Badge, Button, Card, Sheet } from '@/ui/components';
import { radius, space, useColors } from '@/ui/theme';
import { useT } from '@/ui/useT';

export interface CompareTarget {
  docA: string;
  docB: string;
  titleA: string;
  titleB: string;
  shared: SharedConcept;
}

type Phase = 'loading' | 'preview' | 'sending' | 'result' | 'error';
type Tagged = ContextPassage & { docId: string };

const clip = (s: string) => (s.length > 900 ? `${s.slice(0, 899)}…` : s);

function passagesOf(index: DocIndex, docId: string, title: string, blockIds: string[], from: number): Tagged[] {
  return blockIds
    .map((id) => index.byId.get(id))
    .filter((b): b is NonNullable<typeof b> => !!b && b.text.trim().length > 0)
    .map((b, i) => ({
      id: `p${from + i + 1}`,
      blockId: b.id,
      kind: 'context' as const,
      text: clip(b.text.replace(/\s+/g, ' ').trim()),
      label: `${title}, ${sectionLabel(index, b).split(', ').pop()}`,
      page: b.source[0].page,
      docId,
    }));
}

/** Asks the model how two papers relate on one concept, from passages of both; shows what is sent first. */
export function CompareSheet({
  target,
  onClose,
  onOpen,
}: {
  target: CompareTarget | null;
  onClose: () => void;
  onOpen: (docId: string, blockId: string) => void;
}) {
  const t = useT();
  const c = useColors();
  const ai = useSettings((s) => s.ai);
  const [phase, setPhase] = useState<Phase>('loading');
  const [passages, setPassages] = useState<Tagged[]>([]);
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{ res: CompareResponse; sent: Tagged[] } | null>(null);
  const [error, setError] = useState<StringKey>('learn.error.unknown');

  useEffect(() => {
    if (!target) return;
    let alive = true;
    setPhase('loading');
    setResult(null);
    void (async () => {
      const { library } = getStores();
      const [a, b] = await Promise.all([library.loadDocument(target.docA), library.loadDocument(target.docB)]);
      if (!alive || !a || !b) return;
      const pa = passagesOf(indexDocument(a), target.docA, target.titleA, target.shared.a.blockIds, 0);
      const pb = passagesOf(indexDocument(b), target.docB, target.titleB, target.shared.b.blockIds, pa.length);
      const all = [...pa, ...pb];
      setPassages(all);
      setIncluded(new Set(all.map((p) => p.id)));
      setPhase('preview');
    })();
    return () => {
      alive = false;
    };
  }, [target]);

  if (!target) return <Sheet visible={false} onClose={onClose}>{null}</Sheet>;

  const send = async () => {
    setPhase('sending');
    const a = passages.filter((p) => p.docId === target.docA && included.has(p.id));
    const b = passages.filter((p) => p.docId === target.docB && included.has(p.id));
    try {
      const req = buildCompareRequest({ concept: target.shared.term, a, b, titleA: target.titleA, titleB: target.titleB, language: answerLanguage(ai) });
      const res = await new AiClient(getApi()).compare(req);
      // the request renumbers paper B after paper A: rebuild the same ids to map citations back to blocks
      const sent: Tagged[] = [...a.map((p, i) => ({ ...p, id: req.a[i].id })), ...b.map((p, i) => ({ ...p, id: req.b[i].id }))];
      setResult({ res, sent });
      setPhase('result');
    } catch (e) {
      setError(errorKey(e));
      setPhase('error');
    }
  };

  return (
    <Sheet visible onClose={onClose} title={`${t('conn.compare.title')}: ${target.shared.term}`}>
      {phase === 'loading' || phase === 'sending' ? (
        <View style={{ alignItems: 'center', padding: space.xl, gap: space.md }} testID="compare-loading">
          <ActivityIndicator color={c.accent} />
          <AppText muted>{t('conn.compare.loading')}</AppText>
        </View>
      ) : null}

      {phase === 'preview' ? (
        <SendPreview
          passages={passages}
          included={included}
          onToggle={(id) => {
            const next = new Set(included);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            setIncluded(next);
          }}
          onSend={() => void send()}
          onCancel={onClose}
        />
      ) : null}

      {phase === 'error' ? (
        <View style={{ gap: space.md }}>
          <AppText color={c.danger}>{t(error)}</AppText>
          <Button label={t('learn.retry')} onPress={() => setPhase('preview')} />
        </View>
      ) : null}

      {phase === 'result' && result ? (
        <View style={{ gap: space.md }} testID="compare-result">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Badge label={result.res.mode === 'llm' ? 'AI' : 'AI ✕'} tone={result.res.mode === 'llm' ? 'warn' : 'neutral'} />
            <AppText variant="heading" style={{ flex: 1 }} testID="compare-relation">
              {t(`conn.compare.relation.${result.res.relation}` as StringKey)}
            </AppText>
          </View>
          <AppText variant="caption" muted>{t('conn.compare.note')}</AppText>
          {result.res.summary.map((seg, i) => (
            <Card
              key={i}
              testID={seg.grounded ? 'segment-grounded' : 'segment-ungrounded'}
              style={{ gap: 6, borderStyle: seg.grounded ? 'solid' : 'dashed', borderColor: seg.grounded ? c.border : c.warn, backgroundColor: seg.grounded ? c.surface : c.warnBg, borderRadius: radius.md }}
            >
              <AppText selectable>{seg.text}</AppText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                {seg.cites.map((id) => {
                  const p = result.sent.find((x) => x.id === id);
                  return p ? (
                    <Pressable
                      key={id}
                      accessibilityRole="button"
                      onPress={() => {
                        onClose();
                        onOpen(p.docId, p.blockId);
                      }}
                      testID={`cite-${id}`}
                      style={{ backgroundColor: c.surfaceAlt, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}
                    >
                      <AppText variant="caption" color={c.accent} style={{ fontWeight: '700' }}>
                        {p.label}
                      </AppText>
                    </Pressable>
                  ) : null;
                })}
                {!seg.grounded ? <AppText variant="caption" color={c.warn}>{t('learn.ungrounded')}</AppText> : null}
              </View>
            </Card>
          ))}
        </View>
      ) : null}
    </Sheet>
  );
}
