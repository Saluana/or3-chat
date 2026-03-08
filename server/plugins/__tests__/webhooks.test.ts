/* @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
    useRuntimeConfigMock,
    isWebhooksEnabledMock,
    resolveConfiguredWebhookStoreMock,
    createWebhookDispatcherMock,
    createWebhookEventBridgeMock,
    stopActiveWebhookRuntimeMock,
    setActiveWebhookRuntimeMock,
} = vi.hoisted(() => ({
    useRuntimeConfigMock: vi.fn(),
    isWebhooksEnabledMock: vi.fn(),
    resolveConfiguredWebhookStoreMock: vi.fn(),
    createWebhookDispatcherMock: vi.fn(),
    createWebhookEventBridgeMock: vi.fn(),
    stopActiveWebhookRuntimeMock: vi.fn(),
    setActiveWebhookRuntimeMock: vi.fn(),
}));

vi.mock('#imports', () => ({
    useRuntimeConfig: useRuntimeConfigMock,
}));

vi.mock('../../utils/webhooks/is-webhooks-enabled', () => ({
    isWebhooksEnabled: isWebhooksEnabledMock,
}));

vi.mock('../../utils/webhooks/store/resolve-store', () => ({
    resolveConfiguredWebhookStore: resolveConfiguredWebhookStoreMock,
}));

vi.mock('../../utils/webhooks/dispatcher', () => ({
    createWebhookDispatcher: createWebhookDispatcherMock,
}));

vi.mock('../../utils/webhooks/event-bridge', () => ({
    createWebhookEventBridge: createWebhookEventBridgeMock,
}));

vi.mock('../../utils/webhooks/runtime', () => ({
    getActiveWebhookRuntime: vi.fn(() => null),
    setActiveWebhookRuntime: setActiveWebhookRuntimeMock,
    stopActiveWebhookRuntime: stopActiveWebhookRuntimeMock,
}));

vi.mock('nitropack/runtime', () => ({
    defineNitroPlugin: (handler: unknown) => handler,
}));

function createRuntimeConfig(overrides?: Partial<ReturnType<typeof baseConfig>>) {
    return {
        ...baseConfig(),
        ...overrides,
        webhooks: {
            ...baseConfig().webhooks,
            ...overrides?.webhooks,
        },
    };
}

function baseConfig() {
    return {
        auth: { enabled: true },
        webhooks: {
            enabled: true,
            rateLimitPerMinute: 25,
            deliveryTimeoutMs: 2_500,
            blockPrivateIps: true,
            encryptionKey: 'test-encryption-key',
            maxRetryHours: 6,
            logRetentionHours: 48,
        },
    };
}

function createNitroApp() {
    return {
        hooks: {
            hook: vi.fn(),
            callHook: vi.fn(),
        },
    } as any;
}

describe('webhook Nitro plugin runtime', () => {
    beforeEach(() => {
        vi.useFakeTimers();

        useRuntimeConfigMock.mockReset().mockReturnValue(createRuntimeConfig());
        isWebhooksEnabledMock.mockReset().mockReturnValue(true);
        resolveConfiguredWebhookStoreMock.mockReset().mockReturnValue({
            purgeExpiredLogs: vi.fn().mockResolvedValue(0),
            resetStaleInFlightDeliveries: vi.fn().mockResolvedValue(0),
        });
        createWebhookDispatcherMock.mockReset().mockReturnValue({
            start: vi.fn(),
            stop: vi.fn(),
            claimAndProcess: vi.fn().mockResolvedValue(undefined),
        });
        createWebhookEventBridgeMock.mockReset().mockReturnValue({
            start: vi.fn(),
            stop: vi.fn(),
            refreshCustomHookListeners: vi.fn().mockResolvedValue(undefined),
        });
        stopActiveWebhookRuntimeMock.mockReset();
        setActiveWebhookRuntimeMock.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('starts the runtime when enabled and performs startup recovery', async () => {
        const { startWebhookRuntime } = await import('../20.webhooks');
        const nitroApp = createNitroApp();
        const runtime = await startWebhookRuntime(nitroApp);

        expect(runtime).toBeTruthy();
        expect(resolveConfiguredWebhookStoreMock).toHaveBeenCalled();
        expect(createWebhookDispatcherMock).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                rateLimitPerMinute: 25,
                deliveryTimeoutMs: 2_500,
                blockPrivateIps: true,
                encryptionKey: 'test-encryption-key',
                maxRetryHours: 6,
            }),
            expect.any(String)
        );

        const store = resolveConfiguredWebhookStoreMock.mock.results[0]?.value;
        const dispatcher = createWebhookDispatcherMock.mock.results[0]?.value;
        const bridge = createWebhookEventBridgeMock.mock.results[0]?.value;

        expect(bridge.start).toHaveBeenCalledTimes(1);
        expect(dispatcher.start).toHaveBeenCalledTimes(1);
        expect(store.resetStaleInFlightDeliveries).toHaveBeenCalledWith(300000);
        expect(dispatcher.claimAndProcess).toHaveBeenCalledTimes(1);

        runtime?.stop();
        expect(bridge.stop).toHaveBeenCalledTimes(1);
        expect(dispatcher.stop).toHaveBeenCalledTimes(1);
    });

    it('skips runtime startup when webhooks are disabled', async () => {
        const { startWebhookRuntime } = await import('../20.webhooks');
        isWebhooksEnabledMock.mockReturnValue(false);

        await expect(startWebhookRuntime(createNitroApp())).resolves.toBeNull();
        expect(resolveConfiguredWebhookStoreMock).not.toHaveBeenCalled();
    });

    it('skips runtime startup when the encryption key is missing', async () => {
        const { startWebhookRuntime } = await import('../20.webhooks');
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        useRuntimeConfigMock.mockReturnValue(
            createRuntimeConfig({
                webhooks: {
                    ...baseConfig().webhooks,
                    encryptionKey: '',
                },
            })
        );

        await expect(startWebhookRuntime(createNitroApp())).resolves.toBeNull();
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('no encryption key')
        );
        expect(resolveConfiguredWebhookStoreMock).not.toHaveBeenCalled();
    });

    it('runs the plugin-level stale reaper interval', async () => {
        const { startWebhookRuntime } = await import('../20.webhooks');
        const runtime = await startWebhookRuntime(createNitroApp());
        const store = resolveConfiguredWebhookStoreMock.mock.results[0]?.value;

        store.resetStaleInFlightDeliveries.mockClear();
        await vi.advanceTimersByTimeAsync(2 * 60 * 1000);

        expect(store.resetStaleInFlightDeliveries).toHaveBeenCalledWith(300000);
        runtime?.stop();
    });

    it('the Nitro plugin resets previous runtime, installs a close hook, and stores the active runtime', async () => {
        const plugin = (await import('../20.webhooks')).default as (
            nitroApp: ReturnType<typeof createNitroApp>
        ) => Promise<void>;
        const nitroApp = createNitroApp();

        await plugin(nitroApp);

        expect(stopActiveWebhookRuntimeMock).toHaveBeenCalledTimes(1);
        expect(setActiveWebhookRuntimeMock).toHaveBeenCalledWith(
            expect.objectContaining({
                nitroApp,
            })
        );
        expect(nitroApp.hooks.hook).toHaveBeenCalledWith(
            'close',
            expect.any(Function)
        );
    });
});
