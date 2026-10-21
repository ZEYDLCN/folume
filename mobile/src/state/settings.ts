import { Platform } from 'react-native';
import { create } from 'zustand';

import { AsyncStorageKV } from '@/data/asyncStorageKV';
import { KEY } from '@/data/kv';
import { getSecret, setSecret } from '@/data/secrets';
import { setLocale, type LocaleSetting } from '@/i18n';
import { DEFAULT_READER_SETTINGS, type ReaderSettings } from '@/reader/protocol';

export type AppTheme = 'system' | 'light' | 'dark';

export interface AppSettings {
  serverUrl: string;
  apiKey: string;
  locale: LocaleSetting;
  appTheme: AppTheme;
  reader: ReaderSettings;
}

const defaultServerUrl = (): string =>
  process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000');

export const defaultSettings = (): AppSettings => ({
  serverUrl: defaultServerUrl(),
  apiKey: '',
  locale: 'auto',
  appTheme: 'system',
  reader: DEFAULT_READER_SETTINGS,
});

interface SettingsStore extends AppSettings {
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<Omit<AppSettings, 'reader'>>) => Promise<void>;
  updateReader: (patch: Partial<ReaderSettings>) => Promise<void>;
}

const kv = new AsyncStorageKV();

type Persisted = Omit<AppSettings, 'apiKey'>;

async function persist(s: AppSettings): Promise<void> {
  const { apiKey: _apiKey, ...rest } = s;
  void _apiKey;
  await kv.set<Persisted>(KEY.settings, rest);
}

export const useSettings = create<SettingsStore>((set, get) => ({
  ...defaultSettings(),
  loaded: false,
  async load() {
    const stored = await kv.get<Partial<Persisted>>(KEY.settings);
    const apiKey = (await getSecret('apiKey')) ?? '';
    const base = defaultSettings();
    const merged: AppSettings = {
      ...base,
      ...stored,
      reader: { ...base.reader, ...(stored?.reader ?? {}) },
      apiKey,
    };
    setLocale(merged.locale);
    set({ ...merged, loaded: true });
  },
  async update(patch) {
    const next = { ...get(), ...patch };
    if (patch.locale !== undefined) setLocale(patch.locale);
    set(patch);
    if (patch.apiKey !== undefined) await setSecret('apiKey', patch.apiKey || null);
    await persist(next);
  },
  async updateReader(patch) {
    const reader = { ...get().reader, ...patch };
    set({ reader });
    await persist({ ...get(), reader });
  },
}));

/** Subscribes a component to the locale so translated text re-renders on change. */
export function useLocale(): LocaleSetting {
  return useSettings((s) => s.locale);
}
