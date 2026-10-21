import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Switch, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TypographyControls } from '@/features/reader/TypographyControls';
import type { LocaleSetting } from '@/i18n';
import { getApi } from '@/services/container';
import type { Capabilities } from '@/services/api';
import { useSettings, type AiPrefs, type AppTheme } from '@/state/settings';
import { AppText, Button, Card, Field, IconButton, Segmented } from '@/ui/components';
import { radius, space, useColors } from '@/ui/theme';
import { useT } from '@/ui/useT';

type Test = { status: 'idle' } | { status: 'busy' } | { status: 'ok'; version: string; caps: Capabilities } | { status: 'error'; message: string };

export default function SettingsScreen() {
  const t = useT();
  const c = useColors();
  const router = useRouter();
  const s = useSettings();
  const [url, setUrl] = useState(s.serverUrl);
  const [key, setKey] = useState(s.apiKey);
  const [test, setTest] = useState<Test>({ status: 'idle' });

  const input = {
    backgroundColor: c.surfaceAlt,
    color: c.text,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    height: 44,
  } as const;

  const run = async () => {
    setTest({ status: 'busy' });
    await s.update({ serverUrl: url.trim(), apiKey: key.trim() });
    try {
      const api = getApi();
      const health = await api.health();
      setTest({ status: 'ok', version: health.version, caps: await api.capabilities() });
    } catch (e) {
      setTest({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm }}>
        <IconButton icon="chevron-back" label={t('common.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} testID="screen-back" />
        <AppText variant="heading">{t('settings.title')}</AppText>
      </View>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, maxWidth: 720, width: '100%', alignSelf: 'center' }}>
        <Card style={{ gap: space.md }}>
          <AppText variant="heading">{t('settings.server')}</AppText>
          <Field label={t('settings.server.url')}>
            <TextInput
              testID="server-url"
              value={url}
              onChangeText={setUrl}
              onBlur={() => void s.update({ serverUrl: url.trim() })}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={input}
              placeholderTextColor={c.muted}
            />
          </Field>
          <Field label={t('settings.server.key')}>
            <TextInput
              testID="server-key"
              value={key}
              onChangeText={setKey}
              onBlur={() => void s.update({ apiKey: key.trim() })}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              style={input}
              placeholderTextColor={c.muted}
            />
          </Field>
          <Button label={t('settings.server.test')} variant="secondary" onPress={run} loading={test.status === 'busy'} testID="test-connection" />
          {test.status === 'ok' ? (
            <View style={{ gap: 4 }} testID="connection-ok">
              <AppText color={c.ok}>{t('settings.server.ok', { version: test.version })}</AppText>
              <AppText variant="caption" muted>
                {t('settings.server.limits', { mb: test.caps.limits.max_upload_mb, pages: test.caps.limits.max_pages })}
              </AppText>
              <AppText variant="caption" muted>
                {t('settings.server.retention', { min: Math.round(test.caps.retention_seconds / 60) })}
              </AppText>
              <AppText variant="caption" muted>
                {t('settings.server.ai', { state: test.caps.ai.enabled ? t('common.on') : t('common.off') })}
              </AppText>
            </View>
          ) : null}
          {test.status === 'error' ? <AppText color={c.danger}>{test.message}</AppText> : null}
        </Card>

        <Card style={{ gap: space.md }}>
          <AppText variant="heading">{t('settings.appearance')}</AppText>
          <Field label={t('settings.language')}>
            <Segmented<LocaleSetting>
              value={s.locale}
              onChange={(locale) => void s.update({ locale })}
              options={[
                { value: 'auto', label: t('settings.language.auto') },
                { value: 'tr', label: 'Türkçe' },
                { value: 'en', label: 'English' },
              ]}
            />
          </Field>
          <Field label={t('settings.theme')}>
            <Segmented<AppTheme>
              value={s.appTheme}
              onChange={(appTheme) => void s.update({ appTheme })}
              options={[
                { value: 'system', label: t('settings.theme.system') },
                { value: 'light', label: t('settings.theme.light') },
                { value: 'dark', label: t('settings.theme.dark') },
              ]}
            />
          </Field>
        </Card>

        <Card style={{ gap: space.md }} testID="ai-settings">
          <AppText variant="heading">{t('settings.ai')}</AppText>
          <View style={{ gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <AppText style={{ flex: 1 }}>{t('settings.ai.enable')}</AppText>
              <Switch value={s.ai.enabled} onValueChange={(enabled) => void s.updateAi({ enabled })} testID="switch-ai" />
            </View>
            <AppText variant="caption" muted>{t('settings.ai.enable.hint')}</AppText>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <AppText style={{ flex: 1 }}>{t('settings.ai.confirm')}</AppText>
            <Switch value={s.ai.confirmBeforeSend} onValueChange={(confirmBeforeSend) => void s.updateAi({ confirmBeforeSend })} testID="switch-confirm" />
          </View>
          <View style={{ gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <AppText style={{ flex: 1 }}>{t('settings.ai.images')}</AppText>
              <Switch value={s.ai.shareImages} onValueChange={(shareImages) => void s.updateAi({ shareImages })} testID="switch-images" />
            </View>
            <AppText variant="caption" muted>{t('settings.ai.images.hint')}</AppText>
          </View>
          <Field label={t('settings.ai.level')}>
            <Segmented<AiPrefs['level']>
              value={s.ai.level}
              onChange={(level) => void s.updateAi({ level })}
              options={[
                { value: 'beginner', label: t('learn.level.beginner') },
                { value: 'intermediate', label: t('learn.level.intermediate') },
                { value: 'expert', label: t('learn.level.expert') },
              ]}
            />
          </Field>
          <Field label={t('settings.ai.language')}>
            <Segmented<AiPrefs['answerLanguage']>
              value={s.ai.answerLanguage}
              onChange={(answerLanguage) => void s.updateAi({ answerLanguage })}
              options={[
                { value: 'auto', label: t('settings.language.auto') },
                { value: 'tr', label: 'TR' },
                { value: 'en', label: 'EN' },
                { value: 'de', label: 'DE' },
              ]}
            />
          </Field>
          <Field label={t('settings.ai.translate')}>
            <Segmented<AiPrefs['translateTo']>
              value={s.ai.translateTo}
              onChange={(translateTo) => void s.updateAi({ translateTo })}
              options={[
                { value: 'tr', label: 'TR' },
                { value: 'en', label: 'EN' },
                { value: 'de', label: 'DE' },
                { value: 'fr', label: 'FR' },
                { value: 'es', label: 'ES' },
              ]}
            />
          </Field>
        </Card>

        <Card style={{ gap: space.md }}>
          <AppText variant="heading">{t('settings.reading')}</AppText>
          <TypographyControls settings={s.reader} onChange={(patch) => void s.updateReader(patch)} />
        </Card>

        <Card style={{ gap: space.sm }}>
          <AppText variant="heading">{t('settings.privacy')}</AppText>
          <AppText muted>{t('settings.privacy.body')}</AppText>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
