import type { BlobStore } from './blobs';

/** Browser implementation on IndexedDB (expo-file-system has no web backend). */
const DB_NAME = 'folume-blobs';
const STORE = 'files';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function request<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = run(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

class WebBlobStore implements BlobStore {
  async put(path: string, data: Uint8Array | string): Promise<void> {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    await request('readwrite', (s) => s.put(bytes, path));
  }

  async get(path: string): Promise<Uint8Array | null> {
    const v = await request<Uint8Array | undefined>('readonly', (s) => s.get(path));
    return v ?? null;
  }

  async getText(path: string): Promise<string | null> {
    const b = await this.get(path);
    return b ? new TextDecoder().decode(b) : null;
  }

  async exists(path: string): Promise<boolean> {
    return (await this.get(path)) !== null;
  }

  async list(prefix: string): Promise<string[]> {
    const keys = await request<IDBValidKey[]>('readonly', (s) => s.getAllKeys());
    const p = prefix.endsWith('/') ? prefix : `${prefix}/`;
    return keys.map(String).filter((k) => k.startsWith(p));
  }

  async removePrefix(prefix: string): Promise<void> {
    const all = await request<IDBValidKey[]>('readonly', (s) => s.getAllKeys());
    const p = prefix.endsWith('/') ? prefix : `${prefix}/`;
    for (const key of all.map(String)) {
      if (key === prefix || key.startsWith(p)) await request('readwrite', (s) => s.delete(key));
    }
  }
}

export function createBlobStore(): BlobStore {
  return new WebBlobStore();
}
