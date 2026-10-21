/**
 * Browsers have no keychain. The key is kept in sessionStorage so it is gone when the tab closes
 * and never lands in the persistent key-value store.
 */
export async function getSecret(name: string): Promise<string | null> {
  try {
    return window.sessionStorage.getItem(`folume.${name}`);
  } catch {
    return null;
  }
}

export async function setSecret(name: string, value: string | null): Promise<void> {
  try {
    if (value) window.sessionStorage.setItem(`folume.${name}`, value);
    else window.sessionStorage.removeItem(`folume.${name}`);
  } catch {
    /* storage unavailable */
  }
}
