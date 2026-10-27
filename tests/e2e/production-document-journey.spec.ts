import { expect, test, type Page, type Locator } from '@playwright/test';
import type { Editor } from '@tiptap/core';
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

    test('image selection hides text formatting while text selection still shows it', async ({ page }, info) => {
        const body = page.getByRole('textbox', { name: 'Document body' });
        await body.fill('Selectable text');
        await page.locator('input[type="file"][accept="image/*"]').setInputFiles(intakePng);
        // Intake finishes asynchronously and moves the caret when it inserts.
        await expect(page.locator('.or3-document-image img')).toBeVisible();
        const paragraph = body.locator('p').filter({ hasText: 'Selectable text' });
        await paragraph.dblclick({ position: { x: 20, y: 10 } });
        await expect(page.locator('.selection-menu')).toBeVisible();
        await page.locator('.or3-document-image img').click();
        await expect(page.getByRole('textbox', { name: 'Image alt text' })).toBeVisible();
        await expect(page.locator('.selection-menu')).toBeHidden();
        await paragraph.dblclick({ position: { x: 20, y: 10 } });
        await expect(page.locator('.selection-menu')).toBeVisible();
        await page.screenshot({ path: info.outputPath('text-selection-menu.png') });
    });

    test('image controls identify resizing and preserve alignment after reload', async ({ page }, info) => {
        await page.locator('input[type="file"][accept="image/*"]').setInputFiles(intakePng);
        const image = page.locator('.or3-document-image');
        await image.locator('img').click();
        await expect(image.locator('.image-size')).toContainText('Resize');
        const slider = page.getByRole('slider', { name: 'Image width' });
        await slider.focus();
        await slider.press('Home');
        for (let i = 0; i < 5; i++) await slider.press('ArrowRight');
        await expect(slider).toHaveAttribute('aria-valuenow', '50');
        for (const align of ['left', 'center', 'right']) {
            const button = page.getByRole('button', { name: `Align image ${align}`, exact: true });
            await button.click();
            await expect(button).toHaveAttribute('aria-pressed', 'true');
            await expect(image).toHaveAttribute('data-align', align);
            await expect.poll(() => image.evaluate((element, expected) => {
                const outer = element.getBoundingClientRect();
                const frame = element.querySelector('.image-frame')!.getBoundingClientRect();
                const left = frame.left - outer.left;
                const right = outer.right - frame.right;
                return expected === 'left' ? Math.abs(left) < 1 : expected === 'right'
                    ? Math.abs(right) < 1 : Math.abs(left - right) < 1;
            }, align)).toBe(true);
        }
        // Observe the canonical row, rather than treating the live editor as a save receipt.
        const id = (await page.getByTestId('document-journey-id').textContent())!.trim();
        await expect.poll(() => page.evaluate(async documentId => {
            for (const { name } of await indexedDB.databases()) {
                if (!name?.startsWith('or3-db')) continue;
                const db = await new Promise<IDBDatabase>((resolve, reject) => {
                    const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
                });
                try {
                    const row = await new Promise<{ content: string } | undefined>((resolve, reject) => {
                        const request = db.transaction('posts').objectStore('posts').get(documentId);
                        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
                    });
                    if (row) {
                        const attrs = JSON.parse(row.content).content.find((node: { type: string }) => node.type === 'or3Image')?.attrs;
                        return { align: attrs?.align, width: attrs?.width };
                    }
                } finally { db.close(); }
            }
            return null;
        }, id)).toEqual({ align: 'right', width: 50 });
        await page.reload();
        await image.locator('img').click();
        await expect(image).toHaveAttribute('data-align', 'right');
        await expect(page.getByRole('button', { name: 'Align image right', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByRole('slider', { name: 'Image width' })).toHaveAttribute('aria-valuenow', '50');
        await page.setViewportSize({ width: 390, height: 844 });
        await expect.poll(() => image.locator('.image-controls').evaluate(element => {
            const bounds = element.getBoundingClientRect();
            return bounds.left >= 0 && bounds.right <= innerWidth;
        })).toBe(true);
        await page.screenshot({ path: info.outputPath('image-controls-mobile.png') });
    });

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

    for (const control of ['inline', 'dock', 'all'] as const) test(`AI review ${control} acceptance saves a real worker checkpoint and keeps rich formatting`, async ({ page }, info) => {
        const errors: string[] = [];
        const workers: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('worker', worker => workers.push(worker.url()));
        const scripts = recoveryScripts.get(page) ?? [];
        const sessionsURL = scripts.find(url => /\/useDocumentEditorSessions\.ts(?:\?|$)/.test(url));
        const revisionsURL = scripts.find(url => /\/document-revisions\.ts(?:\?|$)/.test(url));
        expect(sessionsURL).toBeTruthy(); expect(revisionsURL).toBeTruthy();
        const id = (await page.getByTestId('document-journey-id').textContent())!.trim();
        const body = page.getByRole('textbox', { name: 'Document body' });
        await body.evaluate(async (element, { sessionsURL, id }) => {
            const { getActiveDocumentEditorSession } = await import(sessionsURL!);
            const editor = (element as HTMLElement & { editor: Editor }).editor;
            editor.commands.setContent('<h2>Original <em>heading</em></h2><p>Unchanged body</p>');
            editor.commands.setTextSelection(1);
            const session = getActiveDocumentEditorSession(id)!;
            await session.ensureLocalDurability();
            const requestId = 'worker-checkpoint-review';
            const { snapshotId } = JSON.parse(session.getChatContext!(requestId));
            session.executeChatTool!('propose_edits', JSON.stringify({ documentId: id, snapshotId, operations: [{
                kind: 'replace_block', ref: 'b1', content: [
                    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Revised heading' }] },
                    { type: 'paragraph', content: [{ type: 'text', text: 'Bold words', marks: [{ type: 'bold' }] }, { type: 'text', text: ' and plain words.' }] },
                ],
            }] }), requestId);
        }, { sessionsURL, id });
        await expect(page.locator('.is-before .document-ai-hunk-pane-text h2 em')).toHaveText('heading');
        const after = page.locator('.is-after .document-ai-hunk-pane-text');
        await expect(after.locator('h2')).toHaveText('Revised heading');
        await expect(after.locator('p strong')).toHaveText('Bold words');
        expect(await after.evaluate(element => {
            const heading = getComputedStyle(element.querySelector('h2')!);
            const paragraph = getComputedStyle(element.querySelector('p')!);
            const strong = getComputedStyle(element.querySelector('strong')!);
            return parseFloat(heading.fontSize) > parseFloat(paragraph.fontSize)
                && Number(strong.fontWeight) > Number(paragraph.fontWeight);
        })).toBe(true);
        await page.screenshot({ path: info.outputPath('formatted-review.png'), animations: 'disabled' });
        if (control === 'dock') {
            // A rejected checkpoint must leave the proposal retryable without
            // mutating the body or leaking the button handler's rejection.
            await page.evaluate(() => {
                const original = Worker.prototype.postMessage;
                Worker.prototype.postMessage = function (...args: Parameters<typeof original>) {
                    if (args[0]?.kind === 'encode') {
                        Worker.prototype.postMessage = original;
                        throw new DOMException('Synthetic checkpoint transport failure', 'DataCloneError');
                    }
                    return original.apply(this, args);
                };
            });
            await page.locator('.review-accept').click();
            await expect(page.locator('.document-ai-composer .error-message')).toContainText('Synthetic checkpoint transport failure');
            await expect(page.getByTestId('persisted-document-body')).toHaveText('Original headingUnchanged body');
            await expect(page.locator('.review-bar')).toBeVisible();
        }
        await page.locator(control === 'inline' ? '.document-ai-hunk-accept' : control === 'dock' ? '.review-accept' : '.review-accept-all').click();
        await expect(page.locator('.review-bar')).toBeHidden();
        await expect(page.locator('.document-ai-composer .error-message')).toBeHidden();
        await expect(page.getByTestId('persisted-document-body')).toHaveText('Revised headingBold words and plain words.Unchanged body');
        const checkpoint = await page.evaluate(async ({ revisionsURL, id }) => {
            const { listCompleteDocumentRevisions } = await import(revisionsURL!);
            const revisions = await listCompleteDocumentRevisions(id);
            return revisions.find((revision: { manifest: { source: string } }) => revision.manifest.source === 'ai')?.snapshot.content;
        }, { revisionsURL, id });
        expect(checkpoint?.content[0]).toMatchObject({ type: 'heading', attrs: { level: 2 }, content: [
            { type: 'text', text: 'Original ' }, { type: 'text', text: 'heading', marks: [{ type: 'italic' }] },
        ] });
        expect(workers.some(url => url.includes('document-revision.worker'))).toBe(true);
        expect(errors).toEqual([]);
        await page.reload();
        await expect(body.locator('h2')).toHaveText('Revised heading', { timeout: 45_000 });
        await expect(body.locator('p strong')).toHaveText('Bold words');
    });

    test('inline AI review accepts Enter and Space once per activation in a locked editor', async ({ page }, info) => {
        const scripts = recoveryScripts.get(page) ?? [];
        const operationsURL = scripts.find(url => /\/document-ai-operations\.ts(?:\?|$)/.test(url));
        const hunksURL = scripts.find(url => /\/document-ai-hunks\.ts(?:\?|$)/.test(url));
        expect(operationsURL).toBeTruthy(); expect(hunksURL).toBeTruthy();
        await page.getByRole('textbox', { name: 'Document body' }).evaluate(async (element, { operationsURL, hunksURL }) => {
            const { freezeDocumentForAi } = await import(operationsURL!);
            const { createDocumentAiHunks } = await import(hunksURL!);
            const editor = (element as HTMLElement & { editor: Editor }).editor;
            const snapshot = freezeDocumentForAi(editor);
            const hunks = createDocumentAiHunks([{ kind: 'insert_end', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Keyboard review evidence' }] }] }], snapshot);
            const receipt = { activations: 0 };
            (window as unknown as { keyboardReviewReceipt: typeof receipt }).keyboardReviewReceipt = receipt;
            editor.commands.setDocumentAiHunkHandlers({ onAcceptHunk: () => { receipt.activations++; } });
            editor.commands.setDocumentAiHunks({ snapshot, hunks });
            editor.setEditable(false, false);
        }, { operationsURL, hunksURL });
        const button = page.locator('.document-ai-hunk-accept');
        await button.focus();
        await page.keyboard.press('Enter');
        await expect.poll(() => page.evaluate(() => (window as unknown as { keyboardReviewReceipt: { activations: number } }).keyboardReviewReceipt.activations)).toBe(1);
        await button.focus();
        await page.keyboard.press('Space');
        await expect.poll(() => page.evaluate(() => (window as unknown as { keyboardReviewReceipt: { activations: number } }).keyboardReviewReceipt.activations)).toBe(2);
        await info.attach('keyboard-review', { body: JSON.stringify({ keys: ['Enter', 'Space'], activations: 2 }), contentType: 'application/json' });
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

    test('document AI keeps an interrupted prompt, retries online, and accepts existing edits offline', async ({ context, page }, info) => {
        const body = page.getByRole('textbox', { name: 'Document body' });
        const prompt = page.getByRole('textbox', { name: 'Document AI prompt' });
        const send = page.getByRole('button', { name: 'Send to document AI', exact: true });
        const keyURL = recoveryScripts.get(page)?.find(url => /\/useUserApiKey\.ts(?:\?|$)/.test(url));
        expect(keyURL).toBeTruthy();
        await page.evaluate(async keyURL => {
            const { useUserApiKey } = await import(keyURL!);
            useUserApiKey().setKey('synthetic-document-ai-offline-key');
        }, keyURL);
        const offlineTokenizerRequests: string[] = [];
        context.on('request', request => {
            if (/gpt-tokenizer/.test(request.url())) offlineTokenizerRequests.push(request.url());
        });
        let requests = 0;
        let releaseFirst!: () => void;
        const firstResponse = new Promise<void>(resolve => { releaseFirst = resolve; });
        const sse = (delta: unknown, finishReason = 'stop') => `data: ${JSON.stringify({ choices: [{ delta, finish_reason: finishReason }] })}\n\ndata: [DONE]\n\n`;
        await page.route('**/api/openrouter/stream', async route => {
            const attempt = ++requests;
            if (attempt === 1) await firstResponse;
            await route.fulfill({ status: 200, contentType: 'text/event-stream', body: attempt === 2
                ? sse({ tool_calls: [{ index: 0, id: 'offline-retry-edit', type: 'function', function: {
                    name: 'propose_edits', arguments: JSON.stringify({ operations: [{ kind: 'insert_end', content: [
                        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Recovered AI edit' }] },
                    ] }] }),
                } }] }, 'tool_calls')
                : sse({ content: 'Finished.' }),
            }).catch(() => {}); // The deliberately interrupted fetch may already be gone.
        });
        try {
            // The panel is lazy-loaded; dev has no service worker to serve its chunk offline.
            await expect(prompt).toBeVisible();
            await context.setOffline(true);
            await expect(page.locator('.offline-message')).toContainText("You're offline");
            await page.locator('input[accept="image/*,application/pdf"]').setInputFiles(intakePng);
            await expect(page.locator('.attachment-name')).toHaveText(intakePng.name);
            await prompt.fill('Add a heading after the existing document.');
            await expect(send).toBeDisabled();
            await prompt.press('Enter');
            await page.waitForTimeout(600);
            expect(requests).toBe(0);
            expect(offlineTokenizerRequests).toEqual([]);
            await context.setOffline(false);
            await expect(send).toBeEnabled();
            await send.click();
            await expect.poll(() => requests).toBe(1);
            await expect(body).toHaveAttribute('contenteditable', 'false');
            await context.setOffline(true);
            await expect(page.getByRole('button', { name: 'Stop AI', exact: true })).toBeHidden();
            await expect(body).toHaveAttribute('contenteditable', 'true');
            await expect(page.locator('.document-ai-composer .error-message')).toContainText('connection was lost');
            await expect(prompt).toHaveText('Add a heading after the existing document.');
            await expect(page.locator('.attachment-name')).toHaveText(intakePng.name);
            releaseFirst();
            await page.screenshot({ path: info.outputPath('interrupted-ai-prompt.png') });
            await context.setOffline(false);
            await expect(send).toBeEnabled();
            await page.waitForTimeout(900);
            expect(requests).toBe(1); // Reconnect never replays a request automatically.
            await send.click();
            await expect(page.locator('.review-bar')).toBeVisible();
            await expect(page.locator('.is-after .document-ai-hunk-pane-text h2')).toHaveText('Recovered AI edit');
            expect(requests).toBe(3); // Tool proposal, then the final assistant turn.
            await expect(page.locator('.document-ai-composer .error-message')).toBeHidden();
            await context.setOffline(true);
            await expect(page.locator('.offline-message')).toBeVisible();
            await page.locator('.review-accept-all').click();
            await expect(page.locator('.review-bar')).toBeHidden();
            await expect(page.getByTestId('persisted-document-body')).toHaveText('Initial document text.Recovered AI edit');
            expect(requests).toBe(3);
            await context.setOffline(false);
            await page.reload();
            await expect(body.locator('h2')).toHaveText('Recovered AI edit', { timeout: 45_000 });
            await info.attach('document-ai-connectivity', { body: JSON.stringify({ offlineRequests: 0, interruptedRequests: 1,
                retryRequests: 2, autoReplay: false, localAcceptWhileOffline: true, survivedReload: true, paidRequests: 0 }), contentType: 'application/json' });
        } finally {
            releaseFirst();
            await context.setOffline(false);
        }
    });

    test('offline editing persists locally through reconnect and reload', async ({ context, page }, info) => {
        const body = page.getByRole('textbox', { name: 'Document body' });
        const scripts = recoveryScripts.get(page) ?? [];
        const keyURL = scripts.find(url => /\/useUserApiKey\.ts(?:\?|$)/.test(url));
        expect(keyURL).toBeTruthy();
        // An in-memory synthetic key makes inference eligible without writing
        // credentials. Every inference response below is local and scripted.
        await page.evaluate(async keyURL => {
            const { useUserApiKey } = await import(keyURL!);
            useUserApiKey().setKey('synthetic-offline-journey-key');
        }, keyURL);
        const inferenceRequests: string[] = [];
        const errors: string[] = [];
        page.on('request', request => {
            if (/\/api\/openrouter\/stream|\/chat\/completions/.test(request.url())) inferenceRequests.push(request.url());
        });
        page.on('console', message => {
            if (message.type() === 'error' && message.text().includes('API call failed')) errors.push(message.text());
        });
        await page.route('**/api/openrouter/stream', route => route.fulfill({
            status: 200, contentType: 'text/event-stream',
            body: 'data: {"choices":[{"delta":{"content":"<next_line> restored suggestion</next_line>"}}]}\n\ndata: [DONE]\n\n',
        }));
        await context.setOffline(true);
        await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
        await body.fill('Offline document recovery marker');
        await expect(page.getByTestId('persisted-document-body')).toHaveText('Offline document recovery marker');
        await page.waitForTimeout(900); // Observe beyond the autocomplete debounce.
        expect(inferenceRequests).toEqual([]);
        expect(errors).toEqual([]);
        await context.setOffline(false);
        await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);
        await body.press('End');
        await body.pressSequentially(' online');
        await expect(body.locator('.autocomplete-suggestion')).toContainText('restored suggestion');
        expect(inferenceRequests).toHaveLength(1);
        expect(inferenceRequests[0]).toContain('/api/openrouter/stream');
        await expect(page.getByTestId('persisted-document-body')).toHaveText('Offline document recovery marker online');
        await page.reload();
        await expect(body).toContainText('Offline document recovery marker online', { timeout: 30_000 });
        await info.attach('offline-local-durability', { body: JSON.stringify({ recovered: await body.textContent(), cloudSyncEnabled: false,
            offlineInferenceRequests: 0, reconnectedInferenceRequests: inferenceRequests.length, paidRequests: 0, autocompleteErrors: errors }), contentType: 'application/json' });
    });

    test('two tabs refuse a stale save and preserve both the committed row and unsaved buffer', async ({ context, page }, info) => {
        const other = await context.newPage();
        try {
            await other.goto('/__or3-document-journey-test');
            const otherBody = other.getByRole('textbox', { name: 'Document body' });
            await expect(otherBody).toContainText('Initial document text.', { timeout: 30_000 });
            // Keep the second tab dirty before the first commits. A clean tab
            // legitimately refreshes its baseline from IndexedDB notifications.
            await other.evaluate(() => {
                const original = IDBObjectStore.prototype.put;
                IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
                    if (this.name === 'posts') throw new DOMException('Synthetic pending draft', 'QuotaExceededError');
                    return original.apply(this, args);
                };
                (window as unknown as { restoreRecoveryPut: () => void }).restoreRecoveryPut = () => { IDBObjectStore.prototype.put = original; };
            });
            await otherBody.fill('Second tab unsaved content');
            await expect(other.getByRole('button', { name: 'Retry document save', exact: true })).toBeVisible();
            await page.getByRole('textbox', { name: 'Document body' }).fill('First tab committed content');
            await expect(page.getByTestId('persisted-document-body')).toHaveText('First tab committed content');
            await other.evaluate(() => (window as unknown as { restoreRecoveryPut: () => void }).restoreRecoveryPut());
            await expect(other.getByTestId('persisted-document-body')).toHaveText('First tab committed content');
            await expect(otherBody).toContainText('Second tab unsaved content');
            await other.getByRole('button', { name: 'Retry document save', exact: true }).click();
            await expect(other.getByText('Your changes have not been saved locally.', { exact: true })).toBeVisible();
            await expect(page.getByTestId('persisted-document-body')).toHaveText('First tab committed content');
            await other.getByRole('button', { name: 'Save local copy and reload', exact: true }).click();
            await expect(otherBody).toContainText('First tab committed content');
            await expect(other.getByText(/Your local edits were saved as/)).toBeVisible();
            await expect(other.getByRole('button', { name: 'Retry document save', exact: true })).toBeHidden();
            await info.attach('two-tab-conflict', { body: JSON.stringify({ saved: await other.getByTestId('persisted-document-body').textContent(), reloaded: await otherBody.textContent() }), contentType: 'application/json' });
        } finally { await other.close(); }
    });
});

test.beforeEach(async ({ page }) => {
    await page.route('**/api/__or3-e2e/models*', route => route.fulfill({ json: { data: [], links: { next: null }, total_count: 0 } }));
});

test('document polish: counts words across paragraphs, hard breaks and table cells', async ({ page }, info) => {
    await page.goto('/__or3-document-journey-test');
    const body = page.getByRole('textbox', { name: 'Document body' });
    await expect(body).toBeVisible();
    await body.fill('hello\nworld');
    await expect(page.locator('.document-byline')).toContainText('2 words');
    await body.evaluate(element => {
        const editor = (element as HTMLElement & { editor: { commands: { setContent: (html: string) => void } } }).editor;
        editor.commands.setContent('<p>one<br>two</p><table><tbody><tr><td><p>three</p></td><td><p>four</p></td></tr></tbody></table>');
    });
    await expect(page.locator('.document-byline')).toContainText('4 words');
    await page.screenshot({ path: info.outputPath('document-word-count.png') });
});

test('document polish: slash insertion dismisses stale caret positions and still inserts headings', async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/__or3-document-journey-test');
    const body = page.getByRole('textbox', { name: 'Document body' });
    await expect(body).toBeVisible();
    await body.fill('/hea');
    await expect(body).toBeFocused();
    await expect(page.getByRole('listbox', { name: 'Insert block' })).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('listbox', { name: 'Insert block' })).toBeHidden();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('listbox', { name: 'Insert block' })).toBeVisible();
    await page.getByRole('option', { name: 'Heading 1 Large section heading', exact: true }).click();
    await expect(body).toBeFocused();
    await page.keyboard.type('Section title');
    await expect(body.locator('h1')).toHaveText('Section title');
    await expect(page.getByRole('listbox', { name: 'Insert block' })).toBeHidden();
    expect(errors).toEqual([]);
    await page.screenshot({ path: info.outputPath('document-slash-heading.png') });
});

