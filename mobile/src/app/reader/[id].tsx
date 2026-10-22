import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Platform, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { safeExternalUrl } from '@/core/links';
import { indexDocument, readingMinutes, titleOf, type DocIndex } from '@/core/docModel';
import { citationSourceOf } from '@/core/export/citations';
import { formatQuote } from '@/core/quote';
import { copyText } from '@/services/clipboard';
import { applyFixes } from '@/core/fixes';
import { buildFeedbackBundle } from '@/core/feedback';
import type { BlockFix } from '@/data/userdata';
import { FixSheet } from '@/features/reader/FixSheet';
import { InkBar, INK_COLORS } from '@/features/reader/InkBar';
import type { InkPageView, InkTool } from '@/reader/protocol';
import { ReportSheet } from '@/features/reader/ReportSheet';
import app from '../../../app.json';
import { buildQueue, Speaker, type SpeakerState, type Utterance } from '@/core/speech';
import { createSpeechEngine, speechAvailable } from '@/services/speech';
import { ListenBar, RATES } from '@/features/reader/ListenBar';
import { safeSheetName, tableToCsv, tablesToXlsx } from '@/core/export/table';
import { shareBinaryFile, shareTextFile } from '@/services/share';
import { slugify } from '@/core/export/paper';
import type { FindHit } from '@/core/find';
import type { Document } from '@/core/types';
import type { DocState } from '@/data/library';
import { HIGHLIGHT_COLORS, toHighlightViews, type Annotation } from '@/data/annotations';
import { LearnSheet, type LearnTarget } from '@/features/learn/LearnSheet';
import { BlockActions } from '@/features/reader/BlockActions';
import { ContentsSheet } from '@/features/reader/ContentsSheet';
import { ExportSheet } from '@/features/reader/ExportSheet';
import { FindBar } from '@/features/reader/FindBar';
import { FlagsSheet } from '@/features/reader/FlagsSheet';
import { NoteSheet } from '@/features/reader/NoteSheet';
import { SelectionBar } from '@/features/reader/SelectionBar';
import { TypographyControls } from '@/features/reader/TypographyControls';
import type { ReaderEvent, ReaderMode } from '@/reader/protocol';
import type { HighlightView } from '@/reader/protocol';
import { ReaderView, type ReaderViewHandle } from '@/reader/ReaderView';
import { readerStrings } from '@/reader/strings';
import { getKnowledge, getStores } from '@/services/container';
import { useSettings, useLocale } from '@/state/settings';
import { AppText, Button, IconButton, ProgressBar, Segmented, Sheet, type IconName } from '@/ui/components';
import { space, useColors } from '@/ui/theme';
import { useT } from '@/ui/useT';

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default function ReaderScreen() {
  const params = useLocalSearchParams<{ id: string; block?: string; mode?: string; page?: string }>();
  const id = first(params.id) as string;
  const router = useRouter();
  const t = useT();
  const c = useColors();
  useLocale();
  const { library, annotations: annRepo } = getStores();
  const aiOn = useSettings((s) => s.ai.enabled);
  const settings = useSettings((s) => s.reader);
  const updateReader = useSettings((s) => s.updateReader);

  /** the paper as the converter made it, and the reader's own corrections laid over it */
  const [raw, setRaw] = useState<Document | null | undefined>(undefined);
  const [fixes, setFixes] = useState<BlockFix[]>([]);
  const doc = useMemo(() => (raw ? applyFixes(raw, fixes) : raw), [raw, fixes]);
  const [fixing, setFixing] = useState<string | null>(null);
  const [inkTool, setInkTool] = useState<InkTool>('off');
  const [inkColor, setInkColor] = useState<string>(INK_COLORS[0].value);
  /** the hand-drawn notes of this paper; kept so the reader can be rebuilt (after a correction) without losing the latest strokes */
  const [inkPages, setInkPages] = useState<InkPageView[]>([]);
  const [reporting, setReporting] = useState<string | null>(null);
  const [state, setState] = useState<DocState | null>(null);
  const [mode, setMode] = useState<ReaderMode>('book');
  /** paged flow: which screen of how many */
  const [screen, setScreen] = useState<{ index: number; count: number } | null>(null);
  const [percent, setPercent] = useState(0);
  const [page, setPage] = useState(1);
  const [active, setActive] = useState<string | null>(null);
  const [flagsFor, setFlagsFor] = useState<string | null>(null);
  const [contentsOpen, setContentsOpen] = useState(false);
  const [typoOpen, setTypoOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [finding, setFinding] = useState(false);
  const [found, setFound] = useState<FindHit | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const speaker = useRef<Speaker | null>(null);
  const anchorRef = useRef<string | null>(null);
  const [listen, setListen] = useState<{ state: SpeakerState; index: number; length: number } | null>(null);
  const [spoken, setSpoken] = useState<Utterance | null>(null);
  const [rate, setRate] = useState(1);
  const citationStyle = useSettings((s) => s.citationStyle);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selection, setSelection] = useState<{ blockId: string; start: number; end: number; text: string } | null>(null);
  const [color, setColor] = useState<string>(HIGHLIGHT_COLORS[0].value);
  const [learn, setLearn] = useState<LearnTarget | null>(null);
  const [learnOpen, setLearnOpen] = useState(false);
  const [noteFor, setNoteFor] = useState<{ mode: 'new'; sel: { blockId: string; start: number; end: number; text: string } } | { mode: 'edit'; id: string } | null>(null);
  const reader = useRef<ReaderViewHandle>(null);
  const pending = useRef<Partial<DocState> | null>(null);
  const termsSent = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const requestedBlock = first(params.block);
  const requestedMode: ReaderMode = first(params.mode) === 'original' ? 'original' : 'book';
  const requestedPage = first(params.page) ? Number(first(params.page)) : undefined;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [d, s] = await Promise.all([library.loadDocument(id), library.getState(id)]);
      if (cancelled) return;
      setRaw(d);
      setFixes(await getStores().fixes.list(id));
      setInkPages((await getStores().ink.list(id)).map((p) => ({ page: p.page, strokes: p.strokes })));
      setState(s);
      setMode(first(params.mode) ? requestedMode : s.mode);
      setPercent(s.percent);
      if (d) void library.markOpened(id);
      setAnnotations(await annRepo.list(id));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const index: DocIndex | null = useMemo(() => (doc ? indexDocument(doc) : null), [doc]);

  const flush = useCallback((): Promise<unknown> => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const patch = pending.current;
    pending.current = null;
    return patch ? library.saveState(id, patch) : Promise.resolve();
  }, [id, library]);

  const save = useCallback(
    (patch: Partial<DocState>) => {
      pending.current = { ...(pending.current ?? {}), ...patch };
      if (!saveTimer.current) saveTimer.current = setTimeout(() => void flush(), 1200);
    },
    [flush],
  );
  useEffect(() => () => void flush(), [flush]);
  // progress is saved a moment after the last move; leaving the app, a tab or the page must not lose that moment
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s !== 'active' && void flush());
    const onHide = () => void flush();
    const onVisibility = () => document.visibilityState === 'hidden' && void flush();
    if (Platform.OS === 'web') {
      window.addEventListener('pagehide', onHide);
      document.addEventListener('visibilitychange', onVisibility);
    }
    return () => {
      sub.remove();
      if (Platform.OS === 'web') {
        window.removeEventListener('pagehide', onHide);
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }, [flush]);

  const bookmarks = state?.bookmarks ?? [];
  const bookmarkIds = useMemo(() => bookmarks.map((b) => b.blockId), [bookmarks]);
  const highlights = useMemo(() => {
    const views = toHighlightViews(annotations);
    // the match being looked at is painted like a highlight, but belongs to no note
    if (finding && found?.range) {
      const mark: HighlightView = { id: 'find:hit', blockId: found.blockId, start: found.range.start, end: found.range.end, color: '#ffc933', hasNote: false };
      views.push(mark);
    }
    if (spoken) views.push({ id: 'find:speech', blockId: spoken.blockId, start: spoken.start, end: spoken.end, color: '#ffc933', hasNote: false });
    return views;
  }, [annotations, finding, found, spoken]);

  // the sentence being read aloud is brought into view once the reader has painted it
  useEffect(() => {
    if (spoken) reader.current?.send({ type: 'reveal', id: 'find:speech' });
  }, [spoken]);

  const stopListening = useCallback(() => {
    speaker.current?.stop();
    speaker.current = null;
    setListen(null);
    setSpoken(null);
  }, []);
  useEffect(() => () => speaker.current?.stop(), []);
  useEffect(() => {
    if (mode !== 'book') stopListening();
  }, [mode, stopListening]);
  // the pen only works on the original pages; coming back to the book puts it down
  useEffect(() => {
    reader.current?.send({ type: 'ink-tool', tool: mode === 'original' ? inkTool : 'off', color: inkColor });
  }, [mode, inkTool, inkColor]);

  const onFound = useCallback((hit: FindHit | null) => {
    setFound(hit);
    if (!hit) return;
    if (hit.removed) reader.current?.send({ type: 'goto-page', page: hit.page });
    else reader.current?.send({ type: 'goto', blockId: hit.blockId, flash: !hit.range });
  }, []);
  const closeFind = useCallback(() => {
    setFinding(false);
    setFound(null);
  }, []);

  const addAnnotation = async (sel: { blockId: string; start: number; end: number; text: string }, note: string, chosen: string) => {
    const block = index?.byId.get(sel.blockId);
    const a = await annRepo.add({
      docId: id, blockId: sel.blockId, start: sel.start, end: sel.end, quote: sel.text.trim(), color: chosen, note,
      page: block?.source[0].page ?? 1,
    });
    setAnnotations((list) => [...list, a]);
    setSelection(null);
    reader.current?.send({ type: 'clear-selection' });
  };


  const toggleBookmark = (blockId: string) => {
    if (!state) return;
    const has = state.bookmarks.some((b) => b.blockId === blockId);
    const next = has
      ? state.bookmarks.filter((b) => b.blockId !== blockId)
      : [...state.bookmarks, { blockId, createdAt: Date.now() }];
    setState({ ...state, bookmarks: next });
    void library.saveState(id, { bookmarks: next });
  };

  const showOriginal = (blockId: string) => {
    setActive(null);
    reader.current?.send({ type: 'mode', mode: 'original', blockId });
  };

  const onEvent = useCallback(
    (e: ReaderEvent) => {
      switch (e.type) {
        case 'progress':
          if (!termsSent.current) {
            // the runtime has laid the paper out: now it can underline the terms the paper defines
            termsSent.current = true;
            void getKnowledge().conceptsOf(id).then((list) => {
              const items = list.flatMap((c) =>
                c.definition ? [c.term, ...c.aliases].map((term) => ({ term, definition: c.definition!.text, blockId: c.definition!.blockId, page: c.definition!.page })) : [],
              );
              if (items.length) reader.current?.send({ type: 'terms', items: items.slice(0, 120) });
            });
          }
          anchorRef.current = e.blockId;
          setPercent(e.percent);
          setPage(e.page);
          setScreen(e.view ?? null);
          save({ percent: Math.round(e.percent * 10) / 10, anchor: { blockId: e.blockId, offset: e.offset } });
          break;
        case 'original-tap':
          setPage(e.page);
          break;
        case 'block-tap':
          setActive(e.blockId);
          setSelection(null);
          break;
        case 'selection':
          setSelection({ blockId: e.blockId, start: e.start, end: e.end, text: e.text });
          setActive(null);
          break;
        case 'selection-clear':
          setActive(null);
          setSelection(null);
          break;
        case 'quiz':
          router.push(`/quiz/${id}?section=${e.sectionId}`);
          break;
        case 'highlight-tap':
          if (!e.id.startsWith('find:')) setNoteFor({ mode: 'edit', id: e.id });
          break;
        case 'flags':
          setFlagsFor(e.blockId);
          break;
        case 'ink-changed':
          setInkPages((list) => [...list.filter((p) => p.page !== e.page), { page: e.page, strokes: e.strokes }]);
          void getStores().ink.setPage(id, e.page, e.strokes);
          break;
        case 'import-ref':
          router.push({ pathname: '/', params: { import: e.doi ?? e.url ?? e.title ?? '' } });
          break;
        case 'link': {
          const url = safeExternalUrl(e.url);
          if (url) void Linking.openURL(url);
          break;
        }
        case 'mode-changed':
          setMode(e.mode);
          save({ mode: e.mode });
          break;
        case 'log':
          console.warn('[reader]', e.message);
          break;
      }
    },
    [save, router, id],
  );

  const strings = useMemo(() => readerStrings(), [useSettings((s) => s.locale)]); // eslint-disable-line react-hooks/exhaustive-deps

  if (doc === undefined || !state || !index) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }
  if (doc === null) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg, padding: space.xl, gap: space.lg }}>
        <AppText variant="heading">{t('reader.notFound')}</AppText>
        <Button label={t('common.back')} onPress={() => router.replace('/')} />
      </SafeAreaView>
    );
  }

  const activeBlock = active ? index.byId.get(active) ?? null : null;
  const flagBlock = flagsFor ? index.byId.get(flagsFor) ?? null : null;
  const total = doc.pages.length;
  const warn = doc.quality.grade !== 'good';
  const minutesLeft = Math.ceil(readingMinutes(doc) * (1 - percent / 100));
  const readerBg = { paper: '#fcf1e5', sepia: '#f4ecd8', dark: '#17181b', black: '#000000' }[settings.theme];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: readerBg }} edges={['top', 'left', 'right']}>
      {!focusMode ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm, backgroundColor: c.bg }}>
            <IconButton icon="chevron-back" label={t('common.back')} onPress={() => void flush().finally(() => (router.canGoBack() ? router.back() : router.replace('/')))} testID="reader-back" />
            <View style={{ flex: 1, paddingHorizontal: space.xs }}>
              <AppText numberOfLines={1} style={{ fontWeight: '700' }}>
                {titleOf(doc)}
              </AppText>
              <AppText variant="caption" muted numberOfLines={1} testID="reader-position">
                {screen && mode === 'book' ? t('reader.screen', { i: screen.index, n: screen.count }) : `${t('reader.page', { n: page })} / ${total}`} · {minutesLeft > 0 ? t('reader.left', { n: minutesLeft }) : t('reader.left.done')}
              </AppText>
            </View>
            {mode === 'book' ? <IconButton icon="search" label={t('reader.find')} onPress={() => setFinding(true)} testID="open-find" /> : null}
            <IconButton icon="list" label={t('reader.contents')} onPress={() => setContentsOpen(true)} testID="open-contents" />
            <IconButton icon="text" label={t('reader.typography')} onPress={() => setTypoOpen(true)} testID="open-typography" />
            <IconButton icon="ellipsis-horizontal" label={t('reader.more')} onPress={() => setMoreOpen(true)} testID="open-more" />
          </View>
          {finding && mode === 'book' ? <FindBar doc={doc} onHit={onFound} onClose={closeFind} /> : null}
          <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm, backgroundColor: c.bg }}>
            <Segmented<'book' | 'magazine' | 'original'>
              value={mode === 'original' ? 'original' : settings.layout}
              onChange={(choice) => {
                setActive(null);
                if (choice === 'original') {
                  closeFind();
                  setMode('original');
                  reader.current?.send({ type: 'mode', mode: 'original' });
                  return;
                }
                void updateReader({ layout: choice });
                if (mode === 'original') {
                  setMode('book');
                  reader.current?.send({ type: 'mode', mode: 'book' });
                }
              }}
              options={[
                { value: 'book', label: t('reader.book') },
                { value: 'magazine', label: t('reader.magazine') },
                { value: 'original', label: t('reader.original') },
              ]}
            />
          </View>
          {mode === 'original' ? (
            <InkBar tool={inkTool} color={inkColor} onTool={setInkTool} onColor={(k) => { setInkColor(k); if (inkTool === 'off') setInkTool('pen'); }} onUndo={() => reader.current?.send({ type: 'ink-undo' })} />
          ) : null}
        </>
      ) : null}

      <View style={{ flex: 1 }}>
        <ReaderView
          key={fixes.map((f) => `${f.id}:${f.updatedAt}`).join(',')}
          ref={reader}
          docId={id}
          doc={doc}
          library={library}
          settings={settings}
          mode={mode}
          anchor={state.anchor}
          bookmarks={bookmarkIds}
          highlights={highlights}
          ink={inkPages}
          strings={strings}
          focus={requestedBlock ? { blockId: requestedBlock, page: requestedPage } : null}
          onEvent={onEvent}
        />
        {selection && mode === 'book' ? (
          <SelectionBar
            text={selection.text}
            color={color}
            onColor={setColor}
            aiOn={aiOn}
            onExplain={() => {
              setLearn({ blockId: selection.blockId, text: selection.text, start: selection.start, end: selection.end });
              setLearnOpen(true);
            }}
            onHighlight={() => void addAnnotation(selection, '', color)}
            onNote={() => setNoteFor({ mode: 'new', sel: selection })}
            copied={copied}
            onCopyCite={() => {
              const page = index.byId.get(selection.blockId)?.source[0].page ?? 1;
              void copyText(formatQuote(selection.text, { source: citationSourceOf(doc), page, style: citationStyle })).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              });
            }}
            onClose={() => {
              setSelection(null);
              reader.current?.send({ type: 'clear-selection' });
            }}
          />
        ) : null}
        {activeBlock && mode === 'book' && !selection ? (
          <BlockActions
            block={activeBlock}
            onExplain={() => {
              setLearn({ blockId: activeBlock.id });
              setLearnOpen(true);
            }}
            onExportTable={(kind) => {
              const table = activeBlock.table;
              if (!table) return;
              const cap = activeBlock.caption_id ? index.byId.get(activeBlock.caption_id)?.text : '';
              const stem = slugify(`${titleOf(doc)} table ${activeBlock.number ?? ''}`);
              if (kind === 'csv') void shareTextFile(`${stem}.csv`, tableToCsv(table.rows, { bom: true, safe: true }), 'text/csv');
              else {
                const name = safeSheetName(cap || `Table ${activeBlock.number ?? ''}`, new Set());
                void shareBinaryFile(`${stem}.xlsx`, tablesToXlsx([{ name, rows: table.rows, headerRows: table.header_rows }]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
              }
            }}
            onFix={() => {
              setFixing(activeBlock.id);
              setActive(null);
              reader.current?.send({ type: 'clear-selection' });
            }}
            onReport={() => {
              setReporting(activeBlock.id);
              setActive(null);
              reader.current?.send({ type: 'clear-selection' });
            }}
            bookmarked={bookmarkIds.includes(activeBlock.id)}
            onToggleBookmark={() => toggleBookmark(activeBlock.id)}
            onShowOriginal={() => showOriginal(activeBlock.id)}
            onClose={() => {
              setActive(null);
              reader.current?.send({ type: 'clear-selection' });
            }}
          />
        ) : null}
      </View>
      {listen ? (
        <ListenBar
          state={listen.state}
          index={listen.index}
          length={listen.length}
          rate={rate}
          onToggle={() => (speaker.current?.state === 'playing' ? speaker.current.pause() : speaker.current?.resume())}
          onPrev={() => speaker.current?.prev()}
          onNext={() => speaker.current?.next()}
          onRate={() => {
            const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
            setRate(next);
            speaker.current?.setRate(next);
          }}
          onClose={stopListening}
        />
      ) : null}
      {focusMode ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('reader.focus.exit')}
          onPress={() => setFocusMode(false)}
          testID="focus-exit"
          style={{ position: 'absolute', top: 6, right: 10, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: 'rgba(29,36,51,0.82)' }}
        >
          <AppText variant="caption" color="#fff" testID="focus-position">
            {Math.round(percent)}% · {minutesLeft > 0 ? t('reader.left', { n: minutesLeft }) : t('reader.left.done')}
          </AppText>
        </Pressable>
      ) : null}
      <View style={{ height: 3, backgroundColor: c.bg }}>
        <ProgressBar value={percent / 100} height={3} />
      </View>

      <ContentsSheet
        visible={contentsOpen}
        onClose={() => setContentsOpen(false)}
        index={index}
        bookmarks={bookmarks}
        onGoto={(blockId) => {
          setContentsOpen(false);
          reader.current?.send({ type: 'goto', blockId, flash: true });
        }}
        onRemoveBookmark={toggleBookmark}
      />
      <Sheet visible={typoOpen} onClose={() => setTypoOpen(false)} title={t('reader.typography')}>
        <TypographyControls settings={settings} onChange={(patch) => void updateReader(patch)} />
      </Sheet>
      <Sheet visible={moreOpen} onClose={() => setMoreOpen(false)} title={t('reader.more')}>
        <View testID="more-sheet" style={{ gap: space.xs }}>
          {(
            [
              ['report', warn ? 'warning-outline' : 'analytics-outline', t('reader.report'), () => router.push(`/report/${id}`)],
              ['export', 'share-outline', t('reader.export'), () => setExportOpen(true)],
              ['focus', 'expand-outline', t('reader.focus'), () => setFocusMode(true)],
              ...(speechAvailable() && mode === 'book'
                ? ([['listen', 'volume-high-outline', t('reader.listen'), () => {
                    const queue = buildQueue(doc, anchorRef.current);
                    if (!queue.length) return;
                    speaker.current?.stop();
                    const sp = new Speaker(createSpeechEngine(), queue, {
                      lang: doc.metadata.language?.toLowerCase().startsWith('tr') ? 'tr-TR' : 'en-US',
                      rate,
                      onSentence: (u, i) => {
                        setSpoken(u);
                        setListen((l) => (l ? { ...l, index: i } : l));
                      },
                      onState: (st) => setListen((l) => (l ? { ...l, state: st } : l)),
                    });
                    speaker.current = sp;
                    setListen({ state: 'playing', index: 0, length: queue.length });
                    sp.play();
                  }]] as [string, IconName, string, () => void][])
                : []),
            ] as [string, IconName, string, () => void][]
          ).map(([key, icon, label, run]) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              testID={`more-${key}`}
              onPress={() => {
                setMoreOpen(false);
                run();
              }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 12 }}
            >
              <IconButton icon={icon} label={label} onPress={() => undefined} />
              <AppText style={{ flex: 1, fontSize: 16 }}>{label}</AppText>
            </Pressable>
          ))}
        </View>
      </Sheet>
      <FixSheet
        visible={fixing !== null}
        onClose={() => setFixing(null)}
        block={fixing ? index.byId.get(fixing) ?? null : null}
        original={fixing && raw ? raw.blocks.find((b) => b.id === fixing) ?? null : null}
        fix={fixing ? fixes.find((f) => f.id === fixing) ?? null : null}
        canMerge={!!fixing && doc.blocks.findIndex((b) => b.id === fixing) > 0}
        onSave={async (patch) => {
          if (!fixing) return;
          await getStores().fixes.set(id, fixing, patch);
          setFixes(await getStores().fixes.list(id));
          termsSent.current = false;
          setFixing(null);
        }}
        onRestore={async () => {
          if (!fixing) return;
          await getStores().fixes.remove(id, fixing);
          setFixes(await getStores().fixes.list(id));
          termsSent.current = false;
          setFixing(null);
        }}
      />
      <ReportSheet
        visible={reporting !== null}
        onClose={() => setReporting(null)}
        onCreate={async (note, withPage) => {
          if (!reporting || !raw) return;
          const block = raw.blocks.find((b) => b.id === reporting);
          const pageInfo = block ? raw.pages.find((p) => p.number === block.source[0]?.page) : undefined;
          const pageImage = withPage && pageInfo ? await library.asset(id, pageInfo.image) : null;
          const bundle = buildFeedbackBundle({ doc: raw, blockId: reporting, note, appVersion: app.expo.version, pageImage });
          await shareBinaryFile(bundle.filename, bundle.bytes, 'application/zip');
          setReporting(null);
        }}
      />
      <ExportSheet visible={exportOpen} onClose={() => setExportOpen(false)} doc={doc} docId={id} library={library} settings={settings} />
      <LearnSheet
        visible={learnOpen}
        onClose={() => setLearnOpen(false)}
        docId={id}
        index={index}
        target={learn}
        onGoto={(blockId) => reader.current?.send({ type: 'goto', blockId, flash: true })}
        onShowOriginal={showOriginal}
        onSaveNote={async ({ blockId, start, end, quote, note, page }) => {
          const a = await annRepo.add({ docId: id, blockId, start, end, quote, color, note, origin: 'ai', page });
          setAnnotations((list) => [...list, a]);
        }}
      />
      <NoteSheet
        visible={noteFor !== null}
        quote={noteFor?.mode === 'new' ? noteFor.sel.text : (annotations.find((a) => a.id === (noteFor?.mode === 'edit' ? noteFor.id : ''))?.quote ?? '')}
        initialNote={noteFor?.mode === 'edit' ? (annotations.find((a) => a.id === noteFor.id)?.note ?? '') : ''}
        initialColor={noteFor?.mode === 'edit' ? (annotations.find((a) => a.id === noteFor.id)?.color ?? color) : color}
        aiNote={noteFor?.mode === 'edit' && annotations.find((a) => a.id === noteFor.id)?.origin === 'ai'}
        onClose={() => setNoteFor(null)}
        onSave={async (note, chosen) => {
          if (!noteFor) return;
          if (noteFor.mode === 'new') await addAnnotation(noteFor.sel, note, chosen);
          else {
            const updated = await annRepo.update(id, noteFor.id, { note, color: chosen });
            if (updated) setAnnotations((list) => list.map((a) => (a.id === updated.id ? updated : a)));
          }
          setNoteFor(null);
        }}
        onDelete={
          noteFor?.mode === 'edit'
            ? async () => {
                await annRepo.remove(id, noteFor.id);
                setAnnotations((list) => list.filter((a) => a.id !== noteFor.id));
                setNoteFor(null);
              }
            : undefined
        }
      />
      <FlagsSheet block={flagBlock} onClose={() => setFlagsFor(null)} onShowOriginal={showOriginal} />
    </SafeAreaView>
  );
}
