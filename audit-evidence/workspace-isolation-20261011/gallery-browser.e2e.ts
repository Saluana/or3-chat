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

for (const boundary of ['chat-rows', 'file-metadata'] as const) {
    test(`actual stored search rejects held ${boundary} across identical workspace identifiers`, async ({ page }, info) => {
        await open(page);
        await page.evaluate(async mode => {
            const clientPath = '/_nuxt/db/client.ts';
            const coordinatorPath = '/_nuxt/core/search/command-palette/coordinator.ts';
            const registryPath = '/_nuxt/core/search/command-palette/registry.ts';
            const chatPath = '/_nuxt/core/search/command-palette/sources/chat-source.ts';
            const documentPath = '/_nuxt/core/search/command-palette/sources/document-source.ts';
            const filePath = '/_nuxt/core/search/command-palette/sources/file-source.ts';
            const { setActiveWorkspaceDb, getDb } = await import(clientPath);
            const { createPaletteCoordinator } = await import(coordinatorPath);
            const { registerPaletteSource } = await import(registryPath);
            const { createChatPaletteSource } = await import(chatPath);
            const { createDocumentPaletteSource } = await import(documentPath);
            const { createFilePaletteSource } = await import(filePath);
            // /images does not mount PageShell's core-source registrations.
            const registrations = [createChatPaletteSource(), createDocumentPaletteSource(), createFilePaletteSource()].map(registerPaletteSource);
            const origin = `stored-search-${mode}-origin`;
            const target = `stored-search-${mode}-target`;
            const blob = new Blob(['identical synthetic file bytes'], { type: 'text/plain' });
            const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
            const hash = 'sha256:' + Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
            for (const [workspace, marker] of [[origin, 'isolationoriginmarker'], [target, 'isolationtargetmarker']]) {
                const db = setActiveWorkspaceDb(workspace); await db.open();
                await db.threads.put({ id: 'identical-thread', title: `${marker} chat`, deleted: false, clock: 1, created_at: 1, updated_at: 1 });
                await db.messages.put({ id: 'identical-message', thread_id: 'identical-thread', role: 'user',
                    data: { content: `${marker} stored synthetic chat text` }, deleted: false, clock: 1, created_at: 1, updated_at: 1, index: 0 });
                await db.posts.put({ id: 'identical-doc', postType: 'doc', title: `${marker} document`,
                    content: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `${marker} stored synthetic document text` }] }] }),
                    deleted: false, clock: 1, created_at: 1, updated_at: 1, meta: '', file_hashes: null });
                await db.file_blobs.put({ hash, blob });
                await db.file_meta.put({ hash, name: `${marker}.txt`, mime_type: 'text/plain', kind: 'file', size_bytes: blob.size,
                    ref_count: 1, created_at: 1, updated_at: 1, clock: 1, deleted: false });
                await db.posts.put({ id: 'identical-file', postType: 'or3:file', title: `${marker} file`,
                    content: `${marker} stored synthetic file text`, deleted: false, clock: 1, created_at: 1, updated_at: 1,
                    meta: JSON.stringify({ 'or3.workspace-item': { version: 1, trashed_at: null } }), file_hashes: JSON.stringify([hash]) });
            }
            await setActiveWorkspaceDb(origin).open();
            const db = getDb();
            const table = mode === 'chat-rows' ? db.messages : db.file_meta;
            const method = mode === 'chat-rows' ? 'toArray' : 'bulkGet';
            const original = table[method].bind(table);
            let release!: () => void;
            const held = new Promise<void>(resolve => { release = resolve; });
            const fixture = { coordinator: createPaletteCoordinator({ debounceMs: 0 }), registrations, entered: false, release,
                restore: () => { table[method] = original; }, originalSearch: null as Promise<unknown> | null };
            table[method] = async (...args: unknown[]) => {
                const captured = await original(...args); fixture.entered = true; await held; return captured;
            };
            (window as unknown as { isolationStoredSearch: unknown }).isolationStoredSearch = fixture;
            fixture.originalSearch = fixture.coordinator.searchOnce({ term: 'isolationoriginmarker', sourceIds: ['chat', 'document', 'file'], limit: 10 })
                .then(() => ({ rejected: false }), () => ({ rejected: true }));
        }, boundary);
        await page.waitForFunction(() => (window as any).isolationStoredSearch.entered);
        await select(page, `stored-search-${boundary}-target`);
        const receipt = await page.evaluate(async mode => {
            const fixture = (window as any).isolationStoredSearch;
            const query = (term: string) => fixture.coordinator.searchOnce({ term, sourceIds: ['chat', 'document', 'file'], limit: 10 });
            try {
                fixture.restore(); fixture.release();
                const original = await fixture.originalSearch;
                await fixture.coordinator.ensureWarm();
                const foreign = await query('isolationoriginmarker');
                const own = await query('isolationtargetmarker');
                const clientPath = '/_nuxt/db/client.ts';
                const { setActiveWorkspaceDb } = await import(clientPath);
                await setActiveWorkspaceDb(`stored-search-${mode}-origin`).open();
                await fixture.coordinator.ensureWarm();
                const recovered = await query('isolationoriginmarker');
                const reverseForeign = await query('isolationtargetmarker');
                return { original, foreign: foreign.results.length, own: own.results.map((row: any) => row.sourceId).sort(),
                    recovered: recovered.results.map((row: any) => row.sourceId).sort(), reverseForeign: reverseForeign.results.length,
                    snapshotsScoped: Array.from(own.snapshots.values()).every((row: any) => row.title.startsWith('isolationtargetmarker')) };
            } finally { fixture.restore(); fixture.release(); fixture.coordinator.dispose(); fixture.registrations.forEach((handle: any) => handle.dispose()); }
        }, boundary);
        await info.attach('synthetic-stored-search-receipt', { body: JSON.stringify(receipt), contentType: 'application/json' });
        expect(receipt).toEqual({ original: { rejected: true }, foreign: 0, own: ['chat', 'document', 'file'],
            recovered: ['chat', 'document', 'file'], reverseForeign: 0, snapshotsScoped: true });
    });
}

