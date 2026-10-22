import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { parseBibliography } from '@/core/bib';
import { classifyLink } from '@/core/link';
import type { WantItem } from '@/data/userdata';
import { getStores } from '@/services/container';
import { pickTextFile } from '@/services/picker';
import { AppText, Badge, Button, Card, IconButton } from '@/ui/components';
import { radius, space, useColors } from '@/ui/theme';
import { useT } from '@/ui/useT';

/** What to hand to "add from a link" for this paper: the arXiv id, else the DOI, else the link. */
export const importTarget = (w: Pick<WantItem, 'arxivId' | 'doi' | 'url'>): string | null => w.arxivId ?? w.doi ?? w.url;

export default function WantScreen() {
  const t = useT();
  const c = useColors();
  const router = useRouter();
  const [items, setItems] = useState<WantItem[]>([]);
  const [text, setText] = useState('');
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => setItems(await getStores().want.list()), []);
  useFocusEffect(useCallback(() => void load(), [load]));

  const importFile = async () => {
    setMessage(null);
    const file = await pickTextFile(['*/*']);
    if (file === null) return;
    const { format, items: found } = parseBibliography(file);
    if (format === 'unknown' || !found.length) return setMessage({ tone: 'error', text: t('want.import.error') });
    const res = await getStores().want.add(found.map((b) => ({ ...b, source: 'bib' as const })));
    setMessage({ tone: 'ok', text: t('want.import.done', { added: res.added, skipped: res.skipped }) });
    await load();
  };

  const addByHand = async () => {
    const value = text.trim();
    if (!value) return;
    const info = classifyLink(value);
    const item: Partial<WantItem> & { title: string } = { title: value, source: 'manual' };
    if (info?.kind === 'arxiv') Object.assign(item, { title: `arXiv:${info.label}`, arxivId: info.label });
    else if (info?.kind === 'doi') Object.assign(item, { title: `doi:${info.label}`, doi: info.label });
    else if (info?.kind === 'url') Object.assign(item, { title: info.label, url: /^https?:/i.test(value) ? value : `https://${value}` });
    const res = await getStores().want.add([item]);
    setMessage(res.added ? null : { tone: 'error', text: t('want.add.duplicate') });
    setText('');
    await load();
  };

  const todo = items.filter((i) => i.state === 'todo');
  const done = items.filter((i) => i.state === 'done');

  const row = (w: WantItem) => {
    const target = importTarget(w);
    return (
      <Card key={w.id} style={{ gap: space.sm }} testID={`want-${w.id}`}>
        <AppText style={{ fontWeight: '700', fontSize: 16, lineHeight: 21 }} numberOfLines={3}>
          {w.title}
        </AppText>
        <AppText variant="caption" muted numberOfLines={1}>
          {[w.authors.slice(0, 3).join(', ') + (w.authors.length > 3 ? ' et al.' : ''), w.year ? String(w.year) : '', w.arxivId ? `arXiv:${w.arxivId}` : w.doi ? `doi:${w.doi}` : ''].filter(Boolean).join(' · ')}
        </AppText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
          {w.state === 'done' ? <Badge label={t('want.done')} tone="ok" /> : null}
          <View style={{ flex: 1 }} />
          {target && w.state === 'todo' ? (
            <Button label={t('want.addToLibrary')} icon="download-outline" variant="secondary" onPress={() => router.dismissTo({ pathname: '/', params: { import: target } })} testID={`want-import-${w.id}`} />
          ) : w.state === 'todo' ? (
            <AppText variant="caption" muted>
              {t('want.noLink')}
            </AppText>
          ) : null}
          <IconButton icon={w.state === 'done' ? 'arrow-undo-outline' : 'checkmark-circle-outline'} label={t(w.state === 'done' ? 'want.undo' : 'want.markDone')} onPress={() => void getStores().want.setState(w.id, w.state === 'done' ? 'todo' : 'done').then(load)} testID={`want-done-${w.id}`} />
          <IconButton icon="trash-outline" label={t('common.delete')} onPress={() => void getStores().want.remove(w.id).then(load)} testID={`want-delete-${w.id}`} />
        </View>
      </Card>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm }}>
        <IconButton icon="chevron-back" label={t('common.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} testID="screen-back" />
        <AppText variant="heading" style={{ flex: 1 }}>
          {t('want.title')}
        </AppText>
        <IconButton icon="document-attach-outline" label={t('want.import')} onPress={() => void importFile()} testID="want-import-file" />
      </View>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, maxWidth: 720, width: '100%', alignSelf: 'center' }} testID="want-list">
        <AppText muted>{t('want.intro')}</AppText>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <TextInput
            value={text}
            onChangeText={setText}
            onSubmitEditing={() => void addByHand()}
            accessibilityLabel={t('want.add.placeholder')}
            placeholder={t('want.add.placeholder')}
            placeholderTextColor={c.muted}
            autoCapitalize="none"
            autoCorrect={false}
            testID="want-input"
            style={{ flex: 1, height: 46, borderRadius: radius.md, paddingHorizontal: space.md, backgroundColor: c.surfaceAlt, color: c.text }}
          />
          <Button label={t('want.add')} onPress={() => void addByHand()} testID="want-add" />
        </View>
        {message ? (
          <AppText color={message.tone === 'ok' ? c.ok : c.danger} testID={message.tone === 'ok' ? 'want-message-ok' : 'want-message-error'}>
            {message.text}
          </AppText>
        ) : null}
        {items.length === 0 ? <AppText muted testID="want-empty">{t('want.empty')}</AppText> : null}
        {todo.map(row)}
        {done.length ? (
          <AppText variant="label" muted>
            {t('want.doneList', { n: done.length })}
          </AppText>
        ) : null}
        {done.map(row)}
      </ScrollView>
    </SafeAreaView>
  );
}
