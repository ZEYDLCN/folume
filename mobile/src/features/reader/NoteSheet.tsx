import { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { HIGHLIGHT_COLORS } from '@/data/annotations';
import { AppText, Button, Card, Field, Row, Sheet } from '@/ui/components';
import { radius, space, useColors } from '@/ui/theme';
import { useT } from '@/ui/useT';

/** Create a note on a selection, or edit/delete an existing highlight. */
export function NoteSheet({
  visible,
  quote,
  initialNote,
  initialColor,
  aiNote,
  onSave,
  onDelete,
  onClose,
}: {
  visible: boolean;
  quote: string;
  initialNote: string;
  initialColor: string;
  /** AI-written notes stay labelled and are not silently turned into the reader's own words */
  aiNote?: boolean;
  onSave: (note: string, color: string) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const c = useColors();
  const [note, setNote] = useState(initialNote);
  const [color, setColor] = useState(initialColor);
  useEffect(() => {
    if (visible) {
      setNote(initialNote);
      setColor(initialColor);
    }
  }, [visible, initialNote, initialColor]);
  return (
    <Sheet visible={visible} onClose={onClose} title={t('note.title')}>
      {quote ? (
        <Card style={{ gap: 4, borderLeftWidth: 4, borderLeftColor: color }}>
          <AppText variant="label" muted>
            {t('note.quote')}
          </AppText>
          <AppText style={{ fontFamily: 'serif' }}>{quote}</AppText>
        </Card>
      ) : null}
      {aiNote ? (
        <AppText variant="caption" color={c.warn}>
          {t('notes.ai.label')}
        </AppText>
      ) : null}
      <TextInput
        testID="note-input"
        accessibilityLabel={t('note.placeholder')}
        value={note}
        onChangeText={setNote}
        placeholder={t('note.placeholder')}
        placeholderTextColor={c.muted}
        multiline
        style={{ minHeight: 110, borderRadius: radius.md, backgroundColor: c.surfaceAlt, color: c.text, padding: space.md, textAlignVertical: 'top' }}
      />
      <Field label={t('note.color')}>
        <Row style={{ gap: space.md }}>
          {HIGHLIGHT_COLORS.map((h) => (
            <Pressable
              key={h.name}
              accessibilityRole="button"
              accessibilityLabel={h.name}
              onPress={() => setColor(h.value)}
              style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: h.value, borderWidth: color === h.value ? 3 : 1, borderColor: color === h.value ? c.accent : c.border }}
            />
          ))}
        </Row>
      </Field>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {onDelete ? <Button label={t('note.delete')} variant="secondary" onPress={onDelete} testID="note-delete" style={{ flex: 1 }} /> : null}
        <Button label={t('note.save')} onPress={() => onSave(note, color)} testID="note-save" style={{ flex: 1 }} />
      </View>
    </Sheet>
  );
}
