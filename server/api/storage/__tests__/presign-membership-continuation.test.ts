import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, toWebHandler } from 'h3';
import { testRuntimeConfig } from '../../../../tests/setup';
import { _resetSharedSessionCache, invalidateSharedSessionCacheForIdentity } from '../../../auth/session';

const fixture = vi.hoisted(() => ({
    role: 'owner' as 'owner' | 'editor' | 'viewer' | null,
    query: vi.fn(), sign: vi.fn(), usage: vi.fn(), list: vi.fn(), storeAvailable: true, mutate: vi.fn(),
}));
vi.mock('../../../auth/registry', () => ({ getAuthProvider: () => ({ getSession: async () => ({
    provider: 'synthetic-storage', user: { id: 'synthetic-subject' }, expiresAt: new Date(Date.now() + 60_000),
}) }) }));
vi.mock('../../../auth/deployment-admin', () => ({ getDeploymentAdminChecker: () => ({ checkDeploymentAdmin: async () => false }) }));
vi.mock('../../../auth/store/registry', () => ({ getAuthWorkspaceStore: () => fixture.storeAvailable ? ({
    getUser: async () => ({ userId: 'synthetic-internal' }),
    getOrCreateDefaultWorkspace: async () => ({ workspaceId: 'synthetic-workspace', workspaceName: 'Synthetic' }),
    getWorkspaceRole: async () => fixture.role,
    listUserWorkspaces: fixture.list,
}) : undefined }));
vi.mock('../../../sync/gateway/registry', () => ({ getActiveSyncGatewayAdapter: () => ({ queryCanonicalStorage: fixture.query }) }));
vi.mock('../../../storage/gateway/registry', () => ({ getActiveStorageGatewayAdapter: () => ({ presignDownload: fixture.sign, presignUpload: fixture.sign }) }));

// This fixture isolates the already-authorized admin route mutation/invalidation path.
// Admin authentication itself is covered by its canonical route-policy suites.
vi.mock('../../../admin/api', () => ({ requireAdminApiContext: async () => ({
    principal: { kind: 'workspace_admin' }, session: { workspace: { id: 'synthetic-workspace' } },
}) }));
vi.mock('../../../admin/stores/registry', () => ({ getWorkspaceAccessStore: () => ({
    removeMember: fixture.mutate, setMemberRole: fixture.mutate,
}) }));
import removeMemberHandler from '../../admin/workspace/members/remove.post';
import setRoleHandler from '../../admin/workspace/members/set-role.post';

vi.mock('../../../utils/security/cloud-mutation', () => ({ requireCloudMutation: vi.fn() }));
vi.mock('../../../utils/storage/quota', () => ({ getWorkspaceStorageUsageSnapshot: fixture.usage }));
import downloadHandler from '../presign-download.post';
import uploadHandler from '../presign-upload.post';
const hash = `sha256:${'a'.repeat(64)}`;
const page = { items: [{ kind: 'metadata', hash, storageId: 'synthetic-object', mimeType: 'image/png', fileKind: 'image', updatedAt: 1 }], hasMore: false };

