import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createConvexSyncProvider } from 'or3-provider-convex/src/runtime/app/sync/convex-sync-provider';

vi.mock('~~/convex/_generated/api', () => ({
    api: {
        sync: {
            watchChanges: 'sync.watchChanges',
            pull: 'sync.pull',
            push: 'sync.push',
            updateDeviceCursor: 'sync.updateDeviceCursor',
            gcTombstones: 'sync.gcTombstones',
            gcChangeLog: 'sync.gcChangeLog',
        },
    },
}));

describe('createConvexSyncProvider', () => {
    const onUpdateMock = vi.fn();
    const queryMock = vi.fn();
    const mutationMock = vi.fn();

    const client = {
        onUpdate: (...args: unknown[]) => onUpdateMock(...args),
        query: (...args: unknown[]) => queryMock(...args),
        mutation: (...args: unknown[]) => mutationMock(...args),
    };

    beforeEach(() => {
        onUpdateMock.mockReset();
        queryMock.mockReset();
        mutationMock.mockReset();
    });

    it('exposes provider metadata (id/mode/auth)', () => {
        const provider = createConvexSyncProvider(client as any);

        expect(provider.id).toBe('convex');
        expect(provider.mode).toBe('direct');
        expect(provider.auth).toEqual({
            providerId: 'convex',
            template: 'convex',
        });
    });

    it('subscribe filters by tables and ignores malformed payloads', async () => {
        const provider = createConvexSyncProvider(client as any);
        const onChanges = vi.fn();

        let callback: ((result: { changes: unknown }) => void) | undefined;
        onUpdateMock.mockImplementation((_query, _args, cb) => {
            callback = cb;
            return vi.fn();
        });

        await provider.subscribe({ workspaceId: 'ws-1' }, ['messages'], onChanges);

        callback?.({
            changes: [
                {
                    serverVersion: 1,
                    tableName: 'messages',
                    pk: 'm1',
                    op: 'put',
                    payload: {},
                    stamp: { clock: 1, hlc: '1:0:dev', deviceId: 'dev', opId: crypto.randomUUID() },
                },
                {
                    serverVersion: 2,
                    tableName: 'threads',
                    pk: 't1',
                    op: 'put',
                    payload: {},
                    stamp: { clock: 1, hlc: '2:0:dev', deviceId: 'dev', opId: crypto.randomUUID() },
                },
            ],
        });

        expect(onChanges).toHaveBeenCalledTimes(1);
        expect(onChanges.mock.calls[0]?.[0]).toEqual([
            expect.objectContaining({ tableName: 'messages' }),
        ]);

        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        callback?.({ changes: [{ bad: 'shape' }] });
        expect(onChanges).toHaveBeenCalledTimes(1);
        expect(errorSpy).toHaveBeenCalled();
    });

    it('suppresses known Convex unwatch race during cleanup', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const knownRaceError = new TypeError("Cannot read properties of undefined (reading 'numSubscribers')");

        onUpdateMock.mockReturnValue(() => {
            throw knownRaceError;
        });

        const provider = createConvexSyncProvider(client as any);
        const unsubscribe = await provider.subscribe({ workspaceId: 'ws-1' }, [], vi.fn());

        expect(() => unsubscribe()).not.toThrow();
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('throws when pull response fails schema validation', async () => {
        const provider = createConvexSyncProvider(client as any);
        queryMock.mockResolvedValue({ changes: 'invalid', nextCursor: 1, hasMore: false });

        await expect(
            provider.pull({ scope: { workspaceId: 'ws-1' }, cursor: 0, limit: 10 })
        ).rejects.toThrow('Invalid pull response');
    });

    it('throws when push response fails schema validation', async () => {
        const provider = createConvexSyncProvider(client as any);
        mutationMock.mockResolvedValue({ results: [{ opId: 'x', success: true }], serverVersion: -1 });

        await expect(
            provider.push({
                scope: { workspaceId: 'ws-1' },
                ops: [
                    {
                        id: 'p1',
                        tableName: 'messages',
                        operation: 'put',
                        pk: 'm1',
                        payload: {},
                        stamp: {
                            opId: crypto.randomUUID(),
                            deviceId: 'dev',
                            hlc: '1:0:dev',
                            clock: 1,
                        },
                        createdAt: Date.now(),
                        attempts: 0,
                        status: 'pending',
                    },
                ],
            })
        ).rejects.toThrow('Invalid push response');
    });

    it('maps pull/push/updateCursor/gc calls to Convex APIs', async () => {
        const provider = createConvexSyncProvider(client as any);
        queryMock.mockResolvedValue({
            changes: [],
            nextCursor: 1,
            hasMore: false,
        });
        mutationMock.mockResolvedValue({ results: [], serverVersion: 1 });

        await provider.pull({ scope: { workspaceId: 'ws-1' }, cursor: 0, limit: 25, tables: ['messages'] });
        expect(queryMock).toHaveBeenCalledWith('sync.pull', {
            workspace_id: 'ws-1',
            cursor: 0,
            limit: 25,
            tables: ['messages'],
        });

        await provider.push({
            scope: { workspaceId: 'ws-1' },
            ops: [
                {
                    id: 'p1',
                    tableName: 'messages',
                    operation: 'put',
                    pk: 'm1',
                    payload: { text: 'hi' },
                    stamp: {
                        opId: crypto.randomUUID(),
                        deviceId: 'dev',
                        hlc: '1:0:dev',
                        clock: 1,
                    },
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
                    table_name: 'messages',
                    operation: 'put',
                    pk: 'm1',
                }),
            ],
        }));

        await provider.updateCursor({ workspaceId: 'ws-1' }, 'dev-1', 123);
        expect(mutationMock).toHaveBeenCalledWith('sync.updateDeviceCursor', {
            workspace_id: 'ws-1',
            device_id: 'dev-1',
            last_seen_version: 123,
        });

        await provider.gcTombstones?.({ workspaceId: 'ws-1' }, 3600);
        expect(mutationMock).toHaveBeenCalledWith('sync.gcTombstones', {
            workspace_id: 'ws-1',
            retention_seconds: 3600,
        });

        await provider.gcChangeLog?.({ workspaceId: 'ws-1' }, 3600);
        expect(mutationMock).toHaveBeenCalledWith('sync.gcChangeLog', {
            workspace_id: 'ws-1',
            retention_seconds: 3600,
        });
    });

    it('dispose unsubscribes all tracked subscriptions', async () => {
        const unwatchA = vi.fn();
        const unwatchB = vi.fn();
        onUpdateMock
            .mockReturnValueOnce(unwatchA)
            .mockReturnValueOnce(unwatchB);

        const provider = createConvexSyncProvider(client as any);
        await provider.subscribe({ workspaceId: 'ws-1' }, ['messages'], vi.fn());
        await provider.subscribe({ workspaceId: 'ws-2' }, ['threads'], vi.fn());

        await provider.dispose();

        expect(unwatchA).toHaveBeenCalledTimes(1);
        expect(unwatchB).toHaveBeenCalledTimes(1);
    });
});
