import { useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';

import type { Block } from '@/core/types';
import type { BlockFix } from '@/data/userdata';
import type { StringKey } from '@/i18n';
import { AppSwitch, AppText, Button, Field, Row, Segmented, Sheet } from '@/ui/components';
import { radius, space, useColors } from '@/ui/theme';
import { useT } from '@/ui/useT';

const TYPES: Block['type'][] = ['paragraph', 'heading', 'list_item', 'caption', 'footnote'];

/** Fix what the converter got wrong in one block: its text, what kind of block it is, or whether it belongs here at all. */
export function FixSheet({
  visible,
  onClose,
  block,
  original,
  fix,
  canMerge,
  onSave,
  onRestore,
}: {
  visible: boolean;
  onClose: () => void;
  /** the block as it is shown now (corrections applied) */
  block: Block | null;
  /** the block as the converter produced it */
  original: Block | null;
  fix: BlockFix | null;
  /** the block before this one is text it could be joined to */
  canMerge: boolean;
  onSave: (patch: Partial<Pick<BlockFix, 'text' | 'type' | 'hidden' | 'mergePrev'>>) => void;
  onRestore: () => void;
}) {
  const t = useT();
  const c = useColors();
  const [text, setText] = useState('');
  const [type, setType] = useState<Block['type']>('paragraph');
  const [merge, setMerge] = useState(false);
  const [hide, setHide] = useState(false);
  useEffect(() => {
    if (!visible || !block) return;
    setText(block.spans.length ? block.spans.map((s) => s.text).join('') : block.text);
    setType(block.type);
    setMerge(fix?.mergePrev ?? false);
    setHide(fix?.hidden ?? false);
  }, [visible, block, fix]);
  if (!block || !original) return null;
  const originalText = original.spans.length ? original.spans.map((s) => s.text).join('') : original.text;
  const textual = original.type !== 'figure' && original.type !== 'table' && original.type !== 'equation';
  const types = TYPES.includes(type) ? TYPES : [type, ...TYPES];

  return (
    <Sheet visible={visible} onClose={onClose} title={t('fix.title')}>
      <View testID="fix-sheet" style={{ gap: space.lg }}>
        <AppText variant="caption" muted>
          {t('fix.intro')}
        </AppText>
        {textual ? (
          <Field label={t('fix.text')}>
            <TextInput
              testID="fix-text"
              accessibilityLabel={t('fix.text')}
              value={text}
              onChangeText={setText}
              multiline
              style={{ minHeight: 120, maxHeight: 260, borderRadius: radius.md, padding: space.md, backgroundColor: c.surfaceAlt, color: c.text, textAlignVertical: 'top', fontSize: 15, lineHeight: 22 }}
            />
            {fix?.text !== null && fix?.text !== undefined ? (
              <AppText variant="caption" muted numberOfLines={3}>
                {t('fix.original')}: {originalText}
              </AppText>
            ) : null}
          </Field>
        ) : null}
        {textual ? (
          <Field label={t('fix.type')}>
            <Segmented<Block['type']> value={type} onChange={setType} options={types.map((k) => ({ value: k, label: t(`reader.block.${k}` as StringKey) }))} />
          </Field>
        ) : null}
        {canMerge && textual ? (
          <Row style={{ justifyContent: 'space-between' }}>
            <AppText style={{ flex: 1 }}>{t('fix.merge')}</AppText>
            <AppSwitch value={merge} onValueChange={setMerge} testID="fix-merge" />
          </Row>
        ) : null}
        <Row style={{ justifyContent: 'space-between' }}>
          <AppText style={{ flex: 1 }}>{t('fix.hide')}</AppText>
          <AppSwitch value={hide} onValueChange={setHide} testID="fix-hide" />
        </Row>
        <Button
          label={t('fix.save')}
          testID="fix-save"
          onPress={() =>
            onSave({
              text: textual && text !== originalText ? text : null,
              type: textual && type !== original.type ? type : null,
              hidden: hide,
              mergePrev: merge,
            })
          }
        />
        {fix ? <Button label={t('fix.restore')} variant="secondary" onPress={onRestore} testID="fix-restore" /> : null}
      </View>
    </Sheet>
  );
}
