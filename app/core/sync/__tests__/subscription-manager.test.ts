import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    PullRequest,
    PullResponse,
    SyncChange,
    SyncProvider,
    SyncScope,
    SyncSubscribeOptions,
} from '~~/shared/sync/types';
import { SubscriptionManager } from '../subscription-manager';
import { createMemoryTable, createMockDb } from './sync-test-utils';
import * as cursorManagerModule from '~/core/sync/cursor-manager';
import { markRecentOpId } from '../recent-op-cache';

const hookState = vi.hoisted(() => ({
    doAction: vi.fn(async () => undefined),
}));

const hookBridgeState = vi.hoisted(() => ({
    markSyncTransaction: vi.fn(),
}));

vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => ({
        doAction: hookState.doAction,
    }),
}));

vi.mock('~/core/sync/hook-bridge', () => ({
    getHookBridge: () => ({
        markSyncTransaction: hookBridgeState.markSyncTransaction,
    }),
}));

vi.mock('~/core/sync/cursor-manager', () => {
    const state = { cursor: 100 };
    const api = {
        getCursor: vi.fn(async () => state.cursor),
        setCursor: vi.fn(async (next: number) => {
            state.cursor = next;
        }),
        markSyncComplete: vi.fn(async () => undefined),
        isBootstrapNeeded: vi.fn(async () => false),
        isCursorPotentiallyExpired: vi.fn(async () => false),
        reset: vi.fn(async () => undefined),
        getDeviceId: vi.fn(() => 'device-1'),
    };
    return {
        getCursorManager: () => api,
        __cursorState: state,
    };
});

class SubscriptionProvider implements SyncProvider {
    id = 'sub-provider';
    mode = 'direct' as const;
    auth = undefined;

    subscribe = vi.fn(async (
        _scope: SyncScope,
        _tables: string[],
        _onChanges: (changes: SyncChange[]) => void,
        _options?: SyncSubscribeOptions
    ) => () => undefined);

    async pull(request: PullRequest): Promise<PullResponse> {
        if (request.cursor === 100) {
            return {
                changes: [
                    {
                        serverVersion: 105,
                        tableName: 'messages',
                        pk: 'm105',
                        op: 'put',
                        payload: {
                            id: 'm105',
                            thread_id: 't1',
                            role: 'user',
                            index: 1,
                            order_key: '0000000000105:0000:node',
                            deleted: false,
                            created_at: 1050,
                            updated_at: 1050,
                            clock: 1,
                        },
                        stamp: {
                            clock: 1,
                            hlc: '0000000000105:0000:node',
                            deviceId: 'device-2',
                            opId: 'op-105',
                        },
                    },
                ],
                nextCursor: 105,
                hasMore: true,
            };
        }

        if (request.cursor === 105) {
            return {
                changes: [
                    {
                        serverVersion: 110,
                        tableName: 'messages',
                        pk: 'm110',
                        op: 'put',
                        payload: {
                            id: 'm110',
                            thread_id: 't1',
                            role: 'user',
                            index: 1,
                            order_key: '0000000000110:0000:node',
                            deleted: false,
                            created_at: 1100,
                            updated_at: 1100,
                            clock: 1,
                        },
                        stamp: {
                            clock: 1,
                            hlc: '0000000000110:0000:node',
                            deviceId: 'device-2',
                            opId: 'op-110',
                        },
                    },
                    {
                        serverVersion: 120,
                        tableName: 'messages',
                        pk: 'm2',
                        op: 'put',
                        payload: {
                            id: 'm2',
                            thread_id: 't1',
                            role: 'user',
                            index: 1,
                            order_key: '0000000000120:0000:node',
                            deleted: false,
                            created_at: 1200,
                            updated_at: 1200,
                            clock: 1,
                        },
                        stamp: {
                            clock: 1,
                            hlc: '0000000000120:0000:node',
                            deviceId: 'device-2',
                            opId: 'op-120',
                        },
                    },
                ],
                nextCursor: 120,
                hasMore: false,
            };
        }

        return { changes: [], nextCursor: request.cursor, hasMore: false };
    }

    async push(): Promise<never> {
        throw new Error('push not used');
    }

    async updateCursor(): Promise<void> {
        return;
    }

    async dispose(): Promise<void> {
        return;
    }
}

function buildChange(version: number): SyncChange {
    return {
        serverVersion: version,
        tableName: 'messages',
        pk: `m-${version}`,
        op: 'put',
        payload: {
            id: `m-${version}`,
            thread_id: 't1',
            role: 'user',
            index: 0,
            order_key: `0000000000${version}:0000:node`,
            deleted: false,
            created_at: version,
            updated_at: version,
            clock: 1,
        },
        stamp: {
            clock: 1,
            hlc: `0000000000${version}:0000:node`,
            deviceId: 'device-1',
            opId: `op-${version}`,
        },
    };
}

