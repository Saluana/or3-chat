import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { H3Event } from 'h3';
import type { StorageGatewayAdapter, PresignUploadRequest } from '~~/server/storage/gateway/types';
import { BillingStore } from '../runtime/server/store';
import { AccountStorageQuota } from '../runtime/server/quota';
import { initializeSqliteDb, destroySqliteDb, _resetForTest, getRawDb } from '~~/node_modules/or3-provider-sqlite/dist/runtime/server/db/kysely.js';
import { runMigrations } from '~~/node_modules/or3-provider-sqlite/dist/runtime/server/db/migrate.js';
import { SqliteAuthWorkspaceStore } from '~~/node_modules/or3-provider-sqlite/dist/runtime/server/auth/sqlite-auth-workspace-store.js';
import { SqliteSyncGatewayAdapter } from '~~/node_modules/or3-provider-sqlite/dist/runtime/server/sync/sqlite-sync-gateway-adapter.js';

vi.mock('~~/server/auth/session', () => ({ resolveSessionContext: async (event: H3Event) => event.context.__or3_session_context_fixture }));
vi.mock('~~/server/utils/webhooks/runtime', () => ({ emitWebhookSystemHook: async () => {} }));

describe('account-wide billing quotas with the installed SQLite provider', () => {
    let root: string, alice: string, bob: string, first: string, second: string, third: string;
    let store: BillingStore, quota: AccountStorageQuota, sync: SqliteSyncGatewayAdapter, adapter: StorageGatewayAdapter;
    function event(userId: string, workspaceId: string, role = 'owner'): H3Event {
        return { context: { __or3_session_context_fixture: { authenticated: true, user: { id: userId }, workspace: { id: workspaceId }, role } }, node: { res: { setHeader() {} } } } as unknown as H3Event;
    }
    function input(workspaceId: string, hash: string, sizeBytes: number): PresignUploadRequest {
        return { workspaceId, hash: hash.repeat(64), sizeBytes, mimeType: 'video/mp4' };
    }
    beforeEach(async () => {
        _resetForTest();
        root = mkdtempSync(join(tmpdir(), 'or3-billing-quota-'));
        const path = join(root, 'sync.sqlite');
        await runMigrations(await initializeSqliteDb({ path, driver: 'better-sqlite3' }));
        const auth = new SqliteAuthWorkspaceStore();
        alice = (await auth.getOrCreateUser({ provider: 'fixture', providerUserId: 'alice' })).userId;
        bob = (await auth.getOrCreateUser({ provider: 'fixture', providerUserId: 'bob' })).userId;
        first = (await auth.createWorkspace({ userId: alice, name: 'First' })).workspaceId;
        second = (await auth.createWorkspace({ userId: alice, name: 'Second' })).workspaceId;
        third = (await auth.createWorkspace({ userId: bob, name: 'Bob' })).workspaceId;
        store = new BillingStore(join(root, 'billing.sqlite'));
        store.claimTrial(alice, 'alice@example.test', '192.0.2.1');
        store.claimTrial(bob, 'bob@example.test', '192.0.2.2');
        quota = new AccountStorageQuota(path, store);
        sync = new SqliteSyncGatewayAdapter();
        adapter = quota.decorate({
            id: 's3', atomicUploadQuota: 'retained-v1',
            presignDownload: async () => ({ url: 'https://storage.example/download' }),
            presignUpload: async (requestEvent, request) => {
                const intentId = randomUUID();
                await sync.reserveUploadIntent(requestEvent, { ...request, intentId, expiresAt: Math.floor(Date.now() / 1000) + 900 });
                return { url: 'https://storage.example/upload', intentId };
            },
        });
    });
    afterEach(async () => {
        quota?.close(); store?.close(); await destroySqliteDb(); _resetForTest();
        rmSync(root, { recursive: true, force: true });
    });

    it('counts retained bytes and pending uploads across owned workspaces without charging another account', async () => {
        const file = input(first, 'a', 600_000_000);
        const upload = await adapter.presignUpload(event(alice, first), file);
        await sync.consumeUploadIntent(event(alice, first), { ...file, intentId: upload.intentId!, storageId: 'committed' });
        await expect(adapter.presignUpload(event(alice, second), input(second, 'b', 500_000_000))).rejects.toMatchObject({ statusCode: 413 });
        await adapter.presignUpload(event(alice, second), input(second, 'c', 400_000_000));
        await expect(adapter.presignUpload(event(alice, first), input(first, 'd', 1))).rejects.toMatchObject({ statusCode: 413 });
        await expect(adapter.presignUpload(event(bob, third), input(third, 'e', 1_000_000_000))).resolves.toHaveProperty('intentId');
        // Reusing the same digest does not consume the allowance twice.
        await expect(adapter.presignUpload(event(alice, first), file)).resolves.toHaveProperty('intentId');
    });

    it('serializes parallel reservations and applies admin limit changes without deleting files', async () => {
        const results = await Promise.allSettled([
            adapter.presignUpload(event(alice, first), input(first, 'a', 700_000_000)),
            adapter.presignUpload(event(alice, second), input(second, 'b', 700_000_000)),
        ]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        const settings = store.settings();
        store.saveSettings({ ...settings, trialStorageGb: 2 });
        await expect(adapter.presignUpload(event(alice, second), input(second, 'c', 700_000_000))).resolves.toHaveProperty('intentId');
        store.saveSettings({ ...store.settings(), trialStorageGb: 1 });
        await expect(adapter.presignUpload(event(alice, first), input(first, 'd', 1))).rejects.toMatchObject({ statusCode: 413 });
        expect(getRawDb().prepare('SELECT count(*) AS count FROM upload_intents').get()).toMatchObject({ count: 2 });
    });

    it('holds expired uploads against the owner allowance and permits retrying the same file', async () => {
        const file = input(first, 'a', 700_000_000);
        const upload = await adapter.presignUpload(event(alice, first), file);
        getRawDb().prepare("UPDATE upload_intents SET status = 'expired', expires_at = ? WHERE id = ?")
            .run(Math.floor(Date.now() / 1000) - 1, upload.intentId);
        await expect(adapter.presignUpload(event(alice, second), input(second, 'b', 400_000_000)))
            .rejects.toMatchObject({ statusCode: 413 });
        expect(quota.usedBytes(alice)).toBe(700_000_000);
        const retry = await adapter.presignUpload(event(alice, first), file);
        await sync.consumeUploadIntent(event(alice, first), { ...file, intentId: retry.intentId!, storageId: 'committed' });
        expect(quota.usedBytes(alice)).toBe(700_000_000);
        await expect(adapter.presignUpload(event(bob, third), input(third, 'c', 1_000_000_000)))
            .resolves.toHaveProperty('intentId');
    });

    it('counts expired active intents but not intents canceled before a signed URL was issued', async () => {
        const firstUpload = await adapter.presignUpload(event(alice, first), input(first, 'a', 600_000_000));
        getRawDb().prepare('UPDATE upload_intents SET expires_at = ? WHERE id = ?')
            .run(Math.floor(Date.now() / 1000) - 1, firstUpload.intentId);
        expect(quota.usedBytes(alice)).toBe(600_000_000);
        const canceled = await adapter.presignUpload(event(alice, second), input(second, 'b', 400_000_000));
        await sync.cancelUploadIntent(event(alice, second), { workspaceId: second, intentId: canceled.intentId! });
        expect(quota.usedBytes(alice)).toBe(600_000_000);
        await expect(adapter.presignUpload(event(alice, second), input(second, 'c', 400_000_000)))
            .resolves.toHaveProperty('intentId');
    });

    it('charges shared uploads to the canonical owner and keeps deleted workspaces in the allowance', async () => {
        await adapter.presignUpload(event(bob, first, 'editor'), input(first, 'a', 800_000_000));
        getRawDb().prepare('UPDATE workspaces SET deleted = 1 WHERE id = ?').run(first);
        await expect(adapter.presignUpload(event(alice, second), input(second, 'b', 300_000_000))).rejects.toMatchObject({ statusCode: 413 });
        await expect(adapter.presignUpload(event(bob, third), input(third, 'c', 1_000_000_000))).resolves.toHaveProperty('intentId');
        await expect(adapter.presignUpload(event(alice, second, 'viewer'), input(second, 'd', 1))).rejects.toMatchObject({ statusCode: 403 });
    });

    /*
     * Stage B failure inventory (task 5.1), written before the breakdown/explanation code:
     * - the breakdown total must equal the admission total for the same snapshot, including
     *   active and expired reservations, without double counting a same-hash retry;
     * - retained bytes in a deleted workspace stay charged and are reported separately;
     * - a smaller workspace cap is reported as the controlling constraint, not the account allowance;
     * - a refused upload and the explanation must name the same controlling constraint;
     * - lowering a limit refuses further admission but never deletes files;
     * - unreadable accounting is unknown (503 / null), never zero.
     */
    it('breaks charged storage down from one snapshot that matches admission', async () => {
        const committed = input(first, 'a', 300_000_000);
        const upload = await adapter.presignUpload(event(alice, first), committed);
        await sync.consumeUploadIntent(event(alice, first), { ...committed, intentId: upload.intentId!, storageId: 'committed' });
        const expired = await adapter.presignUpload(event(alice, second), input(second, 'b', 200_000_000));
        getRawDb().prepare("UPDATE upload_intents SET status = 'expired' WHERE id = ?").run(expired.intentId);
        await adapter.presignUpload(event(alice, second), input(second, 'c', 100_000_000));
        // Retrying the same hash in the same workspace is not charged twice.
        await adapter.presignUpload(event(alice, second), input(second, 'c', 100_000_000));
        getRawDb().prepare('UPDATE workspaces SET deleted = 1 WHERE id = ?').run(first);
        const breakdown = quota.breakdown(alice);
        expect(breakdown).toMatchObject({
            chargedBytes: 600_000_000, retainedBytes: 300_000_000, reservedBytes: 300_000_000,
            expiredReservedBytes: 200_000_000, activeReservedBytes: 100_000_000, deletedWorkspaceBytes: 300_000_000,
        });
        expect(breakdown.chargedBytes).toBe(quota.usedBytes(alice));
        expect(breakdown.workspaces.find(workspace => workspace.workspaceId === first)).toMatchObject({ deleted: true, chargedBytes: 300_000_000 });
        expect(breakdown.workspaces.reduce((sum, workspace) => sum + workspace.chargedBytes, 0)).toBe(breakdown.chargedBytes);
    });

    it('explains the same controlling constraint that admission enforces', async () => {
        const accountRefusal = await adapter.presignUpload(event(alice, first), input(first, 'a', 1_200_000_000)).catch(error => error);
        expect(accountRefusal).toMatchObject({ statusCode: 413, data: { code: 'storage_quota_exceeded', constraint: 'account_allowance' } });
        const preview = quota.explain(alice, { workspaceId: first, sizeBytes: 1_200_000_000, hash: 'a'.repeat(64) });
        expect(preview.controlling).toBe('account_allowance');
        // A smaller workspace cap controls even though the account has room.
        const capped = quota.explain(alice, { workspaceId: first, sizeBytes: 300_000_000, hash: 'b'.repeat(64), workspaceCapBytes: 200_000_000 });
        expect(capped.controlling).toBe('workspace_cap');
        expect(capped.checks.find(check => check.check === 'account_allowance')).toMatchObject({ status: 'pass' });
        expect(quota.explain(alice, { workspaceId: first }).controlling).toBeNull();
        expect(quota.explain(alice, { workspaceId: first }).checks.find(check => check.check === 'owner_entitlement')).toMatchObject({ status: 'pass' });
    });

    it('keeps unstarted-account explanations read-only', () => {
        expect(store.findAccount('unstarted')).toBeNull();
        expect(quota.explain('unstarted', { workspaceId: first }).checks[0]).toMatchObject({ check: 'owner_entitlement', status: 'fail' });
        expect(store.findAccount('unstarted')).toBeNull();
    });

    it('reports the same deleted workspace charge in account and deployment views', async () => {
        await adapter.presignUpload(event(alice, first), input(first, 'd', 123_000_000));
        getRawDb().prepare('UPDATE workspaces SET deleted = 1 WHERE id = ?').run(first);
        expect(quota.breakdown(alice).deletedWorkspaceBytes).toBe(123_000_000);
        const summary = quota.deploymentSummary();
        expect(summary.deletedWorkspaceBytes).toBe(123_000_000);
        // The breakdown parts never overlap: a reservation in a deleted workspace is
        // neither an active-workspace reservation nor subtracted from active files.
        expect(summary).toMatchObject({ activeWorkspaceRetainedBytes: 0, activeWorkspaceReservedBytes: 0 });
        expect(summary.activeWorkspaceRetainedBytes + summary.activeWorkspaceReservedBytes + summary.deletedWorkspaceBytes).toBe(summary.chargedBytes);
    });

    it('reports unreadable accounting as unknown, never zero', () => {
        getRawDb().exec('DROP TRIGGER IF EXISTS retained_storage_insert');
        getRawDb().exec('DROP TABLE storage_usage');
        expect(() => quota.breakdown(alice)).toThrow();
        expect(quota.explain(alice, { workspaceId: first, sizeBytes: 1 }).checks.find(check => check.check === 'account_allowance')).toMatchObject({ status: 'unknown' });
    });
});
