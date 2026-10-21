import { translate, type StringKey } from '@/i18n';
import { useLocale } from '@/state/settings';

export type TFn = (key: StringKey, params?: Record<string, string | number>) => string;

/** Translation function bound to the current locale; re-renders the component when it changes. */
export function useT(): TFn {
  useLocale();
  return (key, params) => translate(key, params);
}