describe('SubscriptionManager', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        hookState.doAction.mockClear();
        hookBridgeState.markSyncTransaction.mockClear();
    });

    it('re-subscribes when cursor advances', async () => {
        (cursorManagerModule as unknown as { __cursorState: { cursor: number } }).__cursorState.cursor = 100;
        const provider = new SubscriptionProvider();
        const messages = createMemoryTable('id');
        const tombstones = createMemoryTable('id');
        const pending_ops = createMemoryTable('id');
        const db = createMockDb({ messages, tombstones, pending_ops });

        const manager = new SubscriptionManager(db as any, provider, { workspaceId: 'ws-1' });
        await manager.start();

        expect(provider.subscribe).toHaveBeenCalledTimes(1);

        const onChanges = provider.subscribe.mock.calls[0]![2] as (changes: SyncChange[]) => void;
        await onChanges([buildChange(110)]);

        await vi.runAllTimersAsync();

        expect(provider.subscribe).toHaveBeenCalledTimes(2);
        expect(provider.subscribe.mock.calls[1]![3]).toEqual({ cursor: 120, limit: 100 });
    });

    it('drains backlog after subscription changes', async () => {
        (cursorManagerModule as unknown as { __cursorState: { cursor: number } }).__cursorState.cursor = 100;
        const provider = new SubscriptionProvider();
        const messages = createMemoryTable('id');
        const tombstones = createMemoryTable('id');
        const pending_ops = createMemoryTable('id');
        const db = createMockDb({ messages, tombstones, pending_ops });

        const manager = new SubscriptionManager(db as any, provider, { workspaceId: 'ws-1' });
        await manager.start();

        const onChanges = provider.subscribe.mock.calls[0]![2] as (changes: SyncChange[]) => void;
        await onChanges([buildChange(110)]);
        await vi.runAllTimersAsync();

        const stored = await messages.get('m2');
        expect(stored?.id).toBe('m2');
        expect(provider.subscribe).toHaveBeenCalledTimes(2);
    });

    it('drains backlog from cursor when subscription skips versions', async () => {
        (cursorManagerModule as unknown as { __cursorState: { cursor: number } }).__cursorState.cursor = 100;
        const provider = new SubscriptionProvider();
        const messages = createMemoryTable('id');
        const tombstones = createMemoryTable('id');
        const pending_ops = createMemoryTable('id');
        const db = createMockDb({ messages, tombstones, pending_ops });

        const manager = new SubscriptionManager(db as any, provider, { workspaceId: 'ws-1' });
        await manager.start();

        const onChanges = provider.subscribe.mock.calls[0]![2] as (changes: SyncChange[]) => void;
        await onChanges([buildChange(110)]);
        await vi.runAllTimersAsync();

        const storedGap = await messages.get('m105');
        const storedLatest = await messages.get('m110');
        expect(storedGap?.id).toBe('m105');
        expect(storedLatest?.id).toBe('m110');
        expect(provider.subscribe).toHaveBeenCalledTimes(2);
    });

    it('suppresses echoed changes by opId', async () => {
        (cursorManagerModule as unknown as { __cursorState: { cursor: number } }).__cursorState.cursor = 1;

        const provider: SyncProvider = {
            id: 'sub-provider-echo',
            mode: 'direct',
            auth: undefined,
            subscribe: vi.fn(async (
                _scope: SyncScope,
                _tables: string[],
                _onChanges: (changes: SyncChange[]) => void,
                _options?: SyncSubscribeOptions
            ) => () => undefined),
            pull: vi.fn(async () => ({ changes: [], nextCursor: 1, hasMore: false })),
            push: vi.fn(async () => {
                throw new Error('push not used');
            }),
            updateCursor: vi.fn(async () => undefined),
            dispose: vi.fn(async () => undefined),
        };

        const messages = createMemoryTable('id');
        const tombstones = createMemoryTable('id');
        const pending_ops = createMemoryTable('id');
        const db = createMockDb({ messages, tombstones, pending_ops });

        const manager = new SubscriptionManager(db as any, provider, { workspaceId: 'ws-1' });
        await manager.start();

        const onChanges = (provider.subscribe as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![2] as (changes: SyncChange[]) => void;

        markRecentOpId('op-echo');

        await onChanges([
            {
                serverVersion: 2,
                tableName: 'messages',
                pk: 'm-echo',
                op: 'put',
                payload: {
                    id: 'm-echo',
                    thread_id: 't1',
                    role: 'user',
                    index: 0,
                    order_key: '0000000000002:0000:node',
                    deleted: false,
                    created_at: 2,
                    updated_at: 2,
                    clock: 1,
                },
                stamp: {
                    clock: 1,
                    hlc: '0000000000002:0000:node',
                    deviceId: 'device-1',
                    opId: 'op-echo',
                },
            },
            {
                serverVersion: 3,
                tableName: 'messages',
                pk: 'm-live',
                op: 'put',
                payload: {
                    id: 'm-live',
                    thread_id: 't1',
                    role: 'user',
                    index: 0,
                    order_key: '0000000000003:0000:node',
                    deleted: false,
                    created_at: 3,
                    updated_at: 3,
                    clock: 1,
                },
                stamp: {
                    clock: 1,
                    hlc: '0000000000003:0000:node',
                    deviceId: 'device-1',
                    opId: 'op-live',
                },
            },
        ]);

        await vi.runAllTimersAsync();

        const echoed = await messages.get('m-echo');
        const live = await messages.get('m-live');
        expect(echoed).toBeUndefined();
        expect(live?.id).toBe('m-live');
    });

    it('advances cursor even when all changes are filtered', async () => {
        (cursorManagerModule as unknown as { __cursorState: { cursor: number } }).__cursorState.cursor = 1;

        const provider: SyncProvider = {
            id: 'sub-provider-filtered',
            mode: 'direct',
            auth: undefined,
            subscribe: vi.fn(async (
                _scope: SyncScope,
                _tables: string[],
                _onChanges: (changes: SyncChange[]) => void,
                _options?: SyncSubscribeOptions
            ) => () => undefined),
            pull: vi.fn(async () => ({ changes: [], nextCursor: 1, hasMore: false })),
            push: vi.fn(async () => {
                throw new Error('push not used');
            }),
            updateCursor: vi.fn(async () => undefined),
            dispose: vi.fn(async () => undefined),
        };

        const messages = createMemoryTable('id');
        const tombstones = createMemoryTable('id');
        const pending_ops = createMemoryTable('id');
        const db = createMockDb({ messages, tombstones, pending_ops });

        const manager = new SubscriptionManager(db as any, provider, { workspaceId: 'ws-1' });
        await manager.start();

        const onChanges = (provider.subscribe as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![2] as (changes: SyncChange[]) => void;

        markRecentOpId('op-only');

        await onChanges([
            {
                serverVersion: 5,
                tableName: 'messages',
                pk: 'm-only',
                op: 'put',
                payload: {
                    id: 'm-only',
                    thread_id: 't1',
                    role: 'user',
                    index: 0,
                    order_key: '0000000000005:0000:node',
                    deleted: false,
                    created_at: 5,
                    updated_at: 5,
                    clock: 1,
                },
                stamp: {
                    clock: 1,
                    hlc: '0000000000005:0000:node',
                    deviceId: 'device-1',
                    opId: 'op-only',
                },
            },
        ]);

        await vi.runAllTimersAsync();

        const cursorState = (cursorManagerModule as unknown as { __cursorState: { cursor: number } }).__cursorState;
        expect(cursorState.cursor).toBe(5);
    });

    it('serializes apply cycles from rapid subscription emissions', async () => {
        (cursorManagerModule as unknown as { __cursorState: { cursor: number } }).__cursorState.cursor = 1;

        let release: (() => void) | null = null;
        const barrier = new Promise<void>((resolve) => {
            release = resolve;
        });

        let updateCalls = 0;

        const provider: SyncProvider = {
            id: 'sub-provider-serial',
            mode: 'direct',
            auth: undefined,
            subscribe: vi.fn(async (
                _scope: SyncScope,
                _tables: string[],
                _onChanges: (changes: SyncChange[]) => void,
                _options?: SyncSubscribeOptions
            ) => () => undefined),
            pull: vi.fn(async (request: PullRequest) => ({
                changes: [],
                nextCursor: request.cursor,
                hasMore: false,
            })),
            push: vi.fn(async () => {
                throw new Error('push not used');
            }),
            updateCursor: vi.fn(async () => {
                updateCalls += 1;
                if (updateCalls === 1) {
                    await barrier;
                }
            }),
            dispose: vi.fn(async () => undefined),
        };

        const messages = createMemoryTable('id');
        const tombstones = createMemoryTable('id');
        const pending_ops = createMemoryTable('id');
        const db = createMockDb({ messages, tombstones, pending_ops });

        const manager = new SubscriptionManager(db as any, provider, { workspaceId: 'ws-1' });
        await manager.start();
        expect((cursorManagerModule as unknown as { __cursorState: { cursor: number } }).__cursorState.cursor).toBe(1);

        const onChanges = (provider.subscribe as unknown as { mock: { calls: unknown[][] } }).mock
            .calls[0]![2] as (changes: SyncChange[]) => Promise<void> | void;

        // Emit two batches back-to-back. Without serialization, the second batch would run
        // while the first is awaiting updateCursor().
        void onChanges([buildChange(2)]);
        void onChanges([buildChange(3)]);

        // Wait until the first updateCursor is reached (it will block on the barrier).
        for (let i = 0; i < 200; i++) {
            if ((provider.updateCursor as unknown as { mock: { calls: unknown[][] } }).mock.calls.length >= 1) break;
            await Promise.resolve();
        }

        expect((cursorManagerModule as unknown as { __cursorState: { cursor: number } }).__cursorState.cursor).toBeGreaterThanOrEqual(2);
        expect(provider.updateCursor).toHaveBeenCalledTimes(1);

        release?.();
        for (let i = 0; i < 200; i++) {
            if ((provider.updateCursor as unknown as { mock: { calls: unknown[][] } }).mock.calls.length >= 2) break;
            await Promise.resolve();
        }
        await vi.runAllTimersAsync();

        expect(provider.updateCursor).toHaveBeenCalledTimes(2);
    });
});
