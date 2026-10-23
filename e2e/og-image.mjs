// Renders the picture shown when a link to the app is shared (LinkedIn, X, chat apps): mobile/public/og-image.png. Run: node og-image.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { here, launch } from './lib.mjs';

const mark = readFileSync(path.join(here, '../mobile/assets/brand/folume-mark.svg'), 'utf8');
const html = `<html><body style="margin:0;width:1200px;height:630px;background:#fcefe3;font-family:Georgia,'DejaVu Serif',serif;color:#46241a;display:flex;align-items:center;position:relative;overflow:hidden">
  <div style="position:absolute;right:-120px;top:-160px;width:620px;height:620px;border-radius:50%;background:#cf6446"></div>
  <div style="position:absolute;right:160px;bottom:-200px;width:420px;height:420px;border-radius:50%;background:#f6dfcc"></div>
  <div style="position:relative;padding:0 80px;width:700px">
    <div style="font-size:112px;font-weight:700;letter-spacing:-2px;line-height:1">Folume</div>
    <div style="font-size:42px;line-height:1.3;margin-top:28px;color:#7a5a4b">Read the paper like a book.<br/>Understand it like a researcher.</div>
    <div style="font-family:system-ui,sans-serif;font-size:26px;margin-top:40px;color:#c2512f;font-weight:600">Every letter kept · EPUB · Notes · Cards</div>
  </div>
  <div style="position:absolute;right:120px;top:155px;width:320px;height:320px;border-radius:72px;background:#141B36;box-shadow:0 24px 60px rgba(70,36,26,.35);display:flex;align-items:center;justify-content:center">
    <div style="width:260px;height:260px">${mark.replace('width="512" height="512"', 'width="260" height="260"')}</div>
  </div>
</body></html>`;
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html);
await page.screenshot({ path: path.join(here, '../mobile/public/og-image.png') });
await browser.close();
console.log('wrote mobile/public/og-image.png');
