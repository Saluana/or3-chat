import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';
import { ConvexSyncGatewayAdapter } from '~~/packages/or3-provider-convex/src/runtime/server/sync/convex-sync-gateway-adapter';

vi.mock('~~/convex/_generated/api', () => ({
    api: {
        sync: {
            pull: 'sync.pull',
            push: 'sync.push',
            updateDeviceCursor: 'sync.updateDeviceCursor',
            gcTombstones: 'sync.gcTombstones',
            gcChangeLog: 'sync.gcChangeLog',
        },
    },
}));

const resolveProviderTokenMock = vi.hoisted(() => vi.fn());
vi.mock('~~/server/auth/token-broker/resolve', () => ({
    resolveProviderToken: (...args: unknown[]) => resolveProviderTokenMock(...args),
}));

const queryMock = vi.hoisted(() => vi.fn());
const mutationMock = vi.hoisted(() => vi.fn());
vi.mock('~~/packages/or3-provider-convex/src/runtime/server/utils/convex-gateway', () => ({
    getConvexGatewayClient: () => ({
        query: (...args: unknown[]) => queryMock(...args),
        mutation: (...args: unknown[]) => mutationMock(...args),
    }),
}));

function makeEvent(): H3Event {
    return { context: {}, node: { req: { headers: {} } } } as H3Event;
}

describe('ConvexSyncGatewayAdapter', () => {
    beforeEach(() => {
        resolveProviderTokenMock.mockReset().mockResolvedValue('provider-jwt');
        queryMock.mockReset();
        mutationMock.mockReset();
    });

    it('requires token for all methods and returns 401 when missing', async () => {
        const adapter = new ConvexSyncGatewayAdapter();
        resolveProviderTokenMock.mockResolvedValue(null);

        await expect(
            adapter.pull(makeEvent(), { scope: { workspaceId: 'ws-1' }, cursor: 0, limit: 10 })
        ).rejects.toMatchObject({ statusCode: 401 });

        await expect(
            adapter.push(makeEvent(), { scope: { workspaceId: 'ws-1' }, ops: [] })
        ).rejects.toMatchObject({ statusCode: 401 });

        await expect(
            adapter.updateCursor(makeEvent(), { scope: { workspaceId: 'ws-1' }, deviceId: 'd1', version: 1 })
        ).rejects.toMatchObject({ statusCode: 401 });

        await expect(
            adapter.gcTombstones(makeEvent(), { scope: { workspaceId: 'ws-1' }, retentionSeconds: 10 })
        ).rejects.toMatchObject({ statusCode: 401 });

        await expect(
            adapter.gcChangeLog(makeEvent(), { scope: { workspaceId: 'ws-1' }, retentionSeconds: 10 })
        ).rejects.toMatchObject({ statusCode: 401 });

        expect(resolveProviderTokenMock).toHaveBeenCalledTimes(5);
    });

    it('maps pull response and converts op strings to put|delete', async () => {
        const adapter = new ConvexSyncGatewayAdapter();
        queryMock.mockResolvedValue({
            changes: [
                {
                    serverVersion: 1,
                    tableName: 'messages',
                    pk: 'm1',
                    op: 'put',
                    payload: { id: 'm1' },
                    stamp: { clock: 1, hlc: '1:0:d', deviceId: 'd', opId: 'o1' },
                },
                {
                    serverVersion: 2,
                    tableName: 'messages',
                    pk: 'm2',
                    op: 'delete',
                    payload: undefined,
                    stamp: { clock: 2, hlc: '2:0:d', deviceId: 'd', opId: 'o2' },
                },
            ],
            nextCursor: 2,
            hasMore: false,
        });

        const result = await adapter.pull(makeEvent(), {
            scope: { workspaceId: 'ws-1' },
            cursor: 0,
            limit: 10,
        });

        expect(result).toEqual({
            changes: [
                expect.objectContaining({ op: 'put' }),
                expect.objectContaining({ op: 'delete' }),
            ],
            nextCursor: 2,
            hasMore: false,
        });

        expect(queryMock).toHaveBeenCalledWith('sync.pull', {
            workspace_id: 'ws-1',
            cursor: 0,
            limit: 10,
            tables: undefined,
        });
    });

    it('maps push/updateCursor/gc methods to Convex API', async () => {
        const adapter = new ConvexSyncGatewayAdapter();
        mutationMock.mockResolvedValue({ results: [], serverVersion: 5 });

        await adapter.push(makeEvent(), {
            scope: { workspaceId: 'ws-1' },
            ops: [
                {
                    id: 'p1',
                    tableName: 'messages',
                    operation: 'put',
                    pk: 'm1',
                    payload: { id: 'm1' },
                    stamp: { opId: 'op-1', deviceId: 'd1', hlc: '1:0:d1', clock: 1 },
                    createdAt: Date.now(),
                    attempts: 0,
                    status: 'pending',
                },
            ],
        });

        expect(mutationMock).toHaveBeenCalledWith('sync.push', expect.objectContaining({
            workspace_id: 'ws-1',
            ops: [
                expect.objectContaining({
                    op_id: 'op-1',
                    table_name: 'messages',
                    operation: 'put',
                }),
            ],
        }));

        await adapter.updateCursor(makeEvent(), {
            scope: { workspaceId: 'ws-1' },
            deviceId: 'dev-1',
            version: 123,
        });
        expect(mutationMock).toHaveBeenCalledWith('sync.updateDeviceCursor', {
            workspace_id: 'ws-1',
            device_id: 'dev-1',
            last_seen_version: 123,
        });

        await adapter.gcTombstones(makeEvent(), {
            scope: { workspaceId: 'ws-1' },
            retentionSeconds: 3600,
        });
        expect(mutationMock).toHaveBeenCalledWith('sync.gcTombstones', {
            workspace_id: 'ws-1',
            retention_seconds: 3600,
        });

        await adapter.gcChangeLog(makeEvent(), {
            scope: { workspaceId: 'ws-1' },
            retentionSeconds: 3600,
        });
        expect(mutationMock).toHaveBeenCalledWith('sync.gcChangeLog', {
            workspace_id: 'ws-1',
            retention_seconds: 3600,
        });
    });

    it('calls resolveProviderToken for each method with provider/template', async () => {
        const adapter = new ConvexSyncGatewayAdapter();
        queryMock.mockResolvedValue({ changes: [], nextCursor: 0, hasMore: false });
        mutationMock.mockResolvedValue({ results: [], serverVersion: 0 });

        await adapter.pull(makeEvent(), { scope: { workspaceId: 'ws-1' }, cursor: 0, limit: 10 });
        await adapter.push(makeEvent(), { scope: { workspaceId: 'ws-1' }, ops: [] });
        await adapter.updateCursor(makeEvent(), { scope: { workspaceId: 'ws-1' }, deviceId: 'd1', version: 1 });
        await adapter.gcTombstones(makeEvent(), { scope: { workspaceId: 'ws-1' }, retentionSeconds: 1 });
        await adapter.gcChangeLog(makeEvent(), { scope: { workspaceId: 'ws-1' }, retentionSeconds: 1 });

        for (const call of resolveProviderTokenMock.mock.calls) {
            expect(call[1]).toEqual({ providerId: 'convex', template: 'convex' });
        }
    });
});