test('rendered chat identifiers stay scoped through workspace switching and recovery', async ({ page }, info) => {
    await open(page);
    await page.route('**/api/openrouter/**', route => route.abort());
    await page.route('**/api/jobs/**', route => route.abort());
    await page.evaluate(async () => {
        const path = '/_nuxt/db/client.ts';
        const { setActiveWorkspaceDb } = await import(path);
        for (const [workspace, text] of [['rendered-chat-origin', 'Synthetic rendered origin workspace message'], ['rendered-chat-target', 'Synthetic rendered target workspace message']]) {
            const db = setActiveWorkspaceDb(workspace); await db.open();
            await db.threads.put({ id: 'identical-rendered-thread', title: text, created_at: 1, updated_at: 1, clock: 1, deleted: false });
            await db.messages.put({ id: 'identical-rendered-message', thread_id: 'identical-rendered-thread', role: 'user',
                data: { content: text }, created_at: 1, updated_at: 1, clock: 1, deleted: false, index: 0 });
        }
        setActiveWorkspaceDb('rendered-chat-origin');
        await (document.querySelector('#__nuxt') as any).__vue_app__.$nuxt.$router.push('/chat/identical-rendered-thread');
    });
    const messageRow = page.locator('[data-msg-id="identical-rendered-message"]');
    await expect(messageRow).toBeVisible();
    await expect(messageRow).toContainText('Synthetic rendered origin workspace message');
    await select(page, 'rendered-chat-target');
    await expect(page.getByText('Synthetic rendered origin workspace message', { exact: true })).toHaveCount(0);
    await page.evaluate(async () => {
        const path = '/_nuxt/utils/multiPaneApi.ts';
        const { getGlobalMultiPaneApi } = await import(path);
        const api = getGlobalMultiPaneApi();
        if (!api) throw new Error('Actual pane navigation API unavailable');
        await api.setPaneThread(api.activePaneIndex.value ?? 0, 'identical-rendered-thread');
    });
    await expect(messageRow).toBeVisible();
    await expect(messageRow).toContainText('Synthetic rendered target workspace message');
    await expect(page.getByText('Synthetic rendered origin workspace message', { exact: true })).toHaveCount(0);
    await select(page, 'rendered-chat-origin');
    await expect(page.getByText('Synthetic rendered target workspace message', { exact: true })).toHaveCount(0);
    await page.evaluate(async () => {
        const path = '/_nuxt/utils/multiPaneApi.ts';
        const { getGlobalMultiPaneApi } = await import(path);
        const api = getGlobalMultiPaneApi();
        if (!api) throw new Error('Actual pane navigation API unavailable');
        await api.setPaneThread(api.activePaneIndex.value ?? 0, 'identical-rendered-thread');
    });
    await expect(messageRow).toBeVisible();
    await expect(messageRow).toContainText('Synthetic rendered origin workspace message');
    await expect(page.getByText('Synthetic rendered target workspace message', { exact: true })).toHaveCount(0);
    await info.attach('synthetic-rendered-chat-scope', { body: 'Actual PageShell/pane navigation, overlapping thread/message IDs, A→B→A; external/model/job requests denied.', contentType: 'text/plain' });
});

