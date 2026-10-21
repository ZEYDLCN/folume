import { Pressable, View } from 'react-native';

import { HIGHLIGHT_COLORS } from '@/data/annotations';
import { AppText, IconButton, Row } from '@/ui/components';
import { radius, space, useColors } from '@/ui/theme';
import { useT } from '@/ui/useT';

/** Appears while text is selected in the book: explain it, highlight it, or attach a note. */
export function SelectionBar({
  text,
  color,
  onColor,
  onExplain,
  onHighlight,
  onNote,
  onClose,
  aiOn,
}: {
  text: string;
  color: string;
  onColor: (c: string) => void;
  onExplain: () => void;
  onHighlight: () => void;
  onNote: () => void;
  onClose: () => void;
  aiOn: boolean;
}) {
  const t = useT();
  const c = useColors();
  return (
    <View
      testID="selection-bar"
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
        padding: space.md,
        gap: space.sm,
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 4 },
        elevation: 8,
      }}
    >
      <AppText variant="caption" muted numberOfLines={1}>
        “{text}”
      </AppText>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row style={{ gap: 6 }}>
          {HIGHLIGHT_COLORS.map((h) => (
            <Pressable
              key={h.name}
              accessibilityRole="button"
              accessibilityLabel={h.name}
              onPress={() => onColor(h.value)}
              testID={`color-${h.name}`}
              style={{
                width: 26,
                height: 26,
                borderRadius: 13,
                backgroundColor: h.value,
                borderWidth: color === h.value ? 3 : 1,
                borderColor: color === h.value ? c.accent : c.border,
              }}
            />
          ))}
        </Row>
        <Row style={{ gap: 2 }}>
          <IconButton icon="color-wand-outline" label={t('sel.explain')} onPress={onExplain} testID="sel-explain" active={aiOn} />
          <IconButton icon="brush-outline" label={t('sel.highlight')} onPress={onHighlight} testID="sel-highlight" />
          <IconButton icon="create-outline" label={t('sel.note')} onPress={onNote} testID="sel-note" />
          <IconButton icon="close" label={t('common.close')} onPress={onClose} />
        </Row>
      </Row>
    </View>
  );
}
