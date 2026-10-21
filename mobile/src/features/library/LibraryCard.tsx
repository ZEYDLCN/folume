import { Pressable, View } from 'react-native';

import type { LibraryEntry } from '@/data/library';
import { AppText, Badge, Card, IconButton, ProgressBar } from '@/ui/components';
import { space } from '@/ui/theme';
import { useT } from '@/ui/useT';

export function LibraryCard({
  entry,
  onOpen,
  onDelete,
  onTags,
  onConnections,
}: {
  entry: LibraryEntry;
  onOpen: () => void;
  onDelete: () => void;
  onTags: () => void;
  onConnections: () => void;
}) {
  const t = useT();
  const quality =
    entry.grade === 'good' ? null : entry.grade === 'fair' ? 'library.quality.fair' : entry.grade === 'poor' ? 'library.quality.poor' : 'library.quality.unsupported';
  return (
    <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={entry.title} testID={`paper-${entry.id}`}>
      <Card style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
          <View style={{ flex: 1, gap: 4 }}>
            <AppText variant="heading" numberOfLines={3}>
              {entry.title}
            </AppText>
            {entry.authors.length ? (
              <AppText variant="caption" muted numberOfLines={1}>
                {entry.authors.join(', ')}
              </AppText>
            ) : null}
          </View>
          <IconButton icon="git-network-outline" label={t('library.connections')} onPress={onConnections} size={20} testID={`connections-${entry.id}`} />
          <IconButton icon="pricetag-outline" label={t('library.tags')} onPress={onTags} size={20} testID={`tags-${entry.id}`} />
          <IconButton icon="trash-outline" label={t('common.delete')} onPress={onDelete} size={20} testID={`delete-${entry.id}`} />
        </View>
        {entry.tags.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }} testID={`tag-list-${entry.id}`}>
            {entry.tags.map((tag) => (
              <Badge key={tag} label={tag} />
            ))}
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', alignItems: 'center' }}>
          <AppText variant="caption" muted>
            {t('common.pages', { n: entry.pageCount })}
            {entry.year ? ` · ${entry.year}` : ''}
          </AppText>
          {quality ? <Badge label={t(quality)} tone={entry.grade === 'fair' ? 'warn' : 'danger'} /> : null}
        </View>
        <ProgressBar value={entry.percent / 100} />
        <AppText variant="caption" muted>
          {entry.lastOpenedAt === null ? t('library.unread') : t('library.progress', { n: Math.round(entry.percent) })}
        </AppText>
      </Card>
    </Pressable>
  );
}
