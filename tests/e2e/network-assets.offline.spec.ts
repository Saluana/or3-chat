import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// Run against a locally built production server: development mode has no precache.
test('Cyberpunk theme images remain available offline', async ({ page, context }, testInfo) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: 'networkidle' });

  const urls = await page.evaluate(async () => {
    const names = await caches.keys();
    const requests = (await Promise.all(names.map(async name => (await caches.open(name)).keys()))).flat();
    return requests.map(request => request.url);
  });
  const assets = ['cyberpunk.', 'cybersb2.', 'lightmode-cyberpunk-bg.'].map(name => {
    const url = urls.find(candidate => new URL(candidate).pathname.includes(`/${name}`));
    expect(url, `${name} must be precached`).toBeTruthy();
    return url!;
  });
  const read = () => page.evaluate(async assetUrls => Promise.all(assetUrls.map(async url => {
    const response = await fetch(url);
    const bytes = await response.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return { status: response.status, size: bytes.byteLength,
      hash: Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('') };
  })), assets);
  const online = await read();
  expect(online.every(result => result.status === 200 && result.size > 0)).toBe(true);
  await context.setOffline(true);
  expect(await read()).toEqual(online);
  const resultsPath = testInfo.outputPath('offline-assets.json');
  await writeFile(resultsPath, JSON.stringify({ assets, online }, null, 2));
  await testInfo.attach('offline-assets.json', { path: resultsPath, contentType: 'application/json' });
});
