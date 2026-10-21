import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AiClient } from '@/ai/client';
import { buildQuizRequest } from '@/ai/requests';
import { indexDocument, sectionBlocks, titleOf, type DocIndex } from '@/core/docModel';
import { cardsFromMissed } from '@/core/learning/cards';
import { clozeQuestions, type Question } from '@/core/learning/cloze';
import { sectionLabel, type ContextPassage } from '@/core/retrieval/context';
import type { Document } from '@/core/types';
import type { QuizItemResult } from '@/data/quiz';
import { AnswerViewChip } from '@/features/learn/AnswerViewChip';
import { SendPreview } from '@/features/learn/SendPreview';
import { answerLanguage, errorKey } from '@/features/learn/helpers';
import { getApi, getStores } from '@/services/container';
import { useSettings } from '@/state/settings';
import type { StringKey } from '@/i18n';
import { AppText, Badge, Button, Card, IconButton, ProgressBar } from '@/ui/components';
import { radius, space, useColors } from '@/ui/theme';
import { useT } from '@/ui/useT';

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
type Phase = 'intro' | 'preview' | 'loading' | 'running' | 'summary' | 'empty' | 'error';

function passagesFor(index: DocIndex, sectionId: string): ContextPassage[] {
  const blocks = sectionBlocks(index, sectionId).filter((b) => (b.type === 'paragraph' || b.type === 'list_item' || b.type === 'caption') && b.text.length > 60);
  return blocks.slice(0, 12).map((b, i) => ({
    id: `p${i + 1}`,
    blockId: b.id,
    kind: 'section',
    text: b.text.length > 1200 ? `${b.text.slice(0, 1199)}…` : b.text,
    label: sectionLabel(index, b),
    page: b.source[0].page,
  }));
}