for (const width of [1440, 390]) {
    test(`document polish: find across formatting and replace literal text at ${width}px`, async ({ page }, info) => {
        await page.setViewportSize({ width, height: 844 });
        await page.goto('/__or3-document-journey-test');
        const body = page.getByRole('textbox', { name: 'Document body' });
        await expect(body).toBeVisible();
        await body.evaluate(element => {
            const editor = (element as HTMLElement & { editor: { commands: { setContent: (html: string) => void } } }).editor;
            editor.commands.setContent('<p>Find <strong>formatted</strong> text. Find formatted text.</p>');
        });
        if (width < 720) {
            await page.getByRole('button', { name: 'More editor tools', exact: true }).click();
            await page.getByRole('menuitem', { name: 'Find in document' }).click();
        } else {
            await page.getByRole('button', { name: 'Find in document', exact: true }).click();
        }
        await page.getByRole('textbox', { name: 'Find text', exact: true }).fill('Find formatted');
        await expect(page.locator('.find-bar')).toContainText('1 / 2');
        await page.getByRole('textbox', { name: 'Replacement text', exact: true }).fill('<em>literal</em>');
        // Replace acts on the first result even before navigating with Next.
        await page.getByRole('button', { name: 'Replace', exact: true }).click();
        await expect(body).toHaveText('<em>literal</em> text. Find formatted text.');
        await expect(page.locator('.find-bar')).toContainText('1 / 1');
        await page.getByRole('button', { name: 'All', exact: true }).click();
        await expect(body).toHaveText('<em>literal</em> text. <em>literal</em> text.');
        await expect(page.locator('.find-bar')).toContainText('No results');
        await page.getByRole('button', { name: 'Close find', exact: true }).click();
        await expect(page.getByTestId('persisted-document-body')).toHaveText('<em>literal</em> text. <em>literal</em> text.');
        await page.reload();
        await expect(body).toHaveText('<em>literal</em> text. <em>literal</em> text.');
        await page.screenshot({ path: info.outputPath(`document-find-${width}.png`) });
    });
}

