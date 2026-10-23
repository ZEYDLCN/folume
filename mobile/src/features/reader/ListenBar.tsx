import { View } from 'react-native';

import type { SpeakerState } from '@/core/speech';
import { AppText, IconButton, Row } from '@/ui/components';
import { radius, space, useColors } from '@/ui/theme';
import { useT } from '@/ui/useT';

export const RATES = [0.8, 1, 1.25, 1.5, 2];

/** Controls while the paper is being read aloud. */
export function ListenBar({
  state,
  index,
  length,
  rate,
  onToggle,
  onPrev,
  onNext,
  onRate,
  onClose,
}: {
  state: SpeakerState;
  index: number;
  length: number;
  rate: number;
  onToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
  onRate: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const c = useColors();
  return (
    <View
      testID="listen-bar"
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
        elevation: 8,
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 4 },
      }}
    >
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <AppText variant="label" muted>
            {t('listen.title')}
          </AppText>
          <AppText variant="caption" muted testID="listen-count">
            {t('listen.count', { i: Math.min(index + 1, length), n: length })}
          </AppText>
        </View>
        <IconButton icon="play-skip-back" label={t('listen.prev')} onPress={onPrev} testID="listen-prev" />
        <IconButton icon={state === 'playing' ? 'pause' : 'play'} label={state === 'playing' ? t('listen.pause') : t('listen.play')} onPress={onToggle} testID="listen-toggle" active />
        <IconButton icon="play-skip-forward" label={t('listen.next')} onPress={onNext} testID="listen-next" />
        <Row style={{ gap: 0 }}>
          <AppText variant="label" onPress={onRate} accessibilityRole="button" accessibilityLabel={t('listen.speed')} testID="listen-rate" style={{ paddingHorizontal: 10, paddingVertical: 8, minWidth: 44, textAlign: 'center' }}>
            {rate}×
          </AppText>
        </Row>
        <IconButton icon="close" label={t('listen.stop')} onPress={onClose} testID="listen-close" />
      </Row>
    </View>
  );
}