for (const outcome of ['success', 'failure'] as const) {
    test(`native tab title metadata rejects former-workspace cache and lookup (${outcome})`, async ({ page }, info) => {
        await open(page);
        await page.route('**/api/openrouter/**', route => route.abort());
        await page.route('**/api/jobs/**', route => route.abort());
        const receipt = await page.evaluate(async mode => {
            const clientPath = '/_nuxt/db/client.ts';
            const metadataPath = '/_nuxt/composables/core/useWorkspaceTabMetadata.ts';
            const client = await import(clientPath);
            const { useWorkspaceTabMetadata } = await import(metadataPath);
            const ids = [`native-title-a-${mode}`, `native-title-b-${mode}`];
            const dbs: any[] = [];
            const tab = (cachedTitle: string) => ({ id: 'identical-native-tab',
                resource: { kind: 'chat', threadId: 'identical-native-thread' },
                cachedTitle, createdAt: 1, lastActivatedAt: 1, ephemeral: false });
            for (const [index, id] of ids.entries()) {
                const db = client.setActiveWorkspaceDb(id); await db.open(); dbs.push(db);
                await db.threads.put({ id: 'identical-native-thread', title: index === 0 ? 'Native A stored' : 'Native B stored',
                    created_at: 1, updated_at: 1, clock: 0, deleted: false });
            }
            client.setActiveWorkspaceDb(ids[0]);
            const app = (document.querySelector('#__nuxt') as any).__vue_app__;
            const scope = new app._instance.scope.constructor(true);
            const metadata = scope.run(() => useWorkspaceTabMetadata());
            const getA = dbs[0].threads.bulkGet.bind(dbs[0].threads);
            const getB = dbs[1].threads.bulkGet.bind(dbs[1].threads);
            let releaseA!: () => void; let releaseB!: () => void;
            const heldA = new Promise<void>(resolve => { releaseA = resolve; });
            const heldB = new Promise<void>(resolve => { releaseB = resolve; });
            let enteredA!: () => void;
            const reachedA = new Promise<void>(resolve => { enteredA = resolve; });
            try {
                await metadata.refresh([tab('A fallback')]);
                const original = metadata.titleFor(tab('A fallback')).title;
                dbs[0].threads.bulkGet = async (keys: string[]) => {
                    const rows = await getA(keys); enteredA(); await heldA; return rows;
                };
                const previous = metadata.refresh([tab('A fallback')]);
                await reachedA;
                dbs[1].threads.bulkGet = async (keys: string[]) => {
                    const rows = await getB(keys); await heldB;
                    if (mode === 'failure') throw new Error('Synthetic native destination failure');
                    return rows;
                };
                client.setActiveWorkspaceDb(ids[1]);
                const immediateCache = metadata.metadata.size;
                const current = metadata.refresh([tab('B fallback')]);
                const settled = current.then(() => 'success', () => 'failure');
                releaseA(); await previous;
                const whileHeld = metadata.titleFor(tab('B fallback')).title;
                releaseB(); const result = await settled;
                const destination = metadata.titleFor(tab('B fallback')).title;
                dbs[0].threads.bulkGet = getA;
                client.setActiveWorkspaceDb(ids[0]);
                await dbs[0].threads.update('identical-native-thread', { title: 'Native A refreshed' });
                await metadata.refresh([tab('A recovery fallback')]);
                return { original, immediateCache, whileHeld, result, destination,
                    recovered: metadata.titleFor(tab('A recovery fallback')).title };
            } finally {
                releaseA(); releaseB(); scope.stop();
                dbs[0].threads.bulkGet = getA; dbs[1].threads.bulkGet = getB;
                client.setActiveWorkspaceDb(null);
                for (let index = 0; index < ids.length; index++) {
                    client.evictWorkspaceDb(ids[index]); await dbs[index].delete();
                }
            }
        }, outcome);
        await info.attach('synthetic-native-title-scope', { body: JSON.stringify(receipt), contentType: 'application/json' });
        expect(receipt).toEqual({ original: 'Native A stored', immediateCache: 0,
            whileHeld: 'B fallback', result: outcome,
            destination: outcome === 'success' ? 'Native B stored' : 'B fallback', recovered: 'Native A refreshed' });
    });
}

