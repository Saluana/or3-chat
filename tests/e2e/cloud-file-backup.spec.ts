import { expect, test, type Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, openAsBlob } from 'node:fs';
import { scanCloudBackup } from '../../shared/storage/workspace-archive';
import { rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';

// Failure inventory: private settings bypass; unsafe cache eviction; orphaned
// direct-upload attachments; cache-only exports; truncated/corrupt restore;
// source replacement; large byte buffers or blob persistence in the browser;
// retained Trash disappearing on export or becoming live after restore.
// Real auth/SQLite/fs APIs own the behavior; only explicit faults are intercepted.
test.setTimeout(180_000);
test.beforeAll(() => expect(process.env.OR3_FILE_BACKUP_E2E_DIR).toMatch(/^\/tmp\/or3-file-backup-cloud-/));

async function start(page: Page) {
    const origin = String(test.info().project.use.baseURL);
    const headers = { origin, 'x-or3-cloud-intent': 'mutation' };
    const response = await page.request.post('/api/basic-auth/sign-in', { headers,
        data: { email: 'file-backup@example.test', password: 'DisposableBackupSuite!123' } });
    expect(response.ok(), await response.text()).toBe(true);
    const created = await page.request.post('/api/workspaces', { headers, data: { name: `Backup fixture ${randomUUID().slice(0, 8)}` } });
    expect(created.ok(), await created.text()).toBe(true);
    const target = (await created.json()).id;
    const activated = await page.request.post('/api/workspaces/active', { headers, data: { id: target } });
    expect(activated.ok(), await activated.text()).toBe(true);
    const source = await (await page.request.get('/api/auth/session')).json();
    const requests: string[] = [];
    page.on('request', request => requests.push(request.url()));
    await page.goto('/');
    await expect.poll(() => requests.find(url => /\/db\/client\.ts(?:\?|$)/.test(url)), { timeout: 30_000 }).toBeTruthy();
    const clientUrl = requests.find(url => /\/db\/client\.ts(?:\?|$)/.test(url))!;
    await expect.poll(() => page.evaluate(async url => (await import(url)).getActiveWorkspaceId(), clientUrl), { timeout: 30_000 }).toBe(source.session.workspace.id);
    const admin = await page.request.post('/api/admin/auth/login', { headers: { origin, 'x-or3-admin-intent': 'admin' },
        data: { username: 'backup-audit', password: 'DisposableAdminSuite!123' } });
    expect(admin.ok(), await admin.text()).toBe(true);
    return { origin, headers, workspaceId: source.session.workspace.id as string, clientUrl };
}

test('admin limits, interrupted direct upload, and verified retention preserve originals', async ({ page }, info) => {
    const { workspaceId, clientUrl, origin, headers } = await start(page);
    const policy = { maxCachedFileBytes: 1024 * 1024, maxCacheBytes: 4 * 1024 * 1024, retentionDays: 14, maxUploadBytes: 8 * 1024 * 1024 };
    const endpoint = '/api/admin/workspace/file-policy';
    const save = await page.request.post(endpoint, { headers: { origin, 'x-or3-admin-intent': 'admin' }, data: { workspaceId, policy } });
    expect(save.ok(), await save.text()).toBe(true);
    expect(await (await page.request.get(`/api/storage/policy?workspaceId=${workspaceId}`)).json()).toEqual(policy);
    const denied = await page.request.post('/api/storage/presign-upload', { headers, data: { workspace_id: workspaceId,
        hash: `sha256:${'a'.repeat(64)}`, mime_type: 'image/png', size_bytes: policy.maxUploadBytes + 1 } });
    expect(denied.status()).toBe(413);
    await page.route('**/api/storage/fs/upload?*', route => route.abort());
    const interruption = await page.evaluate(async url => {
        const { getDb } = await import(url);
        const { createOrRefFile } = await import(new URL('./files.ts', url).href);
        let error = '';
        try { await createOrRefFile(new File([new Uint8Array(2 * 1024 * 1024)], 'interrupted.txt', { type: 'text/plain' }), 'interrupted.txt'); }
        catch (caught) { error = String(caught); }
        return { error, metadata: await getDb().file_meta.filter((row: { name: string }) => row.name === 'interrupted.txt').count(),
            blobs: await getDb().file_blobs.count() };
    }, clientUrl);
    expect(interruption.error).not.toBe(''); expect(interruption.metadata).toBe(0); expect(interruption.blobs).toBe(0);
    await page.unroute('**/api/storage/fs/upload?*');
    const receipt = await page.evaluate(async ({ url, workspaceId, policy }) => {
        const { getDb } = await import(url);
        const db = getDb();
        const load = (path: string) => import(new URL(path, url).href);
        const [{ createOrRefFile }, { cleanupFileCache }, { getActiveStorageProvider }] = await Promise.all([
            load('./files.ts'), load('../core/storage/file-cache.ts'), load('../core/storage/provider-registry.ts'),
        ]);
        const meta = await createOrRefFile(new File(['original bytes for verified retention'], 'safe.txt', { type: 'text/plain' }), 'safe.txt');
        const queue = (await load('../core/storage/transfer-queue.ts')).getStorageTransferQueue();
        const deadline = Date.now() + 20_000;
        while (!(await db.file_meta.get(meta.hash))?.storage_id || (await db.pending_ops.filter((op: { status: string }) => !['applied', 'discarded'].includes(op.status)).count())) {
            if (Date.now() > deadline) throw new Error('Fixture did not finish syncing.');
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        const old = Date.now() - 15 * 86_400_000;
        const remote = await db.file_meta.get(meta.hash);
        await db.file_blobs.update(meta.hash, { cache_accessed_at: old, cache_workspace_id: workspaceId,
            cache_provider_id: remote.storage_provider_id, cache_storage_id: remote.storage_id, cache_bytes: meta.size_bytes });
        const upload = { id: 'held-upload', hash: meta.hash, workspace_id: workspaceId, direction: 'upload', state: 'failed', created_at: 1, updated_at: 1, attempts: 1 };
        await db.file_transfers.put(upload);
        await cleanupFileCache(db, workspaceId, getActiveStorageProvider(), policy);
        const keptPending = !!await db.file_blobs.get(meta.hash);
        await db.file_transfers.delete(upload.id);
        await cleanupFileCache(db, workspaceId, getActiveStorageProvider(), policy);
        const evicted = !await db.file_blobs.get(meta.hash);
        const downloaded = await queue.ensureDownloadedBlob(meta.hash);
        const recent = await db.file_blobs.get(meta.hash);
        return { hash: meta.hash, keptPending, evicted, redownload: await downloaded.text(), refreshed: recent.cache_accessed_at > old,
            bytes: recent.blob.size, originBudget: policy.maxCacheBytes };
    }, { url: clientUrl, workspaceId, policy });
    expect(receipt).toMatchObject({ keptPending: true, evicted: true, redownload: 'original bytes for verified retention', refreshed: true });
    const other = await page.context().newPage();
    await other.goto('/');
    const admit = async (target: Page, prefix: string) => target.evaluate(async ({ url, workspaceId, policy, prefix }) => {
        const db = (await import(url)).getDb();
        const { cacheDownloadedFile } = await import(new URL('../core/storage/file-cache.ts', url).href);
        for (let index = 0; index < 12; index++) {
            await cacheDownloadedFile(db, workspaceId, 'fs', `${prefix}-${index}`, `object-${index}`, new Blob([new Uint8Array(512 * 1024)]), policy);
        }
    }, { url: clientUrl, workspaceId, policy, prefix });
    await Promise.all([admit(page, 'tab-one'), admit(other, 'tab-two')]);
    const cacheBytes = await page.evaluate(async url => (await import(new URL('../core/storage/file-cache.ts', url).href)).originCacheBytes(), clientUrl);
    expect(cacheBytes).toBeLessThanOrEqual(policy.maxCacheBytes);
    expect(cacheBytes).toBeGreaterThan(3 * 1024 * 1024);
    await other.close();
    const path = info.outputPath('retention-receipt.json'); await writeFile(path, JSON.stringify({ interruption, receipt, concurrentTabCacheBytes: cacheBytes }, null, 2));
    await info.attach('retention-receipt', { path, contentType: 'application/json' });
    await page.goto(`/admin/workspaces/${workspaceId}`);
    await expect(page.getByRole('heading', { name: 'Files and device storage' })).toBeVisible();
    await expect(page.getByRole('spinbutton', { name: 'Keep unused copies (days)' })).toHaveValue('14');
    await page.getByRole('spinbutton', { name: 'Keep unused copies (days)' }).fill('21');
    await page.getByRole('button', { name: 'Save file settings' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'No restart required.' })).toBeVisible();
    expect((await (await page.request.get(`/api/storage/policy?workspaceId=${workspaceId}`)).json()).retentionDays).toBe(21);
    await page.getByRole('spinbutton', { name: 'Keep unused copies (days)' }).fill('22');
    await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'No restart required.' })).toHaveCount(0);
    // Another tab's active-workspace change must not retarget this visible form.
    await page.goto('/admin/workspace');
    await expect(page.getByRole('spinbutton', { name: 'Keep unused copies (days)' })).toHaveValue('21');
    const otherWorkspace = await (await page.request.post('/api/workspaces', { headers, data: { name: 'Other settings target' } })).json();
    expect((await page.request.post('/api/workspaces/active', { headers, data: { id: otherWorkspace.id } })).ok()).toBe(true);
    await page.getByRole('spinbutton', { name: 'Keep unused copies (days)' }).fill('22');
    const saving = page.waitForRequest(request => request.url().endsWith('/api/admin/workspace/file-policy') && request.method() === 'POST');
    await page.getByRole('button', { name: 'Save file settings' }).click();
    expect((await saving).postDataJSON().workspaceId).toBe(workspaceId);
    await expect(page.getByRole('status').filter({ hasText: 'No restart required.' })).toBeVisible();
    expect((await (await page.request.get(`/api/storage/policy?workspaceId=${otherWorkspace.id}`)).json()).retentionDays).toBe(14);
    expect((await (await page.request.get(`/api/storage/policy?workspaceId=${workspaceId}`)).json()).retentionDays).toBe(22);
});

