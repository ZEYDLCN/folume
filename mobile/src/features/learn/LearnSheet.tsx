import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, TextInput, View } from 'react-native';

import { AiClient } from '@/ai/client';
import { buildExplainRequest } from '@/ai/requests';
import { mimeForPath, toDataUri } from '@/core/base64';
import type { DocIndex } from '@/core/docModel';
import { buildContext, type ContextPassage } from '@/core/retrieval/context';
import { getApi, getStores } from '@/services/container';
import { useSettings } from '@/state/settings';
import { translate, type StringKey } from '@/i18n';
import { AppText, Button, Card, Field, Segmented, Sheet } from '@/ui/components';
import { radius, space, useColors } from '@/ui/theme';
import { useT } from '@/ui/useT';

import { AnswerView, type AnswerData } from './AnswerView';
import { answerLanguage, errorKey, loadImageRef, tasksFor, type LearnTask } from './helpers';
import { SendPreview } from './SendPreview';

export interface LearnTarget {
  blockId: string;
  /** selected text; absent when the whole block was chosen */
  text?: string;
  start?: number;
  end?: number;
}

type Phase = 'tasks' | 'preview' | 'loading' | 'result' | 'error';

export function LearnSheet({
  visible,
  onClose,
  docId,
  index,
  target,
  onGoto,
  onShowOriginal,
  onSaveNote,
}: {
  visible: boolean;
  onClose: () => void;
  docId: string;
  index: DocIndex;
  target: LearnTarget | null;
  onGoto: (blockId: string) => void;
  onShowOriginal: (blockId: string) => void;
  onSaveNote: (input: { blockId: string; start: number; end: number; quote: string; note: string; page: number }) => Promise<void>;
}) {
  const t = useT();
  const c = useColors();
  const ai = useSettings((s) => s.ai);
  const updateAi = useSettings((s) => s.updateAi);
  const [phase, setPhase] = useState<Phase>('tasks');
  const [task, setTask] = useState<LearnTask>('explain');
  const [question, setQuestion] = useState('');
  const [passages, setPassages] = useState<ContextPassage[]>([]);
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [imageOn, setImageOn] = useState(false);
  const [image, setImage] = useState<{ uri: string; ref: NonNullable<Awaited<ReturnType<typeof loadImageRef>>> } | null>(null);
  const [answer, setAnswer] = useState<AnswerData | null>(null);
  const [error, setError] = useState<StringKey>('learn.error.unknown');
  const [saved, setSaved] = useState(false);
  const [vision, setVision] = useState(false);
  const run = useRef(0);

  const block = target ? index.byId.get(target.blockId) : undefined;
  const tasks = useMemo(() => (block ? tasksFor(block, target?.text) : []), [block, target?.text]);

  useEffect(() => {
    if (visible) {
      setPhase('tasks');
      setAnswer(null);
      setSaved(false);
      setQuestion('');
      setImage(null);
    }
  }, [visible, target?.blockId, target?.text]);

  if (!target || !block) return <Sheet visible={false} onClose={onClose}>{null}</Sheet>;

  const title = t('learn.title');
  const selectionText = target.text ?? (block.type === 'figure' || block.type === 'table' ? '' : block.text);
  const quote = (): string => passages[0]?.text ?? selectionText;

  const toResult = (kind: AnswerData['kind'], segments: AnswerData['segments'], notices: string[], used: ContextPassage[], extra: Partial<AnswerData> = {}) =>
    setAnswer({ kind, segments, notices, passages: used, quote: used[0]?.text ?? selectionText, quotePage: block.source[0].page, task, ...extra });

  const start = async (chosen: LearnTask, q?: string) => {
    setTask(chosen);
    const ctx = buildContext(index, { blockId: block.id, text: target.text }, { question: q });
    setPassages(ctx);
    setIncluded(new Set(ctx.map((p) => p.id)));
    setSaved(false);
    if (chosen === 'local') {
      // pure on-device retrieval: nothing is sent anywhere
      setAnswer({
        kind: 'local',
        segments: ctx.slice(1, 6).map((p) => ({ text: p.text, cites: [p.id], grounded: true })),
        notices: [],
        passages: ctx,
        quote: ctx[0]?.text ?? selectionText,
        quotePage: block.source[0].page,
        task: chosen,
      });
      setPhase('result');
      return;
    }
    // equations, figures and tables may come with their image, if the reader allows it
    let img = null;
    if (block.asset && ai.shareImages) {
      const ref = await loadImageRef(getStores().library, docId, block, 'p1');
      const bytes = block.asset ? await getStores().library.asset(docId, block.asset.path) : null;
      if (ref && bytes) img = { ref, uri: toDataUri(bytes, mimeForPath(block.asset.path)) };
    }
    setImage(img);
    setImageOn(false);
    try {
      const status = await new AiClient(getApi()).status();
      setVision(status.vision);
    } catch {
      setVision(false);
    }
    if (ai.confirmBeforeSend) setPhase('preview');
    else await send(chosen, q, ctx, new Set(ctx.map((p) => p.id)), false, img);
  };

  const send = async (
    chosen: LearnTask,
    q: string | undefined,
    ctx: ContextPassage[] = passages,
    inc: Set<string> = included,
    withImage: boolean = imageOn,
    img: typeof image = image,
  ) => {
    const id = ++run.current;
    setPhase('loading');
    const used = ctx.filter((p) => inc.has(p.id));
    try {
      const req = buildExplainRequest({
        task: chosen as Exclude<LearnTask, 'local'>,
        passages: used,
        question: q,
        language: answerLanguage(ai),
        targetLanguage: ai.translateTo,
        level: ai.level,
        title: index.doc.metadata.title ?? '',
        abstract: index.doc.metadata.abstract,
        images: withImage && img ? [img.ref] : [],
      });
      const res = await new AiClient(getApi()).explain(req);
      if (id !== run.current) return;
      toResult(
        res.mode === 'llm' ? 'ai' : 'extractive',
        res.answer.map((s) => ({ text: s.text, cites: s.cites, grounded: s.grounded })),
        res.notices,
        used,
        { needsMoreContext: res.needs_more_context },
      );
      setPhase('result');
    } catch (e) {
      if (id !== run.current) return;
      setError(errorKey(e));
      setPhase('error');
    }
  };

  const goto = (blockId: string) => {
    onClose();
    onGoto(blockId);
  };

  const saveNote = async () => {
    if (!answer || answer.kind !== 'ai') return;
    const sources = [...new Set(answer.segments.flatMap((s) => s.cites))]
      .map((id) => answer.passages.find((p) => p.id === id)?.label)
      .filter(Boolean)
      .join('; ');
    const note = [...answer.segments.map((s) => s.text), sources ? `— ${translate('learn.sources')}: ${sources}` : '']
      .filter(Boolean)
      .join('\n\n');
    await onSaveNote({
      blockId: block.id,
      start: target.start ?? 0,
      end: target.end ?? 0,
      quote: quote(),
      note,
      page: block.source[0].page,
    });
    setSaved(true);
  };

  const label = (k: LearnTask) => t(`learn.task.${k}` as StringKey);

  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      {phase === 'tasks' ? (
        <View style={{ gap: space.md }} testID="learn-tasks">
          {selectionText ? (
            <Card style={{ gap: 4, borderLeftWidth: 4, borderLeftColor: c.accent }}>
              <AppText variant="label" muted>
                {t('learn.source')}
              </AppText>
              <AppText numberOfLines={5} style={{ fontFamily: 'serif' }}>
                {selectionText}
              </AppText>
            </Card>
          ) : null}

          {!ai.enabled ? (
            <Card style={{ gap: space.sm }} testID="ai-disabled">
              <AppText variant="heading">{t('learn.disabled.title')}</AppText>
              <AppText muted>{t('learn.disabled.body')}</AppText>
              <Button label={t('learn.disabled.enable')} variant="secondary" onPress={() => void updateAi({ enabled: true })} testID="enable-ai" />
            </Card>
          ) : (
            <View style={{ gap: space.sm }}>
              <Field label={t('learn.level')}>
                <Segmented
                  value={ai.level}
                  onChange={(level) => void updateAi({ level })}
                  options={(['beginner', 'intermediate', 'expert'] as const).map((l) => ({ value: l, label: t(`learn.level.${l}` as StringKey) }))}
                />
              </Field>
            </View>
          )}

          <View style={{ gap: space.sm }}>
            {tasks
              .filter((k) => k !== 'ask')
              .filter((k) => ai.enabled || k === 'local')
              .map((k) => (
                <Button key={k} label={label(k)} variant={k === 'local' ? 'secondary' : 'primary'} onPress={() => void start(k)} testID={`task-${k}`} />
              ))}
          </View>

          {ai.enabled && tasks.includes('ask') ? (
            <View style={{ gap: space.sm }}>
              <TextInput
                testID="ask-input"
                value={question}
                onChangeText={setQuestion}
                placeholder={t('learn.ask.placeholder')}
                placeholderTextColor={c.muted}
                multiline
                style={{ minHeight: 64, borderRadius: radius.md, backgroundColor: c.surfaceAlt, color: c.text, padding: space.md, textAlignVertical: 'top' }}
              />
              <Button label={t('learn.ask.send')} variant="secondary" disabled={question.trim().length < 3} onPress={() => void start('ask', question.trim())} testID="task-ask" />
            </View>
          ) : null}
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
          image={image ? { uri: image.uri, label: block.type } : null}
          imageOn={imageOn}
          onToggleImage={(on) => setImageOn(on && vision)}
          onSend={() => void send(task, task === 'ask' ? question.trim() : undefined)}
          onCancel={() => setPhase('tasks')}
        />
      ) : null}

      {phase === 'loading' ? (
        <View style={{ alignItems: 'center', gap: space.md, padding: space.xl }} testID="learn-loading">
          <ActivityIndicator color={c.accent} />
          <AppText muted>{t('learn.loading')}</AppText>
        </View>
      ) : null}

      {phase === 'error' ? (
        <View style={{ gap: space.md }} testID="learn-error">
          <AppText color={c.danger}>{t(error)}</AppText>
          <Button label={t('learn.retry')} onPress={() => setPhase('tasks')} />
        </View>
      ) : null}

      {phase === 'result' && answer ? (
        <View style={{ gap: space.lg }}>
          <AnswerView data={answer} onGoto={goto} onShowOriginal={() => { onClose(); onShowOriginal(block.id); }} />
          <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
            {answer.kind === 'ai' ? (
              <Button label={saved ? t('learn.saved') : t('learn.save')} variant="secondary" disabled={saved} onPress={() => void saveNote()} testID="save-ai-note" style={{ flex: 1 }} />
            ) : null}
            <Button label={t('learn.retry')} variant="secondary" onPress={() => setPhase('tasks')} style={{ flex: 1 }} />
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}