for (const action of ['muteThread', 'unmuteThread'] as const) {
    test(`native notification preference ${action} retains its DB during a workspace switch`, async ({ page }, info) => {
        await open(page);
        await page.route('**/api/auth/**', route => route.abort());
        const receipt = await page.evaluate(async operation => {
            const clientPath = '/_nuxt/db/client.ts';
            const notificationsPath = '/_nuxt/composables/notifications/useNotifications.ts';
            const { setActiveWorkspaceDb, createWorkspaceDb, evictWorkspaceDb } = await import(clientPath);
            const { useNotifications } = await import(notificationsPath);
            const vueApp = (document.querySelector('#__nuxt') as any).__vue_app__;
            const nuxt = vueApp.$nuxt;
            const previousSession = nuxt.payload.state['$sauth-session'];
            const previousEnabled = nuxt.$config.public.ssrAuthEnabled;
            const originId = `native-preference-${operation}-origin`;
            const targetId = `native-preference-${operation}-target`;
            const key = 'notification_muted_threads:synthetic-native-user';
            const initial = operation === 'muteThread' ? ['origin-existing'] : ['origin-existing', 'identical-thread'];
            const row = (value: string[]) => ({ id: key, name: key, value: JSON.stringify(value), deleted: false, created_at: 1, updated_at: 1, clock: 1 });
            const originDb = setActiveWorkspaceDb(originId); await originDb.open();
            const targetDb = createWorkspaceDb(targetId); await targetDb.open();
            await originDb.kv.put(row(initial)); await targetDb.kv.put(row(['target-existing']));
            nuxt.$config.public.ssrAuthEnabled = true;
            const selectSession = (id: string) => { nuxt.payload.state['$sauth-session'] = { appAccessAllowed: true,
                session: { authenticated: true, user: { id: 'synthetic-native-user' }, workspace: { id }, role: 'owner' } }; };
            selectSession(originId);
            const scope = new vueApp._instance.scope.constructor(true);
            const state = scope.run(() => nuxt.runWithContext(() => useNotifications()));
            let release!: () => void;
            let enter!: () => void;
            const held = new Promise<void>(resolve => { release = resolve; });
            const entered = new Promise<void>(resolve => { enter = resolve; });
            const originalGet = originDb.kv.get.bind(originDb.kv);
            let pending: Promise<void> | undefined;
            try {
                for (let i = 0; i < 40 && !state.isThreadMuted('origin-existing'); i++) await new Promise(resolve => requestAnimationFrame(resolve));
                if (!state.isThreadMuted('origin-existing')) throw new Error('Synthetic origin preferences did not load');
                originDb.kv.get = (...args: any[]) => {
                    const result = originalGet(...args);
                    if (!originDb.constructor.currentTransaction || args[0] !== key) return result;
                    enter(); return originDb.constructor.waitFor(held).then(() => result);
                };
                pending = state[operation]('identical-thread');
                await entered;
                setActiveWorkspaceDb(targetId); selectSession(targetId);
                await new Promise(resolve => requestAnimationFrame(resolve));
                release(); await pending;
                originDb.kv.get = originalGet;
                return { origin: JSON.parse((await originDb.kv.get(key)).value), target: JSON.parse((await targetDb.kv.get(key)).value) };
            } finally {
                release(); await pending?.catch(() => {}); originDb.kv.get = originalGet; scope.stop();
                nuxt.$config.public.ssrAuthEnabled = previousEnabled;
                nuxt.payload.state['$sauth-session'] = previousSession;
                setActiveWorkspaceDb(null); evictWorkspaceDb(originId); evictWorkspaceDb(targetId);
                await originDb.delete(); await targetDb.delete();
            }
        }, action);
        await info.attach('synthetic-native-preference-receipt', { body: JSON.stringify(receipt), contentType: 'application/json' });
        expect(receipt).toEqual({ origin: action === 'muteThread' ? ['origin-existing', 'identical-thread'] : ['origin-existing'], target: ['target-existing'] });
    });
}

