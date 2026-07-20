import { describe, expect, it, vi } from 'vitest';
import type { BundledPluginCatalog } from '~~/shared/plugins/bundled-plugin-catalog';
import { createWorkspacePluginShadowObserver } from '../workspace-plugin-shadow-observer';

const catalog: BundledPluginCatalog = {
    schemaVersion: 1,
    marker: 'or3-bundled-plugin-catalog:v1',
    hostBuildId: 'rollback-test-build',
    entries: [],
};

describe('shadow observer rollback seam', () => {
    it('runs the exact V1 import/register path without constructing observer dependencies', async () => {
        const trace: string[] = [];
        const importV1Plugin = vi.fn(async () => {
            trace.push('v1:import');
            return {
                register: vi.fn(async () => {
                    trace.push('v1:register');
                }),
            };
        });
        const createResolver = vi.fn();
        const getManager = vi.fn();
        const observer = createWorkspacePluginShadowObserver({
            enabled: false,
            catalog,
            createResolver: createResolver as never,
            getManager: getManager as never,
        });

        const plugin = await importV1Plugin();
        await plugin.register();
        observer?.observeActivation({
            pluginId: 'fixture',
            workspaceId: 'workspace-1',
            isStillManaged: () => true,
        });

        expect(observer).toBeNull();
        expect(trace).toEqual(['v1:import', 'v1:register']);
        expect(importV1Plugin).toHaveBeenCalledOnce();
        expect(plugin.register).toHaveBeenCalledOnce();
        expect(createResolver).not.toHaveBeenCalled();
        expect(getManager).not.toHaveBeenCalled();
    });
});

