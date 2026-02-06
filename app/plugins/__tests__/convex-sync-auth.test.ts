import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type SessionRecord = {
    session: null | {
        authenticated?: boolean;
        workspace?: { id: string };
    };
};

type MockProvider = {
    id: string;
    mode: 'gateway';
    subscribe: ReturnType<typeof vi.fn>;
    pull: ReturnType<typeof vi.fn>;
    push: ReturnType<typeof vi.fn>;
    updateCursor: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
};

type WatchRecord = {
    source: unknown;
    callback: (value: unknown, oldValue?: unknown) => void;
    lastValue: unknown;
};

type OutboxInstance = {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    flush: ReturnType<typeof vi.fn>;
    retryFailed: ReturnType<typeof vi.fn>;
    purgeCorruptOps: ReturnType<typeof vi.fn>;
};

type SubscriptionInstance = {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
};

type GcInstance = {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
};

function createProvider(id = 'convex'): MockProvider {
    return {
        id,
        mode: 'gateway',
        subscribe: vi.fn(async () => () => undefined),
        pull: vi.fn(async () => ({ changes: [], nextCursor: 0, hasMore: false })),
        push: vi.fn(async () => ({ results: [], serverVersion: 0 })),
        updateCursor: vi.fn(async () => undefined),
        dispose: vi.fn(async () => undefined),
    };
}

function readWatchSource(source: unknown): unknown {
    if (typeof source === 'function') return (source as () => unknown)();
    if (source && typeof source === 'object' && 'value' in source) {
        return (source as { value: unknown }).value;
    }
    return source;
}

const sessionState: { value: SessionRecord } = {
    value: {
        session: {
            authenticated: true,
            workspace: { id: 'ws-1' },
        },
    },
};

const workspaceState: { value: string | null } = {
    value: 'ws-1',
};

const routeState: { value: { path: string } } = {
    value: { path: '/chat' },
};

const watchRecords: WatchRecord[] = [];

const providerRegistryState: { active: MockProvider | null } = {
    active: createProvider('convex'),
};

const providerRegistryMock = {
    registerSyncProvider: vi.fn((provider: MockProvider) => {
        providerRegistryState.active = provider;
    }),
    getActiveSyncProvider: vi.fn(() => providerRegistryState.active),
    setActiveSyncProvider: vi.fn(),
};

const createGatewaySyncProvider = vi.fn(({ id }: { id: string }) => createProvider(id));

const hookBridgeMock = {
    start: vi.fn(),
    stop: vi.fn(),
};

const outboxInstances: OutboxInstance[] = [];
const subscriptionInstances: SubscriptionInstance[] = [];
const gcInstances: GcInstance[] = [];

const setActiveWorkspaceDb = vi.fn();
const createWorkspaceDb = vi.fn((workspaceId: string) => ({ name: `or3-db-${workspaceId}` }));

vi.mock('~/composables/auth/useSessionContext', () => ({
    useSessionContext: () => ({ data: sessionState }),
}));

vi.mock('~/core/sync/providers/gateway-sync-provider', () => ({
    createGatewaySyncProvider,
}));

vi.mock('~/core/sync/sync-provider-registry', () => providerRegistryMock);

vi.mock('~/core/sync/hook-bridge', () => ({
    getHookBridge: () => hookBridgeMock,
    cleanupHookBridge: vi.fn(),
}));

vi.mock('~/core/sync/outbox-manager', () => ({
    OutboxManager: vi.fn(() => {
        const instance: OutboxInstance = {
            start: vi.fn(),
            stop: vi.fn(),
            flush: vi.fn(async () => true),
            retryFailed: vi.fn(async () => undefined),
            purgeCorruptOps: vi.fn(async () => 0),
        };
        outboxInstances.push(instance);
        return instance;
    }),
}));

vi.mock('~/core/sync/subscription-manager', () => ({
    createSubscriptionManager: vi.fn(() => {
        const instance: SubscriptionInstance = {
            start: vi.fn(async () => undefined),
            stop: vi.fn(async () => undefined),
        };
        subscriptionInstances.push(instance);
        return instance;
    }),
    cleanupSubscriptionManager: vi.fn(),
}));

