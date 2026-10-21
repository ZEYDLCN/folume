import { useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';

import { classifyLink } from '@/core/link';
import { AppText, Button, Sheet } from '@/ui/components';
import { radius, space, useColors } from '@/ui/theme';
import { useT } from '@/ui/useT';
import type { StringKey } from '@/i18n';

/** Paste a link, an arXiv id or a DOI; the server downloads the paper and converts it. */
export function LinkSheet({
  visible,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (url: string, label: string) => void;
}) {
  const t = useT();
  const c = useColors();
  const [text, setText] = useState('');
  useEffect(() => {
    if (visible) setText('');
  }, [visible]);

  const info = classifyLink(text);
  const entered = text.trim().length > 0;
  const submit = () => {
    if (info) onSubmit(text.trim(), info.label);
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t('link.title')}>
      <View style={{ gap: space.md }} testID="link-sheet">
        <AppText variant="caption" muted>
          {t('link.hint')}
        </AppText>
        <TextInput
          testID="link-input"
          accessibilityLabel={t('link.title')}
          value={text}
          onChangeText={setText}
          onSubmitEditing={submit}
          placeholder={t('link.placeholder')}
          placeholderTextColor={c.muted}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          style={{ height: 46, borderRadius: radius.md, paddingHorizontal: space.md, backgroundColor: c.surfaceAlt, color: c.text }}
        />
        {info ? (
          <AppText color={c.ok} testID="link-kind">
            {t(`link.kind.${info.kind}` as StringKey, { label: info.label })}
          </AppText>
        ) : entered ? (
          <AppText color={c.warn} testID="link-invalid">
            {t('link.invalid')}
          </AppText>
        ) : null}
        <Button label={t('link.go')} onPress={submit} disabled={!info} testID="link-go" />
      </View>
    </Sheet>
  );
}
