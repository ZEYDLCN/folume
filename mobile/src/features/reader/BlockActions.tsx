import { View } from 'react-native';

import type { Block } from '@/core/types';
import type { StringKey } from '@/i18n';
import { AppText, IconButton, Row } from '@/ui/components';
import { radius, space, useColors } from '@/ui/theme';
import { useT } from '@/ui/useT';

/** Floating bar shown after tapping a block: acts on that block's place in the paper. */
export function BlockActions({
  block,
  bookmarked,
  onToggleBookmark,
  onShowOriginal,
  onExplain,
  onExportTable,
  onFix,
  onReport,
  onClose,
}: {
  block: Block;
  bookmarked: boolean;
  onToggleBookmark: () => void;
  onShowOriginal: () => void;
  onExplain: () => void;
  /** for a table with readable cells: write it out as CSV or Excel */
  onExportTable?: (kind: 'csv' | 'xlsx') => void;
  /** correct what the converter got wrong in this block */
  onFix?: () => void;
  /** make a small file about a wrong conversion */
  onReport?: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const c = useColors();
  return (
    <View
      testID="block-actions"
      style={{
        position: 'absolute',
        left: space.md,
        right: space.md,
        bottom: space.xl + 8,
        alignSelf: 'center',
        maxWidth: 560,
        width: '100%',
        backgroundColor: c.surface,
        borderColor: c.border,
        borderWidth: 1,
        borderRadius: radius.lg,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 4 },
        elevation: 8,
      }}
    >
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <AppText variant="label" muted>
            {t(`reader.block.${block.type}` as StringKey)}
          </AppText>
          <AppText variant="caption" muted>
            {t('reader.page', { n: block.source[0].page })}
          </AppText>
        </View>
        <IconButton icon="color-wand-outline" label={t('sel.explain')} onPress={onExplain} testID="action-explain" />
        {onFix ? <IconButton icon="construct-outline" label={t('fix.title')} onPress={onFix} testID="action-fix" /> : null}
        {onReport ? <IconButton icon="flag-outline" label={t('report.block.title')} onPress={onReport} testID="action-report" /> : null}
        {block.type === 'table' && block.table && onExportTable ? (
          <>
            <IconButton icon="document-text-outline" label={t('action.csv')} onPress={() => onExportTable('csv')} testID="action-csv" />
            <IconButton icon="grid-outline" label={t('action.xlsx')} onPress={() => onExportTable('xlsx')} testID="action-xlsx" />
          </>
        ) : null}
        <IconButton icon="document-text-outline" label={t('reader.showOriginal')} onPress={onShowOriginal} testID="action-original" />
        <IconButton
          icon={bookmarked ? 'bookmark' : 'bookmark-outline'}
          label={bookmarked ? t('reader.bookmark.remove') : t('reader.bookmark.add')}
          active={bookmarked}
          onPress={onToggleBookmark}
          testID="action-bookmark"
        />
        <IconButton icon="close" label={t('common.close')} onPress={onClose} />
      </Row>
    </View>
  );
}