export default function QuizScreen() {
  const params = useLocalSearchParams<{ id: string; section: string }>();
  const id = first(params.id) as string;
  const sectionId = first(params.section) as string;
  const router = useRouter();
  const t = useT();
  const c = useColors();
  const ai = useSettings((s) => s.ai);
  const [doc, setDoc] = useState<Document | null>(null);
  const [phase, setPhase] = useState<Phase>('intro');
  const [passages, setPassages] = useState<ContextPassage[]>([]);
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [questions, setQuestions] = useState<Question[]>([]);
  const [mode, setMode] = useState<'ai' | 'local'>('local');
  const [notices, setNotices] = useState<string[]>([]);
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [results, setResults] = useState<QuizItemResult[]>([]);
  const [error, setError] = useState<StringKey>('learn.error.unknown');
  const [cardsAdded, setCardsAdded] = useState(0);

  useEffect(() => {
    void getStores().library.loadDocument(id).then(setDoc);
  }, [id]);
  const index = useMemo(() => (doc ? indexDocument(doc) : null), [doc]);
  const section = index?.sectionById.get(sectionId);
  const all = useMemo(() => (index ? passagesFor(index, sectionId) : []), [index, sectionId]);

  if (!doc || !index || !section) return <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} />;

  const begin = (qs: Question[], m: 'ai' | 'local', ns: string[] = []) => {
    setQuestions(qs);
    setMode(m);
    setNotices(ns);
    setI(0);
    setPicked(null);
    setTyped('');
    setRevealed(false);
    setResults([]);
    setPhase(qs.length ? 'running' : 'empty');
  };

  const startLocal = () => begin(clozeQuestions(all.map((p) => ({ id: p.id, text: p.text })), 4), 'local');

  const startAi = async () => {
    setPhase('loading');
    try {
      const used = all.filter((p) => included.has(p.id));
      const res = await new AiClient(getApi()).quiz(
        buildQuizRequest({ sectionTitle: section.title, passages: used, count: 4, language: answerLanguage(ai), level: ai.level, title: titleOf(doc) }),
      );
      setPassages(used);
      begin(res.questions.map((q) => ({ ...q, concept: q.concept ?? null })), res.mode === 'llm' ? 'ai' : 'local', res.notices);
    } catch (e) {
      setError(errorKey(e));
      setPhase('error');
    }
  };

  const q = questions[i];
  const blockIdsOf = (qq: Question) =>
    qq.cites.map((cite) => (mode === 'ai' ? passages : all).find((p) => p.id === cite)?.blockId).filter((x): x is string => !!x);
  const isChoice = q && q.type !== 'short';
  const correctNow = q && (isChoice ? picked === q.answer : null);

  const record = (correct: boolean) => {
    if (!q) return;
    const item: QuizItemResult = {
      qid: q.id, type: q.type, prompt: q.prompt, answer: q.answer, explanation: q.explanation, concept: q.concept, correct, blockIds: blockIdsOf(q),
    };
    const next = [...results, item];
    setResults(next);
    return next;
  };

  const advance = async (next: QuizItemResult[]) => {
    if (i + 1 < questions.length) {
      setI(i + 1);
      setPicked(null);
      setTyped('');
      setRevealed(false);
      return;
    }
    const stores = getStores();
    await stores.quizzes.add({ docId: id, sectionId, sectionTitle: section.title, mode, items: next });
    // what was missed comes back later through spaced repetition, with a way back to the source
    setCardsAdded(await stores.cards.add(cardsFromMissed(id, next, (blockId) => index.byId.get(blockId)?.source[0].page ?? 1)));
    setPhase('summary');
  };

  const label = (choice: string) => (choice === 'True' ? t('quiz.true') : choice === 'False' ? t('quiz.false') : choice);
  const score = results.filter((r) => r.correct).length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm }}>
        <IconButton icon="close" label={t('common.close')} onPress={() => router.back()} testID="screen-back" />
        <View style={{ flex: 1 }}>
          <AppText variant="heading">{t('quiz.title')}</AppText>
          <AppText variant="caption" muted numberOfLines={1}>
            {section.number ? `${section.number} ` : ''}{section.title}
          </AppText>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, maxWidth: 720, width: '100%', alignSelf: 'center' }} testID="quiz">
        {phase === 'intro' ? (
          <Card style={{ gap: space.md }}>
            <AppText>{t('quiz.intro', { n: 4 })}</AppText>
            <AppText variant="caption" muted>{t('quiz.mode.local')}</AppText>
            <Button label={t('quiz.start')} onPress={startLocal} testID="quiz-start-local" />
            {ai.enabled ? (
              <Button
                label={t('quiz.useAi')}
                variant="secondary"
                onPress={() => {
                  setPassages(all);
                  setIncluded(new Set(all.map((p) => p.id)));
                  setPhase('preview');
                }}
                testID="quiz-start-ai"
              />
            ) : null}
          </Card>
        ) : null}

        {phase === 'preview' ? (
          <SendPreview
            passages={passages}
            included={included}
            onToggle={(pid) => {
              const next = new Set(included);
              if (next.has(pid)) next.delete(pid);
              else next.add(pid);
              setIncluded(next);
            }}
            onSend={() => void startAi()}
            onCancel={() => setPhase('intro')}
          />
        ) : null}

        {phase === 'loading' ? (
          <View style={{ alignItems: 'center', gap: space.md, padding: space.xl }}>
            <ActivityIndicator color={c.accent} />
            <AppText muted>{t('learn.loading')}</AppText>
          </View>
        ) : null}

        {phase === 'error' ? (
          <Card style={{ gap: space.md }}>
            <AppText color={c.danger}>{t(error)}</AppText>
            <Button label={t('common.retry')} onPress={() => setPhase('intro')} />
          </Card>
        ) : null}

        {phase === 'empty' ? (
          <Card style={{ gap: space.md }}>
            <AppText>{t('quiz.empty')}</AppText>
            <Button label={t('common.back')} variant="secondary" onPress={() => router.back()} />
          </Card>
        ) : null}

        {phase === 'running' && q ? (
          <View style={{ gap: space.lg }}>
            <ProgressBar value={(i + (revealed ? 1 : 0)) / questions.length} height={6} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <AppText variant="label" muted>{t('quiz.question', { i: i + 1, n: questions.length })}</AppText>
              <Badge label={t(mode === 'ai' ? 'quiz.mode.ai' : 'quiz.mode.local')} tone={mode === 'ai' ? 'warn' : 'neutral'} />
            </View>
            {notices.map((n) => (
              <AppText key={n} variant="caption" color={c.warn}>{t(`learn.notice.${n}` as StringKey)}</AppText>
            ))}
            <Card style={{ gap: space.md }}>
              <AppText style={{ fontSize: 17, lineHeight: 26 }} testID="quiz-prompt">{q.prompt}</AppText>
              {isChoice
                ? q.choices.map((choice) => {
                    const chosen = picked === choice;
                    const showRight = revealed && choice === q.answer;
                    const showWrong = revealed && chosen && choice !== q.answer;
                    return (
                      <Pressable
                        key={choice}
                        accessibilityRole="button"
                        disabled={revealed}
                        onPress={() => setPicked(choice)}
                        testID={`choice-${choice}`}
                        style={{
                          padding: space.md,
                          borderRadius: radius.md,
                          borderWidth: chosen || showRight ? 2 : 1,
                          borderColor: showRight ? c.ok : showWrong ? c.danger : chosen ? c.accent : c.border,
                          backgroundColor: c.surface,
                        }}
                      >
                        <AppText>{label(choice)}</AppText>
                      </Pressable>
                    );
                  })
                : (
                  <TextInput
                    testID="quiz-short"
                    accessibilityLabel={q.prompt}
                    value={typed}
                    onChangeText={setTyped}
                    multiline
                    editable={!revealed}
                    placeholder="…"
                    placeholderTextColor={c.muted}
                    style={{ minHeight: 80, borderRadius: radius.md, backgroundColor: c.surfaceAlt, color: c.text, padding: space.md, textAlignVertical: 'top' }}
                  />
                )}
            </Card>

            {revealed ? (
              <Card style={{ gap: space.sm }} testID="quiz-feedback">
                {isChoice ? (
                  <AppText style={{ fontWeight: '700', color: correctNow ? c.ok : c.danger }}>
                    {correctNow ? t('quiz.correct') : t('quiz.wrong')}
                  </AppText>
                ) : null}
                <AppText>{t('quiz.answerWas', { a: label(q.answer) })}</AppText>
                {q.explanation ? (
                  <View style={{ gap: 2 }}>
                    <AppText variant="label" muted>{t('quiz.explanation')}</AppText>
                    <AppText variant="caption">{q.explanation}</AppText>
                  </View>
                ) : null}
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                  {blockIdsOf(q).map((bid) => (
                    <AnswerViewChip key={bid} label={t('quiz.source')} onPress={() => router.push(`/reader/${id}?block=${bid}`)} />
                  ))}
                </View>
              </Card>
            ) : null}

            <View style={{ flexDirection: 'row', gap: space.sm }}>
              {!revealed && isChoice ? (
                <Button label={t('quiz.check')} disabled={picked === null} onPress={() => setRevealed(true)} style={{ flex: 1 }} testID="quiz-check" />
              ) : null}
              {!revealed && !isChoice ? <Button label={t('quiz.showAnswer')} onPress={() => setRevealed(true)} style={{ flex: 1 }} testID="quiz-reveal" /> : null}
              {revealed && isChoice ? (
                <Button
                  label={i + 1 < questions.length ? t('quiz.next') : t('quiz.finish')}
                  onPress={() => { const n = record(!!correctNow); if (n) void advance(n); }}
                  style={{ flex: 1 }}
                  testID="quiz-next"
                />
              ) : null}
              {revealed && !isChoice ? (
                <>
                  <Button label={t('quiz.selfGrade.wrong')} variant="secondary" onPress={() => { const n = record(false); if (n) void advance(n); }} style={{ flex: 1 }} />
                  <Button label={t('quiz.selfGrade.right')} onPress={() => { const n = record(true); if (n) void advance(n); }} style={{ flex: 1 }} testID="quiz-self-right" />
                </>
              ) : null}
            </View>
          </View>
        ) : null}

        {phase === 'summary' ? (
          <View style={{ gap: space.lg }} testID="quiz-summary">
            <Card style={{ gap: space.md }}>
              <AppText variant="title">{t('quiz.score', { c: score, n: results.length })}</AppText>
              <ProgressBar value={results.length ? score / results.length : 0} height={8} />
              {cardsAdded > 0 ? <AppText variant="caption" muted testID="quiz-cards-added">{t('quiz.cardsAdded', { n: cardsAdded })}</AppText> : null}
              {results.some((r) => !r.correct && r.concept) ? (
                <View style={{ gap: 4 }}>
                  <AppText variant="label" muted>{t('quiz.concepts')}</AppText>
                  <AppText>{[...new Set(results.filter((r) => !r.correct && r.concept).map((r) => r.concept))].join(' · ')}</AppText>
                </View>
              ) : null}
            </Card>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button label={t('quiz.again')} variant="secondary" onPress={() => { setPhase('intro'); }} style={{ flex: 1 }} />
              <Button label={t('common.done')} onPress={() => router.back()} style={{ flex: 1 }} testID="quiz-done" />
            </View>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

