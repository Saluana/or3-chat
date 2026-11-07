import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, toWebHandler } from 'h3';

// Transport failures: unqualified providers must not run, raw object targets
// must not be accepted, and journal failure must stop a destructive operation.
const deps = vi.hoisted(() => ({ sync: null as any, storage: null as any, journal: vi.fn() }));
vi.mock('../../../../admin/customers', async importOriginal => ({ ...(await importOriginal()), requireSupportAdmin: vi.fn().mockResolvedValue('admin') }));
vi.mock('../../../../admin/auth/rate-limit', () => ({ enforceGenericAdminRateLimit: vi.fn() }));
vi.mock('../../../../sync/gateway/registry', () => ({ getActiveSyncGatewayAdapter: () => deps.sync }));
vi.mock('../../../../storage/gateway/registry', () => ({ getActiveStorageGatewayAdapter: () => deps.storage }));
vi.mock('../../../../admin/activity/journal', () => ({ withAdminJournal: deps.journal }));
import cleanup from '../cleanup.post';

const request = toWebHandler(createApp().use('/api/admin/storage/cleanup', cleanup));
const post = (body: unknown) => request(new Request('http://localhost/api/admin/storage/cleanup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
describe('cleanup HTTP boundary', () => {
    beforeEach(() => { deps.sync = null; deps.storage = null; deps.journal.mockReset(); });
    it('refuses an unqualified provider before invoking the journal', async () => {
        expect((await post({ workspaceId: 'workspace', generationIds: ['generation'] })).status).toBe(503);
        expect(deps.journal).not.toHaveBeenCalled();
    });
    it('does not accept physical targets or arbitrary batch settings', async () => {
        for (const extra of [{ path: '/tmp/file' }, { retentionSeconds: 0 }, { limit: 1000 }]) {
            expect((await post({ workspaceId: 'workspace', generationIds: ['generation'], ...extra })).status).toBe(400);
        }
        for (const generationIds of [[], ['same', 'same'], Array(26).fill('generation'), ['../file']]) expect((await post({ workspaceId: 'workspace', generationIds })).status).toBe(400);
    });
    it('records the operation before executing a bounded page and returns progress', async () => {
        const reclaimBatch = vi.fn().mockResolvedValue({ examined: 2, completed: 1, blocked: 1, pending: 0, complete: false, nextCursor: 'cursor' });
        const coordinator = { version: 1, storageProviderId: 'fs', registerVerifiedGeneration() {}, getGeneration() {}, claimGeneration() {}, completeDeletion() {} };
        deps.sync = { id: 'sqlite', capabilities: { externalStorageGenerations: 'v1' }, storageGenerationCoordinator: coordinator };
        deps.storage = { id: 'fs', externalStorageGenerations: { version: 1, syncProviderId: 'sqlite', reclaimBatch } };
        deps.journal.mockImplementation(async (_input, work) => work());
        const response = await post({ workspaceId: 'workspace', generationIds: ['generation'] });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ completed: 1, blocked: 1, nextCursor: 'cursor' });
        expect(reclaimBatch).toHaveBeenCalledWith({ workspaceId: 'workspace', retentionSeconds: 604800, limit: 25, cursor: undefined, generationIds: ['generation'] }, coordinator);
        deps.journal.mockRejectedValueOnce(new Error('journal unavailable'));
        expect((await post({ workspaceId: 'workspace', generationIds: ['generation'] })).status).toBe(500);
        expect(reclaimBatch).toHaveBeenCalledTimes(1);
    });
});
