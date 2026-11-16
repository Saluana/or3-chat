import { expect, test, type Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, openAsBlob } from 'node:fs';
import { scanCloudBackup } from '../../shared/storage/workspace-archive';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';

// Failure inventory: private settings bypass; unsafe cache eviction; orphaned
// direct-upload attachments; cache-only exports; truncated/corrupt restore;
// source replacement; large byte buffers or blob persistence in the browser;
// retained Trash disappearing on export or becoming live after restore.
// Real auth/SQLite/storage APIs own the behavior; only explicit faults are intercepted.
const storageProvider = process.env.OR3_STORAGE_PROVIDER === 's3' ? 's3' : 'fs';
test.setTimeout(180_000);
test.beforeAll(() => expect(process.env.OR3_FILE_BACKUP_E2E_DIR).toMatch(/^\/tmp\/or3-file-backup-cloud-/));

async function start(page: Page, beforeBind?: (context: { clientUrl: string; workspaceId: string; headers: Record<string, string>; syncHistory: Record<string, string>; releaseBind(): void }) => Promise<void>) {
    let releaseBind!: () => void;
    if (beforeBind) {
        const gate = new Promise<void>(resolve => { releaseBind = resolve; });
        await page.context().route('**/api/sync/snapshot', async route => { await gate; await route.continue().catch(() => {}); });
    }
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
    const discovery = await page.request.post('/api/sync/snapshot', { headers, data: { scope: { workspaceId: target }, pageSize: 1,
        historyIncarnation: null, historyIncarnationCapability: 'incarnation-v1', unavailableRecordCapability: 'unavailable-v1',
        fileKindCapability: 'v1', workspaceItemCapability: 'v1' } });
    expect(discovery.ok(), await discovery.text()).toBe(true);
    const historyIncarnation = (await discovery.json()).historyIncarnation;
    expect(historyIncarnation).toMatch(/^[\x00-\x7f]{1,128}$/);
    const syncHistory = { historyIncarnation, historyIncarnationCapability: 'incarnation-v1',
        unavailableRecordCapability: 'unavailable-v1', storedRecordCapability: 'stored-record-v1' };
    const requests: string[] = [];
    page.on('request', request => requests.push(request.url()));
    await page.goto('/');
    await expect.poll(() => requests.find(url => /\/db\/client\.ts(?:\?|$)/.test(url)), { timeout: 30_000 }).toBeTruthy();
    const clientUrl = requests.find(url => /\/db\/client\.ts(?:\?|$)/.test(url))!;
    if (beforeBind) {
        await expect.poll(() => page.evaluate(async ({ url, target }) => {
            const client = await import(url);
            const { tryGetHooks } = await import(new URL('../core/hooks/useHooks.ts', url).href);
            return client.getActiveWorkspaceId() === target && Boolean(tryGetHooks());
        }, { url: clientUrl, target }), { timeout: 30_000 }).toBe(true);
        try { await beforeBind({ clientUrl, workspaceId: target, headers, syncHistory, releaseBind }); } finally { releaseBind(); }
    }
    await expect.poll(async () => {
        try {
            return await page.evaluate(async ({ url, workspaceId, historyIncarnation }) => {
                const client = await import(url);
                if (client.getActiveWorkspaceId() !== workspaceId) return false;
                const db = client.getDb();
                const guard = await db.sync_state.get('sync_history');
                return guard?.phase === 'ready' && guard.historyIncarnation === historyIncarnation && db.syncHistoryAtOpen === historyIncarnation;
            }, { url: clientUrl, workspaceId: source.session.workspace.id, historyIncarnation });
        } catch (error) {
            if (/Execution context was destroyed/.test(String(error))) return false;
            throw error;
        }
    }, { timeout: 30_000 }).toBe(true);
    const admin = await page.request.post('/api/admin/auth/login', { headers: { origin, 'x-or3-admin-intent': 'admin' },
        data: { username: 'backup-audit', password: 'DisposableAdminSuite!123' } });
    expect(admin.ok(), await admin.text()).toBe(true);
    return { origin, headers, workspaceId: source.session.workspace.id as string, clientUrl, syncHistory };
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
    const uploadUrl = storageProvider === 's3'
        ? new RegExp('^' + process.env.OR3_STORAGE_S3_ENDPOINT!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/')
        : '**/api/storage/fs/upload?*';
    await page.route(uploadUrl, route => route.request().method() === 'PUT' ? route.abort() : route.continue());
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
    await page.unroute(uploadUrl);
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
            bytes: recent.blob.size, originBudget: policy.maxCacheBytes, held: await db.sync_quarantine.toArray() };
    }, { url: clientUrl, workspaceId, policy });
    await writeFile(info.outputPath('retention-before-assertion.json'), JSON.stringify(receipt, null, 2));
    expect(receipt.held.filter((entry: { variant?: string }) => entry.variant === 'history_reset')).toEqual([]);
    expect(receipt).toMatchObject({ keptPending: true, evicted: true, redownload: 'original bytes for verified retention', refreshed: true });
    const other = await page.context().newPage();
    await other.goto('/');
    const admit = async (target: Page, prefix: string) => target.evaluate(async ({ url, workspaceId, policy, prefix, storageProvider }) => {
        const db = (await import(url)).getDb();
        const { cacheDownloadedFile } = await import(new URL('../core/storage/file-cache.ts', url).href);
        for (let index = 0; index < 12; index++) {
            await cacheDownloadedFile(db, workspaceId, storageProvider, `${prefix}-${index}`, `object-${index}`, new Blob([new Uint8Array(512 * 1024)]), policy);
        }
    }, { url: clientUrl, workspaceId, policy, prefix, storageProvider });
    await Promise.all([admit(page, 'tab-one'), admit(other, 'tab-two')]);
    const cacheBytes = await page.evaluate(async url => (await import(new URL('../core/storage/file-cache.ts', url).href)).originCacheBytes(), clientUrl);
    expect(cacheBytes).toBeLessThanOrEqual(policy.maxCacheBytes);
    expect(cacheBytes).toBeGreaterThan(3 * 1024 * 1024);
    await other.close();
    const usage = await page.request.post('/api/admin/system/provider-action', { headers: { origin, 'x-or3-admin-intent': 'admin' },
        data: { kind: 'storage', actionId: 'storage.usage', workspaceId } });
    expect(usage.ok(), await usage.text()).toBe(true);
    const observed = await usage.json();
    expect(JSON.stringify(observed)).toContain('non_atomic_observation');
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

