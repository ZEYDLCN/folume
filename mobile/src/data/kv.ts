/** Small JSON key-value store: settings, library index, per-paper state. */
export interface KeyValueStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
}

export class MemoryKV implements KeyValueStore {
  readonly data = new Map<string, string>();

  async get<T>(key: string): Promise<T | null> {
    const raw = this.data.get(key);
    return raw === undefined ? null : (JSON.parse(raw) as T);
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, JSON.stringify(value));
  }

  async remove(key: string): Promise<void> {
    this.data.delete(key);
  }

  async keys(prefix: string): Promise<string[]> {
    return [...this.data.keys()].filter((k) => k.startsWith(prefix));
  }
}

export const KEY = {
  settings: 'folume:v1:settings',
  library: 'folume:v1:library',
  docState: (id: string) => `folume:v1:doc:${id}:state`,
  docPrefix: (id: string) => `folume:v1:doc:${id}:`,
};
