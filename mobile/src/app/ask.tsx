import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AiClient } from '@/ai/client';
import { buildExplainRequest } from '@/ai/requests';
import { askPassages, splitBlockRef } from '@/core/knowledge/ask';
import type { ContextPassage } from '@/core/retrieval/context';
import { AnswerView, type AnswerData } from '@/features/learn/AnswerView';
import { answerLanguage, errorKey } from '@/features/learn/helpers';
import { SendPreview } from '@/features/learn/SendPreview';
import type { StringKey } from '@/i18n';
import { getApi, getKnowledge, getStores } from '@/services/container';
import { useSettings } from '@/state/settings';
import { AppText, Button, Card, IconButton } from '@/ui/components';
import { radius, space, useColors } from '@/ui/theme';
import { useT } from '@/ui/useT';

type Phase = 'input' | 'searching' | 'preview' | 'sending' | 'result' | 'none' | 'empty' | 'error';

/** One question across the whole library, answered only from passages found in the papers, each with its source. */
export default function AskScreen() {
  const t = useT();
  const c = useColors();
  const router = useRouter();
  const ai = useSettings((s) => s.ai);
  const [question, setQuestion] = useState('');
  const [phase, setPhase] = useState<Phase>('input');
  const [passages, setPassages] = useState<ContextPassage[]>([]);
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [answer, setAnswer] = useState<AnswerData | null>(null);
  const [error, setError] = useState<StringKey>('learn.error.unknown');
  const run = useRef(0);

  const open = (ref: string) => {
    const { docId, blockId } = splitBlockRef(ref);
    if (docId) router.push(`/reader/${docId}?block=${blockId}`);
  };

  const local = (ctx: ContextPassage[]): AnswerData => ({
    kind: 'local',
    segments: ctx.map((p) => ({ text: p.text, cites: [p.id], grounded: true })),
    notices: [],
    passages: ctx,
    quote: ctx[0].text,
    quotePage: ctx[0].page,
    task: 'ask',
  });

  const send = async (ctx: ContextPassage[], inc: Set<string>, q: string) => {
    const id = ++run.current;
    setPhase('sending');
    const used = ctx.filter((p) => inc.has(p.id));
    try {
      const req = buildExplainRequest({ task: 'ask', passages: used, question: q, language: answerLanguage(ai), level: ai.level, title: t('ask.title') });
      const res = await new AiClient(getApi()).explain(req);
      if (id !== run.current) return;
      setAnswer({
        kind: res.mode === 'llm' ? 'ai' : 'extractive',
        segments: res.answer.map((s) => ({ text: s.text, cites: s.cites, grounded: s.grounded })),
        notices: res.notices,
        passages: used,
        quote: used[0].text,
        quotePage: used[0].page,
        task: 'ask',
        needsMoreContext: res.needs_more_context,
      });
      setPhase('result');
    } catch (e) {
      if (id !== run.current) return;
      setError(errorKey(e));
      setPhase('error');
    }
  };

  const ask = async () => {
    const q = question.trim();
    if (q.length < 3) return;
    setAnswer(null);
    if (!(await getStores().library.list()).length) return setPhase('empty');
    setPhase('searching');
    const ctx = askPassages(await getKnowledge().passages(q, { limit: 10, perPaper: 3 }));
    if (!ctx.length) return setPhase('none');
    setPassages(ctx);
    const all = new Set(ctx.map((p) => p.id));
    setIncluded(all);
    if (!ai.enabled) {
      setAnswer(local(ctx));
      return setPhase('result');
    }
    if (ai.confirmBeforeSend) return setPhase('preview');
    await send(ctx, all, q);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm }}>
        <IconButton icon="chevron-back" label={t('common.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} testID="screen-back" />
        <AppText variant="heading" style={{ flex: 1 }}>
          {t('ask.title')}
        </AppText>
      </View>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, maxWidth: 720, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
        <AppText muted>{t('ask.intro')}</AppText>
        <TextInput
          value={question}
          onChangeText={setQuestion}
          multiline
          accessibilityLabel={t('ask.placeholder')}
          placeholder={t('ask.placeholder')}
          placeholderTextColor={c.muted}
          testID="ask-library-input"
          style={{ minHeight: 72, borderRadius: radius.md, backgroundColor: c.surfaceAlt, color: c.text, padding: space.md, textAlignVertical: 'top' }}
        />
        <Button label={t('ask.send')} icon="chatbubbles-outline" disabled={question.trim().length < 3 || phase === 'searching' || phase === 'sending'} onPress={() => void ask()} testID="ask-library-send" />

        {phase === 'searching' || phase === 'sending' ? (
          <View style={{ alignItems: 'center', gap: space.md, padding: space.xl }} testID="ask-loading">
            <ActivityIndicator color={c.accent} />
            <AppText muted>{t(phase === 'searching' ? 'ask.searching' : 'learn.loading')}</AppText>
          </View>
        ) : null}

        {phase === 'empty' ? <AppText muted testID="ask-empty">{t('ask.empty')}</AppText> : null}
        {phase === 'none' ? <AppText muted testID="ask-none">{t('ask.none')}</AppText> : null}

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
            onSend={() => void send(passages, included, question.trim())}
            onCancel={() => setPhase('input')}
          />
        ) : null}

        {phase === 'error' ? (
          <View style={{ gap: space.md }} testID="ask-error">
            <AppText color={c.danger}>{t(error)}</AppText>
            <Button label={t('learn.retry')} onPress={() => void ask()} />
          </View>
        ) : null}

        {phase === 'result' && answer ? (
          <View style={{ gap: space.md }} testID="ask-result">
            {answer.kind === 'local' ? (
              <Card>
                <AppText variant="caption" muted>
                  {t('ask.aiOff')}
                </AppText>
              </Card>
            ) : null}
            <AnswerView data={answer} onGoto={open} onShowOriginal={() => open(answer.passages[0].blockId)} />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
