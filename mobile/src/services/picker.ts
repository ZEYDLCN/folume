import * as DocumentPicker from 'expo-document-picker';
import { Platform } from 'react-native';

import type { PdfSource } from './importer';

/** Opens the system file picker for a PDF. Returns null when the user cancels. */
export async function pickPdf(): Promise<PdfSource | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'application/pdf',
    copyToCacheDirectory: true,
    multiple: false,
    base64: false,
  });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  if (Platform.OS === 'web' && asset.file) return { kind: 'blob', blob: asset.file, name: asset.name };
  return { kind: 'uri', uri: asset.uri, name: asset.name, size: asset.size };
}

/** Opens the file picker for a text file (a backup) and returns its content, or null when cancelled. */
export async function pickTextFile(types: string[] = ['application/json', 'text/plain']): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: types, copyToCacheDirectory: true, multiple: false });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  if (Platform.OS === 'web' && asset.file) return asset.file.text();
  const { File } = await import('expo-file-system');
  return new File(asset.uri).text();
}
