import { useEffect, useMemo, useState } from 'react';
import { TextInput, View } from 'react-native';

import { findInDocument, type FindHit } from '@/core/find';
import type { Document } from '@/core/types';
import { AppText, IconButton } from '@/ui/components';
import { radius, space, useColors } from '@/ui/theme';
import { useT } from '@/ui/useT';

const LIMIT = 300;

/** Find in the open paper: type, see the count, step through the matches. The match is shown by the reader. */
export function FindBar({
  doc,
  onHit,
  onClose,
}: {
  doc: Document;
  /** called with the hit to show (null when there is none) */
  onHit: (hit: FindHit | null) => void;
  onClose: () => void;
}) {
  const t = useT();
  const c = useColors();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const id = setTimeout(() => {
      setQuery(text);
      setCurrent(0);
    }, 180);
    return () => clearTimeout(id);
  }, [text]);

  const result = useMemo(() => findInDocument(doc, query, { limit: LIMIT }), [doc, query]);
  const hit = result.hits[current] ?? null;
  useEffect(() => {
    onHit(hit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hit?.blockId, hit?.range?.start, hit?.match, current, query]);
  useEffect(() => () => onHit(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  const n = result.hits.length;
  const step = (d: number) => {
    if (n) setCurrent((i) => (i + d + n) % n);
  };
  const entered = query.trim().length >= 2;

  return (
    <View testID="find-bar" style={{ paddingHorizontal: space.sm, paddingBottom: space.sm, backgroundColor: c.bg, gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
        <TextInput
          testID="find-input"
          accessibilityLabel={t('reader.find')}
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => step(1)}
          onKeyPress={(e) => {
            const key = (e.nativeEvent as { key?: string }).key;
            if (key === 'Escape') onClose();
          }}
          placeholder={t('find.placeholder')}
          placeholderTextColor={c.muted}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={{ flex: 1, minWidth: 0, height: 42, borderRadius: radius.md, paddingHorizontal: space.md, backgroundColor: c.surfaceAlt, color: c.text }}
        />
        <AppText variant="caption" muted testID="find-count" style={{ minWidth: 48, flexShrink: 0, textAlign: 'center' }}>
          {!entered ? '' : n === 0 ? t('find.none') : t(result.total > n ? 'find.capped' : 'find.count', { i: current + 1, n: result.total > n ? n : result.total })}
        </AppText>
        <IconButton icon="chevron-up" label={t('find.prev')} onPress={() => step(-1)} testID="find-prev" />
        <IconButton icon="chevron-down" label={t('find.next')} onPress={() => step(1)} testID="find-next" />
        <IconButton icon="close" label={t('find.close')} onPress={onClose} testID="find-close" />
      </View>
      {hit?.removed ? (
        <AppText variant="caption" muted testID="find-removed">
          {t('find.removed', { n: hit.page })}
        </AppText>
      ) : null}
    </View>
  );
}