for (const deletion of ['soft delete', 'Files Trash'] as const) {
    test(`document polish: ${deletion} disables open replacement and table controls without editor errors`, async ({ page }, info) => {
        const scripts: string[] = [];
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.stack ?? error.message));
        page.on('console', message => {
            if (message.type() === 'error' && message.text().startsWith('[err]')) errors.push(message.text());
        });
        page.on('request', request => scripts.push(request.url()));
        await page.goto('/__or3-document-journey-test');
        const body = page.getByRole('textbox', { name: 'Document body' });
        await expect(body).toBeVisible();
        await body.fill('keep this text');
        await body.evaluate(element => {
            (element as HTMLElement & { editor: { commands: { insertTable: (options: { rows: number; cols: number; withHeaderRow: boolean }) => void } } }).editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: false });
        });
        await expect(page.getByRole('toolbar', { name: 'Table controls' })).toBeVisible();
        await expect(page.getByTestId('persisted-document-body')).toHaveText('keep this text');
        await page.getByRole('button', { name: 'Find in document', exact: true }).click();
        await page.getByRole('textbox', { name: 'Find text', exact: true }).fill('keep');
        await page.getByRole('textbox', { name: 'Replacement text', exact: true }).fill('changed');
        const documentsUrl = scripts.find(url => /\/db\/documents\.ts(?:\?|$)/.test(url));
        expect(documentsUrl).toBeTruthy();
        const clientUrl = scripts.find(url => /\/db\/client\.ts(?:\?|$)/.test(url));
        expect(clientUrl).toBeTruthy();
        async function setTrashed(trashed: boolean) {
            return page.evaluate(async ({ documentsUrl, clientUrl, deletion, trashed }) => {
                const id = localStorage.getItem('or3:e2e:production-document-id')!;
                if (deletion === 'soft delete') {
                    const { softDeleteDocument } = await import(documentsUrl!);
                    await softDeleteDocument(id);
                    return;
                }
                const { getDb } = await import(clientUrl!);
                const { updateWorkspaceFile } = await import(new URL('./workspace-files.ts', documentsUrl!).href);
                const { workspaceRevision } = await import(new URL('../utils/chat/workspace-items.ts', documentsUrl!).href);
                const db = getDb();
                const row = await db.posts.get(id);
                await updateWorkspaceFile({ db, workspaceId: 'local', signal: new AbortController().signal,
                    writable: true, assertCurrent() {} }, id, await workspaceRevision(row), { trashed });
            }, { documentsUrl, clientUrl, deletion, trashed });
        }
        await setTrashed(true);
        await expect(body).toHaveAttribute('contenteditable', 'false');
        await expect(page.getByRole('button', { name: 'Replace', exact: true })).toBeDisabled();
        await expect(page.getByRole('button', { name: 'All', exact: true })).toBeDisabled();
        await expect(page.getByRole('toolbar', { name: 'Table controls' })).toBeHidden();
        await expect(body).toHaveText('keep this text');
        expect(errors).toEqual([]);
        await page.screenshot({ path: info.outputPath('document-read-only.png') });
        if (deletion === 'Files Trash') {
            await expect(page.getByRole('status').filter({ hasText: 'Restore it from Files Trash' })).toBeVisible();
            await setTrashed(false);
            await expect(body).toHaveAttribute('contenteditable', 'true');
            await expect(page.getByRole('button', { name: 'Replace', exact: true })).toBeEnabled();
            await page.getByRole('button', { name: 'Close find', exact: true }).click();
            await body.fill('keep this text');
            await body.evaluate(element => {
                (element as HTMLElement & { editor: Editor }).editor
                    .chain().focus().setTextSelection({ from: 1, to: 5 }).run();
            });
            await expect(page.locator('.selection-menu')).toBeVisible();
            await page.locator('.selection-menu').getByRole('button', { name: 'Bold', exact: true }).click();
            await expect(body.locator('strong')).toHaveText('keep');
            await expect(page.getByTestId('persisted-document-body')).toHaveText('keep this text');
            await page.screenshot({ path: info.outputPath('document-restored.png') });
        }
        expect(errors).toEqual([]);
        const path = info.outputPath('document-trash-receipt.json');
        await writeFile(path, JSON.stringify({ deletion, errors, readOnlyVerified: true,
            contentPreserved: true, restoredSelectionToolbarVerified: deletion === 'Files Trash' }, null, 2));
        await info.attach('document-trash-receipt', { path, contentType: 'application/json' });
    });
}

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

