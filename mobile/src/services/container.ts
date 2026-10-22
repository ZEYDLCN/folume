import { AsyncStorageKV } from '@/data/asyncStorageKV';
import type { BlobStore } from '@/data/blobs';
import { createBlobStore } from '@/data/defaultBlobs';
import type { KeyValueStore } from '@/data/kv';
import { AnnotationRepo } from '@/data/annotations';
import { CardRepo } from '@/data/cards';
import { RecordStore } from '@/data/records';
import { FixRepo, InkRepo, ProjectRepo, WantRepo } from '@/data/userdata';
import { LibraryRepo } from '@/data/library';
import { QuizRepo } from '@/data/quiz';
import { useSettings } from '@/state/settings';

import { FolumeApi } from './api';
import { KnowledgeService } from './knowledge';
import { SyncEngine } from './syncEngine';

/** Process-wide singletons for the local stores; the API client always reflects the current settings. */
let kv: KeyValueStore | null = null;
let blobs: BlobStore | null = null;
let library: LibraryRepo | null = null;
let annotations: AnnotationRepo | null = null;
let quizzes: QuizRepo | null = null;
let cards: CardRepo | null = null;
let records: RecordStore | null = null;
let fixes: FixRepo | null = null;
let ink: InkRepo | null = null;
let projects: ProjectRepo | null = null;
let want: WantRepo | null = null;
let knowledgeService: KnowledgeService | null = null;

export function getStores() {
  kv ??= new AsyncStorageKV();
  blobs ??= createBlobStore();
  library ??= new LibraryRepo(kv, blobs);
  annotations ??= new AnnotationRepo(kv);
  quizzes ??= new QuizRepo(kv);
  cards ??= new CardRepo(kv);
  records ??= new RecordStore(kv);
  fixes ??= new FixRepo(kv);
  ink ??= new InkRepo(kv);
  projects ??= new ProjectRepo(kv);
  want ??= new WantRepo(kv);
  return { kv, blobs, library, annotations, quizzes, cards, records, fixes, ink, projects, want };
}

export function getKnowledge(): KnowledgeService {
  knowledgeService ??= new KnowledgeService(() => getStores().library);
  return knowledgeService;
}

export function getSyncEngine(): SyncEngine {
  const { kv, records } = getStores();
  return new SyncEngine(records, kv, getApi());
}

export function getApi(): FolumeApi {
  const { serverUrl, apiKey } = useSettings.getState();
  return new FolumeApi({ baseUrl: serverUrl, apiKey });
}
