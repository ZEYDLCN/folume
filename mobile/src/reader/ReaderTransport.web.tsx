import { createElement, forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

import type { HostMessage } from './protocol';

export interface TransportHandle {
  post(msg: HostMessage): void;
}

interface Props {
  html: string;
  onMessage: (raw: string) => void;
}

/** Web transport: the same runtime in an iframe, talking over window.postMessage. */
export const ReaderTransport = forwardRef<TransportHandle, Props>(function ReaderTransport({ html, onMessage }, ref) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  useImperativeHandle(ref, () => ({
    post(msg) {
      frame.current?.contentWindow?.postMessage(JSON.stringify({ __folumeHost: 1, msg }), '*');
    },
  }));
  useEffect(() => {
    const listener = (ev: MessageEvent) => {
      if (ev.source !== frame.current?.contentWindow || typeof ev.data !== 'string') return;
      onMessage(ev.data);
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [onMessage]);
  return createElement('iframe', {
    ref: frame,
    srcDoc: html,
    title: 'reader',
    'data-testid': 'reader-frame',
    sandbox: 'allow-scripts allow-same-origin',
    style: { border: 0, width: '100%', height: '100%', flex: 1, background: 'transparent' },
  });
});
