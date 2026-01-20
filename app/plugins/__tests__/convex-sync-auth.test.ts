import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionState = { value: { session: null as null | { authenticated: boolean; workspace?: { id: string } } } };

const mockSession = {
    data: sessionState,
};

const tokenState = {
    token: null as string | null,
};

const tokenBroker = {
    getProviderToken: vi.fn(async () => tokenState.token),
};

const providerRegistry = {
    active: {
        id: 'convex',
        mode: 'direct' as const,
        auth: { providerId: 'convex', template: 'convex' },
        subscribe: vi.fn(async (_scope, _tables, _onChanges, _options) => () => undefined),
        pull: vi.fn(async () => ({ changes: [], nextCursor: 0, hasMore: false })),
        push: vi.fn(async () => ({ results: [], serverVersion: 0 })),
        updateCursor: vi.fn(async () => undefined),
        dispose: vi.fn(async () => undefined),
    },
    gateway: {
        id: 'convex-gateway',
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
    getSyncProvider: vi.fn((id: string) => (id === 'convex-gateway' ? providerRegistry.gateway : null)),
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

vi.mock('~/composables/auth/useAuthTokenBroker.client', () => ({
    useAuthTokenBroker: () => tokenBroker,
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

vi.mock('convex-vue', () => ({
    useConvexClient: () => ({ setAuth: vi.fn() }),
}));

vi.mock('vue', async () => {
    const actual = await vi.importActual<typeof import('vue')>('vue');
    return {
        ...actual,
        watch: (source: () => unknown, cb: (value: unknown) => void) => {
            cb(source());
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
}));

describe('convex-sync auth retry', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        outboxStart.mockClear();
        subscriptionStart.mockClear();
        gcStart.mockClear();
        tokenBroker.getProviderToken.mockClear();
        tokenState.token = null;
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
    });

    it('retries start until token is available', async () => {
        providerRegistryMock.getSyncProvider.mockReturnValueOnce(null);
        await import('~/plugins/convex-sync.client');

        expect(tokenBroker.getProviderToken).toHaveBeenCalled();
        expect(outboxStart).not.toHaveBeenCalled();

        tokenState.token = 'token-1';
        providerRegistryMock.getSyncProvider.mockReturnValueOnce(providerRegistry.gateway);

        await vi.advanceTimersByTimeAsync(500);
        await vi.runOnlyPendingTimersAsync();

        expect(outboxStart).toHaveBeenCalled();
        expect(subscriptionStart).toHaveBeenCalled();
        expect(gcStart).toHaveBeenCalled();
    });

    it('uses gateway fallback when direct token unavailable', async () => {
        providerRegistryMock.getActiveSyncProvider.mockReturnValueOnce(providerRegistry.active);
        providerRegistryMock.getSyncProvider.mockReturnValueOnce(providerRegistry.gateway);
        await import('~/plugins/convex-sync.client');
        await vi.runOnlyPendingTimersAsync();

        tokenState.token = null;
        await vi.advanceTimersByTimeAsync(500);
        await vi.runOnlyPendingTimersAsync();

        expect(providerRegistryMock.getSyncProvider).toHaveBeenCalledWith('convex-gateway');
    });

    it('retries direct auth after gateway fallback', async () => {
        providerRegistryMock.getActiveSyncProvider.mockReturnValueOnce(providerRegistry.active);
        providerRegistryMock.getSyncProvider.mockReturnValueOnce(providerRegistry.gateway);
        await import('~/plugins/convex-sync.client');
        await vi.runOnlyPendingTimersAsync();

        tokenState.token = 'token-2';
        await vi.advanceTimersByTimeAsync(500);
        await vi.runOnlyPendingTimersAsync();

        expect(providerRegistryMock.getActiveSyncProvider).toHaveBeenCalled();
    });
});