vi.mock('~/core/sync/gc-manager', () => ({
    GcManager: vi.fn(() => {
        const instance: GcInstance = {
            start: vi.fn(),
            stop: vi.fn(),
        };
        gcInstances.push(instance);
        return instance;
    }),
}));

vi.mock('~/core/sync/cursor-manager', () => ({
    cleanupCursorManager: vi.fn(),
}));

vi.mock('~/db/client', () => ({
    createWorkspaceDb,
    setActiveWorkspaceDb,
}));

vi.mock('~/composables/workspace/useWorkspaceManager', () => ({
    useWorkspaceManager: () => ({ activeWorkspaceId: workspaceState }),
}));

vi.mock('vue', async () => {
    const actual = await vi.importActual<typeof import('vue')>('vue');
    return {
        ...actual,
        watch: (
            source: unknown,
            callback: (value: unknown, oldValue?: unknown) => void,
            options?: { immediate?: boolean }
        ) => {
            const initialValue = readWatchSource(source);
            watchRecords.push({
                source,
                callback,
                lastValue: initialValue,
            });

            if (options?.immediate !== false) {
                callback(initialValue, undefined);
            }

            return () => undefined;
        },
    };
});

vi.mock('#app', () => ({
    defineNuxtPlugin: (plugin: () => unknown) => plugin(),
    useRuntimeConfig: () => ({
        public: {
            ssrAuthEnabled: true,
            sync: { enabled: true, provider: 'convex' },
            admin: { basePath: '/admin' },
        },
    }),
    useNuxtApp: () => ({ provide: vi.fn() }),
    useRouter: () => ({
        currentRoute: routeState,
        afterEach: vi.fn(() => () => undefined),
    }),
}));

type NuxtTestGlobals = typeof globalThis & {
    defineNuxtPlugin?: (plugin: () => unknown) => unknown;
    useRuntimeConfig?: () => {
        public: {
            ssrAuthEnabled: boolean;
            sync: { enabled: boolean; provider: string };
            admin: { basePath: string };
        };
    };
    useNuxtApp?: () => { provide: ReturnType<typeof vi.fn> };
    useRouter?: () => {
        currentRoute: typeof routeState;
        afterEach: ReturnType<typeof vi.fn>;
    };
};

async function triggerWatchers(): Promise<void> {
    for (const record of watchRecords) {
        const nextValue = readWatchSource(record.source);
        record.callback(nextValue, record.lastValue);
        record.lastValue = nextValue;
    }
    await Promise.resolve();
}

async function flushPluginAsyncWork(): Promise<void> {
    await Promise.resolve();
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
}

