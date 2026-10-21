import * as SecureStore from 'expo-secure-store';

/** Secrets (API keys) live in the platform keychain, not in the plain key-value store. */
export async function getSecret(name: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(`folume.${name}`);
  } catch {
    return null;
  }
}

export async function setSecret(name: string, value: string | null): Promise<void> {
  if (value) await SecureStore.setItemAsync(`folume.${name}`, value);
  else await SecureStore.deleteItemAsync(`folume.${name}`);
}
