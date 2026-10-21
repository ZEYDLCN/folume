import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { flattenOutline, outline, type DocIndex } from '@/core/docModel';
import type { Bookmark } from '@/data/library';
import { AppText, IconButton, Segmented, Sheet } from '@/ui/components';
import { space, useColors } from '@/ui/theme';
import { useT } from '@/ui/useT';

export function ContentsSheet({
  visible,
  onClose,
  index,
  bookmarks,
  onGoto,
  onRemoveBookmark,
}: {
  visible: boolean;
  onClose: () => void;
  index: DocIndex;
  bookmarks: Bookmark[];
  onGoto: (blockId: string) => void;
  onRemoveBookmark: (blockId: string) => void;
}) {
  const t = useT();
  const c = useColors();
  const [tab, setTab] = useState<'contents' | 'bookmarks'>('contents');
  useEffect(() => {
    if (visible) setTab('contents'); // it opens on the contents, whichever tab was used last
  }, [visible]);
  const items = flattenOutline(outline(index.doc));
  return (
    <Sheet visible={visible} onClose={onClose} title={tab === 'contents' ? t('reader.contents') : t('reader.bookmarks')}>
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'contents', label: t('reader.contents') },
          { value: 'bookmarks', label: `${t('reader.bookmarks')} (${bookmarks.length})` },
        ]}
      />
      {tab === 'contents' ? (
        <View testID="contents-list">
          {items.map(({ section, depth }) => (
            <Pressable
              key={section.id}
              accessibilityRole="button"
              onPress={() => section.block_id && onGoto(section.block_id)}
              style={{ paddingVertical: 10, paddingLeft: depth * 18, flexDirection: 'row', gap: 8 }}
            >
              {section.number ? (
                <AppText muted style={{ minWidth: 28 }}>
                  {section.number}
                </AppText>
              ) : null}
              <AppText style={{ flex: 1, fontWeight: depth === 0 ? '700' : '500' }}>{section.title}</AppText>
              <AppText variant="caption" muted>
                {section.start_page}
              </AppText>
            </Pressable>
          ))}
        </View>
      ) : bookmarks.length === 0 ? (
        <AppText muted>{t('reader.bookmarks.empty')}</AppText>
      ) : (
        <View style={{ gap: space.sm }}>
          {bookmarks.map((b) => {
            const block = index.byId.get(b.blockId);
            return (
              <View key={b.blockId} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 0.5, borderBottomColor: c.border }}>
                <Pressable style={{ flex: 1, paddingVertical: 8 }} onPress={() => onGoto(b.blockId)}>
                  <AppText numberOfLines={2}>{block?.text || block?.type}</AppText>
                  <AppText variant="caption" muted>
                    {t('reader.page', { n: block?.source[0].page ?? 1 })}
                  </AppText>
                </Pressable>
                <IconButton icon="trash-outline" label={t('common.delete')} size={18} onPress={() => onRemoveBookmark(b.blockId)} />
              </View>
            );
          })}
        </View>
      )}
    </Sheet>
  );
}