for (const mode of ['light', 'dark'] as const) test(`blank ${mode} keyboard focus fits sidebar rows, workspace tabs and document actions`, async ({ page, context }, info) => {
    test.setTimeout(120_000);
    await context.addCookies([{ name: 'or3_active_theme', value: 'blank', domain: '127.0.0.1', path: '/' }]);
    await page.addInitScript(mode => { localStorage.setItem('activeTheme', 'blank'); localStorage.setItem('theme', mode);
        localStorage.setItem('or3:user-theme-accessibility', JSON.stringify({ version: 1, focusRingWidthPx: mode === 'dark' ? 4 : 2, motion: 'reduced' })); }, mode);
    await context.route('**/*', route => {
        const url = new URL(route.request().url());
        return url.hostname === '127.0.0.1' || url.protocol === 'blob:' || url.protocol === 'data:' ? route.continue() : route.abort('blockedbyclient');
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/__or3-chat-journey-test?project=1');
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible({ timeout: 60_000 });
    await page.goto('/chat');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'blank');
    const evidence: unknown[] = [];
    async function checkFocus(control: Locator, owner = control) {
        await control.scrollIntoViewIfNeeded({ timeout: 10_000 });
        await control.focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        await expect(control).toBeFocused();
        expect(await control.evaluate(element => element.matches(':focus-visible'))).toBe(true);
        await owner.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))); });
        const result = await owner.evaluate(element => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            const scale = rect.width / (element as HTMLElement).offsetWidth || 1;
            const outside = Math.max(0, parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset)) * scale;
            const clipped: string[] = [];
            for (let parent = element.parentElement; parent; parent = parent.parentElement) {
                const css = getComputedStyle(parent); const box = parent.getBoundingClientRect();
                if (/(hidden|auto|scroll|clip)/.test(css.overflowX) && (rect.left - outside < box.left - 1 || rect.right + outside > box.right + 1)) clipped.push(parent.className + ':x');
                if (/(hidden|auto|scroll|clip)/.test(css.overflowY) && (rect.top - outside < box.top - 1 || rect.bottom + outside > box.bottom + 1)) clipped.push(parent.className + ':y');
            }
            const probe = document.createElement('span'); probe.style.cssText = 'position:fixed;color:var(--md-focus-ring);outline:var(--app-focus-ring-width) solid'; element.append(probe);
            const expected = getComputedStyle(probe); const expectedColor = expected.color; const expectedWidth = expected.outlineWidth; probe.remove();
            return { label: element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 60),
                color: style.outlineColor, expectedColor, expectedWidth, width: style.outlineWidth, offset: style.outlineOffset, line: style.outlineStyle,
                opacity: style.opacity, ring: style.getPropertyValue('--tw-ring-shadow').trim(), clipped,
                beforeOutline: getComputedStyle(element.querySelector(':scope > button') || element, '::before').outlineStyle };
        });
        evidence.push(result);
        expect.soft(result.line, JSON.stringify(result)).toBe('solid');
        expect.soft(result.width, JSON.stringify(result)).toBe(result.expectedWidth);
        expect.soft(parseFloat(result.offset) + parseFloat(result.width), JSON.stringify(result)).toBeLessThanOrEqual(0.01);
        expect.soft(result.color, JSON.stringify(result)).toBe(result.expectedColor);
        expect.soft(result.opacity, JSON.stringify(result)).toBe('1');
        expect.soft(result.clipped, JSON.stringify(result)).toEqual([]);
        expect.soft(result.ring, JSON.stringify(result)).toMatch(/^(0 0 #0000|0 0 rgba\(0, 0, 0, 0\))$/);
        expect.soft(result.beforeOutline, JSON.stringify(result)).toBe('none');
        if (owner !== control) expect(await control.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('none');
    }
    for (const label of ['Chats', 'Documents', 'Projects']) await checkFocus(page.getByRole('button', { name: label, exact: true }));
    const documentButton = page.getByRole('button', { name: 'Open Workspace evidence', exact: true }).first();
    const documentRow = page.locator('.unified-sb-item').filter({ has: documentButton }).first();
    await checkFocus(documentButton, documentRow);
    await checkFocus(documentRow.getByRole('button', { name: 'Actions for Workspace evidence', exact: true }));
    expect(await documentRow.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('none');
    const chatButton = page.getByRole('button', { name: 'Open Saffron project chat', exact: true }).first();
    await checkFocus(chatButton, page.locator('.unified-sb-item').filter({ has: chatButton }).first());
    const projectButton = page.getByRole('button', { name: 'Open project Workspace fixture project', exact: true });
    await checkFocus(projectButton, page.locator('.project-root-toggle').filter({ has: projectButton }));
    await page.screenshot({ path: info.outputPath(`blank-${mode}-sidebar-focus.png`), animations: 'disabled' });
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    const projectRow = page.getByRole('list', { name: 'Project list', exact: true }).locator('.unified-sb-item').filter({ hasText: 'Workspace fixture project' });
    await checkFocus(projectRow.locator(':scope > button').first(), projectRow);
    await checkFocus(projectRow.getByRole('button', { name: 'Pin project', exact: true }));
    expect(await projectRow.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('none');
    await page.getByRole('region', { name: 'Projects', exact: true }).getByRole('button', { name: 'Home', exact: true }).click();
    await documentButton.click();
    await expect(page.getByRole('textbox', { name: 'Document body' })).toBeVisible({ timeout: 30_000 });
    for (const width of [1440, 1000]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const control of [page.locator('.workspace-tab[aria-selected="true"]'),
            page.getByRole('button', { name: 'New split', exact: true }),
            page.getByRole('button', { name: /^Switch to (light|dark) mode$/ }),
            page.getByRole('combobox', { name: 'Text style', exact: true }).or(page.getByRole('button', { name: /^Text style:/ })),
            page.getByRole('button', { name: /Italic \(/ }),
            page.getByRole('button', { name: 'Outline & info', exact: true })]) await checkFocus(control);
        await page.screenshot({ path: info.outputPath(`blank-${mode}-${width}-toolbar-focus.png`), animations: 'disabled' });
    }
    await writeFile(info.outputPath('keyboard-focus.json'), JSON.stringify(evidence, null, 2));
});
