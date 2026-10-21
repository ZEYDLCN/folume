import { useCallback, useRef, useState } from 'react';

import type { LibraryEntry } from '@/data/library';

import { getApi, getStores } from './container';
import { ImportError, importPdf, type ImportProgress, type PdfSource } from './importer';

export type ImportState =
  | { status: 'idle' }
  | { status: 'running'; progress: ImportProgress; name: string }
  | { status: 'error'; code: string; message: string };

/** Drives one import at a time and exposes progress, cancellation and the final error to the UI. */
export function useImport(onDone: (entry: LibraryEntry) => void) {
  const [state, setState] = useState<ImportState>({ status: 'idle' });
  const abort = useRef<AbortController | null>(null);

  const start = useCallback(
    async (source: PdfSource) => {
      const controller = new AbortController();
      abort.current = controller;
      setState({ status: 'running', name: source.name, progress: { phase: source.kind === 'url' ? 'fetching' : 'uploading', fraction: 0 } });
      try {
        const { blobs, library } = getStores();
        const entry = await importPdf(
          source,
          { api: getApi(), blobs, library },
          (progress) => setState({ status: 'running', name: source.name, progress }),
          controller.signal,
        );
        setState({ status: 'idle' });
        onDone(entry);
      } catch (e) {
        if (e instanceof ImportError && e.code === 'cancelled') {
          setState({ status: 'idle' });
          return;
        }
        const code = e instanceof ImportError ? e.code : 'unknown';
        setState({ status: 'error', code, message: e instanceof Error ? e.message : '' });
      } finally {
        abort.current = null;
      }
    },
    [onDone],
  );

  const cancel = useCallback(() => abort.current?.abort(), []);
  const dismiss = useCallback(() => setState({ status: 'idle' }), []);
  return { state, start, cancel, dismiss };
}
