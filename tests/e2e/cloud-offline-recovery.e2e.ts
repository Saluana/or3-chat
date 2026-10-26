import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

// Real browser IndexedDB, capture/outbox/subscription, authenticated gateway,
// SQLite and filesystem storage. Only the network faults are synthetic.
// Failure inventory: offline retry exhaustion, loss of durable upload intent,
// reload loss, lost ACK duplicate version, live-claim theft, crashed-owner stall.
test.setTimeout(120_000);
test.beforeAll(() => expect(process.env.OR3_FILE_BACKUP_E2E_DIR).toMatch(/^\/tmp\/or3-file-backup-cloud-/));

async function openWorkspace(page: Page, create = true) {
    const origin = String(test.info().project.use.baseURL);
    const headers = { origin, 'x-or3-cloud-intent': 'mutation' };
    if (create) {
        const login = await page.request.post('/api/basic-auth/sign-in', { headers,
            data: { email: 'file-backup@example.test', password: 'DisposableBackupSuite!123' } });
        expect(login.ok(), await login.text()).toBe(true);
        const workspace = await page.request.post('/api/workspaces', { headers, data: { name: `Sync recovery ${randomUUID()}` } });
        expect(workspace.ok(), await workspace.text()).toBe(true);
        const activate = await page.request.post('/api/workspaces/active', { headers, data: { id: (await workspace.json()).id } });
        expect(activate.ok(), await activate.text()).toBe(true);
    }
    const session = await (await page.request.get('/api/auth/session')).json();
    const workspaceId: string = session.session.workspace.id;
    const requests: string[] = [];
    page.on('request', request => requests.push(request.url()));
    await page.goto('/');
    await expect.poll(() => requests.find(url => /\/db\/client\.ts(?:\?|$)/.test(url)), { timeout: 30_000 }).toBeTruthy();
    const clientUrl = requests.find(url => /\/db\/client\.ts(?:\?|$)/.test(url))!;
    await expect.poll(() => page.evaluate(async url => (await import(url)).getActiveWorkspaceId(), clientUrl), { timeout: 30_000 }).toBe(workspaceId);
    return { clientUrl, workspaceId, headers };
}

async function serverChanges(page: Page, workspaceId: string, headers: Record<string, string>) {
    const response = await page.request.post('/api/sync/pull', { headers,
        data: { scope: { workspaceId }, cursor: 0, limit: 1000, workspaceItemCapability: 'v1', fileKindCapability: 'v1' } });
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()).changes as Array<{ pk: string; stamp: { opId: string }; serverVersion: number; payload: any }>;
}

test('offline edits and original upload survive a closed tab and converge automatically', async ({ page, context }, info) => {
    const { clientUrl, workspaceId, headers } = await openWorkspace(page);
    await page.evaluate(async ({ url, workspaceId }) => {
        await (await import(new URL('../core/storage/file-policy.ts', url).href)).loadFilePolicy(workspaceId);
    }, { url: clientUrl, workspaceId });
    await context.setOffline(true);
    const local = await page.evaluate(async url => {
        const { getDb } = await import(url);
        const { setKvByName } = await import(new URL('./kv.ts', url).href);
        const { createOrRefFile } = await import(new URL('./files.ts', url).href);
        const names: string[] = [];
        for (let i = 0; i < 7; i++) {
            const name = `sync-regression:${i}`; names.push(name);
            await setKvByName(name, `offline value ${i}`);
        }
        const file = await createOrRefFile(new File(['original saved while offline'], 'offline.txt', { type: 'text/plain' }), 'offline.txt');
        await new Promise(resolve => setTimeout(resolve, 20_000));
        return { names, hash: file.hash, pending: await getDb().pending_ops.count(),
            transfers: await getDb().file_transfers.toArray() };
    }, clientUrl);
    expect(local.pending).toBeGreaterThanOrEqual(7);
    expect(local.transfers.some((row: any) => row.hash === local.hash && row.attempts === 0)).toBe(true);
    await page.close();
    await context.setOffline(false);
    const recovered = await context.newPage();
    const reopened = await openWorkspace(recovered, false);
    await expect.poll(() => recovered.evaluate(async ({ url, hash }) => {
        const db = (await import(url)).getDb();
        return { pending: await db.pending_ops.count(), remote: Boolean((await db.file_meta.get(hash))?.storage_id) };
    }, { url: reopened.clientUrl, hash: local.hash }), { timeout: 30_000 }).toEqual({ pending: 0, remote: true });
    const changes = await serverChanges(recovered, workspaceId, headers);
    const records = changes.filter(change => change.payload?.name?.startsWith('sync-regression:'));
    expect(records.map(row => ({ name: row.payload.name, value: row.payload.value }))
        .sort((a, b) => a.name.localeCompare(b.name))).toEqual(
        Array.from({ length: 7 }, (_, index) => ({ name: `sync-regression:${index}`, value: `offline value ${index}` })));
    expect(new Set(records.map(row => row.stamp.opId)).size).toBe(7);
    const downloaded = await recovered.evaluate(async ({ url, hash }) => {
        const queue = (await import(new URL('../core/storage/transfer-queue.ts', url).href)).getStorageTransferQueue();
        // Remove the disposable local cache so this assertion reads the real
        // filesystem original through presign, HTTP and hash verification.
        await (await import(url)).getDb().file_blobs.delete(hash);
        return (await queue.ensureDownloadedBlob(hash))?.text();
    }, { url: reopened.clientUrl, hash: local.hash });
    expect(downloaded).toBe('original saved while offline');
    const receiptPath = info.outputPath('recovery-receipt.json');
    await writeFile(receiptPath, JSON.stringify({ workspaceId, local, serverRecords: records, downloaded }, null, 2));
    await info.attach('recovery-receipt', { path: receiptPath, contentType: 'application/json' });
    await recovered.screenshot({ path: info.outputPath('recovered.png'), fullPage: true });
});

