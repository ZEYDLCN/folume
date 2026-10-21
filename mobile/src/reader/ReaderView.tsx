import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';

import { mimeForPath, toDataUri } from '@/core/base64';
import type { Document } from '@/core/types';
import type { LibraryRepo, ReadingAnchor } from '@/data/library';

import {
  parseReaderEvent,
  type HighlightView,
  type HostMessage,
  type ReaderEvent,
  type ReaderMode,
  type ReaderSettings,
  type ReaderStrings,
} from './protocol';
import { READER_HTML } from './readerHtml.generated';
import { ReaderTransport, type TransportHandle } from './ReaderTransport';

export interface ReaderViewHandle {
  send(msg: HostMessage): void;
}

interface Props {
  docId: string;
  doc: Document;
  library: LibraryRepo;
  settings: ReaderSettings;
  mode: ReaderMode;
  anchor: ReadingAnchor | null;
  bookmarks: string[];
  highlights: HighlightView[];
  strings: ReaderStrings;
  focus: { blockId: string; page?: number } | null;
  onEvent: (event: ReaderEvent) => void;
}

/**
 * Hosts the reader runtime: sends it the document once it reports `ready`, serves its image requests from
 * local storage (as data URIs, which sidestep WebView file-access quirks) and forwards its events.
 */
export const ReaderView = forwardRef<ReaderViewHandle, Props>(function ReaderView(props, ref) {
  const transport = useRef<TransportHandle>(null);
  const latest = useRef(props);
  latest.current = props;
  const ready = useRef(false);

  const send = useCallback((msg: HostMessage) => transport.current?.post(msg), []);
  useImperativeHandle(ref, () => ({ send }), [send]);

  const onMessage = useCallback(
    (raw: string) => {
      const event = parseReaderEvent(raw);
      if (!event) return;
      const p = latest.current;
      if (event.type === 'ready') {
        ready.current = true;
        send({
          type: 'init',
          doc: p.doc,
          settings: p.settings,
          mode: p.mode,
          anchor: p.anchor,
          bookmarks: p.bookmarks,
          highlights: p.highlights,
          strings: p.strings,
          focus: p.focus,
        });
        return;
      }
      if (event.type === 'asset-request') {
        const path = event.path;
        void p.library.asset(p.docId, path).then((bytes) => {
          if (bytes) send({ type: 'asset', path, uri: toDataUri(bytes, mimeForPath(path)) });
        });
        return;
      }
      p.onEvent(event);
    },
    [send],
  );

  // push later changes to the already running runtime
  useEffect(() => {
    if (ready.current) send({ type: 'settings', settings: props.settings });
  }, [props.settings, send]);
  useEffect(() => {
    if (ready.current) send({ type: 'bookmarks', ids: props.bookmarks });
  }, [props.bookmarks, send]);
  useEffect(() => {
    if (ready.current) send({ type: 'highlights', items: props.highlights });
  }, [props.highlights, send]);

  return <ReaderTransport ref={transport} html={READER_HTML} onMessage={onMessage} />;
});
