import { DEFAULT_APP_URL, importLink, normalizeAppUrl, pickTarget } from './lib.js';

const MENU = 'send-to-folume';

async function appUrl() {
  const { appUrl: stored } = await chrome.storage.sync.get('appUrl');
  return normalizeAppUrl(stored) ?? DEFAULT_APP_URL;
}

async function send(target) {
  if (!target) return;
  await chrome.tabs.create({ url: importLink(await appUrl(), target) });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: MENU, title: 'Send to Folume', contexts: ['page', 'link', 'selection'] });
});

// the toolbar button sends the page in the current tab
chrome.action.onClicked.addListener((tab) => void send(pickTarget({ tabUrl: tab.url })));

// the right-click menu sends a link, a selected DOI or arXiv id, or the page
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU) void send(pickTarget({ linkUrl: info.linkUrl, selectionText: info.selectionText, pageUrl: info.pageUrl, tabUrl: tab?.url }));
});
