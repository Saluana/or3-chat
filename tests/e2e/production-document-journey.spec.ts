import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const recoveryScripts = new WeakMap<Page, string[]>();

test.describe('local document recovery faults', () => {
    test.describe.configure({ timeout: 90_000 });
    test.beforeEach(async ({ context, page }) => {
        const scripts: string[] = []; recoveryScripts.set(page, scripts);
        page.on('request', request => { if (request.resourceType() === 'script') scripts.push(request.url()); });
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            return url.hostname === '127.0.0.1' || url.protocol === 'blob:' || url.protocol === 'data:'
                ? route.continue() : route.abort('blockedbyclient');
        });
        await page.goto('/__or3-document-journey-test');
        await expect(page.getByRole('textbox', { name: 'Document body' })).toBeVisible({ timeout: 45_000 });
    });

    async function imageRows(page: Page) {
        return page.evaluate(async () => {
            let meta = 0; let blobs = 0; let referenced = false;
            for (const { name } of await indexedDB.databases()) {
                if (!name?.startsWith('or3-db')) continue;
                const db = await new Promise<IDBDatabase>((resolve, reject) => {
                    const open = indexedDB.open(name); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
                });
                if (['file_meta', 'file_blobs', 'posts'].every(table => db.objectStoreNames.contains(table))) {
                    const tx = db.transaction(['file_meta', 'file_blobs', 'posts'], 'readonly');
                    const rows = <T>(table: string) => new Promise<T[]>((resolve, reject) => {
                        const request = tx.objectStore(table).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
                    });
                    const [files, bytes, documents] = await Promise.all([rows<{ hash: string }>('file_meta'), rows('file_blobs'), rows<{ file_hashes?: string }>('posts')]);
                    meta += files.length; blobs += bytes.length;
                    referenced ||= files.some(file => documents.some(document => document.file_hashes?.includes(file.hash)));
                }
                db.close();
            }
            return { meta, blobs, referenced };
        });
    }
    const intakePng = { name: 'synthetic-document-intake.png', mimeType: 'image/png',
        buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=', 'base64') };

    test('a destroyed editor cancels an image intake held before file hashing completes', async ({ page }, info) => {
        await expect(page.getByRole('textbox', { name: 'Document body' })).toHaveAttribute('contenteditable', 'true');
        await page.evaluate(() => {
            const original = crypto.subtle.digest.bind(crypto.subtle);
            let release!: () => void;
            const gate = new Promise<void>(resolve => { release = resolve; });
            const probe = { entered: 0, completed: false, release };
            crypto.subtle.digest = async (...args: Parameters<typeof original>) => {
                if (probe.entered === 0) {
                    probe.entered++; await gate;
                    const result = await original(...args); probe.completed = true; return result;
                }
                return original(...args);
            };
            (window as unknown as { imageIntakeProbe: typeof probe }).imageIntakeProbe = probe;
        });
        await page.locator('input[type="file"][accept="image/*"]').setInputFiles(intakePng);
        await expect.poll(() => page.evaluate(() => (window as unknown as { imageIntakeProbe: { entered: number } }).imageIntakeProbe.entered)).toBe(1);
        await page.evaluate(() => {
            (document.querySelector('[aria-label="Document body"]') as unknown as { editor: { destroy: () => void } }).editor.destroy();
            (window as unknown as { imageIntakeProbe: { release: () => void } }).imageIntakeProbe.release();
        });
        await expect.poll(() => page.evaluate(() => (window as unknown as { imageIntakeProbe: { completed: boolean } }).imageIntakeProbe.completed)).toBe(true);
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        const result = await imageRows(page); expect(result).toEqual({ meta: 0, blobs: 0, referenced: false });
        const path = info.outputPath('destroyed-editor-intake.json');
        await writeFile(path, JSON.stringify({ ...result, boundary: 'actual Chromium mounted editor destroyed during synthetic digest gate', externalRequests: 'denied' }, null, 2));
        await info.attach('destroyed-editor-intake', { path, contentType: 'application/json' });
    });

    test('an image intake quota failure is visible and retry preserves the attachment after reload', async ({ page }, info) => {
        await expect(page.getByRole('textbox', { name: 'Document body' })).toHaveAttribute('contenteditable', 'true');
        await page.evaluate(() => {
            const original = IDBObjectStore.prototype.put;
            IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
                if (this.name === 'file_blobs') throw new DOMException('Synthetic image intake quota', 'QuotaExceededError');
                return original.apply(this, args);
            };
            (window as unknown as { restoreImageIntake: () => void }).restoreImageIntake = () => { IDBObjectStore.prototype.put = original; };
        });
        await page.locator('input[type="file"][accept="image/*"]').setInputFiles(intakePng);
        await expect(page.getByRole('alert')).toContainText('Image could not be added');
        expect(await imageRows(page)).toEqual({ meta: 0, blobs: 0, referenced: false });
        await expect(page.getByRole('textbox', { name: 'Document body' })).toContainText('Initial document text.');
        await page.evaluate(() => (window as unknown as { restoreImageIntake: () => void }).restoreImageIntake());
        await page.locator('input[type="file"][accept="image/*"]').setInputFiles(intakePng);
        await expect(page.locator('.or3-document-image img')).toBeVisible();
        await expect.poll(() => imageRows(page)).toEqual({ meta: 1, blobs: 1, referenced: true });
        await page.reload();
        await expect(page.locator('.or3-document-image img')).toBeVisible({ timeout: 45_000 });
        const path = info.outputPath('image-intake-quota-recovery.json');
        await writeFile(path, JSON.stringify({ ...await imageRows(page), externalRequests: 'denied', reloadPreviewVisible: true }, null, 2));
        await info.attach('image-intake-quota-recovery', { path, contentType: 'application/json' });
    });

    test('a partial image batch retains its committed first image and retries the rejected second image', async ({ page }, info) => {
        await expect(page.getByRole('textbox', { name: 'Document body' })).toHaveAttribute('contenteditable', 'true');
        const second = { ...intakePng, name: 'synthetic-second-image.png',
            buffer: Buffer.concat([intakePng.buffer, Buffer.from('synthetic-second-file')]) };
        await page.evaluate(() => {
            const original = IDBObjectStore.prototype.put;
            let writes = 0;
            IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
                if (this.name === 'file_blobs' && ++writes === 2) {
                    throw new DOMException('Synthetic second image quota', 'QuotaExceededError');
                }
                return original.apply(this, args);
            };
            (window as unknown as { restoreImageBatch: () => void }).restoreImageBatch = () => { IDBObjectStore.prototype.put = original; };
        });
        await page.locator('input[type="file"][accept="image/*"]').setInputFiles([intakePng, second]);
        await expect(page.getByRole('alert')).toContainText('Image could not be added');
        await expect(page.locator('.or3-document-image img')).toHaveCount(1);
        await expect.poll(() => imageRows(page)).toEqual({ meta: 1, blobs: 1, referenced: true });
        await page.evaluate(() => (window as unknown as { restoreImageBatch: () => void }).restoreImageBatch());
        await page.reload();
        await expect(page.locator('.or3-document-image img')).toBeVisible({ timeout: 45_000 });
        expect(await imageRows(page)).toEqual({ meta: 1, blobs: 1, referenced: true });
        await page.locator('input[type="file"][accept="image/*"]').setInputFiles(second);
        await expect(page.locator('.or3-document-image img')).toHaveCount(2);
        await expect.poll(() => imageRows(page)).toEqual({ meta: 2, blobs: 2, referenced: true });
        await page.reload();
        await expect(page.locator('.or3-document-image img')).toHaveCount(2, { timeout: 45_000 });
        const references = await page.evaluate(async () => {
            const results: Array<{ files: number; allReferenced: boolean }> = [];
            for (const { name } of await indexedDB.databases()) {
                if (!name?.startsWith('or3-db')) continue;
                const db = await new Promise<IDBDatabase>((resolve, reject) => {
                    const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
                });
                const tx = db.transaction(['file_meta', 'posts'], 'readonly');
                const rows = <T>(table: string) => new Promise<T[]>((resolve, reject) => {
                    const request = tx.objectStore(table).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
                });
                const [files, documents] = await Promise.all([rows<{ hash: string }>('file_meta'), rows<{ file_hashes?: string }>('posts')]);
                results.push({ files: files.length, allReferenced: files.every(file => documents.some(document => document.file_hashes?.includes(file.hash))) });
                db.close();
            }
            return results;
        });
        expect(references.some(row => row.files === 2 && row.allReferenced)).toBe(true);
        expect(references.every(row => row.allReferenced)).toBe(true);
        const path = info.outputPath('partial-image-batch.json');
        await writeFile(path, JSON.stringify({ ...await imageRows(page), references, externalRequests: 'denied',
            firstImageSurvivedRejectedSecondTransaction: true, explicitSecondRetry: true, reloadImageCount: 2 }, null, 2));
        await info.attach('partial-image-batch', { path, contentType: 'application/json' });
    });

    test('an image committed before a rejected document save stays retryable until its reference is durable', async ({ page }, info) => {
        await expect(page.getByRole('textbox', { name: 'Document body' })).toHaveAttribute('contenteditable', 'true');
        await page.evaluate(() => {
            const put = IDBObjectStore.prototype.put;
            IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
                if (this.name === 'posts') throw new DOMException('Synthetic document reference quota', 'QuotaExceededError');
                return put.apply(this, args);
            };
            (window as unknown as { restoreDocumentReferencePut: () => void }).restoreDocumentReferencePut = () => { IDBObjectStore.prototype.put = put; };
        });
        await page.locator('input[type="file"][accept="image/*"]').setInputFiles(intakePng);
        await expect(page.locator('.or3-document-image img')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Retry document save', exact: true })).toBeVisible();
        expect(await imageRows(page)).toEqual({ meta: 1, blobs: 1, referenced: false });
        const dialogs: string[] = [];
        page.on('dialog', async dialog => { dialogs.push(dialog.type()); await dialog.dismiss(); });
        await page.reload({ timeout: 10_000 }).catch(() => {});
        expect(dialogs).toEqual(['beforeunload']);
        await expect(page.locator('.or3-document-image img')).toBeVisible();
        await page.evaluate(() => (window as unknown as { restoreDocumentReferencePut: () => void }).restoreDocumentReferencePut());
        await page.getByRole('button', { name: 'Retry document save', exact: true }).click();
        await expect.poll(() => imageRows(page)).toEqual({ meta: 1, blobs: 1, referenced: true });
        await expect(page.getByRole('button', { name: 'Retry document save', exact: true })).toBeHidden();
        await page.reload();
        await expect(page.locator('.or3-document-image img')).toBeVisible({ timeout: 45_000 });
        expect(dialogs).toEqual(['beforeunload']);
        const path = info.outputPath('image-document-reference-retry.json');
        await writeFile(path, JSON.stringify({ ...await imageRows(page), dialogs,
            externalRequests: 'denied', savedBlobBeforeRejectedDocumentReference: true, reloadPreviewVisible: true }, null, 2));
        await info.attach('image-document-reference-retry', { path, contentType: 'application/json' });
    });

    for (const boundary of ['node removal', 'workspace switch'] as const) {
        test(`a delayed document image does not create a URL after ${boundary}`, async ({ page }, info) => {
            const clientURL = recoveryScripts.get(page)?.find(url => /\/db\/client\.ts(?:\?|$)/.test(url));
            expect(clientURL).toBeTruthy();
            await page.evaluate(async (url) => {
                const client = await import(url!);
                const db = client.getDb();
                const originalGet = db.file_blobs.get.bind(db.file_blobs);
                const blob = new Blob(['Synthetic delayed image bytes'], { type: 'image/png' });
                let finish!: () => void;
                const delayed = new Promise(resolve => { finish = () => resolve({ hash: 'synthetic-delayed-image', blob }); });
                const probe = { reads: 0, urls: 0, finish, client };
                db.file_blobs.get = (key: unknown) => {
                    if (key === 'synthetic-delayed-image') { probe.reads++; return delayed; }
                    return originalGet(key);
                };
                const create = URL.createObjectURL.bind(URL);
                URL.createObjectURL = (value) => { if (value === blob) probe.urls++; return create(value); };
                (window as unknown as { imageRecoveryProbe: typeof probe }).imageRecoveryProbe = probe;
                const editor = (document.querySelector('[aria-label="Document body"]') as unknown as {
                    editor: { commands: { insertContent: (value: unknown) => void } }
                }).editor;
                editor.commands.insertContent({ type: 'or3Image', attrs: { hash: 'synthetic-delayed-image' } });
            }, clientURL);
            await expect(page.locator('.or3-document-image')).toContainText('Loading image');
            await expect.poll(() => page.evaluate(() => (window as unknown as {
                imageRecoveryProbe: { reads: number }
            }).imageRecoveryProbe.reads)).toBe(1);
            await page.evaluate((boundary) => {
                const probe = (window as unknown as { imageRecoveryProbe: { finish: () => void;
                    client: { setActiveWorkspaceDb: (id: string) => void } } }).imageRecoveryProbe;
                if (boundary === 'workspace switch') probe.client.setActiveWorkspaceDb('synthetic-image-recovery-other');
                else (document.querySelector('[aria-label="Document body"]') as unknown as {
                    editor: { commands: { setContent: (value: unknown) => void } }
                }).editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] });
            }, boundary);
            await expect(page.locator('.or3-document-image')).toHaveCount(0);
            await page.evaluate(() => (window as unknown as { imageRecoveryProbe: { finish: () => void } }).imageRecoveryProbe.finish());
            // Cross two rendering frames so the fulfilled read and node cleanup settle.
            await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
            const result = await page.evaluate(() => {
                const probe = (window as unknown as { imageRecoveryProbe: { reads: number; urls: number } }).imageRecoveryProbe;
                return { reads: probe.reads, urls: probe.urls };
            });
            expect(result).toEqual({ reads: 1, urls: 0 });
            await info.attach('delayed-image-ownership', { body: JSON.stringify({ boundary, ...result,
                evidence: 'actual mounted editor in Chromium; deterministic deferred local blob read; external requests denied' }), contentType: 'application/json' });
        });
    }

    test('a delayed document read cannot replace a newer committed editor buffer', async ({ page }, info) => {
        const scripts = recoveryScripts.get(page) ?? [];
        const clientURL = scripts.find(url => /\/db\/client\.ts(?:\?|$)/.test(url));
        const storeURL = scripts.find(url => /\/useDocumentsStore\.ts(?:\?|$)/.test(url));
        expect(clientURL).toBeTruthy(); expect(storeURL).toBeTruthy();
        await page.evaluate(async ({ clientURL, storeURL }) => {
            const client = await import(clientURL!); const store = await import(storeURL!);
            const db = client.getDb(); const id = localStorage.getItem('or3:e2e:production-document-id')!;
            const get = db.posts.get.bind(db.posts); let armed = true;
            let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
            const probe = { captured: false, settled: false, capturedContent: undefined as unknown, release, read: undefined as unknown,
                record: () => store.useDocumentState(id, db).record?.content };
            db.posts.get = (key: unknown) => {
                const read = get(key);
                if (!armed || key !== id) return read;
                armed = false;
                return read.then(async (row: unknown) => { probe.captured = true; probe.capturedContent = (row as { content?: unknown } | undefined)?.content; await gate; return row; });
            };
            probe.read = store.loadDocument(id, db).finally(() => { probe.settled = true; db.posts.get = get; });
            (window as unknown as { delayedDocumentRead: typeof probe }).delayedDocumentRead = probe;
        }, { clientURL, storeURL });
        await expect.poll(() => page.evaluate(() => (window as unknown as { delayedDocumentRead: { captured: boolean } }).delayedDocumentRead.captured)).toBe(true);
        expect(await page.evaluate(() => (window as unknown as { delayedDocumentRead: { settled: boolean } }).delayedDocumentRead.settled)).toBe(false);
        const body = page.getByRole('textbox', { name: 'Document body' }); const marker = 'Newer committed document survives a late read';
        await body.fill(marker);
        await expect(page.getByTestId('persisted-document-body')).toHaveText(marker);
        expect(await page.evaluate(() => (window as unknown as { delayedDocumentRead: { settled: boolean } }).delayedDocumentRead.settled)).toBe(false);
        const result = await page.evaluate(async () => {
            const probe = (window as unknown as { delayedDocumentRead: { release: () => void; read: Promise<unknown>; capturedContent: unknown; record: () => unknown } }).delayedDocumentRead;
            probe.release(); await probe.read; return { record: probe.record(), captured: probe.capturedContent };
        });
        expect(JSON.stringify(result.captured)).toContain('Initial document text.');
        const record = result.record; expect(JSON.stringify(record)).toContain(marker);
        await expect(body).toHaveText(marker);
        await body.press('End'); await page.keyboard.type(' with a subsequent edit');
        await expect(page.getByTestId('persisted-document-body')).toHaveText(marker + ' with a subsequent edit');
        await page.reload();
        await expect(body).toHaveText(marker + ' with a subsequent edit', { timeout: 45_000 });
        const path = info.outputPath('late-document-read.json');
        await writeFile(path, JSON.stringify({ capturedReadContent: result.captured, recordAfterLateRead: record, restoredText: await body.innerText(),
            externalRequests: 'denied', fault: 'deferred native IndexedDB read receipt through the production store' }, null, 2));
        await info.attach('late-document-read', { path, contentType: 'application/json' });
    });

    test('refresh before the capture debounce protects the unsaved document', async ({ page }, info) => {
        const body = page.getByRole('textbox', { name: 'Document body' });
        await body.click();
        await body.fill('Immediate refresh recovery marker');
        const dialogs: string[] = [];
        page.on('dialog', async dialog => { dialogs.push(dialog.type()); await dialog.dismiss(); });
        // Reload is refused until the captured edit is actually durable.
        await page.reload({ timeout: 10_000 }).catch(() => {});
        expect(dialogs).toEqual(['beforeunload']);
        await expect(body).toContainText('Immediate refresh recovery marker', { timeout: 30_000 });
        await expect(page.getByTestId('persisted-document-body')).toHaveText('Immediate refresh recovery marker');
        await page.reload();
        await expect(body).toContainText('Immediate refresh recovery marker', { timeout: 30_000 });
        await info.attach('refresh-recovery', { body: JSON.stringify({ dialogs, recovered: await body.textContent() }), contentType: 'application/json' });
    });

    for (const fault of ['quota', 'abort'] as const) test(`${fault} failure is visible and explicit retry saves the retained edit`, async ({ page }, info) => {
        await page.evaluate((fault) => {
            const original = IDBObjectStore.prototype.put;
            IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
                if (this.name !== 'posts') return original.apply(this, args);
                if (fault === 'quota') throw new DOMException('Synthetic storage full', 'QuotaExceededError');
                const request = original.apply(this, args);
                this.transaction.abort();
                return request;
            };
            (window as unknown as { restoreRecoveryPut: () => void }).restoreRecoveryPut = () => { IDBObjectStore.prototype.put = original; };
        }, fault);
        const body = page.getByRole('textbox', { name: 'Document body' });
        await body.fill('Quota retry recovery marker');
        await expect(page.getByRole('button', { name: 'Retry document save', exact: true })).toBeVisible();
        await expect(page.getByText('Your changes have not been saved locally.', { exact: true })).toBeVisible();
        await expect(body).toContainText('Quota retry recovery marker', { timeout: 30_000 });
        await expect(page.getByTestId('persisted-document-body')).toHaveText('Initial document text.');
        await page.screenshot({ path: info.outputPath('quota-save-visible.png') });
        await page.evaluate(() => (window as unknown as { restoreRecoveryPut: () => void }).restoreRecoveryPut());
        await page.getByRole('button', { name: 'Retry document save', exact: true }).click();
        await expect(page.getByTestId('persisted-document-body')).toHaveText('Quota retry recovery marker');
        await expect(page.getByRole('button', { name: 'Retry document save', exact: true })).toBeHidden();
        await page.reload();
        await expect(body).toContainText('Quota retry recovery marker', { timeout: 30_000 });
    });

    test('offline editing persists locally through reconnect and reload', async ({ context, page }, info) => {
        const body = page.getByRole('textbox', { name: 'Document body' });
        await context.setOffline(true);
        await body.fill('Offline document recovery marker');
        await expect(page.getByTestId('persisted-document-body')).toHaveText('Offline document recovery marker');
        await context.setOffline(false);
        await page.reload();
        await expect(body).toContainText('Offline document recovery marker', { timeout: 30_000 });
        await info.attach('offline-local-durability', { body: JSON.stringify({ recovered: await body.textContent(), cloudSyncEnabled: false }), contentType: 'application/json' });
    });

    test('two tabs refuse a stale save and preserve both the committed row and unsaved buffer', async ({ context, page }, info) => {
        const other = await context.newPage();
        try {
            await other.goto('/__or3-document-journey-test');
            const otherBody = other.getByRole('textbox', { name: 'Document body' });
            await expect(otherBody).toContainText('Initial document text.', { timeout: 30_000 });
            await page.getByRole('textbox', { name: 'Document body' }).fill('First tab committed content');
            await expect(page.getByTestId('persisted-document-body')).toHaveText('First tab committed content');
            await otherBody.fill('Second tab unsaved content');
            await expect(other.getByRole('button', { name: 'Retry document save', exact: true })).toBeVisible();
            await expect(other.getByTestId('persisted-document-body')).toHaveText('First tab committed content');
            await expect(otherBody).toContainText('Second tab unsaved content');
            await other.getByRole('button', { name: 'Retry document save', exact: true }).click();
            await expect(other.getByText('Your changes have not been saved locally.', { exact: true })).toBeVisible();
            await expect(page.getByTestId('persisted-document-body')).toHaveText('First tab committed content');
            await info.attach('two-tab-conflict', { body: JSON.stringify({ saved: await other.getByTestId('persisted-document-body').textContent(), unsaved: await otherBody.textContent() }), contentType: 'application/json' });
        } finally { await other.close(); }
    });
});

