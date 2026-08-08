/* @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { useRuntimeConfigMock, getSyncGatewayAdapterMock } = vi.hoisted(() => ({
    useRuntimeConfigMock: vi.fn(),
    getSyncGatewayAdapterMock: vi.fn(),
}));

vi.mock('#imports', () => ({
    useRuntimeConfig: useRuntimeConfigMock,
}));

vi.mock('../../sync/gateway/registry', () => ({
    getSyncGatewayAdapter: getSyncGatewayAdapterMock,
}));

vi.mock('nitropack/runtime', () => ({
    defineNitroPlugin: (handler: unknown) => handler,
}));

function createConfig(overrides?: { enabled?: boolean; provider?: string }) {
    return {
        sync: {
            enabled: overrides?.enabled ?? true,
            provider: overrides?.provider ?? 'sqlite',
        },
    };
}

function createAdapter() {
    return {
        listWorkspaceIds: vi.fn().mockResolvedValue(['ws-1', 'ws-2']),
        gcChangeLog: vi.fn().mockResolvedValue(undefined),
        gcTombstones: vi.fn().mockResolvedValue(undefined),
        beginMaintenanceRun: vi.fn(),
        completeMaintenanceRun: vi.fn(),
        failMaintenanceRun: vi.fn(),
    };
}

function createNitroApp() {
    return {
        hooks: {
            hook: vi.fn(),
        },
    } as any;
}

describe('sync-maintenance scheduler plugin', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.resetModules();
        useRuntimeConfigMock.mockReset().mockReturnValue(createConfig());
        getSyncGatewayAdapterMock.mockReset().mockReturnValue(createAdapter());
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('starts the scheduler only when sync is enabled and provider is sqlite', async () => {
        const { startSyncMaintenanceScheduler } = await import('../sync-maintenance');
        const scheduler = startSyncMaintenanceScheduler();
        expect(scheduler).not.toBeNull();
        scheduler?.stop();
    });

    it('skips when sync is disabled', async () => {
        useRuntimeConfigMock.mockReturnValue(createConfig({ enabled: false }));
        const { startSyncMaintenanceScheduler } = await import('../sync-maintenance');
        expect(startSyncMaintenanceScheduler()).toBeNull();
    });

    it('skips when the sync provider is not sqlite', async () => {
        useRuntimeConfigMock.mockReturnValue(createConfig({ provider: 'convex' }));
        const { startSyncMaintenanceScheduler } = await import('../sync-maintenance');
        expect(startSyncMaintenanceScheduler()).toBeNull();
    });

    it('runs GC per workspace and records maintenance state', async () => {
        const adapter = createAdapter();
        getSyncGatewayAdapterMock.mockReturnValue(adapter);
        const { runSyncMaintenance } = await import('../sync-maintenance');

        await runSyncMaintenance();

        expect(adapter.beginMaintenanceRun).toHaveBeenCalledTimes(1);
        expect(adapter.listWorkspaceIds).toHaveBeenCalledTimes(1);
        expect(adapter.gcChangeLog).toHaveBeenCalledTimes(2);
        expect(adapter.gcTombstones).toHaveBeenCalledTimes(2);
        expect(adapter.completeMaintenanceRun).toHaveBeenCalledTimes(1);
        expect(adapter.failMaintenanceRun).not.toHaveBeenCalled();
    });

    it('is non-overlapping: skips a pass while one is in flight', async () => {
        const adapter = createAdapter();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        adapter.listWorkspaceIds.mockReturnValue(gate.then(() => ['ws-1']));
        getSyncGatewayAdapterMock.mockReturnValue(adapter);
        const { runSyncMaintenance } = await import('../sync-maintenance');

        const first = runSyncMaintenance();
        const second = runSyncMaintenance();
        release();
        await Promise.all([first, second]);

        expect(adapter.listWorkspaceIds).toHaveBeenCalledTimes(1);
        expect(adapter.gcChangeLog).toHaveBeenCalledTimes(1);
    });

    it('records a failed maintenance state when GC throws', async () => {
        const adapter = createAdapter();
        adapter.gcChangeLog.mockRejectedValue(new Error('db locked'));
        getSyncGatewayAdapterMock.mockReturnValue(adapter);
        const { runSyncMaintenance } = await import('../sync-maintenance');

        await runSyncMaintenance();

        expect(adapter.failMaintenanceRun).toHaveBeenCalledWith('db locked');
        expect(adapter.completeMaintenanceRun).not.toHaveBeenCalled();
    });

    it('is inert when the gateway is not registered', async () => {
        getSyncGatewayAdapterMock.mockReturnValue(null);
        const { runSyncMaintenance } = await import('../sync-maintenance');
        await expect(runSyncMaintenance()).resolves.toBeUndefined();
    });

    it('the Nitro plugin is inert when sync is not sqlite', async () => {
        useRuntimeConfigMock.mockReturnValue(createConfig({ provider: 'convex' }));
        const plugin = (await import('../sync-maintenance')).default as (
            nitroApp: ReturnType<typeof createNitroApp>
        ) => void;
        const nitroApp = createNitroApp();

        plugin(nitroApp);

        expect(nitroApp.hooks.hook).not.toHaveBeenCalled();
    });

    it('the Nitro plugin starts the scheduler and installs a close hook for sqlite', async () => {
        const plugin = (await import('../sync-maintenance')).default as (
            nitroApp: ReturnType<typeof createNitroApp>
        ) => void;
        const nitroApp = createNitroApp();

        plugin(nitroApp);

        expect(nitroApp.hooks.hook).toHaveBeenCalledWith('close', expect.any(Function));
    });

});
