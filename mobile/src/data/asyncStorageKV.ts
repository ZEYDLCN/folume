import AsyncStorage from '@react-native-async-storage/async-storage';

import type { KeyValueStore } from './kv';

export class AsyncStorageKV implements KeyValueStore {
  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await AsyncStorage.getItem(key);
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch {
      return null; // corrupt or unavailable storage must not crash the app
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  }

  async remove(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
  }

  async keys(prefix: string): Promise<string[]> {
    const all = await AsyncStorage.getAllKeys();
    return all.filter((k) => k.startsWith(prefix));
  }
}