test.beforeEach(async ({ page }) => {
    await page.route('**/api/__or3-e2e/models*', route => route.fulfill({ json: { data: [], links: { next: null }, total_count: 0 } }));
});

test('document quick action edits persist after leaving the fields and reloading', async ({ page }, info) => {
    await page.goto('/__or3-document-journey-test');
    await expect(page.getByRole('textbox', { name: 'Document body' })).toBeVisible();
    await page.getByRole('button', { name: 'Document AI settings', exact: true }).click();
    await page.getByRole('button', { name: 'Add action', exact: true }).click();
    await page.getByRole('textbox', { name: 'Quick action label', exact: true }).fill('Journey quick action');
    await page.getByRole('textbox', { name: 'Quick action label', exact: true }).press('Tab');
    await page.getByRole('textbox', { name: 'Quick action prompt', exact: true }).fill('Preserve the scratch section and summarize it.');
    await page.getByRole('textbox', { name: 'Quick action prompt', exact: true }).press('Tab');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Edit Journey quick action', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Document body' })).toBeVisible();
    await page.getByRole('button', { name: 'Document AI settings', exact: true }).click();
    await page.getByRole('button', { name: 'Edit Journey quick action', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Quick action label', exact: true })).toHaveValue('Journey quick action');
    await expect(page.getByRole('textbox', { name: 'Quick action prompt', exact: true })).toHaveValue('Preserve the scratch section and summarize it.');
    const path = info.outputPath('quick-action-reloaded.png');
    await page.screenshot({ path, animations: 'disabled' });
    await info.attach('quick-action-reloaded', { path, contentType: 'image/png' });
});