test('first binding preserves offline authorship across restart and a second tab without false holds', async ({ page }, info) => {
    let other: Page | undefined;
    const before: unknown[] = [];
    const { clientUrl, workspaceId } = await start(page, async context => {
        const remoteOpId = randomUUID();
        const remote = await page.request.post('/api/sync/push', { headers: context.headers, data: { ...context.syncHistory,
            scope: { workspaceId: context.workspaceId }, ops: [{ id: remoteOpId, tableName: 'kv', pk: 'kv:prebind-conflict', operation: 'put',
                payload: { id: 'kv:prebind-conflict', name: 'prebind-conflict', value: 'server wins', deleted: false, created_at: 1, updated_at: 1, clock: 100 },
                stamp: { opId: remoteOpId, deviceId: 'fixture', clock: 100, hlc: '100:0:fixture' }, createdAt: 1, attempts: 0, status: 'pending' }] } });
        expect(remote.ok(), await remote.text()).toBe(true);
        before.push(await page.evaluate(async url => {
            const client = await import(url); const db = client.getDb();
            const { getWriteTxTableNames } = await import(new URL('./util.ts', url).href);
            const { setKvByName } = await import(new URL('./kv.ts', url).href);
            const thread = { id: 'offline-thread', title: 'Offline', status: 'ready', pinned: false, forked: false,
                deleted: false, created_at: 1, updated_at: 1, clock: 1 };
            await db.transaction('rw', getWriteTxTableNames(db, ['threads', 'messages']), async () => {
                await db.threads.put(thread);
                await db.messages.put({ id: 'offline-message', thread_id: thread.id, role: 'user', index: 0,
                    data: { content: 'offline conversation' }, clock: 1, deleted: false, created_at: 1, updated_at: 1 });
                await db.messages.put({ id: 'offline-stream', thread_id: thread.id, role: 'assistant', index: 1, pending: true,
                    data: { content: 'saved streaming progress', generation_lease_id: 'offline-lease', generation_heartbeat_at: Date.now() },
                    clock: 1, deleted: false, created_at: 1, updated_at: 1 });
            });
            await setKvByName('prebind-conflict', 'local loses', db);
            await setKvByName('prebind-edit', 'before edit', db); await setKvByName('prebind-edit', 'after edit', db);
            await setKvByName('prebind-delete', 'local row', db);
            await db.transaction('rw', getWriteTxTableNames(db, 'kv'), () => db.kv.delete('kv:prebind-delete'));
            return { guard: await db.sync_state.get('sync_history'), ops: await db.pending_ops.toArray(),
                stream: await db.messages.get('offline-stream') };
        }, context.clientUrl));
        expect((before[0] as any).guard.firstBindEligible).toBe(true);
        await page.reload();
        other = await page.context().newPage(); await other.goto('/');
        await expect.poll(async () => other!.evaluate(async url => {
            const db = (await import(url)).getDb();
            return { eligible: (await db.sync_state.get('sync_history'))?.firstBindEligible,
                content: (await db.messages.get('offline-message'))?.data?.content };
        }, context.clientUrl)).toEqual({ eligible: true, content: 'offline conversation' });
        await other.evaluate(async url => {
            const db = (await import(url)).getDb();
            await (await import(new URL('./kv.ts', url).href)).setKvByName('during-staging', 'second tab edit', db);
        }, context.clientUrl);
        // Abort the actual native install transaction in either possible lock
        // owner, then restart both documents. Only the injected fault is mocked.
        for (const target of [page, other]) await target.evaluate(async url => {
            const db = (await import(url)).getDb();
            const root = window as any;
            db.sync_state.hook('creating', (_key: string, row: any) => {
                if (row.id === 'sync_history' && row.phase === 'ready') {
                    root.__firstBindQuota = true;
                    throw new DOMException('Injected install quota', 'QuotaExceededError');
                }
            });
        }, context.clientUrl);
        context.releaseBind();
        await expect.poll(async () => (await Promise.all([page, other!].map(target => target.evaluate(() => Boolean((window as any).__firstBindQuota))))).some(Boolean),
            { timeout: 30_000 }).toBe(true);
        before.push(await page.evaluate(async url => {
            const db = (await import(url)).getDb();
            return { afterAbort: true, guard: await db.sync_state.get('sync_history'),
                ops: await db.pending_ops.toArray(), stream: await db.messages.get('offline-stream') };
        }, context.clientUrl));
        expect((before[1] as any).guard.firstBindEligible).toBe(true);
        expect((before[1] as any).stream.data.content).toBe('saved streaming progress');
        await other.close(); other = undefined;
        await page.reload();
    });
    let receipt: unknown;
    await expect.poll(async () => receipt = await page.evaluate(async url => {
        const db = (await import(url)).getDb();
        return { guard: await db.sync_state.get('sync_history'), held: await db.sync_quarantine.toArray(),
            active: await db.pending_ops.filter((op: { status: string }) => !['applied', 'discarded'].includes(op.status)).count(),
            conflict: (await db.kv.get('kv:prebind-conflict'))?.value,
            edit: (await db.kv.get('kv:prebind-edit'))?.value, deleted: await db.kv.get('kv:prebind-delete'),
            during: (await db.kv.get('kv:during-staging'))?.value, messages: await db.messages.toArray() };
    }, clientUrl), { timeout: 30_000 }).toMatchObject({ guard: { firstBindEligible: false, phase: 'ready' }, held: [], active: 0,
        conflict: 'server wins', edit: 'after edit', during: 'second tab edit', deleted: undefined,
        messages: expect.arrayContaining([expect.objectContaining({ id: 'offline-message' }),
            expect.objectContaining({ id: 'offline-stream', pending: true, data: expect.objectContaining({ content: 'saved streaming progress' }) })]) });
    const snapshot = await page.request.post('/api/sync/snapshot', { headers: { origin: String(info.project.use.baseURL), 'x-or3-cloud-intent': 'mutation' }, data: { scope: { workspaceId }, historyIncarnation: null,
        historyIncarnationCapability: 'incarnation-v1', unavailableRecordCapability: 'unavailable-v1', fileKindCapability: 'v1', workspaceItemCapability: 'v1', pageSize: 200 } });
    expect(snapshot.ok(), await snapshot.text()).toBe(true);
    const installed = await snapshot.json();
    expect(installed.items).toEqual(expect.arrayContaining([expect.objectContaining({ tableName: 'threads', pk: 'offline-thread' }),
        expect.objectContaining({ tableName: 'messages', pk: 'offline-message' }), expect.objectContaining({ tableName: 'kv', pk: 'kv:theme_selection' }),
        expect.objectContaining({ tableName: 'kv', pk: 'kv:prebind-delete', kind: 'tombstone' })]));
    await writeFile(info.outputPath('first-bind-receipt.json'), JSON.stringify({ before, installed, receipt }, null, 2));
    await other?.close();
});

