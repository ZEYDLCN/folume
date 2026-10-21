import { forwardRef, useImperativeHandle, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

import type { HostMessage } from './protocol';

export interface TransportHandle {
  post(msg: HostMessage): void;
}

interface Props {
  html: string;
  onMessage: (raw: string) => void;
}

/** Native transport: the reader runtime lives in a WebView and receives messages via injected calls. */
export const ReaderTransport = forwardRef<TransportHandle, Props>(function ReaderTransport({ html, onMessage }, ref) {
  const web = useRef<WebView<object>>(null);
  useImperativeHandle(ref, () => ({
    post(msg) {
      web.current?.injectJavaScript(`window.__host && window.__host(${JSON.stringify(msg)}); true;`);
    },
  }));
  return (
    // WebView's own typings default its generic to `undefined`, which makes the props `never`; `object` fixes that
    <WebView<object>
      ref={web}
      testID="reader-webview"
      originWhitelist={['*']}
      source={{ html }}
      onMessage={(e) => onMessage(e.nativeEvent.data)}
      javaScriptEnabled
      domStorageEnabled={false}
      setSupportMultipleWindows={false}
      allowFileAccess={false}
      bounces={false}
      automaticallyAdjustContentInsets={false}
      contentInsetAdjustmentBehavior="never"
      hideKeyboardAccessoryView
      style={styles.web}
    />
  );
});

const styles = StyleSheet.create({ web: { flex: 1, backgroundColor: 'transparent' } });