describe('sync engine plugin', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.resetModules();

        watchRecords.length = 0;
        outboxInstances.length = 0;
        subscriptionInstances.length = 0;
        gcInstances.length = 0;

        sessionState.value = {
            session: {
                authenticated: true,
                workspace: { id: 'ws-1' },
            },
        };
        workspaceState.value = 'ws-1';
        routeState.value = { path: '/chat' };

        providerRegistryState.active = createProvider('convex');

        providerRegistryMock.registerSyncProvider.mockClear();
        providerRegistryMock.getActiveSyncProvider.mockClear();
        providerRegistryMock.setActiveSyncProvider.mockClear();
        createGatewaySyncProvider.mockClear();

        hookBridgeMock.start.mockClear();
        hookBridgeMock.stop.mockClear();

        setActiveWorkspaceDb.mockClear();
        createWorkspaceDb.mockClear();

        const globals = globalThis as NuxtTestGlobals;
        globals.defineNuxtPlugin = (plugin) => plugin();
        globals.useRuntimeConfig = () => ({
            public: {
                ssrAuthEnabled: true,
                sync: { enabled: true, provider: 'convex' },
                admin: { basePath: '/admin' },
            },
        });
        globals.useNuxtApp = () => ({ provide: vi.fn() });
        globals.useRouter = () => ({
            currentRoute: routeState,
            afterEach: vi.fn(() => () => undefined),
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('starts sync engine when provider and workspace are available', async () => {
        await import('~/plugins/convex-sync.client');
        await flushPluginAsyncWork();

        expect(outboxInstances).toHaveLength(1);
        expect(outboxInstances[0]?.start).toHaveBeenCalledTimes(1);
        expect(subscriptionInstances).toHaveLength(1);
        expect(subscriptionInstances[0]?.start).toHaveBeenCalledTimes(1);
        expect(gcInstances).toHaveLength(1);
        expect(gcInstances[0]?.start).toHaveBeenCalledTimes(1);
    });

    it('does not start sync engine when user is unauthenticated', async () => {
        sessionState.value = {
            session: {
                authenticated: false,
                workspace: { id: 'ws-1' },
            },
        };

        await import('~/plugins/convex-sync.client');
        await flushPluginAsyncWork();

        expect(outboxInstances).toHaveLength(0);
        expect(subscriptionInstances).toHaveLength(0);
        expect(gcInstances).toHaveLength(0);
    });

    it('retries start when provider is temporarily unavailable and recovers', async () => {
        sessionState.value = {
            session: {
                authenticated: false,
                workspace: { id: 'ws-1' },
            },
        };

        await import('~/plugins/convex-sync.client');

        providerRegistryState.active = null;
        sessionState.value = {
            session: {
                authenticated: true,
                workspace: { id: 'ws-1' },
            },
        };

        await triggerWatchers();

        expect(outboxInstances).toHaveLength(0);

        await vi.advanceTimersByTimeAsync(499);
        expect(outboxInstances).toHaveLength(0);

        providerRegistryState.active = createProvider('convex');
        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();

        expect(outboxInstances).toHaveLength(1);
        expect(outboxInstances[0]?.start).toHaveBeenCalledTimes(1);
    });

    it('cancels pending auth retry when session becomes unauthenticated', async () => {
        sessionState.value = {
            session: {
                authenticated: false,
                workspace: { id: 'ws-1' },
            },
        };

        await import('~/plugins/convex-sync.client');

        providerRegistryState.active = null;
        sessionState.value = {
            session: {
                authenticated: true,
                workspace: { id: 'ws-1' },
            },
        };
        await triggerWatchers();

        sessionState.value = {
            session: {
                authenticated: false,
                workspace: { id: 'ws-1' },
            },
        };
        await triggerWatchers();

        providerRegistryState.active = createProvider('convex');
        await vi.advanceTimersByTimeAsync(6000);

        expect(outboxInstances).toHaveLength(0);
    });

    it('stops current engine and starts a new one when workspace changes', async () => {
        await import('~/plugins/convex-sync.client');
        await flushPluginAsyncWork();

        const firstProvider = providerRegistryState.active;
        workspaceState.value = 'ws-2';
        await triggerWatchers();
        await flushPluginAsyncWork();

        expect(outboxInstances).toHaveLength(2);
        expect(outboxInstances[0]?.stop).toHaveBeenCalledTimes(1);
        expect(subscriptionInstances[0]?.stop).toHaveBeenCalledTimes(1);
        expect(gcInstances[0]?.stop).toHaveBeenCalledTimes(1);
        expect(firstProvider?.dispose).toHaveBeenCalledTimes(1);
        expect(outboxInstances[1]?.start).toHaveBeenCalledTimes(1);
    });

    it('stops sync and clears active workspace DB on admin route transitions', async () => {
        await import('~/plugins/convex-sync.client');
        await flushPluginAsyncWork();

        routeState.value = { path: '/admin/extensions' };
        await triggerWatchers();
        await flushPluginAsyncWork();

        expect(setActiveWorkspaceDb).toHaveBeenCalledWith(null);
        expect(outboxInstances).toHaveLength(1);
        expect(outboxInstances[0]?.stop).toHaveBeenCalledTimes(1);
        expect(subscriptionInstances[0]?.stop).toHaveBeenCalledTimes(1);
        expect(gcInstances[0]?.stop).toHaveBeenCalledTimes(1);
    });
});
