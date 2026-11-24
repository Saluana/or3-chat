import { expect, test, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

const fixtureEmail = process.env.OR3_OFFLINE_PWA_TEST_EMAIL;
const fixturePassword = process.env.OR3_OFFLINE_PWA_TEST_PASSWORD;
const blockedPolicy = process.env.OR3_OFFLINE_PWA_TEST_POLICY_DISABLED === 'true';

async function signIn(page: Page, headers: Record<string, string>) {
  const response = await page.request.post('/api/basic-auth/sign-in', {
    headers, data: { email: fixtureEmail, password: fixturePassword },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

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

test('mobile workspace cold-starts and saves local work offline', async ({ page, context, browser }, info) => {
  test.skip(blockedPolicy, 'This journey verifies workspace access when the site allows it.');
  test.setTimeout(90_000);
  context.setDefaultTimeout(15_000);
  const origin = String(info.project.use.baseURL);
  const headers = { origin, 'x-or3-cloud-intent': 'mutation' };
  let workspaceId: string | undefined;
  if (fixtureEmail) {
    // Configure these only against a disposable Basic Auth production build.
    await signIn(page, headers);
    const created = await page.request.post('/api/workspaces', { headers, data: { name: 'Offline PWA test' } });
    expect(created.ok(), await created.text()).toBe(true);
    workspaceId = (await created.json()).id;
    const activated = await page.request.post('/api/workspaces/active', { headers, data: { id: workspaceId } });
    expect(activated.ok(), await activated.text()).toBe(true);
    const verified = await page.request.get('/api/auth/session');
    expect(await verified.json()).toMatchObject({ offlineWorkspaceAccess: true, session: { workspace: { id: workspaceId } } });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible({ timeout: 15_000 });
  await page.close();

  // A closed PWA has no in-memory modules. Empty Chrome's ordinary HTTP cache
  // too, so only the installed service worker can satisfy the new navigation.
  await context.setOffline(true);
  const launch = await context.newPage();
  await launch.setViewportSize({ width: 390, height: 844 });
  const cdp = await context.newCDPSession(launch);
  await cdp.send('Network.clearBrowserCache');
  await cdp.detach();
  await launch.goto('/');
  await expect(launch.getByRole('textbox', { name: 'Message input' })).toBeVisible({ timeout: 15_000 });
  expect(await launch.evaluate(() => navigator.onLine)).toBe(false);
  const welcome = launch.getByRole('button', { name: 'Dismiss welcome', exact: true });
  await launch.addLocatorHandler(welcome, () => welcome.click());
  const chat = launch.getByRole('textbox', { name: 'Message input' });
  await chat.fill('Unsent note from airplane mode');
  await chat.press('Tab');
  await launch.reload();
  await expect(chat).toContainText('Unsent note from airplane mode');
  await launch.getByRole('button', { name: 'Create a document', exact: true }).first().click();
  const title = launch.getByRole('textbox', { name: 'Document title' });
  const body = launch.getByRole('textbox', { name: 'Document body' });
  await title.fill('Offline field notes');
  await title.press('Tab');
  await body.fill('Written with the network disconnected.');
  await body.press('Tab');
  await expect(launch).toHaveURL(/\/docs\/.+/);
  const documentUrl = launch.url();
  const database = workspaceId ? `or3-db-${workspaceId}` : 'or3-db';
  const documentId = new URL(documentUrl).pathname.split('/').at(-1)!;
  await expect.poll(() => launch.evaluate(async ({ database, documentId }) => {
    if (!(await indexedDB.databases()).some(db => db.name === database)) return null;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(database);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const request = db.transaction('current_posts').objectStore('current_posts').get(documentId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  }, { database, documentId }).then(value => JSON.stringify(value))).toContain('Written with the network disconnected.');
  await launch.close();

  const reopened = await context.newPage();
  await reopened.goto(documentUrl);
  await expect(reopened.getByRole('textbox', { name: 'Document title' })).toHaveValue('Offline field notes');
  const restoredBody = reopened.getByRole('textbox', { name: 'Document body' });
  await expect(restoredBody).toContainText('Written with the network disconnected.');
  await reopened.screenshot({ path: info.outputPath('offline-document.png') });
  await reopened.setViewportSize({ width: 1440, height: 950 });
  await reopened.keyboard.press('ControlOrMeta+K');
  const query = reopened.locator('[data-test="command-palette-input"]');
  await query.fill('doc: Offline field notes');
  await expect(reopened.getByRole('option', { name: /Offline field notes/ })).toBeVisible();
  await reopened.keyboard.press('Escape');

  await reopened.getByRole('button', { name: 'Files', exact: true }).first().click();
  const files = reopened.getByRole('region', { name: 'Workspace Files' });
  const original = 'Original file saved with no connection.';
  await files.getByLabel('Upload files', { exact: true }).setInputFiles({
    name: 'field-notes.txt', mimeType: 'text/plain', buffer: Buffer.from(original),
  });
  await expect(files.getByRole('button', { name: 'Open field-notes.txt', exact: true })).toBeVisible();
  await reopened.reload();
  await reopened.getByRole('button', { name: 'Files', exact: true }).first().click();
  await files.getByRole('button', { name: 'Open field-notes.txt', exact: true }).click();
  const preview = reopened.getByRole('complementary', { name: 'File preview', exact: true });
  const download = reopened.waitForEvent('download');
  await preview.getByRole('button', { name: 'Download', exact: true }).click();
  const localCopy = await (await download).path();
  expect(await readFile(localCopy, 'utf8')).toBe(original);

  const navigation = reopened.getByRole('complementary', { name: 'Navigation', exact: true });
  await navigation.getByRole('button', { name: 'New project', exact: true }).click();
  const project = reopened.getByRole('dialog', { name: 'New Project', exact: true });
  await project.getByPlaceholder('Project title').fill('Offline expedition');
  await project.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(reopened.getByRole('button', { name: 'Open project Offline expedition', exact: true })).toBeVisible();

  const pushed = workspaceId && reopened.waitForResponse(async response => {
    if (!response.url().endsWith('/api/sync/push') || !response.ok()) return false;
    const operations = response.request().postDataJSON()?.ops ?? [];
    const op = operations.find((operation: { pk: string; payload: unknown }) =>
      operation.pk === documentId && JSON.stringify(operation.payload).includes('Written with the network disconnected.'));
    if (!op) return false;
    const result = await response.json();
    return result.results?.some((record: { opId: string; success: boolean }) => record.opId === op.stamp.opId && record.success);
  });
  await context.setOffline(false);
  if (pushed) {
    await pushed;
    await reopened.goto(documentUrl);
  } else {
    await navigation.getByRole('button', { name: 'Open Offline field notes', exact: true }).click();
  }
  await expect(restoredBody).toContainText('Written with the network disconnected.');

  if (workspaceId) {
    const second = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
    try {
      const other = await second.newPage();
      await signIn(other, headers);
      await other.goto(documentUrl, { waitUntil: 'domcontentloaded' });
      await expect(other.getByRole('textbox', { name: 'Document body' })).toContainText('Written with the network disconnected.');
    } finally {
      await second.close();
    }
  }
});

test('Cloud keeps an unverified workspace locked offline', async ({ page, context }) => {
  test.skip(!fixtureEmail, 'This requires a disposable Cloud build with the lock page enabled.');
  if (blockedPolicy) {
    const origin = String(test.info().project.use.baseURL);
    await signIn(page, { origin, 'x-or3-cloud-intent': 'mutation' });
    const response = await page.request.get('/api/auth/session');
    const verified = await response.json();
    expect(verified.session?.authenticated).toBe(true);
    expect(verified.offlineWorkspaceAccess).not.toBe(true);
  }
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.close();
  await context.setOffline(true);
  const reopened = await context.newPage();
  await reopened.goto('/chat', { waitUntil: 'domcontentloaded' });
  await expect(reopened).toHaveURL(/\/welcome/);
  await expect(reopened.getByRole('textbox', { name: 'Message input' })).toHaveCount(0);
});
