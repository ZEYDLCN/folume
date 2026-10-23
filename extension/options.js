import { DEFAULT_APP_URL, normalizeAppUrl } from './lib.js';

const input = document.getElementById('url');
const status = document.getElementById('status');

const { appUrl } = await chrome.storage.sync.get('appUrl');
input.value = normalizeAppUrl(appUrl) ?? DEFAULT_APP_URL;

document.getElementById('save').addEventListener('click', async () => {
  const clean = normalizeAppUrl(input.value);
  if (!clean) {
    status.textContent = 'That is not a web address (it must start with http:// or https://).';
    return;
  }
  await chrome.storage.sync.set({ appUrl: clean });
  input.value = clean;
  status.textContent = 'Saved.';
});
