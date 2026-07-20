import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    BUNDLED_PLUGIN_CATALOG_MARKER,
    type BundledPluginCatalog,
} from '~~/shared/plugins/bundled-plugin-catalog';
import { BundledV1Loader } from '~~/shared/plugins/bundled-v1-loader';
import type { PluginRuntimeManifestResponse } from '~~/shared/plugins/runtime-manifest';
import type { BundledV1PluginDescriptor } from '~~/shared/plugins/runtime-descriptor';

const runtimeMocks = vi.hoisted(() => ({
    dispose: vi.fn(async () => ({
        status: 'clean' as const,
        timedOut: false,
        invokedCount: 0,
        settledThenableCount: 0,
        errors: [],
        durationMs: 0,
    })),
    registerInstance: vi.fn(() => ({ accepted: true })),
    unregisterInstance: vi.fn(),
}));

vi.mock('../workspace-runtime', () => ({
    createManagedWorkspacePluginRuntime: () => ({ api: {}, dispose: runtimeMocks.dispose }),
    registerWorkspacePluginInstance: runtimeMocks.registerInstance,
    unregisterWorkspacePluginInstance: runtimeMocks.unregisterInstance,
}));

import {
    createBundledV1WorkspaceManager,
    createWorkspaceManagerCanarySelector,
} from '../bundled-v1-manager-runtime';

function catalog(): BundledPluginCatalog {
    return {
        schemaVersion: 1,
        marker: BUNDLED_PLUGIN_CATALOG_MARKER,
        hostBuildId: 'build-1',
        entries: [
            {
                pluginId: 'alpha',
                clientEntry: 'plugin.client.ts',
                moduleKey: 'alpha-module',
            },
        ],
    };
}

function descriptor(workspaceId = 'workspace-1'): BundledV1PluginDescriptor {
    return {
        id: 'alpha',
        version: '1.0.0',
        manifestVersion: 1,
        pluginApiVersion: '1',
        source: 'extension',
        trust: 'trusted-host',
        workspaceId,
        policyRevision: 'policy-1',
        grantsRevision: 'grants-1',
        resolvedDependencyKeys: [],
        artifact: {
            kind: 'bundled-v1',
            hostBuildId: 'build-1',
            moduleKey: 'alpha-module',
            rebuildRequired: true,
        },
        descriptorKey: `sha256-${'a'.repeat(64)}`,
    };
}

function manifest(input: {
    workspaceId?: string;
    revision: string;
    enabled?: boolean;
}): PluginRuntimeManifestResponse {
    const enabled = input.enabled ?? true;
    const entry = descriptor(input.workspaceId);
    return {
        workspaceId: input.workspaceId ?? 'workspace-1',
        enabledPluginIds: enabled ? ['alpha'] : [],
        installedPluginIds: ['alpha'],
        runtime: {
            alpha: {
                clientEntry: 'plugin.client.ts',
                hasServerRoutes: false,
                loadAllowed: enabled,
                lifecycleCoverage: 'legacy-global-possible',
                mediatedLifecycleCoverage: 'managed-v1-api',
                descriptorStatus: 'ready',
                descriptor: entry,
            },
        },
        revision: input.revision,
    };
}

describe('bundled V1 workspace manager runtime', () => {
    beforeEach(() => {
        runtimeMocks.dispose.mockClear();
        runtimeMocks.registerInstance.mockClear().mockReturnValue({ accepted: true });
        runtimeMocks.unregisterInstance.mockClear();
    });

    it('loads only the descriptor-bound artifact and unregisters it on disable', async () => {
        const register = vi.fn();
        let desired = manifest({ revision: '1' });
        const manager = createBundledV1WorkspaceManager({
            loader: new BundledV1Loader(catalog(), {
                'alpha-module': async () => ({ id: 'alpha', register }),
            }),
            getWorkspaceId: () => 'workspace-1',
            fetchManifest: async () => desired,
        });

        await manager.schedule('boot');
        expect(register).toHaveBeenCalledTimes(1);
        expect(runtimeMocks.registerInstance).toHaveBeenCalledWith(
            'alpha',
            'extension',
            expect.any(Function)
        );

        desired = manifest({ revision: '2', enabled: false });
        await manager.schedule('local-admin-change');
        expect(runtimeMocks.unregisterInstance).toHaveBeenCalledWith('alpha');
        expect(manager.listActivePluginIds()).toEqual([]);
    });

    it('preserves a healthy generation on a transient or wrong-workspace manifest', async () => {
        let shouldFail = false;
        const manager = createBundledV1WorkspaceManager({
            loader: new BundledV1Loader(catalog(), {
                'alpha-module': async () => ({ id: 'alpha', register: vi.fn() }),
            }),
            getWorkspaceId: () => 'workspace-1',
            fetchManifest: async () => {
                if (shouldFail) return manifest({ workspaceId: 'workspace-2', revision: '2' });
                return manifest({ revision: '1' });
            },
        });
        await manager.schedule('boot');
        shouldFail = true;

        await manager.schedule('focus-refresh');

        expect(manager.listActivePluginIds()).toEqual(['alpha']);
        expect(runtimeMocks.unregisterInstance).not.toHaveBeenCalled();
    });

    it('stops the old workspace before registering the new workspace generation', async () => {
        let workspaceId = 'workspace-1';
        const register = vi.fn();
        const manager = createBundledV1WorkspaceManager({
            loader: new BundledV1Loader(catalog(), {
                'alpha-module': async () => ({ id: 'alpha', register }),
            }),
            getWorkspaceId: () => workspaceId,
            fetchManifest: async () => manifest({ workspaceId, revision: workspaceId }),
        });
        await manager.schedule('boot');
        workspaceId = 'workspace-2';

        await manager.stopAll('workspace-session-change');
        await manager.schedule('workspace-session-change');

        expect(register).toHaveBeenCalledTimes(2);
        expect(runtimeMocks.unregisterInstance).toHaveBeenCalledTimes(1);
        expect(manager.listRecords()[0]?.descriptor.workspaceId).toBe('workspace-2');
    });

    it('preserves V1 extension-over-builtin registration precedence', async () => {
        runtimeMocks.registerInstance.mockReturnValue({
            accepted: true,
            replacedSource: 'builtin',
        });
        const manager = createBundledV1WorkspaceManager({
            loader: new BundledV1Loader(catalog(), {
                'alpha-module': async () => ({ id: 'alpha', register: vi.fn() }),
            }),
            getWorkspaceId: () => 'workspace-1',
            fetchManifest: async () => manifest({ revision: '1' }),
        });

        await manager.schedule('boot');

        expect(runtimeMocks.registerInstance).toHaveBeenCalledWith(
            'alpha',
            'extension',
            expect.any(Function)
        );
        expect(manager.listActivePluginIds()).toEqual(['alpha']);
    });

    it('snapshots workspace canary flags so live mutation cannot switch kernels', () => {
        const flags = { enabled: true, workspaceIds: ['workspace-1'] };
        const select = createWorkspaceManagerCanarySelector(flags);

        flags.enabled = false;
        flags.workspaceIds.splice(0, 1, 'workspace-2');

        expect(select('workspace-1')).toBe(true);
        expect(select('workspace-2')).toBe(false);
        expect(select(null)).toBe(false);
    });
});
