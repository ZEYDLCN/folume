// Run with `node --test extension/` (no dependencies).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { DEFAULT_APP_URL, importLink, normalizeAppUrl, pickTarget } from './lib.js';

test('the app address is cleaned up, and anything that is not a plain web address is refused', () => {
  assert.equal(normalizeAppUrl(' https://folume.example.org/ '), 'https://folume.example.org');
  assert.equal(normalizeAppUrl('http://localhost:8081/?x=1#y'), 'http://localhost:8081');
  assert.equal(normalizeAppUrl('https://example.org/folume/'), 'https://example.org/folume');
  for (const bad of ['', 'folume', 'javascript:alert(1)', 'file:///x', 'ftp://x.org', 'https://user:pw@x.org', null, undefined]) {
    assert.equal(normalizeAppUrl(bad), null, String(bad));
  }
});

test('the link opens the app with the paper to add, exactly as the app itself builds it', () => {
  // the same expectations as mobile/src/core/share.test.ts: the two must agree
  assert.equal(importLink('https://folume.example.org', 'https://arxiv.org/abs/2401.01234'), 'https://folume.example.org/?import=https%3A%2F%2Farxiv.org%2Fabs%2F2401.01234');
  assert.equal(importLink('http://localhost:8081/', '2401.01234'), 'http://localhost:8081/?import=2401.01234');
  assert.equal(importLink('https://example.org/folume/', '2401.01234'), 'https://example.org/folume/?import=2401.01234');
  const link = importLink('https://a.org', 'https://x.org/p?a=1&import=evil#frag');
  assert.equal(new URL(link).searchParams.get('import'), 'https://x.org/p?a=1&import=evil#frag');
  assert.equal(new URL(link).hash, '');
  assert.throws(() => importLink('not a url', 'x'), /bad_app_url/);
});

test('a right-clicked link wins, then a selected DOI or arXiv id, then the page', () => {
  assert.equal(pickTarget({ linkUrl: 'https://arxiv.org/abs/2401.01234', selectionText: '10.1145/3292500.3330701', pageUrl: 'https://x.org/' }), 'https://arxiv.org/abs/2401.01234');
  assert.equal(pickTarget({ selectionText: ' 10.1145/3292500.3330701 ', pageUrl: 'https://x.org/' }), '10.1145/3292500.3330701');
  assert.equal(pickTarget({ selectionText: 'arXiv:2401.01234v2', pageUrl: 'https://x.org/' }), 'arXiv:2401.01234v2');
  assert.equal(pickTarget({ selectionText: 'hep-th/9901001' }), 'hep-th/9901001');
  assert.equal(pickTarget({ selectionText: 'some words I selected', pageUrl: 'https://x.org/paper' }), 'https://x.org/paper');
  assert.equal(pickTarget({ tabUrl: 'https://x.org/tab' }), 'https://x.org/tab');
});

test('nothing but web addresses, DOIs and arXiv ids is ever sent', () => {
  assert.equal(pickTarget({ linkUrl: 'javascript:alert(1)', pageUrl: 'chrome://extensions' }), null);
  assert.equal(pickTarget({ linkUrl: 'file:///etc/passwd', tabUrl: 'about:blank' }), null);
  assert.equal(pickTarget({ selectionText: '<script>alert(1)</script>', pageUrl: 'data:text/html,x' }), null);
  assert.equal(pickTarget({}), null);
  assert.equal(pickTarget(), null);
});

test('the manifest asks for as little as it can and names every file it needs', () => {
  const m = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));
  assert.equal(m.manifest_version, 3);
  assert.deepEqual([...m.permissions].sort(), ['activeTab', 'contextMenus', 'storage']);
  assert.equal(m.host_permissions, undefined, 'no access to any site');
  assert.equal(m.content_scripts, undefined, 'nothing is injected into pages');
  for (const f of [m.background.service_worker, m.options_ui.page, ...Object.values(m.icons), ...Object.values(m.action.default_icon)]) {
    assert.ok(readFileSync(new URL(`./${f}`, import.meta.url)).length > 0, f);
  }
  assert.equal(DEFAULT_APP_URL, 'http://localhost:8081');
});
