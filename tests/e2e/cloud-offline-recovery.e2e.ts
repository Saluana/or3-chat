import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

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

// Failure inventory (user recovery): failed changes invisible to normal users;
// raw provider errors or payloads shown; retry/discard acting on another
// workspace; unconfirmed or content-deleting discard; a retry that bypasses the
// authorized gateway or applies twice; local backup blocked while Cloud cannot
// drain; a stale list surviving a workspace switch.
test('a normal user recovers failed changes from the workspace sync view', async ({ page, context }, info) => {
    test.setTimeout(180_000);
    await context.addInitScript(() => {
        Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
    });
    const { clientUrl, workspaceId, headers } = await openWorkspace(page);
    await page.getByRole('button', { name: 'Dismiss welcome', exact: true }).click();
    const outbox = (target: Page, url: string, name: string) => target.evaluate(async ({ url, name }) =>
        (await (await import(url)).getDb().pending_ops.toArray())
            .filter((row: any) => row.payload?.name === name)
            .map((row: any) => ({ id: row.id, status: row.status })), { url, name });
    const localValue = (target: Page, url: string, name: string) => target.evaluate(async ({ url, name }) =>
        (await (await import(new URL('./kv.ts', url).href)).getKvByName(name))?.value ?? null, { url, name });
    await expect.poll(() => page.evaluate(async url => (await (await import(url)).getDb().pending_ops.toArray())
        .filter((row: any) => !['applied', 'discarded'].includes(row.status)).length, clientUrl), { timeout: 30_000 }).toBe(0);

    const names = ['sync-recovery-retry', 'sync-recovery-discard', 'sync-recovery-switch'];
    let rejecting = true;
    // The real gateway is reachable; only these records are rejected, as a
    // server-side validation failure would be.
    await context.route('**/api/sync/push', async route => {
        const batch = route.request().postDataJSON();
        if (!rejecting || !batch.ops.some((row: any) => names.includes(row.payload?.name))) {
            await route.continue();
            return;
        }
        await route.fulfill({ json: { serverVersion: 0, results: batch.ops.map((row: any) => ({
            opId: row.stamp.opId, success: false, error: 'Rejected by fixture: secret-detail', errorCode: 'VALIDATION_ERROR',
        })) } });
    });
    await page.evaluate(async url => {
        const { setKvByName } = await import(new URL('./kv.ts', url).href);
        await setKvByName('sync-recovery-retry', 'retry value kept in this browser');
        await setKvByName('sync-recovery-discard', 'discard value kept in this browser');
    }, clientUrl);
    for (const name of names.slice(0, 2)) {
        await expect.poll(() => outbox(page, clientUrl, name), { timeout: 30_000 })
            .toEqual([expect.objectContaining({ status: 'failed_permanent' })]);
    }

    // Discoverable from the permanent-failure notification.
    await page.getByRole('button', { name: 'Notifications' }).click();
    await page.getByRole('button', { name: 'Review sync' }).first().click();
    const view = page.locator('#dashboard-workspace-sync-container');
    await expect(view.getByText('2 changes need attention')).toBeVisible({ timeout: 30_000 });
    const item = (name: string) => view.getByRole('listitem').filter({ hasText: name });
    await expect(item('sync-recovery-retry')).toContainText('The server didn’t accept this change.');
    await expect(view.getByText(/secret-detail|discard value kept/)).toHaveCount(0);

    // A local copy is available while Cloud cannot drain the queue.
    const download = page.waitForEvent('download');
    await view.getByRole('button', { name: 'Save copy', exact: true }).click();
    const backupPath = info.outputPath('browser-copy.or3.jsonl');
    await (await download).saveAs(backupPath);
    const backup = await readFile(backupPath, 'utf8');
    expect(backup).toContain('retry value kept in this browser');
    expect(backup).toContain('discard value kept in this browser');
    await expect(view.getByRole('status').filter({ hasText: 'Browser copy saved' })).toBeVisible();

    // Discard needs an explicit second step and never removes local content.
    await item('sync-recovery-discard').getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(item('sync-recovery-discard')).toContainText('stays saved in this browser');
    await expect(item('sync-recovery-discard').getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    expect(await outbox(page, clientUrl, 'sync-recovery-discard')).toEqual([expect.objectContaining({ status: 'failed_permanent' })]);
    await item('sync-recovery-discard').getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await outbox(page, clientUrl, 'sync-recovery-discard')).toEqual([expect.objectContaining({ status: 'failed_permanent' })]);
    await item('sync-recovery-discard').getByRole('button', { name: 'Discard', exact: true }).click();
    await item('sync-recovery-discard').getByRole('button', { name: 'Discard change', exact: true }).click();
    await expect(item('sync-recovery-discard')).toHaveCount(0);
    expect(await outbox(page, clientUrl, 'sync-recovery-discard')).toEqual([expect.objectContaining({ status: 'discarded' })]);
    expect(await localValue(page, clientUrl, 'sync-recovery-discard')).toBe('discard value kept in this browser');

    // A retry from another tab goes through the authorized gateway once, and
    // this tab's list follows the shared outbox instead of keeping a stale row.
    rejecting = false;
    const peer = await context.newPage();
    const opened = await openWorkspace(peer, false);
    expect(opened.workspaceId).toBe(workspaceId);
    await peer.goto('/chat?dashboard=workspaces&page=sync');
    const peerView = peer.locator('#dashboard-workspace-sync-container');
    await peerView.getByRole('listitem').filter({ hasText: 'sync-recovery-retry' })
        .getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(item('sync-recovery-retry')).toHaveCount(0, { timeout: 30_000 });
    await expect.poll(() => outbox(page, clientUrl, 'sync-recovery-retry'), { timeout: 30_000 }).toEqual([]);
    await expect(view.getByText('No changes waiting to sync')).toBeVisible({ timeout: 30_000 });
    // The discarded local change was never uploaded, so an empty queue must
    // not promise that every browser change exists on the server.
    await expect(view.getByText('Every change saved in this browser has synced.')).toHaveCount(0);
    await peer.close();
    const server = await serverChanges(page, workspaceId, headers);
    const retried = server.filter(change => change.payload?.name === 'sync-recovery-retry');
    expect(retried.map(change => change.payload.value)).toEqual(['retry value kept in this browser']);
    expect(server.filter(change => change.payload?.name === 'sync-recovery-discard')).toEqual([]);

    // Switching workspace replaces the list; the old workspace's failure is untouched.
    rejecting = true;
    await page.evaluate(async url => {
        await (await import(new URL('./kv.ts', url).href)).setKvByName('sync-recovery-switch', 'switch value');
    }, clientUrl);
    await expect.poll(() => outbox(page, clientUrl, 'sync-recovery-switch'), { timeout: 30_000 })
        .toEqual([expect.objectContaining({ status: 'failed_permanent' })]);
    await expect(item('sync-recovery-switch')).toBeVisible();
    const other = await page.request.post('/api/workspaces', { headers, data: { name: `Sync recovery other ${randomUUID()}` } });
    expect(other.ok(), await other.text()).toBe(true);
    const otherId = (await other.json()).id as string;
    const activated = await page.request.post('/api/workspaces/active', { headers, data: { id: otherId } });
    expect(activated.ok(), await activated.text()).toBe(true);
    await page.evaluate(async url => {
        const { useSessionContext } = await import(new URL('../composables/auth/useSessionContext.ts', url).href);
        await useSessionContext().refresh();
    }, clientUrl);
    await expect.poll(() => page.evaluate(async url => (await import(url)).getActiveWorkspaceId(), clientUrl), { timeout: 30_000 }).toBe(otherId);
    await expect(item('sync-recovery-switch')).toHaveCount(0);
    await expect(view.getByText('No changes waiting to sync')).toBeVisible({ timeout: 30_000 });
    const original = await page.evaluate(async ({ url, workspaceId }) =>
        (await (await import(url)).createWorkspaceDb(workspaceId).pending_ops.toArray())
            .filter((row: any) => row.payload?.name === 'sync-recovery-switch').map((row: any) => row.status), { url: clientUrl, workspaceId });
    expect(original).toEqual(['failed_permanent']);

    const receiptPath = info.outputPath('sync-recovery-view-receipt.json');
    await writeFile(receiptPath, JSON.stringify({
        workspaceId, otherWorkspaceId: otherId, serverRetried: retried,
        discarded: await page.evaluate(async ({ url, workspaceId }) =>
            (await (await import(url)).createWorkspaceDb(workspaceId).pending_ops.toArray())
                .filter((row: any) => row.payload?.name === 'sync-recovery-discard').map((row: any) => row.status), { url: clientUrl, workspaceId }),
        originalWorkspaceAfterSwitch: original, browserCopyBytes: backup.length,
    }, null, 2));
    await info.attach('sync-recovery-view-receipt', { path: receiptPath, contentType: 'application/json' });
    await page.screenshot({ path: info.outputPath('sync-recovery-view.png'), fullPage: true });
});
