import type { CitationStyle } from '@/core/quote';
import { Platform } from 'react-native';
import { create } from 'zustand';

import { AsyncStorageKV } from '@/data/asyncStorageKV';
import { KEY } from '@/data/kv';
import { getSecret, setSecret } from '@/data/secrets';
import { setLocale, type LocaleSetting } from '@/i18n';
import { DEFAULT_READER_SETTINGS, type ReaderSettings } from '@/reader/protocol';

export type AppTheme = 'system' | 'light' | 'dark';

export interface AiPrefs {
  /** master switch; off by default: nothing is sent anywhere until the reader opts in */
  enabled: boolean;
  /** allow sending equation/figure images (still confirmed per request) */
  shareImages: boolean;
  /** show exactly which passages will be sent before every request */
  confirmBeforeSend: boolean;
  level: 'beginner' | 'intermediate' | 'expert';
  answerLanguage: 'auto' | 'tr' | 'en' | 'de' | 'fr' | 'es';
  translateTo: 'tr' | 'en' | 'de' | 'fr' | 'es';
}

export const DEFAULT_AI_PREFS: AiPrefs = {
  enabled: false,
  shareImages: false,
  confirmBeforeSend: true,
  level: 'intermediate',
  answerLanguage: 'auto',
  translateTo: 'tr',
};

export interface SyncPrefs {
  /** off by default: nothing leaves the device unless the reader sets up their own server and key */
  enabled: boolean;
}

export const DEFAULT_SYNC_PREFS: SyncPrefs = { enabled: false };

export interface AppSettings {
  serverUrl: string;
  apiKey: string;
  /** shared secret of the optional sync; only its hash is ever sent to the server. Kept in secure storage. */
  syncKey: string;
  locale: LocaleSetting;
  appTheme: AppTheme;
  /** the style "copy with citation" writes */
  citationStyle: CitationStyle;
  /** the name written on notes the reader shares */
  authorName: string;
  reader: ReaderSettings;
  ai: AiPrefs;
  sync: SyncPrefs;
}

const defaultServerUrl = (): string =>
  process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000');

export const defaultSettings = (): AppSettings => ({
  serverUrl: defaultServerUrl(),
  apiKey: '',
  syncKey: '',
  locale: 'auto',
  appTheme: 'system',
  citationStyle: 'apa',
  authorName: '',
  reader: DEFAULT_READER_SETTINGS,
  ai: DEFAULT_AI_PREFS,
  sync: DEFAULT_SYNC_PREFS,
});

interface SettingsStore extends AppSettings {
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<Omit<AppSettings, 'reader' | 'ai' | 'sync'>>) => Promise<void>;
  updateReader: (patch: Partial<ReaderSettings>) => Promise<void>;
  updateAi: (patch: Partial<AiPrefs>) => Promise<void>;
  updateSync: (patch: Partial<SyncPrefs>) => Promise<void>;
}

const kv = new AsyncStorageKV();

type Persisted = Omit<AppSettings, 'apiKey' | 'syncKey'>;

async function persist(s: AppSettings): Promise<void> {
  const { apiKey: _apiKey, syncKey: _syncKey, ...rest } = s;
  void _apiKey;
  void _syncKey;
  await kv.set<Persisted>(KEY.settings, rest);
}

export const useSettings = create<SettingsStore>((set, get) => ({
  ...defaultSettings(),
  loaded: false,
  async load() {
    const stored = await kv.get<Partial<Persisted>>(KEY.settings);
    const apiKey = (await getSecret('apiKey')) ?? '';
    const syncKey = (await getSecret('syncKey')) ?? '';
    const base = defaultSettings();
    const merged: AppSettings = {
      ...base,
      ...stored,
      reader: { ...base.reader, ...(stored?.reader ?? {}) },
      ai: { ...base.ai, ...(stored?.ai ?? {}) },
      sync: { ...base.sync, ...(stored?.sync ?? {}) },
      apiKey,
      syncKey,
    };
    setLocale(merged.locale);
    set({ ...merged, loaded: true });
  },
  async update(patch) {
    const next = { ...get(), ...patch };
    if (patch.locale !== undefined) setLocale(patch.locale);
    set(patch);
    if (patch.apiKey !== undefined) await setSecret('apiKey', patch.apiKey || null);
    if (patch.syncKey !== undefined) await setSecret('syncKey', patch.syncKey || null);
    await persist(next);
  },
  async updateAi(patch) {
    const ai = { ...get().ai, ...patch };
    set({ ai });
    await persist({ ...get(), ai });
  },
  async updateSync(patch) {
    const sync = { ...get().sync, ...patch };
    set({ sync });
    await persist({ ...get(), sync });
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
