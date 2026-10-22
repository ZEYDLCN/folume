import { Pressable, View } from 'react-native';

import type { ReaderSettings, ThemeName } from '@/reader/protocol';
import { AppSwitch, AppText, Field, Row, Segmented, Stepper } from '@/ui/components';
import { radius, space, useColors } from '@/ui/theme';
import { useT } from '@/ui/useT';

const SWATCH: Record<ThemeName, { bg: string; fg: string }> = {
  paper: { bg: '#fcf1e5', fg: '#3e2418' },
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
      <Field label={t('typo.layout')}>
        <Segmented
          value={settings.layout}
          onChange={(layout) => onChange({ layout })}
          options={[
            { value: 'book', label: t('typo.layout.book') },
            { value: 'magazine', label: t('typo.layout.magazine') },
          ]}
        />
      </Field>

      <Field label={t('typo.flow')} hint={settings.flow === 'paged' ? t('typo.flow.hint') : undefined}>
        <Segmented
          value={settings.flow}
          onChange={(flow) => onChange({ flow })}
          options={[
            { value: 'scroll', label: t('typo.flow.scroll') },
            { value: 'paged', label: t('typo.flow.paged') },
          ]}
        />
      </Field>

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
            { value: 'hyperlegible', label: t('typo.font.hyperlegible') },
            { value: 'dyslexic', label: t('typo.font.dyslexic') },
          ]}
        />
        {settings.fontFamily === 'dyslexic' ? (
          <AppText variant="caption" muted>
            {t('typo.font.dyslexic.hint')}
          </AppText>
        ) : null}
      </Field>

      <Field label={t('typo.size')}>
        <Stepper value={settings.fontSize} min={14} max={30} step={1} onChange={(fontSize) => onChange({ fontSize })} format={(v) => `${v}`} />
      </Field>

      <Field label={t('typo.lineHeight')}>
        <Stepper value={settings.lineHeight} min={1.3} max={2.1} step={0.1} onChange={(lineHeight) => onChange({ lineHeight })} format={(v) => v.toFixed(1)} />
      </Field>

      <Field label={t('typo.letterSpacing')}>
        <Stepper value={settings.letterSpacing} min={0} max={0.16} step={0.02} onChange={(letterSpacing) => onChange({ letterSpacing: Math.round(letterSpacing * 100) / 100 })} format={(v) => v.toFixed(2)} />
      </Field>

      <Field label={t('typo.wordSpacing')}>
        <Stepper value={settings.wordSpacing} min={0} max={0.5} step={0.05} onChange={(wordSpacing) => onChange({ wordSpacing: Math.round(wordSpacing * 100) / 100 })} format={(v) => v.toFixed(2)} />
      </Field>

      <View style={{ gap: 4 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <AppText style={{ flex: 1 }}>{t('typo.ruler')}</AppText>
          <AppSwitch value={settings.ruler} onValueChange={(ruler) => onChange({ ruler })} testID="switch-ruler" />
        </Row>
        <AppText variant="caption" muted>
          {t('typo.ruler.hint')}
        </AppText>
      </View>

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
        <AppSwitch value={settings.justify} onValueChange={(justify) => onChange({ justify })} testID="switch-justify" />
      </Row>

      <View style={{ gap: 4 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <AppText style={{ flex: 1 }}>{t('typo.showNotes')}</AppText>
          <AppSwitch value={settings.showNotes} onValueChange={(showNotes) => onChange({ showNotes })} testID="switch-notes" />
        </Row>
        <AppText variant="caption" muted>
          {t('typo.showNotes.hint')}
        </AppText>
      </View>
    </View>
  );
}
