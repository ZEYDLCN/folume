import { useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';

import { AppText, Button, Sheet } from '@/ui/components';
import { radius, space, useColors } from '@/ui/theme';
import { useT } from '@/ui/useT';

/** "This block was converted wrongly": makes a small file to send to the developers. Nothing is sent from here. */
export function ReportSheet({ visible, onClose, onCreate }: { visible: boolean; onClose: () => void; onCreate: (note: string, withPage: boolean) => void }) {
  const t = useT();
  const c = useColors();
  const [note, setNote] = useState('');
  useEffect(() => {
    if (visible) setNote('');
  }, [visible]);
  return (
    <Sheet visible={visible} onClose={onClose} title={t('report.block.title')}>
      <View testID="report-sheet" style={{ gap: space.lg }}>
        <AppText muted>{t('report.block.intro')}</AppText>
        <TextInput
          testID="report-note"
          accessibilityLabel={t('report.block.note')}
          value={note}
          onChangeText={setNote}
          multiline
          placeholder={t('report.block.note')}
          placeholderTextColor={c.muted}
          style={{ minHeight: 90, borderRadius: radius.md, padding: space.md, backgroundColor: c.surfaceAlt, color: c.text, textAlignVertical: 'top' }}
        />
        <Button label={t('report.block.create')} icon="share-outline" onPress={() => onCreate(note, true)} testID="report-create" />
        <Button label={t('report.block.createNoPage')} variant="secondary" onPress={() => onCreate(note, false)} testID="report-create-text" />
      </View>
    </Sheet>
  );
}
