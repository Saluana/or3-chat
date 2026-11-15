import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';
const f = vi.hoisted(() => ({ body: {} as any, adapter: {} as any, query: {} as any }));
vi.mock('../../../utils/security/limited-json-body', () => ({ readLimitedJsonBody: async () => f.body }));
vi.mock('../../../utils/security/cloud-mutation', () => ({ requireCloudMutation: () => {} }));
vi.mock('../../../auth/session', () => ({ resolveSessionContext: async () => ({ authenticated: true, user: { id: 'u' }, workspace: { id: 'w' } }) }));
vi.mock('../../../auth/can', () => ({ requireCan: () => {} }));
vi.mock('../../../utils/auth/is-ssr-auth-enabled', () => ({ isSsrAuthEnabled: () => true }));
vi.mock('../../../utils/sync/is-sync-enabled', () => ({ isSyncEnabled: () => true }));
vi.mock('../../../utils/headers', () => ({ setNoCacheHeaders: () => {} }));
vi.mock('../../../sync/observations', () => ({ observeSyncRequest: (_e: unknown, _u: unknown, _w: unknown, _k: unknown, fn: () => unknown) => fn() }));
vi.mock('../../../utils/sync/rate-limiter', () => ({ checkSyncRateLimit: () => ({ allowed: true }), getSyncRateLimitStats: () => null, recordSyncRequest: () => {} }));
vi.mock('../../../sync/gateway/registry', () => ({ getActiveSyncGatewayAdapter: () => f.adapter }));
vi.mock('../../../utils/storage/workspace-access', () => ({ requireStorageWorkspaceAccess: async () => {} }));
vi.mock('../../../cloud/access', () => ({ requireCloudAccess: async () => {}, resolveCloudAccess: async () => null }));
vi.mock('h3', async original => ({ ...await original<typeof import('h3')>(), defineEventHandler: (fn: unknown) => fn, getQuery: () => f.query }));
const event = { context: {}, node: { req: { headers: {} }, res: { setHeader() {} } } } as unknown as H3Event;
const capability = { historyIncarnationCapability: 'incarnation-v1' };
const request = { scope: { workspaceId: 'w' }, cursor: 100, limit: 10, pageSize: 10, deviceId: 'd', version: 100, ops: [] };
describe('history incarnation boundary (provider double; native transaction fencing requires S3)', () => {
    beforeEach(() => {
        f.body = { ...request, ...capability, historyIncarnation: 'I' };
        f.query = { workspaceId: 'w', ...capability, historyIncarnation: 'I' };
        f.adapter = { id: 'test', capabilities: { historyIncarnation: 'v1' }, getHistoryIncarnation: vi.fn(async () => 'J'),
            pull: vi.fn(), snapshot: vi.fn(), push: vi.fn(), updateCursor: vi.fn(), watchVersion: vi.fn() };
    });
    it.each(['pull', 'snapshot', 'push', 'update-cursor', 'events'])('P0-5.9 rejects old browser on %s before dispatch', async name => {
        delete f.body.historyIncarnationCapability; delete f.query.historyIncarnationCapability;
        const route = (await import(`../${name}.${name === 'events' ? 'get' : 'post'}.ts`)).default;
        await expect(route(event)).rejects.toMatchObject({ statusCode: 426, data: { code: 'OR3_SYNC_UPDATE_REQUIRED', requiredCapability: 'incarnation-v1' } });
        expect(f.adapter.getHistoryIncarnation).not.toHaveBeenCalled();
    });
    it.each([0, 99, 100, 120])('P0-5.1 detects changed history at cursor %i without decoding payloads', async cursor => {
        f.body.cursor = cursor;
        const route = (await import('../pull.post')).default;
        // Provider owns retention metadata and short-circuits before decoding.
        f.adapter.pull.mockResolvedValue({ historyIncarnation: 'J', changes: [], unavailable: [], nextCursor: cursor, hasMore: false, requiresSnapshot: true, oldestRetainedVersion: 81 });
        await expect(route(event)).resolves.toMatchObject({ historyIncarnation: 'J', changes: [], nextCursor: cursor, requiresSnapshot: true });
    });
    it.each(['push', 'update-cursor', 'snapshot', 'events'])('P0-5.5 fences stale %s before receipts, ACK refresh or snapshot dispatch', async name => {
        const route = (await import(`../${name}.${name === 'events' ? 'get' : 'post'}.ts`)).default;
        await expect(route(event)).rejects.toMatchObject({ statusCode: 409, data: { code: 'OR3_SYNC_HISTORY_CHANGED', historyIncarnation: 'J', requiresSnapshot: true } });
        for (const method of ['push', 'updateCursor', 'snapshot', 'watchVersion']) expect(f.adapter[method]).not.toHaveBeenCalled();
    });
    it('fails closed with an old provider before even an empty push', async () => {
        delete f.adapter.capabilities.historyIncarnation;
        await expect((await import('../push.post')).default(event)).rejects.toMatchObject({ statusCode: 503, data: { code: 'OR3_SYNC_HISTORY_UNSUPPORTED' } });
        expect(f.adapter.push).not.toHaveBeenCalled();
    });
});
