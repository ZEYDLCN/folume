import { Pressable, View } from 'react-native';

import type { InkTool } from '@/reader/protocol';
import { IconButton, Row } from '@/ui/components';
import { radius, space, useColors } from '@/ui/theme';
import { useT } from '@/ui/useT';

export const INK_COLORS = [
  { name: 'terracotta', value: '#c2512f' },
  { name: 'blue', value: '#2d45ea' },
  { name: 'ink', value: '#1d1b19' },
  { name: 'yellow', value: '#ffd600' },
] as const;

/** Pen, highlighter, eraser, undo and colours for drawing on the original pages. */
export function InkBar({
  tool,
  color,
  onTool,
  onColor,
  onUndo,
}: {
  tool: InkTool;
  color: string;
  onTool: (t: InkTool) => void;
  onColor: (c: string) => void;
  onUndo: () => void;
}) {
  const t = useT();
  const c = useColors();
  return (
    <View testID="ink-bar" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingBottom: space.sm, backgroundColor: c.bg }}>
      <Row style={{ gap: 0 }}>
        <IconButton icon="hand-left-outline" label={t('ink.off')} active={tool === 'off'} onPress={() => onTool('off')} testID="ink-off" />
        <IconButton icon="pencil" label={t('ink.pen')} active={tool === 'pen'} onPress={() => onTool('pen')} testID="ink-pen" />
        <IconButton icon="brush" label={t('ink.highlighter')} active={tool === 'highlighter'} onPress={() => onTool('highlighter')} testID="ink-highlighter" />
        <IconButton icon="backspace-outline" label={t('ink.eraser')} active={tool === 'eraser'} onPress={() => onTool('eraser')} testID="ink-eraser" />
        <IconButton icon="arrow-undo" label={t('ink.undo')} onPress={onUndo} testID="ink-undo" />
      </Row>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        {INK_COLORS.map((k) => (
          <Pressable
            key={k.name}
            accessibilityRole="button"
            accessibilityLabel={k.name}
            onPress={() => onColor(k.value)}
            testID={`ink-color-${k.name}`}
            style={{ width: 24, height: 24, borderRadius: radius.pill, backgroundColor: k.value, borderWidth: color === k.value ? 3 : 1, borderColor: color === k.value ? c.accent : c.border }}
          />
        ))}
      </View>
    </View>
  );
}
