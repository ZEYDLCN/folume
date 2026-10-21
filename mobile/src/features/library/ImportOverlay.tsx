import { Modal, View } from 'react-native';

import type { ImportState } from '@/services/useImport';
import { AppText, Button, Card, ProgressBar } from '@/ui/components';
import { space, useColors } from '@/ui/theme';
import { useT } from '@/ui/useT';
import type { StringKey } from '@/i18n';

const KNOWN_ERRORS = new Set([
  'not_a_pdf', 'file_too_large', 'too_many_pages', 'unreadable_pdf', 'busy', 'unauthorized', 'network',
  'conversion_failed', 'cancelled', 'unknown', 'invalid_url', 'url_not_allowed', 'fetch_failed', 'timeout',
  'url_import_disabled', 'page_too_large', 'too_complex',
]);

export function ImportOverlay({
  state,
  onCancel,
  onDismiss,
  onRetry,
}: {
  state: ImportState;
  onCancel: () => void;
  onDismiss: () => void;
  onRetry: () => void;
}) {
  const t = useT();
  const c = useColors();
  if (state.status === 'idle') return null;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={state.status === 'running' ? onCancel : onDismiss}>
      <View style={{ flex: 1, backgroundColor: c.scrim, alignItems: 'center', justifyContent: 'center', padding: space.xl }}>
        <Card style={{ width: '100%', maxWidth: 420, gap: space.lg }}>
          {state.status === 'running' ? (
            <>
              <AppText variant="heading">{t('import.title')}</AppText>
              <AppText muted numberOfLines={1}>
                {state.name}
              </AppText>
              <ProgressBar value={state.progress.fraction} height={6} />
              <View style={{ gap: 2 }} testID="import-status">
                <AppText>{t(`import.phase.${state.progress.phase}` as StringKey)}</AppText>
                {state.progress.stage && state.progress.phase === 'converting' ? (
                  <AppText variant="caption" muted>
                    {t(stageKey(state.progress.stage))}
                  </AppText>
                ) : null}
              </View>
              <AppText variant="caption" muted>
                {t('import.privacy')}
              </AppText>
              <Button label={t('common.cancel')} variant="secondary" onPress={onCancel} />
            </>
          ) : (
            <>
              <AppText variant="heading">{t('import.error.title')}</AppText>
              <AppText testID="import-error">
                {t((KNOWN_ERRORS.has(state.code) ? `import.error.${state.code}` : 'import.error.unknown') as StringKey)}
              </AppText>
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <Button label={t('common.close')} variant="secondary" onPress={onDismiss} style={{ flex: 1 }} />
                <Button label={t('common.retry')} onPress={onRetry} style={{ flex: 1 }} />
              </View>
            </>
          )}
        </Card>
      </View>
    </Modal>
  );
}

function stageKey(stage: string): StringKey {
  const key = `import.stage.${stage}` as StringKey;
  return ['import.stage.extract', 'import.stage.layout', 'import.stage.structure', 'import.stage.render'].includes(key)
    ? key
    : 'import.phase.converting';
}
