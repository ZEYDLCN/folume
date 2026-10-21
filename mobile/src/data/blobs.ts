/** Binary/text file storage addressed by relative path (e.g. `docs/<id>/pages/p001.jpg`). */
export interface BlobStore {
  put(path: string, data: Uint8Array | string): Promise<void>;
  get(path: string): Promise<Uint8Array | null>;
  getText(path: string): Promise<string | null>;
  exists(path: string): Promise<boolean>;
  /** Removes `prefix` itself and everything below it. */
  removePrefix(prefix: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

export class MemoryBlobStore implements BlobStore {
  readonly files = new Map<string, Uint8Array>();

  async put(path: string, data: Uint8Array | string): Promise<void> {
    this.files.set(path, typeof data === 'string' ? new TextEncoder().encode(data) : data);
  }

  async get(path: string): Promise<Uint8Array | null> {
    return this.files.get(path) ?? null;
  }

  async getText(path: string): Promise<string | null> {
    const b = this.files.get(path);
    return b ? new TextDecoder().decode(b) : null;
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async removePrefix(prefix: string): Promise<void> {
    for (const key of [...this.files.keys()]) {
      if (key === prefix || key.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)) this.files.delete(key);
    }
  }

  async list(prefix: string): Promise<string[]> {
    const p = prefix.endsWith('/') ? prefix : `${prefix}/`;
    return [...this.files.keys()].filter((k) => k.startsWith(p));
  }
}
