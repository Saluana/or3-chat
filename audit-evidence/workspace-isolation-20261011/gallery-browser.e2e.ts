import { test, expect, type Page } from '@playwright/test';

test.setTimeout(60_000);
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5m0AAAAASUVORK5CYII=', 'base64');
const file = { name: 'synthetic-origin.png', mimeType: 'image/png', buffer: pixel };
async function select(page: Page, workspace: string) {
    await page.evaluate(async id => {
        const path = '/_nuxt/db/client.ts';
        const client = await import(path);
        await client.setActiveWorkspaceDb(id).open();
    }, workspace);
}
async function open(page: Page) {
    await page.route('**/*', route => {
        const url = new URL(route.request().url());
        return url.hostname === '127.0.0.1' || ['blob:', 'data:'].includes(url.protocol)
            ? route.continue() : route.abort();
    });
    await page.goto('/images');
    await expect(page.getByRole('heading', { name: 'Image library' })).toBeVisible({ timeout: 60_000 });
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => (document.querySelector('#__nuxt') as unknown as { __vue_app__?: { _instance?: { isMounted: boolean } } })?.__vue_app__?._instance?.isMounted);
    const welcome = page.getByRole('button', { name: 'Dismiss welcome', exact: true });
    if (await welcome.isVisible()) await welcome.click();
}
test('actual gallery upload, viewer and cached previews remain scoped across workspace switching', async ({ page }) => {
    await open(page);
    await select(page, 'gallery-browser-origin');
    await page.locator('input[type=file]').setInputFiles(file);
    const tile = page.getByRole('button', { name: `View ${file.name}`, exact: true });
    await expect(tile.locator('img')).toBeVisible();
    const oldUrl = await tile.locator('img').getAttribute('src');
    expect(oldUrl).toMatch(/^blob:/);
    await tile.click();
    await expect(page.getByRole('button', { name: 'Close image preview', exact: true })).toBeVisible();
    await select(page, 'gallery-browser-empty');
    await expect(tile).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Close image preview', exact: true })).toHaveCount(0);
    expect(await page.evaluate(async url => { try { await fetch(url!); return true; } catch { return false; } }, oldUrl)).toBe(false);
    await select(page, 'gallery-browser-origin');
    await expect(tile.locator('img')).toBeVisible();
    expect(await tile.locator('img').getAttribute('src')).not.toBe(oldUrl);
});
test('actual file chooser cannot upload into a workspace selected after it opened', async ({ page }) => {
    await open(page);
    await select(page, 'gallery-browser-picker-origin');
    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Upload images', exact: true }).click();
    const chooser = await chooserPromise;
    await select(page, 'gallery-browser-picker-target');
    await chooser.setFiles(file);
    await expect(page.getByText('Could not add the selected images.', { exact: true })).toBeVisible();
    expect(await page.evaluate(async () => {
        const path = '/_nuxt/db/client.ts';
        const { getDb } = await import(path);
        return await getDb().file_meta.count();
    })).toBe(0);
    await page.locator('input[type=file]').setInputFiles(file);
    await expect(page.getByRole('button', { name: `View ${file.name}`, exact: true }).locator('img')).toBeVisible();
});

test('actual gallery discards a held preview read after switching to an empty workspace', async ({ page }) => {
    await open(page);
    await select(page, 'gallery-browser-held-origin');
    await page.evaluate(async bytes => {
        const path = '/_nuxt/db/client.ts';
        const { getDb } = await import(path);
        const db = getDb();
        const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
        const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
        const hash = 'sha256:' + Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
        await db.file_blobs.put({ hash, blob });
        const get = db.file_blobs.get.bind(db.file_blobs);
        let release!: () => void;
        const held = new Promise<void>(resolve => { release = resolve; });
        let calls = 0;
        db.file_blobs.get = async (...args: unknown[]) => { calls++; await held; return get(...args); };
        (window as unknown as { isolationHeld: { release(): void; calls(): number; restore(): void } }).isolationHeld = {
            release, calls: () => calls, restore: () => { db.file_blobs.get = get; },
        };
        await db.file_meta.put({ hash, name: 'held-synthetic.png', mime_type: 'image/png', kind: 'image',
            size_bytes: blob.size, ref_count: 0, created_at: 1, updated_at: 1, clock: 1, deleted: false });
    }, Array.from(pixel));
    const tile = page.getByRole('button', { name: 'View held-synthetic.png', exact: true });
    await expect(tile).toBeVisible();
    await page.waitForFunction(() => (window as unknown as { isolationHeld: { calls(): number } }).isolationHeld.calls() > 0);
    await expect(tile.locator('img')).toHaveCount(0);
    await select(page, 'gallery-browser-held-empty');
    await page.evaluate(() => {
        const held = (window as unknown as { isolationHeld: { release(): void; restore(): void } }).isolationHeld;
        held.restore(); held.release();
    });
    await expect(tile).toHaveCount(0);
    await select(page, 'gallery-browser-held-origin');
    await expect(tile.locator('img')).toBeVisible();
});

for (const action of ['download', 'copy'] as const) {
    test(`actual gallery ${action} discards a blob read from a former workspace`, async ({ page }) => {
        await open(page);
        await select(page, `gallery-browser-${action}-origin`);
        await page.locator('input[type=file]').setInputFiles(file);
        const tile = page.getByRole('button', { name: `View ${file.name}`, exact: true });
        await expect(tile.locator('img')).toBeVisible();
        const downloads: string[] = [];
        page.on('download', download => downloads.push(download.suggestedFilename()));
        await page.evaluate(async () => {
            const path = '/_nuxt/db/client.ts';
            const { getDb } = await import(path);
            const db = getDb();
            const get = db.file_blobs.get.bind(db.file_blobs);
            let release!: () => void;
            const held = new Promise<void>(resolve => { release = resolve; });
            let calls = 0;
            db.file_blobs.get = async (...args: unknown[]) => { calls++; await held; return get(...args); };
            const fixture = { release, calls: () => calls, writes: 0, restore: () => { db.file_blobs.get = get; } };
            (window as unknown as { isolationDelivery: typeof fixture }).isolationDelivery = fixture;
            Object.defineProperty(navigator.clipboard, 'write', { configurable: true, value: async () => { fixture.writes++; } });
        });
        const button = page.getByRole('button', { name: action === 'download' ? 'Download image' : 'Copy image', exact: true });
        await button.click();
        await page.waitForFunction(() => (window as unknown as { isolationDelivery: { calls(): number } }).isolationDelivery.calls() > 0);
        await select(page, `gallery-browser-${action}-empty`);
        await page.evaluate(() => {
            const fixture = (window as unknown as { isolationDelivery: { release(): void; restore(): void } }).isolationDelivery;
            fixture.restore(); fixture.release();
        });
        await expect(tile).toHaveCount(0);
        await select(page, `gallery-browser-${action}-origin`);
        await expect(tile.locator('img')).toBeVisible();
        if (action === 'download') {
            const completed = page.waitForEvent('download');
            await button.click();
            expect((await completed).suggestedFilename()).toBe(file.name);
            expect(downloads).toEqual([file.name]);
        } else {
            await button.click();
            await expect(page.getByText('Image copied', { exact: true })).toBeVisible();
            expect(await page.evaluate(() => (window as unknown as { isolationDelivery: { writes: number } }).isolationDelivery.writes)).toBe(1);
        }
    });
}