test('outline navigation positions headings below the toolbar in the document viewport', async ({ page }, info) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/__or3-document-journey-test');
    const body = page.getByRole('textbox', { name: 'Document body' });
    await expect(body).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.editor-toolbar')).not.toHaveClass(/editor-toolbar--compact/);
    await body.click();
    await body.press('ControlOrMeta+A');
    await body.evaluate((element) => {
        const clipboardData = new DataTransfer();
        const paragraphs = '<p>Section content with enough space to exercise document scrolling.</p>'.repeat(16);
        clipboardData.setData('text/html', `<h1>Opening section</h1>${paragraphs}<h2>Middle section</h2>${paragraphs}<h2>Final section</h2>${paragraphs}`);
        element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    });
    await expect(page.getByTestId('persisted-document-body')).toContainText('Final section');

    for (const size of [{ width: 1440, height: 900 }, { width: 800, height: 600 }]) {
        await page.setViewportSize(size);
        if (size.width === 800) {
            await expect(page.getByRole('tree', { name: 'Document heading hierarchy' })).toBeHidden();
        }
        for (const title of ['Final section', 'Opening section', 'Middle section']) {
            if (!await page.getByRole('tree', { name: 'Document heading hierarchy' }).isVisible()) {
                await page.getByRole('button', { name: 'Outline & info', exact: true }).click();
            }
            await page.getByRole('treeitem').filter({ hasText: title }).click();
            const heading = body.getByRole('heading', { name: title, exact: true });
            await expect.poll(() => heading.evaluate(async element => {
                const viewport = element.closest('.editor-scroll')!;
                // Check the settled position, rather than a transient frame
                // while smooth scrolling or inspector reflow passes the target.
                for (let frame = 0; frame < 12; frame++) {
                    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
                    const offset = element.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
                    if (Math.abs(offset - 24) > 1) return false;
                }
                return true;
            }), { message: `${title} stays aligned at ${size.width}x${size.height}` }).toBe(true);
            await expect(body).toBeFocused();
        }
        const path = info.outputPath(`outline-navigation-${size.width}x${size.height}.png`);
        await page.screenshot({ path, animations: 'disabled' });
        await info.attach('outline-navigation', { path, contentType: 'image/png' });
    }
});

