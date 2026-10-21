import { Pressable } from 'react-native';

import { AppText } from '@/ui/components';
import { useColors } from '@/ui/theme';

export function AnswerViewChip({ label, onPress }: { label: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{ backgroundColor: c.surfaceAlt, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}
    >
      <AppText variant="caption" color={c.accent} style={{ fontWeight: '700' }}>
        {label}
      </AppText>
    </Pressable>
  );
}
