import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
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
        root = mkdtempSync('/tmp/or3-billing-quota-');
        const path = join(root, 'sync.sqlite');
        await runMigrations(await initializeSqliteDb({ path, driver: 'better-sqlite3' }));
        const auth = new SqliteAuthWorkspaceStore();
        alice = (await auth.getOrCreateUser({ provider: 'fixture', providerUserId: 'alice' })).userId;
        bob = (await auth.getOrCreateUser({ provider: 'fixture', providerUserId: 'bob' })).userId;
        first = (await auth.createWorkspace({ userId: alice, name: 'First' })).workspaceId;
        second = (await auth.createWorkspace({ userId: alice, name: 'Second' })).workspaceId;
        third = (await auth.createWorkspace({ userId: bob, name: 'Bob' })).workspaceId;
        store = new BillingStore(join(root, 'billing.sqlite'));
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

    it('charges shared uploads to the canonical owner and keeps deleted workspaces in the allowance', async () => {
        await adapter.presignUpload(event(bob, first, 'editor'), input(first, 'a', 800_000_000));
        getRawDb().prepare('UPDATE workspaces SET deleted = 1 WHERE id = ?').run(first);
        await expect(adapter.presignUpload(event(alice, second), input(second, 'b', 300_000_000))).rejects.toMatchObject({ statusCode: 413 });
        await expect(adapter.presignUpload(event(bob, third), input(third, 'c', 1_000_000_000))).resolves.toHaveProperty('intentId');
        await expect(adapter.presignUpload(event(alice, second, 'viewer'), input(second, 'd', 1))).rejects.toMatchObject({ statusCode: 403 });
    });
});
