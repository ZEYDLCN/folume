import { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { AppText, Button, Sheet } from '@/ui/components';
import { radius, space, useColors } from '@/ui/theme';
import { useT } from '@/ui/useT';

/** The reader's own labels for a paper (a reading group, a project, a topic). */
export function TagsSheet({
  visible,
  title,
  tags,
  suggestions,
  onClose,
  onSave,
}: {
  visible: boolean;
  title: string;
  tags: string[];
  suggestions: string[];
  onClose: () => void;
  onSave: (tags: string[]) => void;
}) {
  const t = useT();
  const c = useColors();
  const [draft, setDraft] = useState<string[]>(tags);
  const [text, setText] = useState('');
  useEffect(() => {
    if (visible) {
      setDraft(tags);
      setText('');
    }
  }, [visible, tags]);

  const add = (raw: string) => {
    const tag = raw.trim().replace(/\s+/g, ' ').slice(0, 32);
    if (tag && !draft.some((d) => d.toLowerCase() === tag.toLowerCase())) setDraft([...draft, tag]);
    setText('');
  };

  const chip = (label: string, onPress: () => void, testID: string, on: boolean) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      onPress={onPress}
      testID={testID}
      style={{ backgroundColor: on ? c.accent : c.surfaceAlt, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}
    >
      <AppText variant="caption" color={on ? c.accentText : c.text} style={{ fontWeight: '600' }}>
        {on ? `${label}  ✕` : label}
      </AppText>
    </Pressable>
  );

  const rest = suggestions.filter((s) => !draft.some((d) => d.toLowerCase() === s.toLowerCase()));
  return (
    <Sheet visible={visible} onClose={onClose} title={t('tags.title')}>
      <View style={{ gap: space.md }} testID="tags-sheet">
        <AppText variant="caption" muted numberOfLines={2}>{title}</AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {draft.length === 0 ? <AppText muted>{t('tags.none')}</AppText> : null}
          {draft.map((tag) => chip(tag, () => setDraft(draft.filter((d) => d !== tag)), `tag-chip-${tag}`, true))}
        </View>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <TextInput
            testID="tag-input"
            value={text}
            onChangeText={setText}
            onSubmitEditing={() => add(text)}
            placeholder={t('tags.placeholder')}
            placeholderTextColor={c.muted}
            autoCapitalize="none"
            style={{ flex: 1, height: 44, borderRadius: radius.md, paddingHorizontal: space.md, backgroundColor: c.surfaceAlt, color: c.text }}
          />
          <Button label={t('tags.add')} variant="secondary" onPress={() => add(text)} disabled={!text.trim()} testID="tag-add" />
        </View>
        {rest.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {rest.map((s) => chip(s, () => add(s), `tag-suggest-${s}`, false))}
          </View>
        ) : null}
        <Button label={t('tags.save')} onPress={() => onSave(draft)} testID="tags-save" />
      </View>
    </Sheet>
  );
}