test.skip(
    process.env.OR3_PRODUCTION_JOURNEY_TEST_HARNESS !== 'true',
    'Production journeys require OR3_PRODUCTION_JOURNEY_TEST_HARNESS=true'
);

for (const theme of ['blank', 'retro', 'cyberpunk']) {
    test(`${theme} document dialogs retain focus and fit short viewports`, async ({ page }, info) => {
        test.setTimeout(90_000);
        await page.context().addCookies([{ name: 'or3_active_theme', value: theme, domain: '127.0.0.1', path: '/' }]);
        await page.addInitScript((value) => { localStorage.setItem('activeTheme', value); localStorage.setItem('theme', 'light'); }, theme);
        await page.route(/(?:openrouter\.ai\/|\/api\/openrouter\/)/, route => route.request().method() === 'POST' ? route.abort() : route.continue());
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/__or3-document-journey-test');
        await expect(page.getByRole('textbox', { name: 'Document body' })).toBeVisible({ timeout: 30_000 });
        const settings = page.getByRole('button', { name: 'Document AI settings', exact: true });
        await settings.focus();
        await settings.click();
        const dialog = page.getByRole('dialog', { name: 'Document AI settings', exact: true });
        await expect(dialog).toBeVisible();
        for (const size of [{ width: 320, height: 568 }, { width: 390, height: 320 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
            await page.setViewportSize(size);
            const path = info.outputPath(`modal-${theme}-light-${size.width}x${size.height}-document-settings.png`);
            await page.screenshot({ path, animations: 'disabled', scale: 'css' });
            await info.attach('document-settings', { path, contentType: 'image/png' });
            await expect.poll(() => dialog.evaluate(e => {
                const r = e.getBoundingClientRect();
                return r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && e.scrollWidth <= e.clientWidth + 1;
            })).toBe(true);
            await expect(dialog.getByRole('button', { name: 'Close Document AI settings', exact: true })).toBeInViewport({ ratio: 1 });
        }
        await page.setViewportSize({ width: 390, height: 320 });
        for (let i = 0; i < 24; i++) {
            await page.keyboard.press('Tab');
            await expect.poll(() => dialog.evaluate(e => {
                const active = document.activeElement;
                if (!active || !e.contains(active)) return false;
                const r = active.getBoundingClientRect();
                return r.top >= -1 && r.bottom <= innerHeight + 1;
            })).toBe(true);
        }
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(settings).toBeFocused();
        await expect(page.getByRole('textbox', { name: 'Document body' })).toContainText('Initial document text.');
    });
}

test('autosaves the production document editor and restores title and content after reload', async ({
    page,
}) => {
    const inferenceRequests: string[] = [];
    await page.route('**/api/openrouter/stream', route => { inferenceRequests.push(route.request().url()); return route.fulfill({status:401, json:{error:'Sign in required'}}); });
    await page.goto('/__or3-document-journey-test');
    await expect(page.getByTestId('production-document-journey')).toBeVisible({
        timeout: 30_000,
    });

    const title = page.getByRole('textbox', { name: 'Document title' });
    const body = page.getByRole('textbox', { name: 'Document body' });
    await expect(title).toHaveValue('Journey draft', { timeout: 30_000 });
    await expect(body).toContainText('Initial document text.');

    await title.click();
    await title.press('ControlOrMeta+A');
    await title.pressSequentially('Persisted journey title');
    await title.press('Tab');
    await expect(page.getByTestId('persisted-document-title')).toHaveText(
        'Persisted journey title',
        { timeout: 10_000 }
    );
    await body.click();
    await body.press('ControlOrMeta+A');
    await body.pressSequentially('Autosaved browser document body.');
    await expect(page.getByTestId('persisted-document-body')).toHaveText(
        'Autosaved browser document body.',
        { timeout: 10_000 }
    );
    // Guest typing must stay local after the autocomplete debounce settles.
    await page.waitForTimeout(1600);
    expect(inferenceRequests).toEqual([]);
    await page.reload();
    await expect(
        page.getByRole('textbox', { name: 'Document title' })
    ).toHaveValue('Persisted journey title', { timeout: 30_000 });
    await expect(
        page.getByRole('textbox', { name: 'Document body' })
    ).toContainText('Autosaved browser document body.');
});
