import { Image, View } from 'react-native';

import type { ContextPassage } from '@/core/retrieval/context';
import type { StringKey } from '@/i18n';
import { AppSwitch, AppText, Button, Card } from '@/ui/components';
import { space, useColors } from '@/ui/theme';
import { useT } from '@/ui/useT';

export interface PreviewImage {
  uri: string;
  label: string;
}

/** Shows exactly what will leave the device and lets the reader drop passages before sending. */
export function SendPreview({
  passages,
  included,
  onToggle,
  image,
  imageOn,
  onToggleImage,
  onSend,
  onCancel,
  sendLabel,
}: {
  passages: ContextPassage[];
  included: Set<string>;
  onToggle: (id: string) => void;
  image?: PreviewImage | null;
  imageOn?: boolean;
  onToggleImage?: (on: boolean) => void;
  onSend: () => void;
  onCancel: () => void;
  sendLabel?: string;
}) {
  const t = useT();
  const c = useColors();
  const total = passages.filter((p) => included.has(p.id)).reduce((n, p) => n + p.text.length, 0);
  return (
    <View style={{ gap: space.md }} testID="send-preview">
      <AppText variant="heading">{t('learn.preview.title')}</AppText>
      <AppText variant="caption" muted>
        {t('learn.preview.hint')}
      </AppText>
      {passages.map((p, i) => (
        <Card key={p.id} style={{ gap: 6, padding: space.md, opacity: included.has(p.id) ? 1 : 0.5 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <AppText variant="label" muted>
                {t(`learn.kind.${p.kind}` as StringKey)} · {p.label}
              </AppText>
            </View>
            {i === 0 ? null : (
              <AppSwitch value={included.has(p.id)} onValueChange={() => onToggle(p.id)} testID={`include-${p.id}`} />
            )}
          </View>
          <AppText numberOfLines={4} variant="caption">
            {p.text}
          </AppText>
          <AppText variant="caption" muted>
            {t('learn.preview.chars', { n: p.text.length })}
          </AppText>
        </Card>
      ))}
      {image ? (
        <Card style={{ gap: 6, padding: space.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <AppText>{t('learn.preview.images')}</AppText>
              <AppText variant="caption" muted>
                {t('learn.preview.imagesHint')}
              </AppText>
            </View>
            <AppSwitch value={!!imageOn} onValueChange={(v) => onToggleImage?.(v)} testID="include-image" />
          </View>
          <View style={{ backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: c.border, padding: 6, alignItems: 'center' }}>
            <ImageThumb uri={image.uri} />
          </View>
        </Card>
      ) : null}
      <AppText variant="caption" muted>
        {t('learn.preview.chars', { n: total })}
      </AppText>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button label={t('common.cancel')} variant="secondary" onPress={onCancel} style={{ flex: 1 }} />
        <Button label={sendLabel ?? t('learn.preview.send')} onPress={onSend} style={{ flex: 1 }} testID="send-confirm" />
      </View>
    </View>
  );
}


function ImageThumb({ uri }: { uri: string }) {
  return <Image source={{ uri }} style={{ width: '100%', height: 90 }} resizeMode="contain" />;
}
