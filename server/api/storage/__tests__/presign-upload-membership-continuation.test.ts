import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, toWebHandler } from 'h3';
import { testRuntimeConfig } from '../../../../tests/setup';
import { _resetSharedSessionCache, invalidateSharedSessionCacheForIdentity } from '../../../auth/session';

const fixture = vi.hoisted(() => ({
    role: 'owner' as 'owner' | 'viewer' | null,
    sign: vi.fn(), usage: vi.fn(), list: vi.fn(), storeAvailable: true,
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
vi.mock('../../../storage/gateway/registry', () => ({ getActiveStorageGatewayAdapter: () => ({ presignUpload: fixture.sign }) }));

vi.mock('../../../utils/security/cloud-mutation', () => ({ requireCloudMutation: vi.fn() }));
vi.mock('../../../utils/storage/quota', () => ({ getWorkspaceStorageUsageSnapshot: fixture.usage }));
import handler from '../presign-upload.post';
const hash = `sha256:${'a'.repeat(64)}`;

describe('upload signing membership continuation with real session caching', () => {
    beforeEach(() => {
        _resetSharedSessionCache();
        vi.stubGlobal('useRuntimeConfig', () => testRuntimeConfig.value);
        fixture.role = 'owner';
        fixture.storeAvailable = true;
        fixture.list.mockReset().mockImplementation(async () => fixture.role ? [{ id: 'synthetic-workspace', name: 'Synthetic', role: fixture.role }] : []);
        fixture.usage.mockReset().mockResolvedValue({ usedBytes: 0, reservedBytes: 0, filesByHash: new Map() });
        fixture.sign.mockReset().mockResolvedValue({ url: '/synthetic-download', expiresAt: Date.now() + 60_000 });
        testRuntimeConfig.value = { ...testRuntimeConfig.value,
            auth: { ...testRuntimeConfig.value.auth, enabled: true, provider: 'synthetic-storage', registrationMode: 'closed' },
            storage: { enabled: true, workspaceQuotaBytes: 100_000 }, sync: { provider: 'synthetic-store' },
            public: { ...testRuntimeConfig.value.public, sync: { provider: 'synthetic-store' } },
        };
    });
    afterEach(() => { vi.unstubAllGlobals(); _resetSharedSessionCache(); });
    for (const stage of ['quota', 'signer'] as const) {
        it.each(['removed', 'viewer', 'owner'] as const)(`uses current membership %s after held ${stage} resumes`, async role => {
            let resume!: () => void;
            let entered!: () => void;
            const held = new Promise<void>(resolve => { resume = resolve; });
            const started = new Promise<void>(resolve => { entered = resolve; });
            if (stage === 'quota') fixture.usage.mockImplementationOnce(async () => { entered(); await held; return { usedBytes: 0, reservedBytes: 0, filesByHash: new Map() }; });
            else fixture.sign.mockImplementationOnce(async () => { entered(); await held; return { url: '/synthetic-download', expiresAt: Date.now() + 60_000 }; });
            const request = toWebHandler(createApp().use(handler));
            const response = request(new Request('http://synthetic.test/presign', { method: 'POST',
                headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace_id: 'synthetic-workspace', hash, mime_type: 'image/png', size_bytes: 3 }),
            }));
            await Promise.race([started, response.then(() => { throw new Error('Fixture did not reach canonical read'); })]);
            fixture.role = role === 'removed' ? null : role;
            invalidateSharedSessionCacheForIdentity({ provider: 'synthetic-storage', providerUserId: 'synthetic-subject', storeId: 'synthetic-store' });
            resume();
            const result = await response;
            expect(result.status).toBe(role === 'owner' ? 200 : 403);
            expect(fixture.sign).toHaveBeenCalledTimes(role !== 'owner' && stage === 'quota' ? 0 : 1);
        });
    }
});
