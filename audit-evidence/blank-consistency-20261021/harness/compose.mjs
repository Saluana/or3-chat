// node compose.mjs <beforeDir> <afterDir> <outDir> [nameFilter]  -> side-by-side before/after JPEGs
import { chromium } from 'playwright-core';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
const [beforeArg, afterArg, outArg, only = ''] = process.argv.slice(2);
const [before, after, out] = [beforeArg, afterArg, outArg].map((p) => resolve(p));
const tmpHtml = join(tmpdir(), 'blank-audit-pair.html');
mkdirSync(out, { recursive: true });
const names = readdirSync(before).filter((f) => f.endsWith('.png') && f.includes(only) && existsSync(`${after}/${f}`));
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
const label = (n) => ({ d: 'Desktop', k: 'Desktop dark', m: 'Phone' }[n[0]] || '');
for (const f of names) {
  const html = `<html><body style="margin:0;background:#fff;font:600 20px -apple-system,system-ui,sans-serif">
  <div style="display:flex;gap:24px;padding:24px;align-items:flex-start;background:#f4f4f5">
    <figure style="margin:0;flex:1 1 0;min-width:0"><div style="margin:0 0 10px;color:#6b7280;letter-spacing:.04em;font-size:15px">BEFORE</div><img id=a style="width:100%;display:block;border:1px solid #d4d4d8;border-radius:8px;background:#fff" src="file://${before}/${f}"></figure>
    <figure style="margin:0;flex:1 1 0;min-width:0"><div style="margin:0 0 10px;color:#047857;letter-spacing:.04em;font-size:15px">AFTER</div><img id=b style="width:100%;display:block;border:1px solid #d4d4d8;border-radius:8px;background:#fff" src="file://${after}/${f}"></figure>
  </div></body></html>`;
  writeFileSync(tmpHtml, html);
  const w = f.startsWith('m') ? 1100 : (f.match(/^(d03|d15)/) ? 1100 : 2000);
  await page.setViewportSize({ width: w, height: 800 });
  await page.goto('file://' + tmpHtml);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth));
  await page.screenshot({ path: `${out}/${f.replace('.png', '.jpg')}`, fullPage: true, type: 'jpeg', quality: 88 });
}
await browser.close();
console.log(names.length + ' pairs');
