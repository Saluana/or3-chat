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

for (const heldDecode of [false, true]) {
    test(`native thumbnail ${heldDecode ? 'held decode' : 'cached blob'} cannot cross workspaces or overwrite recovery`, async ({ page }, info) => {
        await open(page);
        const receipt = await page.evaluate(async held => {
            const clientPath = '/_nuxt/db/client.ts';
            const filesPath = '/_nuxt/db/files.ts';
            const cachePath = '/_nuxt/composables/core/useThumbnailUrlCache.ts';
            const client = await import(clientPath);
            const files = await import(filesPath);
            const { useThumbnailUrlCache } = await import(cachePath);
            const canvas = document.createElement('canvas');
            canvas.width = 2; canvas.height = 2;
            canvas.getContext('2d')!.fillRect(0, 0, 2, 2);
            const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
            await client.setActiveWorkspaceDb('native-thumbnail-a').open();
            const meta = await files.createOrRefFile(blob, 'synthetic-a.png');
            const cache = useThumbnailUrlCache();
            const nativeDecode = Image.prototype.decode;
            let release!: () => void;
            let started!: () => void;
            const pending = new Promise<void>(resolve => { release = resolve; });
            const entered = new Promise<void>(resolve => { started = resolve; });
            let oldUrl = '';
            if (held) {
                let intercepted = false;
                Image.prototype.decode = function() {
                    if (!intercepted) {
                        intercepted = true; oldUrl = this.src; started(); return pending;
                    }
                    return nativeDecode.call(this);
                };
            }
            try {
                const oldEnsure = cache.ensure(meta.hash, () => files.getFileBlob(meta.hash));
                if (held) await Promise.race([entered, oldEnsure.then(() => { throw new Error('Native decode was not reached'); })]);
                else {
                    const oldState = await oldEnsure;
                    if (oldState?.status !== 'ready') throw new Error('Native PNG decode failed');
                    oldUrl = oldState.url!;
                }
                await client.setActiveWorkspaceDb('native-thumbnail-b').open();
                const immediateCached = cache.get(meta.hash);
                const missingMeta = await files.getFileMeta(meta.hash);
                const absent = await cache.ensure(meta.hash, () => files.getFileBlob(meta.hash));
                const ownMeta = await files.createOrRefFile(blob, 'synthetic-b.png');
                const fresh = await cache.ensure(ownMeta.hash, () => files.getFileBlob(ownMeta.hash));
                release();
                const oldResult = await oldEnsure;
                const preserved = cache.get(ownMeta.hash);
                let oldReadable = true;
                try { await fetch(oldUrl); } catch { oldReadable = false; }
                const actualBytes = fresh?.url ? await (await fetch(fresh.url)).arrayBuffer() : new ArrayBuffer(0);
                const digest = await crypto.subtle.digest('SHA-256', actualBytes);
                const deliveredHash = 'sha256:' + Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
                return { immediateCached: !!immediateCached, missingMeta: !!missingMeta, absent: !!absent,
                    oldDiscarded: held ? oldResult === undefined : true, oldReadable,
                    freshStatus: fresh?.status, freshDifferentUrl: fresh?.url !== oldUrl,
                    preserved: preserved === fresh, sameHash: ownMeta.hash === meta.hash,
                    deliveredHashMatches: deliveredHash === ownMeta.hash };
            } finally { release(); Image.prototype.decode = nativeDecode; }
        }, heldDecode);
        await info.attach('synthetic-native-thumbnail-receipt', { body: JSON.stringify(receipt), contentType: 'application/json' });
        expect(receipt).toEqual({ immediateCached: false, missingMeta: false, absent: false,
            oldDiscarded: true, oldReadable: false, freshStatus: 'ready', freshDifferentUrl: true,
            preserved: true, sameHash: true, deliveredHashMatches: true });
    });
}