test('legacy native migration preserves unknown intent through blocked and aborted upgrades', async ({ page }, info) => {
    const { clientUrl } = await start(page);
    const schema = JSON.parse(await readFile('app/core/sync/__tests__/fixtures/legacy-v31-schema.json', 'utf8'));
    const receipt = await page.evaluate(async ({ url, schema }) => {
        const { Or3DB } = await import(url);
        const Dexie = Object.getPrototypeOf(Or3DB);
        const { HookBridge: LegacyHookBridge } = await import(new URL('../core/sync/__tests__/fixtures/legacy-v31-hook-bridge.ts', url).href);
        const { SnapshotStager } = await import(new URL('../core/sync/snapshot-applier.ts', url).href);
        const name = `h14-legacy-${crypto.randomUUID()}`;
        const old = new Dexie(name); old.version(31).stores(schema);
        old.on('versionchange', () => false);
        const bridge = new LegacyHookBridge(old); bridge.start({ coalesceUnsent: true });
        const current = new Or3DB(name);
        const bytes = new Blob(['legacy attachment bytes']);
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await bytes.arrayBuffer())), b => b.toString(16).padStart(2, '0')).join('');
        const row = { id: 'legacy', name: 'legacy', value: 'before upgrade', deleted: false,
            clock: 1, created_at: 1, updated_at: 1 };
        const oldWrite = (value: string) => old.transaction('rw', ['kv', 'pending_ops', 'tombstones', 'sync_state'],
            () => old.table('kv').put({ ...row, value }));
        const remove = IDBDatabase.prototype.deleteObjectStore;
        let blocked = false, aborted = false;
        try {
            await old.open(); await oldWrite(row.value);
            await old.table('file_blobs').put({ hash, blob: bytes });
            old.on('versionchange', () => false);
            const waiting = new Promise<void>(resolve => current.on('blocked', () => { blocked = true; resolve(); }));
            IDBDatabase.prototype.deleteObjectStore = function(store: string) {
                if (store === 'current_pending_ops') throw new DOMException('Injected native rename quota', 'QuotaExceededError');
                return remove.call(this, store);
            };
            const upgrading = current.open().then(() => null, (error: Error) => error.name);
            await waiting;
            await oldWrite('written while blocked');
            const original = { row: await old.table('kv').get('legacy'), ops: await old.table('pending_ops').toArray() };
            old.close();
            aborted = (await upgrading) !== null;
            IDBDatabase.prototype.deleteObjectStore = remove;
            await old.open();
            const afterAbort = { row: await old.table('kv').get('legacy'), ops: await old.table('pending_ops').toArray(), version: old.backendDB().version,
                bytes: await (await old.table('file_blobs').get(hash)).blob.text() };
            old.close(); await current.open();
            const migrated = { guard: await current.sync_state.get('sync_history'), ops: await current.pending_ops.toArray() };
            const stager = new SnapshotStager(current, { workspaceId: name });
            await stager.start();
            await stager.appendPage({ historyIncarnation: 'I', workspaceId: name, snapshotId: 'native', highWatermark: 0, items: [], nextPageToken: null });
            await stager.apply('native');
            const state = async () => ({ guard: await current.sync_state.get('sync_history'), held: await current.sync_quarantine.toArray(),
                ops: await current.pending_ops.toArray(), rows: await current.kv.toArray(), bytes: await (await current.file_blobs.get(hash)).blob.text() });
            const installed = await state();
            await old.open(); await oldWrite('stale reopened writer');
            await old.table('sync_state').put({ id: 'sync_history', firstBindEligible: true, cursor: 0 });
            await current.open();
            return { blocked, aborted, hash, original, afterAbort, migrated, installed, afterOldWrite: await state() };
        } finally {
            IDBDatabase.prototype.deleteObjectStore = remove;
            bridge.stop(); old.close(); current.close(); await Dexie.delete(name);
        }
    }, { url: clientUrl, schema });
    expect(receipt).toMatchObject({ blocked: true, aborted: true, afterAbort: { version: 310, bytes: 'legacy attachment bytes' } });
    expect(receipt.afterAbort.row).toEqual(receipt.original.row);
    expect(receipt.afterAbort.ops).toEqual(receipt.original.ops);
    expect(receipt.migrated.guard?.firstBindEligible).not.toBe(true);
    expect(receipt.migrated.ops).toEqual(receipt.original.ops);
    expect(receipt.installed.guard).toMatchObject({ firstBindEligible: false, phase: 'ready', historyIncarnation: 'I' });
    expect(receipt.installed.ops).toEqual([]);
    expect(receipt.installed.held.length).toBeGreaterThan(0);
    expect(receipt.installed.held).toEqual(expect.arrayContaining(receipt.original.ops.map((op: unknown) => expect.objectContaining({ variant: 'history_reset', op }))));
    expect(receipt.afterOldWrite).toEqual(receipt.installed);
    expect(receipt.hash).toBe(createHash('sha256').update('legacy attachment bytes').digest('hex'));
    await writeFile(info.outputPath('native-migration-receipt.json'), JSON.stringify(receipt, null, 2));
});

