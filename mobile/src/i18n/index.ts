import { en } from './en';
import { tr, type StringKey } from './tr';

export type Locale = 'tr' | 'en';
export type LocaleSetting = 'auto' | Locale;
export type { StringKey };

const dictionaries: Record<Locale, Record<StringKey, string>> = { tr, en };
let current: Locale = 'tr';

export function detectLocale(): Locale {
  try {
    const l = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase();
    return l.startsWith('tr') ? 'tr' : 'en';
  } catch {
    return 'tr';
  }
}

export function setLocale(setting: LocaleSetting): Locale {
  current = setting === 'auto' ? detectLocale() : setting;
  return current;
}

export function getLocale(): Locale {
  return current;
}

export function translate(key: StringKey, params?: Record<string, string | number>, locale: Locale = current): string {
  let text = dictionaries[locale][key] ?? dictionaries.tr[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) text = text.split(`{${k}}`).join(String(v));
  return text;
}

export const t = translate;