for (const outcome of ['success', 'failure'] as const) {
    for (const change of ['changed', 'returned'] as const) {
        test(`actual palette discards ${outcome} feedback after workspace is ${change}`, async ({ page }) => {
            await open(page);
            await select(page, `palette-browser-${outcome}-${change}-origin`);
            await page.evaluate(async () => {
                const path = '/_nuxt/composables/search/useCommandPalette.ts';
                const module = await import(path);
                const palette = module.useCommandPalette();
                let finish!: (value: unknown) => void;
                const held = new Promise(resolve => { finish = resolve; });
                const restore = module.setPaletteHostContext({ canOpenNewPane: () => true, openChat: () => held });
                palette.open();
                const pending = palette.runAction({ id: 'synthetic-navigation', label: 'Synthetic navigation', target: { kind: 'chat', threadId: 'synthetic-thread', destination: 'active' } });
                (window as unknown as { isolationPalette: unknown }).isolationPalette = { palette, finish, pending, restore };
            });
            await select(page, `palette-browser-${outcome}-${change}-target`);
            if (change === 'returned') await select(page, `palette-browser-${outcome}-${change}-origin`);
            const state = await page.evaluate(async result => {
                const fixture = (window as unknown as { isolationPalette: {
                    palette: { isOpen: { value: boolean }; errorMessage: { value: string | null }; announcement: { value: string }; close(): void };
                    finish(value: unknown): void; pending: Promise<void>; restore(): void;
                } }).isolationPalette;
                fixture.finish(result === 'success' ? { ok: true } : { ok: false, error: { code: 'navigation-failed', message: 'synthetic-private-workspace-a-filename' } });
                await fixture.pending;
                const state = { open: fixture.palette.isOpen.value, error: fixture.palette.errorMessage.value, announcement: fixture.palette.announcement.value };
                fixture.palette.close();
                fixture.restore();
                return state;
            }, outcome);
            expect(state.open).toBe(true);
            expect(state.error).toBeNull();
            expect(state.announcement).not.toContain('synthetic-private-workspace-a-filename');
        });
    }
}

for (const boundary of ['native-conversion', 'iteration', 'unchanged'] as const) {
    test(`actual SDK file read fences ${boundary} byte delivery`, async ({ page }, info) => {
        await open(page);
        await select(page, `sdk-browser-${boundary}-origin`);
        await page.evaluate(async mode => {
            const hostPath = '/_nuxt/composables/plugins/trusted-host-context.ts';
            const { createTrustedHostContext } = await import(hostPath);
            const trusted = createTrustedHostContext({ pluginId: 'fixture.browser-files', version: '1.0.0',
                workspaceId: `sdk-browser-${mode}-origin`, grants: ['files.read', 'files.write'] });
            const written = await trusted.context.files.write({ name: 'synthetic-sdk-origin.txt', mimeType: 'text/plain',
                data: (async function* () { yield new TextEncoder().encode('synthetic-sdk-private-origin-bytes'); })() });
            if (!written.ok) throw new Error(`Synthetic SDK write failed: ${written.error.code}`);
            const nativeRead = Blob.prototype.arrayBuffer;
            let release!: () => void;
            const held = new Promise<void>(resolve => { release = resolve; });
            const fixture = { trusted, entered: false, release, restore: () => { Blob.prototype.arrayBuffer = nativeRead; },
                pending: null as Promise<unknown> | null, read: null as unknown };
            if (mode === 'native-conversion') {
                Blob.prototype.arrayBuffer = async function() {
                    fixture.entered = true; await held; return nativeRead.call(this);
                };
                fixture.pending = trusted.context.files.read(written.value.id);
            } else fixture.read = await trusted.context.files.read(written.value.id);
            (window as unknown as { isolationSdkFile: unknown }).isolationSdkFile = fixture;
        }, boundary);
        if (boundary === 'native-conversion') {
            await page.waitForFunction(() => (window as unknown as { isolationSdkFile: { entered: boolean } }).isolationSdkFile.entered);
        }
        if (boundary !== 'unchanged') await select(page, `sdk-browser-${boundary}-target`);
        const receipt = await page.evaluate(async () => {
            const fixture = (window as unknown as { isolationSdkFile: {
                trusted: { dispose(): Promise<void> }; release(): void; restore(): void;
                pending: Promise<any> | null; read: any;
            } }).isolationSdkFile;
            try {
                fixture.restore(); fixture.release();
                const read = fixture.pending ? await fixture.pending : fixture.read;
                if (!read.ok) return { readOk: false, error: read.error.code, chunks: 0, text: '' };
                const chunks: Uint8Array[] = [];
                for await (const chunk of read.value) chunks.push(chunk);
                const terminal = await read.value.result;
                return { readOk: true, error: terminal.ok ? null : terminal.error.code, chunks: chunks.length,
                    text: chunks.map(chunk => new TextDecoder().decode(chunk)).join('') };
            } finally { fixture.restore(); fixture.release(); await fixture.trusted.dispose(); }
        });
        await info.attach('synthetic-sdk-file-receipt', { body: JSON.stringify(receipt), contentType: 'application/json' });
        expect(receipt).toEqual(boundary === 'unchanged'
            ? { readOk: true, error: null, chunks: 1, text: 'synthetic-sdk-private-origin-bytes' }
            : { readOk: boundary === 'iteration', error: 'stale-context', chunks: 0, text: '' });
    });
}