test('complete cloud backup restores independently of browser cache', async ({ page }, info) => {
    test.setTimeout(15 * 60_000);
    const { workspaceId, clientUrl, origin, headers, syncHistory } = await start(page);
    const large = process.env.OR3_BACKUP_LARGE_E2E === 'true';
    const count = large ? 16 : 3;
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
        const chunk = Buffer.alloc(1024 * 1024, !large && index === 1 ? 17 : index + 17);
        const algorithm = !large && index !== 1 ? 'md5' : 'sha256';
        const digest = createHash(algorithm); for (let bytes = 0; bytes < size; bytes += chunk.length) digest.update(chunk);
        const hash = `${algorithm}:${digest.digest('hex')}`; hashes.push(hash);
        const grantResponse = await page.request.post('/api/storage/presign-upload', { headers, data: {
            workspace_id: workspaceId, hash, mime_type: 'text/plain', size_bytes: size, file_kind_capability: 'v1',
        } });
        expect(grantResponse.ok(), await grantResponse.text()).toBe(true);
        const grant = await grantResponse.json();
        async function* content() { for (let bytes = 0; bytes < size; bytes += chunk.length) yield chunk; }
        const uploaded = await fetch(new URL(grant.url, origin), { method: grant.method ?? 'PUT', headers: {
            ...(storageProvider === 'fs' ? { cookie: cookies, 'content-type': 'text/plain' } : {}), ...grant.headers,
        }, body: Readable.from(content()), duplex: 'half' } as RequestInit);
        expect(uploaded.ok, await uploaded.text()).toBe(true);
        const commit = await page.request.post('/api/storage/commit', { headers, data: {
            workspace_id: workspaceId, hash, storage_id: grant.storageId, intent_id: grant.intentId,
            storage_provider_id: storageProvider, mime_type: 'text/plain', size_bytes: size, name: `original-${index}.txt`, kind: 'file', file_kind_capability: 'v1',
        } });
        expect(commit.ok(), await commit.text()).toBe(true);
        const id = randomUUID();
        const saved = await page.request.post('/api/sync/push', { headers, data: { scope: { workspaceId }, ...syncHistory, fileKindCapability: 'v1', workspaceItemCapability: 'v1', ops: [{
            id, tableName: 'file_meta', operation: 'put', pk: hash, payload: { hash, name: `original-${index}.txt`, kind: 'file', mime_type: 'text/plain', size_bytes: size,
                storage_id: grant.storageId, storage_provider_id: storageProvider, ref_count: 0, clock: 1, created_at: 1, updated_at: 1, deleted: false },
            stamp: { deviceId: 'backup-e2e', opId: id, clock: 1, hlc: `${String(Date.now()).padStart(15, '0')}:000000:backup-e2e` }, createdAt: Date.now(), attempts: 0, status: 'pending',
        }] } });
        expect(saved.ok(), await saved.text()).toBe(true); expect((await saved.json()).results[0].success).toBe(true);
    }
    // Keep both MD5/SHA256 identities for identical bytes, including nested references.
    const referencePost = { id: randomUUID(), title: 'Preserved attachment identities', post_type: 'doc',
        content: JSON.stringify({ type: 'doc', content: [{ type: 'or3Image', attrs: { hash: hashes[0] } }] }),
        file_hashes: JSON.stringify(hashes.slice(0, 2)), clock: 1, created_at: 1, updated_at: 1, deleted: false };
    const referenceId = randomUUID();
    const referenceSaved = await page.request.post('/api/sync/push', { headers, data: { scope: { workspaceId }, ...syncHistory, fileKindCapability: 'v1', workspaceItemCapability: 'v1', ops: [{
        id: referenceId, tableName: 'posts', operation: 'put', pk: referencePost.id, payload: referencePost,
        stamp: { deviceId: 'backup-e2e', opId: referenceId, clock: 1, hlc: `${String(Date.now()).padStart(15, '0')}:000000:backup-e2e` }, createdAt: Date.now(), attempts: 0, status: 'pending',
    }] } });
    expect(referenceSaved.ok(), await referenceSaved.text()).toBe(true);
    expect((await referenceSaved.json()).results[0].applied).toBe(true);
    const trashHash = hashes.at(-1)!;
    const trashId = randomUUID();
    const trashed = await page.request.post('/api/sync/push', { headers, data: { scope: { workspaceId }, ...syncHistory, fileKindCapability: 'v1', workspaceItemCapability: 'v1', ops: [{
        id: trashId, tableName: 'file_meta', operation: 'delete', pk: trashHash,
        stamp: { deviceId: 'backup-e2e', opId: trashId, clock: 2, hlc: `${String(Date.now()).padStart(15, '0')}:000001:backup-e2e` }, createdAt: Date.now(), attempts: 0, status: 'pending',
    }] } });
    expect(trashed.ok(), await trashed.text()).toBe(true);
    expect((await trashed.json()).results[0].applied).toBe(true);
    await page.evaluate(async url => { await (await import(url)).getDb().file_blobs.clear(); }, clientUrl);
    const clientExport = await page.evaluate(async url => {
        const { exportCloudWorkspace } = await import(new URL('../utils/cloud-workspace-backup.ts', url).href) as typeof import('../../app/utils/cloud-workspace-backup');
        let bytes = 0, closed = false, aborted = false;
        await exportCloudWorkspace(async () => ({ write: async (chunk: Uint8Array) => { bytes += chunk.length; },
            close: async () => { closed = true; }, abort: async () => { aborted = true; } }));
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
        ...syncHistory, fileKindCapability: 'v1', workspaceItemCapability: 'v1', tables: ['file_meta'] } });
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
        const download = await fetch(new URL(grant.url, origin), { headers: { ...(storageProvider === 'fs' ? { cookie: cookies } : {}), ...grant.headers } });
        expect(download.ok).toBe(true);
        const algorithm = hash.split(':')[0]!;
        const digest = createHash(algorithm); for await (const bytes of Readable.fromWeb(download.body! as never)) digest.update(bytes);
        expect(`${algorithm}:${digest.digest('hex')}`).toBe(hash); verified.push(hash);
    }
    const restoredArchivePath = join(process.env.OR3_FILE_BACKUP_E2E_DIR!, 'restored.or3cloud');
    const restoredExport = await fetch(`${origin}/api/workspaces/backup?workspaceId=${restored.workspaceId}`, { headers: { cookie: cookies } });
    expect(restoredExport.ok).toBe(true);
    await writeFile(restoredArchivePath, Readable.fromWeb(restoredExport.body! as never));
    const archivedHashes: string[] = [];
    let trashPreserved = false, referencesPreserved = false;
    await scanCloudBackup(await openAsBlob(restoredArchivePath), async frame => {
        if (frame.header.type === 'file') archivedHashes.push(frame.header.hash);
        if (frame.header.type === 'row' && frame.header.table === 'posts' && frame.row?.id === referencePost.id) {
            expect(frame.row).toMatchObject({ content: referencePost.content, file_hashes: referencePost.file_hashes });
            referencesPreserved = true;
        }
        if (frame.header.type === 'row' && frame.header.table === 'file_meta') {
            const row = frame.row as { hash: string; deleted: boolean };
            if (row.hash === trashHash) trashPreserved = row.deleted === true;
        }
    });
    expect(archivedHashes.sort()).toEqual([...hashes].sort());
    expect(trashPreserved).toBe(true);
    expect(referencesPreserved).toBe(true);
    await rm(restoredArchivePath);
    const source = await reloaded.request.get(`${origin}/api/workspaces`); expect((await source.json()).workspaces.some((row: { id: string }) => row.id === workspaceId)).toBe(true);
    const path = info.outputPath('roundtrip-receipt.json');
    await writeFile(path, JSON.stringify({ storageProvider, referencesPreserved, bytes: count * size, count, sourceWorkspace: workspaceId, ...restored,
        archiveSha256: archiveDigest.digest('hex'), verifiedHashes: verified, archivedHashes, trashPreserved, sourceKept: true, browserReloadVerified: true, clientExport,
        serverRestart: { before: initial.bootId, after: nextBoot.bootId }, truncatedRestoreRejected: rejected }, null, 2));
    await info.attach('roundtrip-receipt', { path, contentType: 'application/json' });
    await rm(archivePath);
});