test('complete cloud backup restores independently of browser cache', async ({ page }, info) => {
    test.setTimeout(15 * 60_000);
    const { workspaceId, clientUrl, origin, headers } = await start(page);
    const large = process.env.OR3_BACKUP_LARGE_E2E === 'true';
    const count = large ? 16 : 2;
    const size = large ? 128 * 1024 * 1024 : 2 * 1024 * 1024;
    const lifecycle = await (await page.request.get('/api/admin/system/restart-status')).json();
    expect(lifecycle.capability.restart).toBe(true);
    const initialPolicy = await (await page.request.get(`/api/storage/policy?workspaceId=${workspaceId}`)).json();
    const sourcePolicy = await page.request.post('/api/admin/workspace/file-policy', { headers: { origin, 'x-or3-admin-intent': 'admin' },
        data: { workspaceId, policy: { ...initialPolicy, maxUploadBytes: Math.max(initialPolicy.maxUploadBytes, size) } } });
    expect(sourcePolicy.ok(), await sourcePolicy.text()).toBe(true);
    const hashes: string[] = [];
    const cookies = (await page.context().cookies()).map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
    for (let index = 0; index < count; index++) {
        const chunk = Buffer.alloc(1024 * 1024, index + 17);
        const digest = createHash('sha256'); for (let bytes = 0; bytes < size; bytes += chunk.length) digest.update(chunk);
        const hash = `sha256:${digest.digest('hex')}`; hashes.push(hash);
        const grantResponse = await page.request.post('/api/storage/presign-upload', { headers, data: {
            workspace_id: workspaceId, hash, mime_type: 'text/plain', size_bytes: size, file_kind_capability: 'v1',
        } });
        expect(grantResponse.ok(), await grantResponse.text()).toBe(true);
        const grant = await grantResponse.json();
        async function* content() { for (let bytes = 0; bytes < size; bytes += chunk.length) yield chunk; }
        const uploaded = await fetch(new URL(grant.url, origin), { method: grant.method ?? 'PUT', headers: {
            cookie: cookies, 'content-type': 'text/plain', ...grant.headers,
        }, body: Readable.from(content()), duplex: 'half' } as RequestInit);
        expect(uploaded.ok, await uploaded.text()).toBe(true);
        const commit = await page.request.post('/api/storage/commit', { headers, data: {
            workspace_id: workspaceId, hash, storage_id: grant.storageId, intent_id: grant.intentId,
            storage_provider_id: 'fs', mime_type: 'text/plain', size_bytes: size, name: `original-${index}.txt`, kind: 'file', file_kind_capability: 'v1',
        } });
        expect(commit.ok(), await commit.text()).toBe(true);
        const id = randomUUID();
        const saved = await page.request.post('/api/sync/push', { headers, data: { scope: { workspaceId }, fileKindCapability: 'v1', workspaceItemCapability: 'v1', ops: [{
            id, tableName: 'file_meta', operation: 'put', pk: hash, payload: { hash, name: `original-${index}.txt`, kind: 'file', mime_type: 'text/plain', size_bytes: size,
                storage_id: grant.storageId, storage_provider_id: 'fs', ref_count: 0, clock: 1, created_at: 1, updated_at: 1, deleted: false },
            stamp: { deviceId: 'backup-e2e', opId: id, clock: 1, hlc: `${String(Date.now()).padStart(15, '0')}:000000:backup-e2e` }, createdAt: Date.now(), attempts: 0, status: 'pending',
        }] } });
        expect(saved.ok(), await saved.text()).toBe(true); expect((await saved.json()).results[0].success).toBe(true);
    }
    const trashHash = hashes.at(-1)!;
    const trashId = randomUUID();
    const trashed = await page.request.post('/api/sync/push', { headers, data: { scope: { workspaceId }, fileKindCapability: 'v1', workspaceItemCapability: 'v1', ops: [{
        id: trashId, tableName: 'file_meta', operation: 'delete', pk: trashHash,
        stamp: { deviceId: 'backup-e2e', opId: trashId, clock: 2, hlc: `${String(Date.now()).padStart(15, '0')}:000001:backup-e2e` }, createdAt: Date.now(), attempts: 0, status: 'pending',
    }] } });
    expect(trashed.ok(), await trashed.text()).toBe(true);
    expect((await trashed.json()).results[0].applied).toBe(true);
    await page.evaluate(async url => { await (await import(url)).getDb().file_blobs.clear(); }, clientUrl);
    const clientExport = await page.evaluate(async url => {
        const { exportCloudWorkspace } = await import(new URL('../utils/cloud-workspace-backup.ts', url).href);
        let bytes = 0, closed = false, aborted = false;
        await exportCloudWorkspace({ write: async (chunk: Uint8Array) => { bytes += chunk.length; },
            close: async () => { closed = true; }, abort: async () => { aborted = true; } });
        return { bytes, closed, aborted, blobs: await (await import(url)).getDb().file_blobs.count() };
    }, clientUrl);
    expect(clientExport).toMatchObject({ closed: true, aborted: false, blobs: 0 });
    expect(clientExport.bytes).toBeGreaterThan(count * size);
    const archivePath = join(process.env.OR3_FILE_BACKUP_E2E_DIR!, 'roundtrip.or3cloud');
    const exported = await fetch(`${origin}/api/workspaces/backup?workspaceId=${workspaceId}`, { headers: { cookie: cookies } });
    expect(exported.ok).toBe(true);
    await writeFile(archivePath, Readable.fromWeb(exported.body! as never));
    expect((await stat(archivePath)).size).toBeGreaterThan(count * size);
    const archiveDigest = createHash('sha256'); for await (const bytes of createReadStream(archivePath)) archiveDigest.update(bytes);
    // A native File on disk is the durable restore source; no 2 GB arrayBuffer.
    await page.locator('body').evaluate(body => { const input = document.createElement('input'); input.type = 'file'; input.id = 'backup-fixture-file'; body.appendChild(input); });
    await page.locator('#backup-fixture-file').setInputFiles(archivePath);
    const rejected = await page.evaluate(async url => {
        const load = (path: string) => import(new URL(path, url).href);
        const [{ restoreCloudWorkspace }, { useSessionContext }] = await Promise.all([
            load('../utils/cloud-workspace-backup.ts'), load('../composables/auth/useSessionContext.ts'),
        ]);
        const before = await (await fetch('/api/workspaces')).json();
        const file = (document.querySelector('#backup-fixture-file') as HTMLInputElement).files![0]!;
        let error = '';
        try { await restoreCloudWorkspace(file.slice(0, file.size - 5), useSessionContext(), () => {}); }
        catch (caught) { error = String(caught); }
        const after = await (await fetch('/api/workspaces')).json();
        return { error, before: before.workspaces.length, after: after.workspaces.length, workspaceId: (await import(url)).getActiveWorkspaceId() };
    }, clientUrl);
    expect(rejected.error).not.toBe(''); expect(rejected.before).toBe(rejected.after); expect(rejected.workspaceId).toBe(workspaceId);
    const restored = await page.evaluate(async url => {
        const load = (path: string) => import(new URL(path, url).href);
        const [{ restoreCloudWorkspace }, { useSessionContext }] = await Promise.all([
            load('../utils/cloud-workspace-backup.ts'), load('../composables/auth/useSessionContext.ts'),
        ]);
        const file = (document.querySelector('#backup-fixture-file') as HTMLInputElement).files![0]!;
        const dbModule = await import(url);
        const before = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
        let peak = before ?? 0;
        let previous = performance.now(), maxUiGapMs = 0;
        const timer = setInterval(() => {
            maxUiGapMs = Math.max(maxUiGapMs, performance.now() - previous); previous = performance.now();
            peak = Math.max(peak, (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0);
        }, 100);
        try {
            await restoreCloudWorkspace(file, useSessionContext(), () => {});
            return { workspaceId: dbModule.getActiveWorkspaceId(), blobs: await dbModule.getDb().file_blobs.count(), peakHeapBytes: peak, beforeHeapBytes: before, maxUiGapMs };
        } finally { clearInterval(timer); }
    }, clientUrl);
    expect(restored.workspaceId).not.toBe(workspaceId); expect(restored.blobs).toBe(0);
    expect(restored.peakHeapBytes).toBeLessThan(384 * 1024 * 1024);
    expect(restored.maxUiGapMs).toBeLessThan(1000);
    const snapshot = await page.request.post('/api/sync/snapshot', { headers, data: { scope: { workspaceId: restored.workspaceId }, pageSize: 200,
        fileKindCapability: 'v1', workspaceItemCapability: 'v1', tables: ['file_meta'] } });
    expect(snapshot.ok(), await snapshot.text()).toBe(true);
    const items = (await snapshot.json()).items;
    const rows = items.filter((item: { kind: string }) => item.kind === 'row');
    expect(rows.map((item: { payload: { hash: string } }) => item.payload.hash).sort()).toEqual(hashes.filter(hash => hash !== trashHash).sort());
    expect(items).toContainEqual(expect.objectContaining({ kind: 'tombstone', pk: trashHash }));
    // Restart the disposable development server, keeping its SQLite/files intact.
    const initial = await (await page.request.get('/api/admin/system/restart-status')).json();
    const restarted = await page.request.post('/api/admin/system/restart', { headers: { origin, 'x-or3-admin-intent': 'admin' },
        data: { requestId: randomUUID(), policy: 'wait', target: { kind: 'current', activeRevision: initial.activeRevision } } });
    expect(restarted.status(), await restarted.text()).toBe(202);
    await expect.poll(async () => { try { return (await (await page.request.get('/api/admin/system/restart-status')).json()).operation.phase; } catch { return 'unreachable'; } }, { timeout: 120_000 }).toBe('succeeded');
    const nextBoot = await (await page.request.get('/api/admin/system/restart-status')).json();
    expect(nextBoot.bootId).not.toBe(initial.bootId);
    // A new page avoids racing Vite's automatic restart navigation.
    const reloaded = await page.context().newPage();
    await page.close();
    const requests: string[] = [];
    reloaded.on('request', request => requests.push(request.url()));
    await reloaded.goto('/');
    await expect.poll(() => requests.find(url => /\/db\/client\.ts(?:\?|$)/.test(url)), { timeout: 30_000 }).toBeTruthy();
    const nextClientUrl = requests.find(url => /\/db\/client\.ts(?:\?|$)/.test(url))!;
    await expect.poll(() => reloaded.evaluate(async url => (await import(url)).getActiveWorkspaceId(), nextClientUrl), { timeout: 30_000 }).toBe(restored.workspaceId);
    expect(await reloaded.evaluate(async url => (await import(url)).getDb().file_blobs.count(), nextClientUrl)).toBe(0);
    // Verify destination bytes independently after reopening, with no browser blobs.
    const verified: string[] = [];
    for (const hash of hashes.filter(hash => hash !== trashHash)) {
        const response = await reloaded.request.post('/api/storage/presign-download', { headers, data: { workspace_id: restored.workspaceId, hash, file_kind_capability: 'v1' } });
        expect(response.ok(), await response.text()).toBe(true);
        const grant = await response.json();
        const download = await fetch(new URL(grant.url, origin), { headers: { cookie: cookies, ...grant.headers } });
        expect(download.ok).toBe(true);
        const digest = createHash('sha256'); for await (const bytes of Readable.fromWeb(download.body! as never)) digest.update(bytes);
        expect(`sha256:${digest.digest('hex')}`).toBe(hash); verified.push(hash);
    }
    const restoredArchivePath = join(process.env.OR3_FILE_BACKUP_E2E_DIR!, 'restored.or3cloud');
    const restoredExport = await fetch(`${origin}/api/workspaces/backup?workspaceId=${restored.workspaceId}`, { headers: { cookie: cookies } });
    expect(restoredExport.ok).toBe(true);
    await writeFile(restoredArchivePath, Readable.fromWeb(restoredExport.body! as never));
    const archivedHashes: string[] = [];
    let trashPreserved = false;
    await scanCloudBackup(await openAsBlob(restoredArchivePath), async frame => {
        if (frame.header.type === 'file') archivedHashes.push(frame.header.hash);
        if (frame.header.type === 'row' && frame.header.table === 'file_meta') {
            const row = frame.row as { hash: string; deleted: boolean };
            if (row.hash === trashHash) trashPreserved = row.deleted === true;
        }
    });
    expect(archivedHashes.sort()).toEqual([...hashes].sort());
    expect(trashPreserved).toBe(true);
    await rm(restoredArchivePath);
    const source = await reloaded.request.get(`${origin}/api/workspaces`); expect((await source.json()).workspaces.some((row: { id: string }) => row.id === workspaceId)).toBe(true);
    const path = info.outputPath('roundtrip-receipt.json');
    await writeFile(path, JSON.stringify({ bytes: count * size, count, sourceWorkspace: workspaceId, ...restored,
        archiveSha256: archiveDigest.digest('hex'), verifiedHashes: verified, archivedHashes, trashPreserved, sourceKept: true, browserReloadVerified: true, clientExport,
        serverRestart: { before: initial.bootId, after: nextBoot.bootId }, truncatedRestoreRejected: rejected }, null, 2));
    await info.attach('roundtrip-receipt', { path, contentType: 'application/json' });
    await rm(archivePath);
});
