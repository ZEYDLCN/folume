import { Platform } from 'react-native';

/** Puts text on the clipboard: the browser's on web, the system's on devices. */
export async function copyText(text: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // no permission or an insecure page: fall back to a hidden text area
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      return;
    }
  }
  const Clipboard = await import('expo-clipboard');
  await Clipboard.setStringAsync(text);
}
