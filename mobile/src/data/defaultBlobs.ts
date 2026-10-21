import { Directory, File, Paths } from 'expo-file-system';

import type { BlobStore } from './blobs';

/** Native implementation on top of expo-file-system's `File`/`Directory` API. */
class NativeBlobStore implements BlobStore {
  private readonly root = new Directory(Paths.document, 'folume');

  private file(path: string): File {
    return new File(this.root, ...path.split('/'));
  }

  async put(path: string, data: Uint8Array | string): Promise<void> {
    const f = this.file(path);
    f.create({ intermediates: true, overwrite: true });
    await f.write(data);
  }

  async get(path: string): Promise<Uint8Array | null> {
    const f = this.file(path);
    return f.exists ? await f.bytes() : null;
  }

  async getText(path: string): Promise<string | null> {
    const f = this.file(path);
    return f.exists ? await f.text() : null;
  }

  async exists(path: string): Promise<boolean> {
    return this.file(path).exists;
  }

  async removePrefix(prefix: string): Promise<void> {
    const parts = prefix.split('/').filter(Boolean);
    const dir = new Directory(this.root, ...parts);
    if (dir.exists) {
      dir.delete();
      return;
    }
    const f = new File(this.root, ...parts);
    if (f.exists) f.delete();
  }

  async list(prefix: string): Promise<string[]> {
    const out: string[] = [];
    const walk = (dir: Directory, rel: string) => {
      if (!dir.exists) return;
      for (const entry of dir.list()) {
        const name = entry.name;
        if (entry instanceof Directory) walk(entry, `${rel}/${name}`);
        else out.push(`${rel}/${name}`);
      }
    };
    walk(new Directory(this.root, ...prefix.split('/').filter(Boolean)), prefix.replace(/\/$/, ''));
    return out;
  }
}

export function createBlobStore(): BlobStore {
  return new NativeBlobStore();
}