for (const account of ['changed', 'unchanged'] as const) {
    test(`actual SDK job tracking preserves originating account when account is ${account}`, async ({ page }, info) => {
        await open(page);
        await page.route('**/api/openrouter/**', route => route.abort());
        await page.route('**/api/models/**', route => route.abort());
        // Mock every job request before creating a tracker: no server/model execution.
        await page.route('**/api/jobs/**', route => route.fulfill({ status: 200, contentType: 'application/json',
            body: JSON.stringify({ status: 'streaming', content: '', content_length: 0, id: 'synthetic-sdk-job',
                threadId: 'synthetic-thread', messageId: 'synthetic-message', model: 'synthetic/model', chunksReceived: 0, startedAt: 1 }) }));
        await select(page, `sdk-tracker-${account}-origin`);
        const receipt = await page.evaluate(async mode => {
            const hostPath = '/_nuxt/composables/plugins/trusted-host-context.ts';
            const servicesPath = '/_nuxt/composables/plugins/trusted-runtime-services.ts';
            const trackerPath = '/_nuxt/utils/chat/useAi-internal/backgroundJobs.ts';
            const notificationsPath = '/_nuxt/utils/chat/useAi-internal/backgroundJobNotifications.ts';
            const clientPath = '/_nuxt/db/client.ts';
            const { createTrustedHostContext } = await import(hostPath);
            const { createTrustedRuntimeServices } = await import(servicesPath);
            const { ensureBackgroundJobTracker, stopBackgroundJobTracking, backgroundJobTrackers } = await import(trackerPath);
            const { emitBackgroundComplete } = await import(notificationsPath);
            const { getDb, setActiveWorkspaceDb } = await import(clientPath);
            const vueApp = (document.querySelector('#__nuxt') as any).__vue_app__;
            const nuxt = vueApp.$nuxt;
            const stateKey = '$sauth-session';
            const previousSession = nuxt.payload.state[stateKey];
            const originWorkspace = `sdk-tracker-${mode}-origin`;
            nuxt.payload.state[stateKey] = { appAccessAllowed: true, session: { authenticated: true,
                user: { id: 'synthetic-origin-user' }, workspace: { id: originWorkspace }, role: 'owner' } };
            const originDb = getDb();
            const tracker = ensureBackgroundJobTracker({ jobId: 'synthetic-sdk-job', userId: 'synthetic-origin-user',
                workspaceId: originWorkspace, threadId: 'synthetic-thread', messageId: 'synthetic-message',
                originDb, useSse: false });
            stopBackgroundJobTracking(tracker);
            const workspace = mode === 'changed' ? `sdk-tracker-${mode}-target` : originWorkspace;
            if (mode === 'changed') await setActiveWorkspaceDb(workspace).open();
            nuxt.payload.state[stateKey] = { appAccessAllowed: true, session: { authenticated: true,
                user: { id: mode === 'changed' ? 'synthetic-next-user' : 'synthetic-origin-user' }, workspace: { id: workspace }, role: 'owner' } };
            const trusted = nuxt.runWithContext(() => createTrustedHostContext({ pluginId: 'fixture.sdk-tracker', version: '1.0.0',
                workspaceId: workspace, grants: ['jobs.background'], runtimeServices: createTrustedRuntimeServices }));
            try {
                const tracked = await trusted.context.jobs.track({ jobId: 'synthetic-sdk-job', threadId: 'synthetic-thread', messageId: 'synthetic-message' });
                const owner = tracker.userId;
                const db = getDb();
                const before = await db.notifications.count();
                await emitBackgroundComplete(tracker, { id: 'synthetic-sdk-job', status: 'error', threadId: 'synthetic-thread',
                    messageId: 'synthetic-message', model: 'synthetic/model', chunksReceived: 0, startedAt: 1,
                    completedAt: 2, content: '', content_length: 0, error: 'synthetic-origin-private-error' });
                const after = await db.notifications.count();
                return { tracked: tracked.ok, owner, originRetained: tracker.originDb === originDb,
                    notificationDelta: after - before };
            } finally { await trusted.dispose(); stopBackgroundJobTracking(tracker); backgroundJobTrackers.clear(); nuxt.payload.state[stateKey] = previousSession; }
        }, account);
        await info.attach('synthetic-sdk-tracker-receipt', { body: JSON.stringify(receipt), contentType: 'application/json' });
        expect(receipt).toEqual({ tracked: true, owner: 'synthetic-origin-user', originRetained: true,
            notificationDelta: account === 'changed' ? 0 : 1 });
    });
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

for (const outcome of ['success', 'failure'] as const) {
    for (const change of ['changed', 'returned'] as const) {
        test(`actual palette preview preserves recovery after held ${outcome} and workspace ${change}`, async ({ page }, info) => {
            await open(page);
            const origin = `preview-browser-${outcome}-${change}-origin`;
            await select(page, origin);
            await page.evaluate(async () => {
                const palettePath = '/_nuxt/composables/search/useCommandPalette.ts';
                const registryPath = '/_nuxt/core/search/command-palette/registry.ts';
                const typesPath = '/_nuxt/core/search/command-palette/types.ts';
                const { useCommandPalette } = await import(palettePath);
                const { registerPaletteSource } = await import(registryPath);
                const { CORE_PALETTE_CATEGORIES } = await import(typesPath);
                let finish!: (value: unknown) => void;
                let reject!: (error: Error) => void;
                const held = new Promise((resolve, deny) => { finish = resolve; reject = deny; });
                const fixture = { palette: useCommandPalette(), entered: false, cleanup: 0, signal: null as AbortSignal | null,
                    oldUrl: URL.createObjectURL(new Blob(['synthetic-former-preview'])), finish, reject, registration: null as any };
                fixture.registration = registerPaletteSource({ id: 'fixture-preview', label: 'Synthetic previews',
                    category: CORE_PALETTE_CATEGORIES.find((category: { id: string }) => category.id === 'chat'), order: 0,
                    load: async (context: { workspaceGeneration: number }) => [{ sourceId: 'fixture-preview', categoryId: 'chat',
                        key: 'fixture-preview:identical-id', recordId: 'identical-id', title: 'isolation-preview-probe',
                        updatedAt: 1, revision: String(context.workspaceGeneration), content: 'isolation-preview-probe',
                        primaryAction: { id: 'fixture-open', label: 'Synthetic open', target: { kind: 'chat', threadId: 'identical-id', destination: 'active' } } }],
                    hydratePreview: async (_resource: unknown, context: { workspaceGeneration: number; signal: AbortSignal }) => {
                        if (!fixture.entered) { fixture.entered = true; fixture.signal = context.signal; return held; }
                        return { title: `current-preview-generation-${context.workspaceGeneration}`, categoryId: 'chat' };
                    } });
                (window as unknown as { isolationPreview: unknown }).isolationPreview = fixture;
                fixture.palette.query.value = 'chat: isolation-preview-probe';
                fixture.palette.open();
            });
            await page.waitForFunction(() => (window as unknown as { isolationPreview: { entered: boolean } }).isolationPreview.entered);
            await select(page, `preview-browser-${outcome}-${change}-target`);
            await page.waitForFunction(() => (window as unknown as { isolationPreview: { palette: { preview: { value: { title?: string } | null } } } }).isolationPreview.palette.preview.value?.title?.startsWith('current-preview-generation-'));
            if (change === 'returned') {
                const previous = await page.evaluate(() => (window as any).isolationPreview.palette.preview.value.title);
                await select(page, origin);
                await page.waitForFunction(old => { const current = (window as any).isolationPreview.palette.preview.value?.title; return current?.startsWith('current-preview-generation-') && current !== old; }, previous);
            }
            const receipt = await page.evaluate(async result => {
                const fixture = (window as any).isolationPreview;
                const recovered = fixture.palette.preview.value;
                const before = { title: recovered.title, loading: fixture.palette.previewLoading.value };
                if (result === 'failure') fixture.reject(new Error('synthetic-private-former-filename'));
                else fixture.finish({ title: 'synthetic-private-former-filename', categoryId: 'chat', imageObjectUrl: fixture.oldUrl,
                    cleanup: () => { fixture.cleanup++; URL.revokeObjectURL(fixture.oldUrl); } });
                await new Promise(resolve => setTimeout(resolve, 0));
                let oldReadable = true;
                try { await fetch(fixture.oldUrl); } catch { oldReadable = false; }
                const receipt = { before, after: { title: fixture.palette.preview.value?.title, loading: fixture.palette.previewLoading.value },
                    samePreview: recovered === fixture.palette.preview.value, aborted: fixture.signal.aborted,
                    cleanup: fixture.cleanup, oldReadable };
                fixture.palette.close(); fixture.registration.dispose(); URL.revokeObjectURL(fixture.oldUrl);
                return receipt;
            }, outcome);
            await info.attach('synthetic-palette-preview-receipt', { body: JSON.stringify(receipt), contentType: 'application/json' });
            expect(receipt.after).toEqual(receipt.before);
            expect(receipt.samePreview).toBe(true);
            expect(receipt.aborted).toBe(true);
            expect(receipt.cleanup).toBe(outcome === 'success' ? 1 : 0);
            expect(receipt.oldReadable).toBe(outcome === 'failure');
        });
    }
}
