import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionState = { value: { session: null as null | { authenticated: boolean; workspace?: { id: string } } } };

const mockSession = {
    data: sessionState,
};

const providerRegistry = {
    active: {
        id: 'convex',
        mode: 'gateway' as const,
        subscribe: vi.fn(async (_scope, _tables, _onChanges, _options) => () => undefined),
        pull: vi.fn(async () => ({ changes: [], nextCursor: 0, hasMore: false })),
        push: vi.fn(async () => ({ results: [], serverVersion: 0 })),
        updateCursor: vi.fn(async () => undefined),
        dispose: vi.fn(async () => undefined),
    },
};

const providerRegistryMock = {
    registerSyncProvider: vi.fn(),
    getActiveSyncProvider: vi.fn(() => providerRegistry.active),
    setActiveSyncProvider: vi.fn(),
};

const hookBridgeMock = {
    start: vi.fn(),
    stop: vi.fn(),
};

const outboxStart = vi.fn();
const subscriptionStart = vi.fn(async () => undefined);
const gcStart = vi.fn();

vi.mock('~/composables/auth/useSessionContext', () => ({
    useSessionContext: () => mockSession,
}));

vi.mock('~/core/sync/sync-provider-registry', () => providerRegistryMock);

vi.mock('~/core/sync/hook-bridge', () => ({
    getHookBridge: () => hookBridgeMock,
    cleanupHookBridge: vi.fn(),
}));

vi.mock('~/core/sync/outbox-manager', () => ({
    OutboxManager: vi.fn(() => ({ start: outboxStart, stop: vi.fn() })),
}));

vi.mock('~/core/sync/subscription-manager', () => ({
    createSubscriptionManager: vi.fn(() => ({ start: subscriptionStart, stop: vi.fn() })),
    cleanupSubscriptionManager: vi.fn(),
}));

vi.mock('~/core/sync/gc-manager', () => ({
    GcManager: vi.fn(() => ({ start: gcStart, stop: vi.fn() })),
}));

vi.mock('~/core/sync/cursor-manager', () => ({
    cleanupCursorManager: vi.fn(),
}));

vi.mock('~/db/client', () => ({
    createWorkspaceDb: vi.fn(() => ({ name: 'or3-db-test' })),
    setActiveWorkspaceDb: vi.fn(),
}));

const workspaceManagerMock = {
    activeWorkspaceId: { value: 'ws-1' },
};

vi.mock('~/composables/workspace/useWorkspaceManager', () => ({
    useWorkspaceManager: () => workspaceManagerMock,
}));

vi.mock('vue', async () => {
    const actual = await vi.importActual<typeof import('vue')>('vue');
    return {
        ...actual,
        watch: (source: unknown, cb: (value: unknown, oldValue?: unknown) => void, options?: { immediate?: boolean }) => {
            // Handle different source types (ref, computed, function, array)
            let currentValue: unknown;
            
            if (typeof source === 'function') {
                currentValue = (source as () => unknown)();
            } else if (source && typeof source === 'object' && 'value' in source) {
                // Ref or computed
                currentValue = (source as { value: unknown }).value;
            } else {
                currentValue = source;
            }
            
            // Call callback immediately if immediate option is set (Vue default behavior)
            if (options?.immediate !== false) {
                cb(currentValue, undefined);
            }
            
            // Return cleanup function
            return () => {};
        },
    };
});

vi.mock('#app', () => ({
    defineNuxtPlugin: (plugin: () => void) => plugin(),
    useRuntimeConfig: () => ({
        public: {
            ssrAuthEnabled: true,
            sync: { enabled: true, provider: 'convex' },
        },
    }),
    useNuxtApp: () => ({ provide: vi.fn() }),
    useRouter: () => ({
        afterEach: vi.fn(() => () => undefined),
    }),
}));

describe('sync engine plugin', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.resetModules();
        outboxStart.mockClear();
        subscriptionStart.mockClear();
        gcStart.mockClear();
        providerRegistryMock.getActiveSyncProvider.mockClear();
        providerRegistryMock.registerSyncProvider.mockClear();
        providerRegistryMock.setActiveSyncProvider.mockClear();
        sessionState.value.session = {
            authenticated: true,
            workspace: { id: 'ws-1' },
        };
        (globalThis as typeof globalThis & { defineNuxtPlugin: (plugin: () => unknown) => unknown }).defineNuxtPlugin =
            (plugin) => plugin();
        (globalThis as typeof globalThis & {
            useRuntimeConfig?: () => {
                public: {
                    ssrAuthEnabled: boolean;
                    sync?: { enabled: boolean; provider: string };
                };
            };
        }).useRuntimeConfig = () => ({
            public: {
                ssrAuthEnabled: true,
                sync: { enabled: true, provider: 'convex' },
            },
        });
        (globalThis as typeof globalThis & { useNuxtApp?: () => { provide: (key: string, value: unknown) => void } }).useNuxtApp =
            () => ({ provide: vi.fn() });
        (globalThis as typeof globalThis & { useRouter?: () => { afterEach: (cb: (to: { path: string }) => void) => () => void } }).useRouter =
            () => ({ afterEach: vi.fn(() => () => undefined) });
    });

    it('starts sync engine when provider and workspace are available', async () => {
        providerRegistryMock.getActiveSyncProvider.mockReturnValue(providerRegistry.active);
        await import('~/plugins/convex-sync.client');
        await vi.runOnlyPendingTimersAsync();

        expect(outboxStart).toHaveBeenCalled();
        expect(subscriptionStart).toHaveBeenCalled();
        expect(gcStart).toHaveBeenCalled();
    });
});
