import { beforeEach, describe, expect, it, vi } from 'vitest';

const disposeTool = vi.fn(() => true);
const registerTool = vi.fn(() => ({
    _owner: Symbol('tool'),
    dispose: disposeTool,
}));

const dashboardHandles: Array<{ dispose: () => boolean }> = [];
const registerDashboardPlugin = vi.fn((plugin: { id: string }) => {
    let disposed = false;
    const handle = {
        id: plugin.id,
        owner: Symbol(plugin.id),
        get disposed() {
            return disposed;
        },
        dispose() {
            if (disposed) return false;
            disposed = true;
            return true;
        },
    };
    dashboardHandles.push(handle);
    return handle;
});

vi.mock('~/composables/dashboard/useDashboardPlugins', () => ({
    registerDashboardPlugin,
    unregisterDashboardPlugin: vi.fn(),
}));
vi.mock('~/composables/sidebar/registerSidebarPage', () => ({
    registerSidebarPage: vi.fn(() => () => {}),
}));
vi.mock('~/composables/core/usePaneApps', () => ({
    usePaneApps: vi.fn(() => ({
        registerPaneApp: vi.fn((def: { id: string }) => ({
            id: def.id,
            owner: Symbol(def.id),
            disposed: false,
            dispose: () => true,
        })),
        unregisterPaneApp: vi.fn(),
    })),
}));
vi.mock('~/composables/chat/useMessageActions', () => ({
    registerMessageAction: vi.fn((action: { id: string }) => ({
        id: action.id,
        owner: Symbol(action.id),
        disposed: false,
        dispose: () => true,
    })),
    unregisterMessageAction: vi.fn(),
}));
vi.mock('~/utils/chat/tools-public', () => ({
    useToolRegistry: vi.fn(() => ({
        registerTool,
        unregisterTool: vi.fn(),
    })),
}));

describe('workspace plugin runtime registry', () => {
    beforeEach(async () => {
        disposeTool.mockClear().mockReturnValue(true);
        registerTool.mockClear();
        registerDashboardPlugin.mockClear();
        dashboardHandles.length = 0;
        const mod = await import('../workspace-runtime');
        for (const entry of mod.listWorkspacePluginInstances()) {
            mod.unregisterWorkspacePluginInstance(entry.id);
        }
    });

    it('prefers extension over builtin for same plugin id', async () => {
        const mod = await import('../workspace-runtime');
        const cleanupCalls: string[] = [];

        const builtin = mod.registerWorkspacePluginInstance('or3-tasks', 'builtin', () => {
            cleanupCalls.push('builtin');
        });
        expect(builtin.accepted).toBe(true);

        const extension = mod.registerWorkspacePluginInstance('or3-tasks', 'extension', () => {
            cleanupCalls.push('extension');
        });
        expect(extension.accepted).toBe(true);

        expect(cleanupCalls).toEqual(['builtin']);
        expect(mod.listWorkspacePluginInstances()).toEqual([
            { id: 'or3-tasks', source: 'extension' },
        ]);
    });

    it('rejects lower-priority builtin when extension already registered', async () => {
        const mod = await import('../workspace-runtime');

        mod.registerWorkspacePluginInstance('or3-tasks', 'extension', () => {});
        const result = mod.registerWorkspacePluginInstance('or3-tasks', 'builtin', () => {});

        expect(result.accepted).toBe(false);
        expect(mod.listWorkspacePluginInstances()).toEqual([
            { id: 'or3-tasks', source: 'extension' },
        ]);
    });

    it('disposes tools via owner handle instead of name-based unregister', async () => {
        const mod = await import('../workspace-runtime');
        const { api, dispose } = mod.createWorkspacePluginApi();

        const handle = api.registerTool(
            {
                type: 'function',
                function: {
                    name: 'demo_tool',
                    description: 'demo',
                    parameters: { type: 'object', properties: {} },
                },
            } as never,
            async () => ({ ok: true })
        );

        expect(registerTool).toHaveBeenCalled();
        expect(handle.dispose()).toBe(true);
        expect(disposeTool).toHaveBeenCalledTimes(1);

        // Second dispose via plugin cleanup should be idempotent.
        dispose();
        expect(disposeTool).toHaveBeenCalledTimes(1);
    });

    it('runs registered cleanup callbacks when plugin instance is unregistered', async () => {
        const mod = await import('../workspace-runtime');
        const { api, dispose } = mod.createWorkspacePluginApi();
        const cleanup = vi.fn();
        api.onCleanup(cleanup);

        mod.registerWorkspacePluginInstance('cleanup-plugin', 'extension', dispose);
        mod.unregisterWorkspacePluginInstance('cleanup-plugin');
        expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it('survives cleanup callbacks that throw', async () => {
        const mod = await import('../workspace-runtime');
        const { api, dispose } = mod.createWorkspacePluginApi();
        const later = vi.fn();
        api.onCleanup(() => {
            throw new Error('cleanup boom');
        });
        api.onCleanup(later);

        expect(() => dispose()).not.toThrow();
        expect(later).toHaveBeenCalledTimes(1);
    });

    it('exposes awaited cleanup reporting only through the internal manager adapter', async () => {
        const mod = await import('../workspace-runtime');
        const publicRuntime = mod.createWorkspacePluginApi();
        expect(Object.keys(publicRuntime).sort()).toEqual(['api', 'dispose']);
        expect(publicRuntime.dispose()).toBeUndefined();

        const managed = mod.createManagedWorkspacePluginRuntime();
        managed.api.onCleanup(async () => undefined);
        await expect(managed.dispose()).resolves.toMatchObject({
            status: 'clean',
            timedOut: false,
            invokedCount: 1,
            settledThenableCount: 1,
        });
    });
});
