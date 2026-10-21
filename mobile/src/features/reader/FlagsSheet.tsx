import { View } from 'react-native';

import type { Block } from '@/core/types';
import type { StringKey } from '@/i18n';
import { AppText, Badge, Button, Sheet } from '@/ui/components';
import { space } from '@/ui/theme';
import { useT } from '@/ui/useT';

export function FlagsSheet({
  block,
  onClose,
  onShowOriginal,
}: {
  block: Block | null;
  onClose: () => void;
  onShowOriginal: (blockId: string) => void;
}) {
  const t = useT();
  return (
    <Sheet visible={block !== null} onClose={onClose} title={t('reader.flags.title')}>
      {block ? (
        <View style={{ gap: space.md }} testID="flags-sheet">
          {block.flags.map((f) => (
            <View key={f.code} style={{ gap: 6 }}>
              <Badge label={f.severity.toUpperCase()} tone={f.severity === 'info' ? 'neutral' : 'warn'} />
              <AppText>{t(`flag.${f.code}` as StringKey)}</AppText>
            </View>
          ))}
          <AppText variant="caption" muted>
            {t('reader.flags.sourceHint')}
          </AppText>
          <Button
            label={t('reader.showOriginal')}
            icon="document-text-outline"
            onPress={() => {
              onShowOriginal(block.id);
              onClose();
            }}
          />
        </View>
      ) : null}
    </Sheet>
  );
}
