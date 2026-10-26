import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, reactive } from 'vue';
import type { SyncScope } from '~~/shared/sync/types';

type SessionRecord = {
    session: null | {
        user?: { id: string };
        authenticated?: boolean;
        workspace?: { id: string };
    };
};

type MockProvider = {
    id: string;
    mode: 'gateway' | 'direct';
    auth?: { providerId: string; template?: string };
    subscribe: ReturnType<typeof vi.fn>;
    pull: ReturnType<typeof vi.fn>;
    push: ReturnType<typeof vi.fn>;
    updateCursor: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
};

type OutboxInstance = {
    scope: SyncScope;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    flush: ReturnType<typeof vi.fn>;
    retryFailed: ReturnType<typeof vi.fn>;
    quarantineCorruptOps: ReturnType<typeof vi.fn>;
};

type SubscriptionInstance = {
    scope: SyncScope;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
};

type GcInstance = {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
};

function createProvider(id = 'convex', mode: 'gateway' | 'direct' = 'gateway'): MockProvider {
    return {
        id,
        mode,
        auth: mode === 'direct'
            ? {
                providerId: id,
                template: 'convex',
            }
            : undefined,
        subscribe: vi.fn(async () => () => undefined),
        pull: vi.fn(async () => ({ changes: [], nextCursor: 0, hasMore: false })),
        push: vi.fn(async () => ({ results: [], serverVersion: 0 })),
        updateCursor: vi.fn(async () => undefined),
        dispose: vi.fn(async () => undefined),
    };
}

const sessionState = reactive<{ value: SessionRecord }>({
    value: {
        session: {
            authenticated: true,
            workspace: { id: 'ws-1' },
        },
    },
});

const workspaceState = reactive<{ value: string | null }>({
    value: 'ws-1',
});

const routeState = reactive({
    value: { path: '/chat' },
});

const watcherStops: Array<() => void> = [];
const nuxtAppMock = { provide: vi.fn() };

const pluginControl = vi.hoisted(() => {
    let release: () => void = () => undefined;
    let gate: Promise<void> = Promise.resolve();
    const runtime = {
        ssrAuthEnabled: true,
        sync: { enabled: true, provider: 'convex' },
        admin: { basePath: '/admin' },
    };
    return {
        runtime,
        blockStart() {
            gate = new Promise<void>((resolve) => {
                release = resolve;
            });
        },
        releaseStart() {
            release();
        },
        waitStart() {
            return gate;
        },
        reset() {
            gate = Promise.resolve();
            runtime.ssrAuthEnabled = true;
            runtime.sync = { enabled: true, provider: 'convex' };
        },
    };
});

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
const authTokenBrokerMock = {
    getProviderToken: vi.fn(async (): Promise<string | null> => 'token'),
};

vi.mock('~/composables/auth/useSessionContext', () => ({
    useSessionContext: () => ({ data: sessionState }),
    getCachedSessionContext: () => sessionState.value.session,
}));

vi.mock('~/composables/auth/useAuthTokenBroker.client', () => ({
    useAuthTokenBroker: () => authTokenBrokerMock,
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
    OutboxManager: vi.fn(function (_db: unknown, _provider: unknown, scope: SyncScope) {
        const instance: OutboxInstance = {
            scope,
            start: vi.fn(),
            stop: vi.fn(),
            flush: vi.fn(async () => true),
            retryFailed: vi.fn(async () => undefined),
            quarantineCorruptOps: vi.fn(async () => ({ quarantined: 0, repaired: 0 })),
        };
        outboxInstances.push(instance);
        return instance;
    }),
}));

vi.mock('~/core/sync/subscription-manager', async importOriginal => ({
    ...(await importOriginal<typeof import('~/core/sync/subscription-manager')>()),
    createSubscriptionManager: vi.fn((_db: unknown, _provider: unknown, scope: SyncScope) => {
        const instance: SubscriptionInstance = {
            scope,
            start: vi.fn(async () => pluginControl.waitStart()),
            stop: vi.fn(async () => undefined),
        };
        subscriptionInstances.push(instance);
        return instance;
    }),
    cleanupSubscriptionManager: vi.fn(),
}));

