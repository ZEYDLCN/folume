import type { ReaderEvent } from '../../src/reader/protocol';

type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string | null,
  attrs?: Record<string, string | number | undefined> | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined) node.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(data: string): void };
    __host?: (msg: unknown) => void;
  }
}

/** Sends an event to the host: the React Native WebView bridge, or the parent window on web. */
export function post(event: ReaderEvent): void {
  const data = JSON.stringify(event);
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(data);
  else if (window.parent !== window) window.parent.postMessage(JSON.stringify({ __folume: 1, ...event }), '*');
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function rectOf(node: Element | Range): { x: number; y: number; width: number; height: number } {
  const r = node.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}
