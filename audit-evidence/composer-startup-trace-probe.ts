/** Observational local Vite tracing around unchanged composer operations. */
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import type { WorkspaceTabDraftRow } from '../app/db/client';
import type { RecoveryProbeWindow } from './probe-types';
const output = '/workspace/or3-chat/test-results/recovery-composer-startup-trace' + (process.env.OR3_TRACE_INTERRUPTED_BLOB === 'true' ? '-interrupted-blob' : '');
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
try {
    for (let attempt = 0; attempt < 5; attempt++) {
        const context = await browser.newContext();
        await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort('blockedbyclient'));
        await context.addInitScript(() => {
            (globalThis as unknown as RecoveryProbeWindow).__recoveryTrace = (stage: string, details: unknown) => {
                try {
                    const key = 'or3:e2e:composer-startup-trace';
                    const rows = JSON.parse(sessionStorage.getItem(key) ?? '[]') as unknown[];
                    rows.push({ stage, details, at: Date.now(), page: performance.timeOrigin });
                    sessionStorage.setItem(key, JSON.stringify(rows.slice(-100)));
                } catch {}
            };
        });
        await context.route('**/components/chat/ChatInputDropper.vue*', async route => {
            const response = await route.fetch(); let body = await response.text();
            const substitutions: Array<[string, string]> = [
                ['const revision = ++draftRestoreRevision;', 'globalThis.__recoveryTrace("restore-start", { tabId, text: promptText.value, editor: editor.value?.getText(), edit: draftEditRevision });'],
                ['draft = await tabDrafts.load(tabId, scope);', 'globalThis.__recoveryTrace("restore-read", { tabId, revision, active: draftRestoreRevision, text: draft?.text, json: draft?.editorJson, edit: draftEditRevision });'],
                ['keptTypedText = draftEditRevision !== revisionBeforeLoad;', 'globalThis.__recoveryTrace("restore-compete", { tabId, revision, active: draftRestoreRevision, keptTypedText, revisionBeforeLoad, edit: draftEditRevision, text: promptText.value, editor: editor.value?.getText() });'],
                ['editor.value = nextEditor;', 'globalThis.__recoveryTrace("editor-created", { tabId: props.tabId, replaceExisting, text: promptText.value, previous: previous?.getText(), editor: nextEditor.getText() });'],
                ['function captureDraft(tabId = props.tabId) {', 'globalThis.__recoveryTrace("capture", { tabId, text: promptText.value, json: editor.value?.getJSON(), loading: draftContentLoading, failed: draftRestoreFailed, files: attachments.value.length });'],
                ['function noteDraftEdit() {', 'globalThis.__recoveryTrace("edit", { tabId: props.tabId, text: promptText.value, editor: editor.value?.getText(), restoring: restoringDraft.value });'],
            ];
            for (const [needle, trace] of substitutions) {
                expect(body).toContain(needle); body = body.replaceAll(needle, needle + '\n' + trace);
            }
            await route.fulfill({ response, body });
        });
        const page = await context.newPage();
        const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
        const read = () => page.evaluate(async () => {
            const rows: WorkspaceTabDraftRow[] = [];
            for (const { name } of await indexedDB.databases()) {
                if (!name?.startsWith('or3-db')) continue;
                const db = await new Promise<IDBDatabase>((resolve, reject) => {
                    const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
                });
                if (db.objectStoreNames.contains('workspace_tab_drafts')) rows.push(...await new Promise<WorkspaceTabDraftRow[]>((resolve, reject) => {
                    const request = db.transaction('workspace_tab_drafts', 'readonly').objectStore('workspace_tab_drafts').getAll();
                    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
                }));
                db.close();
            }
            return rows;
        });
        try {
            await page.goto('http://127.0.0.1:3127/chat');
            const input = page.getByRole('textbox', { name: 'Message input' }); await input.waitFor({ timeout: 45_000 });
            const marker = `Synthetic startup trace ${attempt}`; await input.fill(marker);
            const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'Add attachments', exact: true }).click();
            await (await chooser).setFiles({ name: 'trace.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=', 'base64') });
            await expect.poll(async () => (await read()).some(row => row.draft.text === marker && row.draft.attachments.length === 1)).toBe(true);
            const before = await read();
            if (process.env.OR3_TRACE_INTERRUPTED_BLOB === 'true') {
                await page.addInitScript(() => {
                    const get = IDBObjectStore.prototype.get;
                    IDBObjectStore.prototype.get = function (...args: Parameters<typeof get>) {
                        if (this.name === 'file_blobs' && localStorage.getItem('or3:e2e:blob-read-repaired') !== 'yes') {
                            throw new DOMException('Synthetic trace interrupted blob read', 'AbortError');
                        }
                        return get.apply(this, args);
                    };
                    (globalThis as unknown as RecoveryProbeWindow).__repairBlobRead = () => {
                        localStorage.setItem('or3:e2e:blob-read-repaired', 'yes'); IDBObjectStore.prototype.get = get;
                    };
                });
                await page.reload();
                await expect(page.getByText('Draft could not be restored', { exact: true })).toBeVisible({ timeout: 30_000 });
                await page.reload();
                await expect(page.getByText('Draft could not be restored', { exact: true })).toBeVisible({ timeout: 30_000 });
                await page.evaluate(() => (globalThis as unknown as RecoveryProbeWindow).__repairBlobRead());
                // A successful action removes its toast while Playwright may still be waiting on its transition.
                await page.getByRole('button', { name: 'Retry restore', exact: true }).click({ timeout: 10_000 }).catch(async error => {
                    await expect(input).toHaveText(marker); errors.push('Retry click timeout after successful text restoration: ' + String(error));
                });
                await expect(input).toHaveText(marker);
                await expect(page.getByRole('button', { name: 'Remove image', exact: true })).toBeVisible();
                await writeFile(`${output}/attempt-${attempt}-before-final-reload.json`, JSON.stringify({ rows: await read(),
                    liveText: await input.innerText(), trace: await page.evaluate(() => JSON.parse(sessionStorage.getItem('or3:e2e:composer-startup-trace') ?? '[]') as unknown) }, null, 2));
            }
            await page.reload();
            let failure: string | undefined;
            try { await expect(input).toHaveText(marker, { timeout: 12_000 }); }
            catch (error) { failure = String(error); }
            const evidence = { attempt, before, after: await read(), liveText: await input.innerText(), errors, failure,
                trace: await page.evaluate(() => JSON.parse(sessionStorage.getItem('or3:e2e:composer-startup-trace') ?? '[]') as unknown),
                externalRequests: 'denied', observations: 'local Vite response tracing only; native storage receipts' };
            await writeFile(`${output}/attempt-${attempt}.json`, JSON.stringify(evidence, null, 2));
            console.log(JSON.stringify({ attempt, liveText: evidence.liveText, failure, errors }));
            if (failure) break;
        } finally { await context.close(); }
    }
} finally { await browser.close(); }
