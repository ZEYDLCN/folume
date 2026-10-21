import { Pressable, Switch, View } from 'react-native';

import type { ReaderSettings, ThemeName } from '@/reader/protocol';
import { AppText, Field, Row, Segmented, Stepper } from '@/ui/components';
import { radius, space, useColors } from '@/ui/theme';
import { useT } from '@/ui/useT';

const SWATCH: Record<ThemeName, { bg: string; fg: string }> = {
  paper: { bg: '#fbfaf7', fg: '#1c1b19' },
  sepia: { bg: '#f4ecd8', fg: '#433422' },
  dark: { bg: '#17181b', fg: '#d6d6d9' },
  black: { bg: '#000000', fg: '#c9c9cc' },
};

export function TypographyControls({
  settings,
  onChange,
}: {
  settings: ReaderSettings;
  onChange: (patch: Partial<ReaderSettings>) => void;
}) {
  const t = useT();
  const c = useColors();
  return (
    <View style={{ gap: space.lg }}>
      <Field label={t('typo.theme')}>
        <Row style={{ gap: space.md }}>
          {(Object.keys(SWATCH) as ThemeName[]).map((name) => (
            <Pressable
              key={name}
              accessibilityRole="button"
              accessibilityLabel={t(`typo.theme.${name}`)}
              accessibilityState={{ selected: settings.theme === name }}
              onPress={() => onChange({ theme: name })}
              testID={`theme-${name}`}
              style={{
                flex: 1,
                height: 56,
                borderRadius: radius.md,
                backgroundColor: SWATCH[name].bg,
                borderWidth: settings.theme === name ? 2.5 : 1,
                borderColor: settings.theme === name ? c.accent : c.border,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <AppText color={SWATCH[name].fg} style={{ fontSize: 18, fontFamily: 'serif' }}>
                Aa
              </AppText>
              <AppText variant="caption" color={SWATCH[name].fg} style={{ fontSize: 10 }}>
                {t(`typo.theme.${name}`)}
              </AppText>
            </Pressable>
          ))}
        </Row>
      </Field>

      <Field label={t('typo.font')}>
        <Segmented
          value={settings.fontFamily}
          onChange={(fontFamily) => onChange({ fontFamily })}
          options={[
            { value: 'serif', label: t('typo.font.serif') },
            { value: 'sans', label: t('typo.font.sans') },
          ]}
        />
      </Field>

      <Field label={t('typo.size')}>
        <Stepper value={settings.fontSize} min={14} max={30} step={1} onChange={(fontSize) => onChange({ fontSize })} format={(v) => `${v}`} />
      </Field>

      <Field label={t('typo.lineHeight')}>
        <Stepper value={settings.lineHeight} min={1.3} max={2.1} step={0.1} onChange={(lineHeight) => onChange({ lineHeight })} format={(v) => v.toFixed(1)} />
      </Field>

      <Field label={t('typo.margin')}>
        <Segmented
          value={settings.margin}
          onChange={(margin) => onChange({ margin })}
          options={[
            { value: 'narrow', label: t('typo.margin.narrow') },
            { value: 'normal', label: t('typo.margin.normal') },
            { value: 'wide', label: t('typo.margin.wide') },
          ]}
        />
      </Field>

      <Row style={{ justifyContent: 'space-between' }}>
        <AppText>{t('typo.justify')}</AppText>
        <Switch value={settings.justify} onValueChange={(justify) => onChange({ justify })} testID="switch-justify" />
      </Row>

      <View style={{ gap: 4 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <AppText style={{ flex: 1 }}>{t('typo.showNotes')}</AppText>
          <Switch value={settings.showNotes} onValueChange={(showNotes) => onChange({ showNotes })} testID="switch-notes" />
        </Row>
        <AppText variant="caption" muted>
          {t('typo.showNotes.hint')}
        </AppText>
      </View>
    </View>
  );
}