describe('storage signing membership continuation with real session caching', () => {
    beforeEach(() => {
        _resetSharedSessionCache();
        vi.stubGlobal('useRuntimeConfig', () => testRuntimeConfig.value);
        fixture.role = 'owner';
        fixture.mutate.mockReset().mockImplementation(async (input: { role?: 'owner' | 'editor' | 'viewer' }) => { fixture.role = input.role ?? null; });
        fixture.storeAvailable = true;
        fixture.list.mockReset().mockImplementation(async () => fixture.role ? [{ id: 'synthetic-workspace', name: 'Synthetic', role: fixture.role }] : []);
        fixture.query.mockReset().mockResolvedValue(page);
        fixture.usage.mockReset().mockResolvedValue({ usedBytes: 0, reservedBytes: 0, filesByHash: new Map() });
        fixture.sign.mockReset().mockResolvedValue({ url: '/synthetic-download', expiresAt: Date.now() + 60_000 });
        testRuntimeConfig.value = { ...testRuntimeConfig.value,
            auth: { ...testRuntimeConfig.value.auth, enabled: true, provider: 'synthetic-storage', registrationMode: 'closed' },
            storage: { enabled: true }, sync: { provider: 'synthetic-store' },
            public: { ...testRuntimeConfig.value.public, sync: { provider: 'synthetic-store' } },
        };
    });
    afterEach(() => { vi.unstubAllGlobals(); _resetSharedSessionCache(); });
    it.each(['unavailable', 'failed-read', 'foreign-only'] as const)('fails closed and recovers after membership provider %s', async fault => {
        let resume!: () => void;
        let entered!: () => void;
        const held = new Promise<void>(resolve => { resume = resolve; });
        const started = new Promise<void>(resolve => { entered = resolve; });
        fixture.query.mockImplementationOnce(async () => { entered(); await held; return page; });
        const request = toWebHandler(createApp().use(downloadHandler));
        const input = () => new Request('http://synthetic.test/presign', { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ workspace_id: 'synthetic-workspace', hash }) });
        const response = request(input());
        await Promise.race([started, response.then(() => { throw new Error('Fixture did not reach metadata'); })]);
        if (fault === 'unavailable') fixture.storeAvailable = false;
        if (fault === 'failed-read') fixture.list.mockRejectedValueOnce(new Error('synthetic-private-provider-detail'));
        if (fault === 'foreign-only') fixture.list.mockResolvedValueOnce([{ id: 'foreign-workspace', name: 'Synthetic foreign', role: 'owner' }]);
        resume();
        const denied = await response;
        expect(denied.status).toBe(fault === 'foreign-only' ? 403 : 503);
        expect(await denied.text()).not.toContain('synthetic-private-provider-detail');
        expect(fixture.sign).not.toHaveBeenCalled();
        fixture.storeAvailable = true;
        expect((await request(input())).status).toBe(200);
        expect(fixture.sign).toHaveBeenCalledOnce();
    });
    for (const stage of ['before signing', 'after signing'] as const) {
        for (const operation of ['download', 'upload'] as const) {
            it.each(['removed', 'viewer', 'editor'] as const)(`uses current membership %s for ${operation} when its ${stage} lookup returns a stale snapshot`, async role => {
                let resume!: () => void;
                let entered!: () => void;
                const held = new Promise<void>(resolve => { resume = resolve; });
                const started = new Promise<void>(resolve => { entered = resolve; });
                if (stage === 'after signing') fixture.list.mockImplementationOnce(async () => [{ id: 'synthetic-workspace', name: 'Synthetic', role: 'owner' }]);
                fixture.list.mockImplementationOnce(async () => {
                    const snapshot = [{ id: 'synthetic-workspace', name: 'Synthetic', role: fixture.role }];
                    entered(); await held; return snapshot;
                });
                const request = toWebHandler(createApp().use(operation === 'upload' ? uploadHandler : downloadHandler));
                const response = request(new Request('http://synthetic.test/presign', { method: 'POST', headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ workspace_id: 'synthetic-workspace', hash, ...(operation === 'upload' ? { mime_type: 'image/png', size_bytes: 3 } : {}) }),
                }));
                await Promise.race([started, response.then(() => { throw new Error('Fixture did not reach held membership read'); })]);
                fixture.role = role === 'removed' ? null : role;
                invalidateSharedSessionCacheForIdentity({ provider: 'synthetic-storage', providerUserId: 'synthetic-subject', storeId: 'synthetic-store' });
                resume();
                const result = await response;
                const permitted = role !== 'removed' && (operation === 'download' || role === 'editor');
                expect(result.status).toBe(permitted ? 200 : 403);
                if (!permitted) expect(await result.text()).not.toContain('/synthetic-download');
                expect(fixture.sign).toHaveBeenCalledTimes(!permitted && stage === 'before signing' ? 0 : 1);
            });
        }
        it(`bounds retries under repeated membership invalidation ${stage}`, async () => {
            if (stage === 'after signing') fixture.list.mockImplementationOnce(async () => [{ id: 'synthetic-workspace', name: 'Synthetic', role: 'owner' }]);
            fixture.list.mockImplementation(async () => {
                invalidateSharedSessionCacheForIdentity({ provider: 'synthetic-storage', providerUserId: 'synthetic-subject', storeId: 'synthetic-store' });
                return [{ id: 'synthetic-workspace', name: 'Synthetic', role: 'owner' }];
            });
            const request = toWebHandler(createApp().use(downloadHandler));
            const result = await request(new Request('http://synthetic.test/presign', { method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ workspace_id: 'synthetic-workspace', hash }),
            }));
            expect(result.status).toBe(503);
            expect(await result.text()).not.toContain('/synthetic-download');
            expect(fixture.list).toHaveBeenCalledTimes(stage === 'before signing' ? 3 : 4);
            expect(fixture.sign).toHaveBeenCalledTimes(stage === 'before signing' ? 0 : 1);
        });
    }
    it('preserves the read when an unrelated identity is invalidated during membership lookup', async () => {
        fixture.list.mockImplementationOnce(async () => {
            invalidateSharedSessionCacheForIdentity({ provider: 'synthetic-storage', providerUserId: 'unrelated-subject', storeId: 'synthetic-store' });
            return [{ id: 'synthetic-workspace', name: 'Synthetic', role: 'owner' }];
        });
        const request = toWebHandler(createApp().use(downloadHandler));
        expect((await request(new Request('http://synthetic.test/presign', { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ workspace_id: 'synthetic-workspace', hash }),
        }))).status).toBe(200);
        expect(fixture.list).toHaveBeenCalledTimes(2);
    });

    for (const operation of ['download', 'upload'] as const) {
        it.each(['removed', 'viewer', 'editor'] as const)(`fences ${operation} when an admin route changes membership %s during final membership lookup`, async role => {
            let resume!: () => void;
            let entered!: () => void;
            const held = new Promise<void>(resolve => { resume = resolve; });
            const started = new Promise<void>(resolve => { entered = resolve; });
            fixture.list.mockImplementationOnce(async () => [{ id: 'synthetic-workspace', name: 'Synthetic', role: 'owner' }]);
            fixture.list.mockImplementationOnce(async () => {
                const snapshot = [{ id: 'synthetic-workspace', name: 'Synthetic', role: fixture.role }];
                entered(); await held; return snapshot;
            });
            const request = toWebHandler(createApp().use(operation === 'upload' ? uploadHandler : downloadHandler));
            const input = () => new Request('http://synthetic.test/presign', { method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ workspace_id: 'synthetic-workspace', hash, ...(operation === 'upload' ? { mime_type: 'image/png', size_bytes: 3 } : {}) }),
            });
            const response = request(input());
            await Promise.race([started, response.then(() => { throw new Error('Fixture did not reach final membership read'); })]);
            const admin = toWebHandler(createApp().use(role === 'removed' ? removeMemberHandler : setRoleHandler));
            const mutation = await admin(new Request('http://synthetic.test/admin/mutate', { method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ workspaceId: 'synthetic-workspace', userId: 'synthetic-internal', ...(role === 'removed' ? {} : { role }) }),
            }));
            expect(mutation.status).toBe(200);
            expect(fixture.mutate).toHaveBeenCalledWith({ workspaceId: 'synthetic-workspace', userId: 'synthetic-internal', ...(role === 'removed' ? {} : { role }) });
            resume();
            const result = await response;
            const permitted = role !== 'removed' && (operation === 'download' || role === 'editor');
            expect(result.status).toBe(permitted ? 200 : 403);
            if (!permitted) expect(await result.text()).not.toContain('/synthetic-download');
            expect(fixture.list).toHaveBeenCalledTimes(3);
            expect(fixture.sign).toHaveBeenCalledOnce();
            // The same admin path restores access; denied signing does not poison recovery.
            const restore = toWebHandler(createApp().use(setRoleHandler));
            expect((await restore(new Request('http://synthetic.test/admin/mutate', { method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ workspaceId: 'synthetic-workspace', userId: 'synthetic-internal', role: 'editor' }),
            }))).status).toBe(200);
            expect((await request(input())).status).toBe(200);
        });
    }
    it.each(['unrelated-store', 'global'] as const)('handles %s invalidation during a membership read', async scope => {
        fixture.list.mockImplementationOnce(async () => {
            invalidateSharedSessionCacheForIdentity(scope === 'global' ? {} : { storeId: 'unrelated-store' });
            return [{ id: 'synthetic-workspace', name: 'Synthetic', role: 'owner' }];
        });
        const request = toWebHandler(createApp().use(downloadHandler));
        expect((await request(new Request('http://synthetic.test/presign', { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ workspace_id: 'synthetic-workspace', hash }),
        }))).status).toBe(200);
        expect(fixture.list).toHaveBeenCalledTimes(scope === 'global' ? 3 : 2);
    });

    for (const operation of ['download', 'upload'] as const) {
        const stages = operation === 'download' ? ['canonical metadata', 'signer'] as const : ['quota', 'signer'] as const;
        for (const stage of stages) {
            it.each(['removed', 'viewer', 'owner'] as const)(`uses current membership %s for ${operation} after held ${stage} resumes`, async role => {
                testRuntimeConfig.value.storage = { ...testRuntimeConfig.value.storage, workspaceQuotaBytes: 100_000 };
                let resume!: () => void;
                let entered!: () => void;
                const held = new Promise<void>(resolve => { resume = resolve; });
                const started = new Promise<void>(resolve => { entered = resolve; });
                if (stage === 'canonical metadata') fixture.query.mockImplementationOnce(async () => { entered(); await held; return page; });
                else if (stage === 'quota') fixture.usage.mockImplementationOnce(async () => { entered(); await held; return { usedBytes: 0, reservedBytes: 0, filesByHash: new Map() }; });
                else fixture.sign.mockImplementationOnce(async () => { entered(); await held; return { url: '/synthetic-download', expiresAt: Date.now() + 60_000 }; });
                const request = toWebHandler(createApp().use(operation === 'upload' ? uploadHandler : downloadHandler));
                const response = request(new Request('http://synthetic.test/presign', { method: 'POST',
                    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace_id: 'synthetic-workspace', hash, ...(operation === 'upload' ? { mime_type: 'image/png', size_bytes: 3 } : {}) }),
                }));
                await Promise.race([started, response.then(() => { throw new Error('Fixture did not reach canonical read'); })]);
                fixture.role = role === 'removed' ? null : role;
                invalidateSharedSessionCacheForIdentity({ provider: 'synthetic-storage', providerUserId: 'synthetic-subject', storeId: 'synthetic-store' });
                resume();
                const result = await response;
                const permitted = operation === 'upload' ? role === 'owner' : role !== 'removed';
                expect(result.status).toBe(permitted ? 200 : 403);
                expect(fixture.sign).toHaveBeenCalledTimes(!permitted && stage !== 'signer' ? 0 : 1);
            });
        }
    }
});
