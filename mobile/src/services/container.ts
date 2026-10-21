import { AsyncStorageKV } from '@/data/asyncStorageKV';
import type { BlobStore } from '@/data/blobs';
import { createBlobStore } from '@/data/defaultBlobs';
import type { KeyValueStore } from '@/data/kv';
import { AnnotationRepo } from '@/data/annotations';
import { LibraryRepo } from '@/data/library';
import { QuizRepo } from '@/data/quiz';
import { useSettings } from '@/state/settings';

import { FolumeApi } from './api';

/** Process-wide singletons for the local stores; the API client always reflects the current settings. */
let kv: KeyValueStore | null = null;
let blobs: BlobStore | null = null;
let library: LibraryRepo | null = null;
let annotations: AnnotationRepo | null = null;
let quizzes: QuizRepo | null = null;

export function getStores() {
  kv ??= new AsyncStorageKV();
  blobs ??= createBlobStore();
  library ??= new LibraryRepo(kv, blobs);
  annotations ??= new AnnotationRepo(kv);
  quizzes ??= new QuizRepo(kv);
  return { kv, blobs, library, annotations, quizzes };
}

export function getApi(): FolumeApi {
  const { serverUrl, apiKey } = useSettings.getState();
  return new FolumeApi({ baseUrl: serverUrl, apiKey });
}
