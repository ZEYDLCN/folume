import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { indexDocument } from '@/core/docModel';
import { tableToCsv, tablesToXlsx } from '@/core/export/table';
import {
  addColumn,
  addPaper,
  matrixMarkdown,
  matrixProgress,
  matrixRows,
  removeColumn,
  removePaper,
  renameColumn,
  setCell,
  suggestCell,
  withPage,
  type MatrixPaper,
} from '@/core/matrix';
import type { LibraryEntry } from '@/data/library';
import { cellKey, type Project } from '@/data/userdata';
import { getStores } from '@/services/container';
import { shareBinaryFile, shareTextFile } from '@/services/share';
import { AppText, Button, Card, Field, IconButton, Sheet } from '@/ui/components';
import { radius, space, useColors } from '@/ui/theme';
import { useT } from '@/ui/useT';

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const slug = (s: string) => s.normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';

export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const projectId = first(id) ?? '';
  const t = useT();
  const c = useColors();
  const router = useRouter();
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [sheet, setSheet] = useState<'papers' | 'columns' | 'export' | null>(null);
  const [newColumn, setNewColumn] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  /** what is being typed in a cell, until the reader leaves it */
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const stores = getStores();
    setProject(await stores.projects.get(projectId));
    setEntries(await stores.library.list());
    setDrafts({});
  }, [projectId]);
  useFocusEffect(useCallback(() => void load(), [load]));

  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);

  const change = async (fn: (p: Project) => Project) => {
    const next = await getStores().projects.edit(projectId, fn);
    if (next) setProject(next);
    return next;
  };

  if (project === undefined) return <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} />;
  if (project === null) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg, padding: space.lg, gap: space.md }}>
        <AppText>{t('project.missing')}</AppText>
        <Button label={t('common.back')} onPress={() => router.dismissTo('/projects')} testID="project-back" />
      </SafeAreaView>
    );
  }

  const { filled, total } = matrixProgress(project);
  const paperInfo = (docId: string): MatrixPaper | null => {
    const e = byId.get(docId);
    return e ? { id: docId, title: e.title, authors: e.authors, year: e.year } : null;
  };

  const suggestFor = async (docId: string, columnIds: string[]): Promise<Record<string, string>> => {
    const doc = await getStores().library.loadDocument(docId);
    if (!doc) return {};
    const index = indexDocument(doc);
    const out: Record<string, string> = {};
    for (const col of project.columns.filter((x) => columnIds.includes(x.id))) {
      const s = suggestCell(index, col.name);
      if (s) out[cellKey(docId, col.id)] = withPage(s);
    }
    return out;
  };

  const suggestOne = async (docId: string, columnId: string) => {
    setNotice(null);
    const got = await suggestFor(docId, [columnId]);
    const text = got[cellKey(docId, columnId)];
    if (!text) return setNotice(t('project.suggest.none'));
    await change((p) => setCell(p, docId, columnId, text));
  };

  const suggestAll = async () => {
    setNotice(null);
    const found: Record<string, string> = {};
    for (const docId of project.paperIds) {
      const empty = project.columns.filter((col) => !project.cells[cellKey(docId, col.id)]?.trim()).map((col) => col.id);
      if (empty.length) Object.assign(found, await suggestFor(docId, empty));
    }
    const keys = Object.keys(found);
    if (!keys.length) return setNotice(t('project.suggest.none'));
    await change((p) => {
      let next = p;
      for (const k of keys) {
        const [docId, columnId] = k.split('|');
        next = setCell(next, docId, columnId, found[k]);
      }
      return next;
    });
    setNotice(t('project.suggestAll.done', { n: keys.length }));
  };

  const rows = () => matrixRows(project, new Map(project.paperIds.flatMap((d) => (paperInfo(d) ? [[d, paperInfo(d)!] as const] : []))));

  const exportAs = async (kind: 'csv' | 'xlsx' | 'markdown') => {
    const base = slug(project.name);
    const data = rows();
    let file: string;
    if (kind === 'csv') {
      file = `${base}.csv`;
      await shareTextFile(file, tableToCsv(data, { bom: true, safe: true }), 'text/csv');
    } else if (kind === 'markdown') {
      file = `${base}.md`;
      await shareTextFile(file, matrixMarkdown(project.name, data), 'text/markdown');
    } else {
      file = `${base}.xlsx`;
      await shareBinaryFile(file, tablesToXlsx([{ name: project.name, rows: data, headerRows: 1 }]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    }
    setNotice(t('project.export.done', { file }));
    setSheet(null);
  };

  const confirmDelete = () => {
    const run = () => void getStores().projects.remove(projectId).then(() => router.dismissTo('/projects'));
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') return window.confirm(t('project.delete') + '?') ? run() : undefined;
    Alert.alert(t('project.delete'), project.name, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: run },
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm }}>
        <IconButton icon="chevron-back" label={t('common.back')} onPress={() => (router.canGoBack() ? router.back() : router.dismissTo('/projects'))} testID="project-back" />
        <TextInput
          value={drafts.__name ?? project.name}
          onChangeText={(v) => setDrafts((d) => ({ ...d, __name: v }))}
          onBlur={() => {
            const v = drafts.__name;
            if (v !== undefined && v.trim() && v.trim() !== project.name) void change((p) => ({ ...p, name: v.trim() }));
            setDrafts((d) => {
              const { __name: _n, ...rest } = d;
              void _n;
              return rest;
            });
          }}
          accessibilityLabel={t('project.name')}
          testID="project-name"
          style={{ flex: 1, minWidth: 0, color: c.text, fontSize: 20, fontWeight: '700', paddingVertical: space.sm }}
        />
        {project.paperIds.length ? <IconButton icon="download-outline" label={t('project.export')} onPress={() => setSheet('export')} testID="project-export" /> : null}
        <IconButton icon="trash-outline" label={t('project.delete')} onPress={confirmDelete} testID="project-delete" />
      </View>

      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, maxWidth: 720, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled" testID="project-body">
        <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
          <Button label={t('project.papers.add')} icon="add" variant="secondary" onPress={() => setSheet('papers')} testID="project-add-papers" />
          <Button label={t('project.columns')} icon="options-outline" variant="secondary" onPress={() => setSheet('columns')} testID="project-columns" />
          {project.paperIds.length ? <Button label={t('project.suggestAll')} icon="sparkles-outline" variant="secondary" onPress={() => void suggestAll()} testID="project-suggest-all" /> : null}
        </View>
        {total ? (
          <AppText variant="caption" muted testID="project-progress">
            {t('project.progress', { filled, total })}
          </AppText>
        ) : null}
        {notice ? (
          <AppText color={c.accent} testID="project-notice">
            {notice}
          </AppText>
        ) : null}
        {!project.paperIds.length ? <AppText muted testID="project-empty">{t('project.papers.none')}</AppText> : null}

        {project.paperIds.map((docId) => {
          const e = byId.get(docId);
          return (
            <Card key={docId} style={{ gap: space.md }} testID={`project-paper-${docId}`}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText style={{ fontWeight: '700', fontSize: 16, lineHeight: 21 }} numberOfLines={3}>
                    {e?.title ?? t('project.papers.pick')}
                  </AppText>
                  {e ? (
                    <AppText variant="caption" muted numberOfLines={1}>
                      {[e.authors.slice(0, 3).join(', ') + (e.authors.length > 3 ? ' et al.' : ''), e.year ? String(e.year) : ''].filter(Boolean).join(' · ')}
                    </AppText>
                  ) : null}
                </View>
                {e ? <IconButton icon="open-outline" label={t('project.open')} onPress={() => router.push(`/reader/${docId}`)} testID={`project-open-${docId}`} /> : null}
                <IconButton icon="close" label={t('project.remove')} onPress={() => void change((p) => removePaper(p, docId))} testID={`project-remove-${docId}`} />
              </View>
              {project.columns.map((col) => {
                const k = cellKey(docId, col.id);
                const value = drafts[k] ?? project.cells[k] ?? '';
                return (
                  <View key={col.id} style={{ gap: 4 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                      <AppText variant="label" muted style={{ flex: 1 }}>
                        {col.name}
                      </AppText>
                      {e ? (
                        <Pressable accessibilityRole="button" accessibilityLabel={`${t('project.suggest')}: ${col.name}`} onPress={() => void suggestOne(docId, col.id)} testID={`cell-suggest-${docId}-${col.id}`} hitSlop={8}>
                          <Ionicons name="sparkles-outline" size={18} color={c.accent} />
                        </Pressable>
                      ) : null}
                    </View>
                    <TextInput
                      value={value}
                      onChangeText={(v) => setDrafts((d) => ({ ...d, [k]: v }))}
                      onBlur={() => {
                        const v = drafts[k];
                        if (v === undefined) return;
                        void change((p) => setCell(p, docId, col.id, v));
                        setDrafts((d) => {
                          const { [k]: _gone, ...rest } = d;
                          void _gone;
                          return rest;
                        });
                      }}
                      multiline
                      placeholder={t('project.cell.placeholder')}
                      placeholderTextColor={c.muted}
                      accessibilityLabel={`${col.name}`}
                      testID={`cell-${docId}-${col.id}`}
                      style={{ minHeight: 44, borderRadius: radius.md, backgroundColor: c.surfaceAlt, color: c.text, padding: space.md, textAlignVertical: 'top' }}
                    />
                  </View>
                );
              })}
            </Card>
          );
        })}
      </ScrollView>

      <Sheet visible={sheet === 'papers'} onClose={() => setSheet(null)} title={t('project.papers.pick')}>
        {entries.length === 0 ? <AppText muted>{t('project.papers.libraryEmpty')}</AppText> : null}
        {entries.map((e) => {
          const on = project.paperIds.includes(e.id);
          return (
            <Pressable
              key={e.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              onPress={() => void change((p) => (on ? removePaper(p, e.id) : addPaper(p, e.id)))}
              testID={`project-pick-${e.id}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: c.surfaceAlt, borderWidth: 2, borderColor: on ? c.accent : 'transparent' }}
            >
              <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? c.accent : c.muted} />
              <View style={{ flex: 1 }}>
                <AppText numberOfLines={2} style={{ fontWeight: '600' }}>
                  {e.title}
                </AppText>
                <AppText variant="caption" muted numberOfLines={1}>
                  {e.authors.slice(0, 2).join(', ')}
                </AppText>
              </View>
            </Pressable>
          );
        })}
      </Sheet>

      <Sheet visible={sheet === 'columns'} onClose={() => setSheet(null)} title={t('project.columns')}>
        {project.columns.map((col) => (
          <View key={col.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <TextInput
              value={drafts[`col:${col.id}`] ?? col.name}
              onChangeText={(v) => setDrafts((d) => ({ ...d, [`col:${col.id}`]: v }))}
              onBlur={() => {
                const v = drafts[`col:${col.id}`];
                if (v !== undefined) void change((p) => renameColumn(p, col.id, v));
                setDrafts((d) => {
                  const { [`col:${col.id}`]: _gone, ...rest } = d;
                  void _gone;
                  return rest;
                });
              }}
              accessibilityLabel={col.name}
              testID={`column-name-${col.id}`}
              style={{ flex: 1, minWidth: 0, height: 44, borderRadius: radius.md, paddingHorizontal: space.md, backgroundColor: c.surfaceAlt, color: c.text }}
            />
            <IconButton icon="trash-outline" label={t('common.delete')} onPress={() => void change((p) => removeColumn(p, col.id))} testID={`column-delete-${col.id}`} />
          </View>
        ))}
        <Field label={t('project.columns.add')}>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <TextInput
              value={newColumn}
              onChangeText={setNewColumn}
              onSubmitEditing={() => {
                void change((p) => addColumn(p, newColumn));
                setNewColumn('');
              }}
              placeholder={t('project.columns.placeholder')}
              placeholderTextColor={c.muted}
              accessibilityLabel={t('project.columns.add')}
              testID="column-new"
              style={{ flex: 1, minWidth: 0, height: 44, borderRadius: radius.md, paddingHorizontal: space.md, backgroundColor: c.surfaceAlt, color: c.text }}
            />
            <Button
              label={t('projects.create')}
              disabled={!newColumn.trim()}
              onPress={() => {
                void change((p) => addColumn(p, newColumn));
                setNewColumn('');
              }}
              testID="column-add"
            />
          </View>
        </Field>
      </Sheet>

      <Sheet visible={sheet === 'export'} onClose={() => setSheet(null)} title={t('project.export')}>
        <Button label={t('project.export.xlsx')} icon="grid-outline" onPress={() => void exportAs('xlsx')} testID="project-export-xlsx" />
        <Button label={t('project.export.csv')} icon="document-text-outline" variant="secondary" onPress={() => void exportAs('csv')} testID="project-export-csv" />
        <Button label={t('project.export.markdown')} icon="logo-markdown" variant="secondary" onPress={() => void exportAs('markdown')} testID="project-export-markdown" />
      </Sheet>
    </SafeAreaView>
  );
}