vi.mock('~/core/sync/gc-manager', () => ({
    GcManager: vi.fn(function () {
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
    getActiveWorkspaceId: () => workspaceState.value,
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
        watch: (...args: Parameters<typeof actual.watch>) => {
            const stop = actual.watch(...args);
            watcherStops.push(stop);
            return stop;
        },
    };
});

vi.mock('#app', () => ({
    defineNuxtPlugin: (plugin: () => unknown) => plugin(),
    useRuntimeConfig: () => ({
        public: pluginControl.runtime,
    }),
    useNuxtApp: () => nuxtAppMock,
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

async function flushPluginAsyncWork(): Promise<void> {
    await nextTick();
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
}

describe('sync engine plugin', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.resetModules();

        pluginControl.reset();
        nuxtAppMock.provide.mockClear();
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
        authTokenBrokerMock.getProviderToken.mockClear();

        const globals = globalThis as NuxtTestGlobals;
        globals.defineNuxtPlugin = (plugin) => plugin();
        globals.useRuntimeConfig = () => ({
            public: pluginControl.runtime,
        });
        globals.useNuxtApp = () => nuxtAppMock;
        globals.useRouter = () => ({
            currentRoute: routeState,
            afterEach: vi.fn(() => () => undefined),
        });
    });

    afterEach(async () => {
        for (const stop of watcherStops.splice(0)) stop();
        pluginControl.releaseStart();
        const engine = nuxtAppMock.provide.mock.calls.find(([key]) => key === 'syncEngine')?.[1] as
            { stop: () => Promise<void> } | undefined;
        await engine?.stop();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('keeps local uploads running while incoming sync waits for another window, and cancels ownership on sign-out', async () => {
        let signal: AbortSignal | undefined;
        const request = vi.fn((_name: string, options: { signal: AbortSignal; ifAvailable?: boolean }, callback: (lock: null) => Promise<void>) => {
            if (options.ifAvailable) return callback(null);
            return new Promise<void>((_resolve, reject) => {
                signal = options.signal;
                signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
            });
        });
        vi.stubGlobal('navigator', { locks: { request }, onLine: true });
        await (await import('~/plugins/convex-sync.client')).default;
        await flushPluginAsyncWork();

        expect(subscriptionInstances[0]?.start).not.toHaveBeenCalled();
        expect(outboxInstances[0]?.start).toHaveBeenCalledTimes(1);
        expect(request).toHaveBeenCalledTimes(2);
        sessionState.value = { session: { authenticated: false, workspace: { id: 'ws-1' } } };
        await nextTick();
        await flushPluginAsyncWork();
        expect(signal?.aborted).toBe(true);
        expect(subscriptionInstances[0]?.start).not.toHaveBeenCalled();
    });

    it('starts sync engine when provider and workspace are available', async () => {
        await (await import('~/plugins/convex-sync.client')).default;
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

        await (await import('~/plugins/convex-sync.client')).default;
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

        await (await import('~/plugins/convex-sync.client')).default;

        providerRegistryState.active = null;
        sessionState.value = {
            session: {
                authenticated: true,
                workspace: { id: 'ws-1' },
            },
        };

        await nextTick();

        expect(outboxInstances).toHaveLength(0);

        await vi.advanceTimersByTimeAsync(499);
        expect(outboxInstances).toHaveLength(0);

        providerRegistryState.active = createProvider('convex');
        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();

        expect(outboxInstances).toHaveLength(1);
        expect(outboxInstances[0]?.start).toHaveBeenCalledTimes(1);
    });

    it('defers direct-provider startup until auth token is available', async () => {
        providerRegistryState.active = createProvider('convex', 'direct');
        authTokenBrokerMock.getProviderToken
            .mockResolvedValueOnce(null)
            .mockResolvedValue('token');

        await (await import('~/plugins/convex-sync.client')).default;
        await Promise.resolve();

        expect(outboxInstances).toHaveLength(0);
        expect(authTokenBrokerMock.getProviderToken).toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(499);
        expect(outboxInstances).toHaveLength(0);

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

        await (await import('~/plugins/convex-sync.client')).default;

        providerRegistryState.active = null;
        sessionState.value = {
            session: {
                authenticated: true,
                workspace: { id: 'ws-1' },
            },
        };
        await nextTick();

        sessionState.value = {
            session: {
                authenticated: false,
                workspace: { id: 'ws-1' },
            },
        };
        await nextTick();

        providerRegistryState.active = createProvider('convex');
        await vi.advanceTimersByTimeAsync(6000);

        expect(outboxInstances).toHaveLength(0);
    });

    it('stops current engine and starts a new one when workspace changes', async () => {
        await (await import('~/plugins/convex-sync.client')).default;
        await flushPluginAsyncWork();

        const firstProvider = providerRegistryState.active;
        workspaceState.value = 'ws-2';
        await nextTick();
        await flushPluginAsyncWork();

        expect(outboxInstances).toHaveLength(2);
        expect(outboxInstances[0]?.stop).toHaveBeenCalledTimes(1);
        expect(subscriptionInstances[0]?.stop).toHaveBeenCalledTimes(1);
        expect(gcInstances[0]?.stop).toHaveBeenCalledTimes(1);
        expect(firstProvider?.dispose).toHaveBeenCalledTimes(1);
        expect(outboxInstances[1]?.start).toHaveBeenCalledTimes(1);
    });

    it('stops sync without clobbering active workspace DB on admin route transitions', async () => {
        await (await import('~/plugins/convex-sync.client')).default;
        await flushPluginAsyncWork();

        routeState.value = { path: '/admin/extensions' };
        await nextTick();
        await flushPluginAsyncWork();

        expect(setActiveWorkspaceDb).not.toHaveBeenCalled();
        expect(outboxInstances).toHaveLength(1);
        expect(outboxInstances[0]?.stop).toHaveBeenCalledTimes(1);
        expect(subscriptionInstances[0]?.stop).toHaveBeenCalledTimes(1);
        expect(gcInstances[0]?.stop).toHaveBeenCalledTimes(1);
    });

    it('starts OutboxManager only after subscription bootstrap resolves', async () => {
        pluginControl.blockStart();
        await (await import('~/plugins/convex-sync.client')).default;
        await vi.waitFor(() => expect(subscriptionInstances).toHaveLength(1));

        expect(subscriptionInstances[0]?.start).toHaveBeenCalledTimes(1);
        expect(outboxInstances).toHaveLength(0);

        pluginControl.releaseStart();
        await flushPluginAsyncWork();

        expect(outboxInstances).toHaveLength(1);
        expect(outboxInstances[0]?.start).toHaveBeenCalledTimes(1);
    });

    it('starts the engine for a non-SSR direct provider without registering gateway', async () => {
        pluginControl.runtime.ssrAuthEnabled = false;
        providerRegistryState.active = createProvider('convex', 'direct');

        await (await import('~/plugins/convex-sync.client')).default;
        await flushPluginAsyncWork();

        expect(createGatewaySyncProvider).not.toHaveBeenCalled();
        expect(outboxInstances).toHaveLength(1);
        expect(subscriptionInstances).toHaveLength(1);
    });

    it('does not start when SSR is off and no direct provider is registered', async () => {
        pluginControl.runtime.ssrAuthEnabled = false;
        providerRegistryState.active = null;

        await (await import('~/plugins/convex-sync.client')).default;
        await flushPluginAsyncWork();

        expect(outboxInstances).toHaveLength(0);
        expect(createGatewaySyncProvider).not.toHaveBeenCalled();
    });
    it('cancels superseded starts and runs only the latest workspace after an A/B/C race', async () => {
        pluginControl.blockStart();
        await (await import('~/plugins/convex-sync.client')).default;
        await Promise.resolve();
        workspaceState.value = 'ws-2';
        await nextTick();
        workspaceState.value = 'ws-3';
        await nextTick();
        pluginControl.releaseStart();
        await flushPluginAsyncWork();
        expect(outboxInstances).toHaveLength(1);
        expect(outboxInstances[0]?.scope.workspaceId).toBe('ws-3');
        expect(outboxInstances[0]?.start).toHaveBeenCalledOnce();
        for (const subscription of subscriptionInstances) {
            expect(subscription.start).toHaveBeenCalledOnce();
            if (subscription.scope.workspaceId === 'ws-3') {
                expect(subscription.stop).not.toHaveBeenCalled();
            } else {
                expect(subscription.stop).toHaveBeenCalled();
            }
        }
    });

    it('restarts visibility coverage when the principal changes within one workspace', async () => {
        sessionState.value.session!.user = { id: 'alice' };
        await (await import('~/plugins/convex-sync.client')).default;
        await flushPluginAsyncWork();
        sessionState.value.session!.user = { id: 'bob' };
        await nextTick();
        await flushPluginAsyncWork();
        expect(outboxInstances).toHaveLength(2);
        expect(outboxInstances[0]?.stop).toHaveBeenCalledTimes(1);
        expect(outboxInstances[1]?.scope).toEqual({ workspaceId: 'ws-1', principalId: 'bob' });
        expect(outboxInstances[1]?.start).toHaveBeenCalledOnce();
    });

});