test('a second tab recovers a crashed push owner after a committed response is lost', async ({ page, context }, info) => {
    const { clientUrl, workspaceId, headers } = await openWorkspace(page);
    let committed!: (value: any) => void;
    const receipt = new Promise<any>(resolve => { committed = resolve; });
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/sync/push', async route => {
        const batch = route.request().postDataJSON();
        if (!batch.ops.some((row: any) => row.payload?.name === 'sync-crash-race')) {
            await route.continue();
            return;
        }
        const response = await route.fetch();
        committed({ response: await response.json(), batch: route.request().postDataJSON() });
        await held;
        await route.fulfill({ response }).catch(() => {});
    });
    try {
        await page.evaluate(async url => {
            await (await import(new URL('./kv.ts', url).href)).setKvByName('sync-crash-race', 'persisted exactly once');
        }, clientUrl);
        const first = await receipt;
        expect(first.response.results[0].success).toBe(true);
        const op = first.batch.ops.find((row: any) => row.payload?.name === 'sync-crash-race');
        expect(op).toBeTruthy();
        const peer = await context.newPage();
        const opened = await openWorkspace(peer, false);
        // A live lease must survive another manager starting against the same DB.
        await new Promise(resolve => setTimeout(resolve, 1200));
        const claim = await peer.evaluate(async ({ url, opId }) => {
            const row = (await (await import(url)).getDb().pending_ops.toArray()).find((row: any) => row.stamp.opId === opId);
            return { status: row?.status, expiresAt: row?.claimExpiresAt };
        }, { url: opened.clientUrl, opId: op.stamp.opId });
        expect(claim.status).toBe('in_flight');
        expect(claim.expiresAt).toBeGreaterThan(Date.now());
        const cdp = await context.newCDPSession(page);
        const crashedAt = Date.now();
        const crashed = page.waitForEvent('crash');
        // Chromium cannot reply to the command after terminating its renderer.
        void cdp.send('Page.crash').catch(() => {});
        await crashed;
        release();
        await page.close();
        // Real 60s claim expiry: the already-open peer must wake without reload or
        // manual retry. Its idempotent resend must reuse the committed op/version.
        await expect.poll(() => peer.evaluate(async url => (await import(url)).getDb().pending_ops.count(), opened.clientUrl),
            { timeout: 70_000, intervals: [250, 1000] }).toBe(0);
        const recoveredAt = Date.now();
        expect(recoveredAt).toBeGreaterThanOrEqual(claim.expiresAt);
        const matches = (await serverChanges(peer, workspaceId, headers)).filter(change => change.stamp.opId === op.stamp.opId);
        expect(matches).toHaveLength(1);
        expect(matches[0]!.serverVersion).toBe(first.response.results.find((row: any) => row.opId === op.stamp.opId).serverVersion);
        expect(matches[0]!.payload.value).toBe('persisted exactly once');
        const receiptPath = info.outputPath('crash-race-receipt.json');
        await writeFile(receiptPath, JSON.stringify({ workspaceId, first, canonical: matches, claim, crashedAt, recoveredAt }, null, 2));
        await info.attach('crash-race-receipt', { path: receiptPath, contentType: 'application/json' });
        await peer.screenshot({ path: info.outputPath('crash-recovered.png'), fullPage: true });
    } finally { release(); }
});
