import { Pressable, View } from 'react-native';

import type { LibraryEntry } from '@/data/library';
import { getLocale } from '@/i18n';
import { AppText, Badge, Card, IconButton, ProgressBar } from '@/ui/components';
import { radius, serif, space, useColors } from '@/ui/theme';
import { useT } from '@/ui/useT';

/** Month over day, like the date of a lecture in a course list: when the paper was last read (or added). */
function DateChip({ at }: { at: number }) {
  const c = useColors();
  const d = new Date(at);
  const month = d.toLocaleDateString(getLocale() === 'tr' ? 'tr-TR' : 'en-US', { month: 'short' }).replace('.', '');
  return (
    <View style={{ width: 50, height: 56, borderRadius: radius.md, backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center' }} accessible={false}>
      <AppText style={{ fontSize: 10, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: c.accent }}>{month}</AppText>
      <AppText style={{ fontSize: 20, lineHeight: 24, fontWeight: '700', fontFamily: serif }}>{d.getDate()}</AppText>
    </View>
  );
}

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
      <Card style={{ gap: space.sm, padding: space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
          <DateChip at={entry.lastOpenedAt ?? entry.addedAt} />
          <View style={{ flex: 1, gap: 3 }}>
            <AppText numberOfLines={3} style={{ fontSize: 16, lineHeight: 21, fontWeight: '700' }}>
              {entry.title}
            </AppText>
            {entry.authors.length ? (
              <AppText variant="caption" muted numberOfLines={1}>
                {entry.authors.join(', ')}
              </AppText>
            ) : null}
            <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', alignItems: 'center' }}>
              <AppText variant="caption" muted>
                {t('common.pages', { n: entry.pageCount })}
                {entry.year ? ` · ${entry.year}` : ''}
              </AppText>
              {quality ? <Badge label={t(quality)} tone={entry.grade === 'fair' ? 'warn' : 'danger'} /> : null}
            </View>
          </View>
        </View>
        {entry.tags.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }} testID={`tag-list-${entry.id}`}>
            {entry.tags.map((tag) => (
              <Badge key={tag} label={tag} />
            ))}
          </View>
        ) : null}
        <ProgressBar value={entry.percent / 100} />
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <AppText variant="caption" muted style={{ flex: 1 }}>
            {entry.lastOpenedAt === null ? t('library.unread') : t('library.progress', { n: Math.round(entry.percent) })}
          </AppText>
          <IconButton icon="git-network-outline" label={t('library.connections')} onPress={onConnections} size={19} testID={`connections-${entry.id}`} />
          <IconButton icon="pricetag-outline" label={t('library.tags')} onPress={onTags} size={19} testID={`tags-${entry.id}`} />
          <IconButton icon="trash-outline" label={t('common.delete')} onPress={onDelete} size={19} testID={`delete-${entry.id}`} />
        </View>
      </Card>
    </Pressable>
  );
}
