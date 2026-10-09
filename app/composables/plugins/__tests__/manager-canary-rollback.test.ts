import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginRuntimeManifestResponse } from '~~/shared/plugins/runtime-manifest';
import type { BundledV1PluginDescriptor } from '~~/shared/plugins/runtime-descriptor';
import { WorkspacePluginCoordinator } from '~~/shared/plugins/workspace-plugin-coordinator';
import { installWorkspacePluginCoordinator, stopWorkspacePluginsAndAwait } from '../workspace-plugin-coordinator';

const fixture = vi.hoisted(() => ({
    ids: ['runtime-order-after-cleanup', 'runtime-order-first', 'runtime-order-second'],
    config: {
        public: {
            ssrAuthEnabled: true,
            admin: {
                pluginRuntimeLoaderEnabled: true,
                pluginRuntimeV2Enabled: true,
                pluginRuntimeV2WorkspaceIds: [] as string[],
                pluginRuntimeShadowEnabled: false,
                disableNonCorePlugins: false,
            },
        },
    },
}));

vi.mock('#imports', async (importOriginal) => ({
    ...await importOriginal<typeof import('#imports')>(),
    useRuntimeConfig: () => fixture.config,
}));
vi.mock('#build/or3/bundled-plugin-catalog', () => ({
    bundledPluginCatalog: {
        schemaVersion: 1,
        marker: 'or3-bundled-plugin-catalog:v1',
        hostBuildId: 'fixture-build',
        entries: fixture.ids.map((pluginId) => ({
            pluginId,
            clientEntry: 'plugin.client.ts',
            moduleKey: `../../tests/plugin-runtime/build-fixtures/extensions/plugins/${pluginId}/plugin.client.ts`,
        })),
    },
}));

import { listRegisteredMessageActionIds } from '~/composables/chat/useMessageActions';

function manifest(enabled: string[], revision: string, workspaceId = 'workspace-1'): PluginRuntimeManifestResponse {
    return {
        workspaceId,
        revision,
        installedPluginIds: fixture.ids,
        enabledPluginIds: [...enabled].sort(),
        runtime: Object.fromEntries(fixture.ids.map((id, index) => {
            const descriptor: BundledV1PluginDescriptor = {
                id,
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
                    hostBuildId: 'fixture-build',
                    moduleKey: `../../tests/plugin-runtime/build-fixtures/extensions/plugins/${id}/plugin.client.ts`,
                    rebuildRequired: true,
                },
                descriptorKey: `sha256-${String(index + 1).repeat(64)}`,
            };
            return [id, {
                clientEntry: 'plugin.client.ts',
                hasServerRoutes: false,
                loadAllowed: enabled.includes(id),
                lifecycleCoverage: 'legacy-global-possible',
                descriptorStatus: 'ready',
                descriptor,
            }];
        })),
    };
}

function fixtureActions(): string[] {
    return listRegisteredMessageActionIds().filter((id) => id.startsWith('fixture:')).sort();
}

describe('bundled plugin compatibility through the workspace entry point', () => {
    let coordinator: WorkspacePluginCoordinator;
    let desired: PluginRuntimeManifestResponse;
    const errors: unknown[] = [];
    const clientProcess = process as typeof process & { client?: boolean };
    const originalClient = clientProcess.client;

    beforeEach(() => {
        errors.length = 0;
        clientProcess.client = true;
        fixture.config.public.ssrAuthEnabled = true;
        Object.assign(fixture.config.public.admin, {
            pluginRuntimeLoaderEnabled: true,
            pluginRuntimeV2Enabled: true,
            pluginRuntimeV2WorkspaceIds: [],
            disableNonCorePlugins: false,
        });
        vi.stubGlobal('defineNuxtPlugin', (plugin: unknown) => plugin);
        desired = manifest(['runtime-order-first', 'runtime-order-second'], 'boot');
        coordinator = new WorkspacePluginCoordinator({
            fetchManifest: async () => desired,
            onError: (error) => errors.push(error),
        });
        installWorkspacePluginCoordinator(coordinator);
    });

    afterEach(async () => {
        await coordinator.dispose();
        installWorkspacePluginCoordinator(null);
        clientProcess.client = originalClient;
        vi.unstubAllGlobals();
        expect(fixtureActions()).toEqual([]);
    });

    it.each([
        { name: 'manager selected', enabled: true, workspaces: [] },
        { name: 'package client flag disabled', enabled: false, workspaces: [] },
        { name: 'outside the former manager canary', enabled: true, workspaces: ['other-workspace'] },
    ])('preserves startup, cleanup, workspace change, and logout with $name', async ({ enabled, workspaces }) => {
        fixture.config.public.admin.pluginRuntimeV2Enabled = enabled;
        fixture.config.public.admin.pluginRuntimeV2WorkspaceIds = workspaces;
        const boot = (await import('~/plugins/workspace-plugins.client')).default as () => void;
        boot();

        await coordinator.refresh({ workspaceId: 'workspace-1', sessionKey: 'session-1' });
        expect(fixtureActions()).toEqual(['fixture:cleanup-first', 'fixture:startup-first', 'fixture:startup-second']);

        // The new plugin sorts before the one being removed and needs its async
        // cleanup to finish. Neither import order nor per-plugin locking suffices.
        desired = manifest(['runtime-order-after-cleanup', 'runtime-order-second'], 'disable-and-enable');
        await coordinator.refresh({ workspaceId: 'workspace-1', sessionKey: 'session-1' });
        expect(fixtureActions()).toEqual(['fixture:after-cleanup', 'fixture:startup-second']);

        desired = manifest(['runtime-order-first', 'runtime-order-second'], 'workspace-change', 'workspace-2');
        await coordinator.refresh({ workspaceId: 'workspace-2', sessionKey: 'session-1' });
        expect(fixtureActions()).toEqual(['fixture:cleanup-first', 'fixture:startup-first', 'fixture:startup-second']);

        await stopWorkspacePluginsAndAwait();
        expect(fixtureActions()).toEqual([]);
        expect(errors).toEqual([]);
    });

    it('finishes all async removal cleanup before starting a newly enabled plugin', async () => {
        desired = manifest(['runtime-order-first'], 'boot-first');
        const boot = (await import('~/plugins/workspace-plugins.client')).default as () => void;
        boot();
        await coordinator.refresh({ workspaceId: 'workspace-1', sessionKey: 'session-1' });
        expect(fixtureActions()).toEqual(['fixture:cleanup-first', 'fixture:startup-first']);

        desired = manifest(['runtime-order-after-cleanup'], 'replace-with-other-plugin');
        await coordinator.refresh({ workspaceId: 'workspace-1', sessionKey: 'session-1' });
        expect(fixtureActions()).toEqual(['fixture:after-cleanup']);
        expect(errors).toEqual([]);
    });

    it.each(['static', 'loader-disabled', 'safe-mode'] as const)('keeps bundled plugins inactive in %s mode', async (mode) => {
        if (mode === 'static') fixture.config.public.ssrAuthEnabled = false;
        if (mode === 'loader-disabled') fixture.config.public.admin.pluginRuntimeLoaderEnabled = false;
        if (mode === 'safe-mode') fixture.config.public.admin.disableNonCorePlugins = true;
        const boot = (await import('~/plugins/workspace-plugins.client')).default as () => void;
        boot();
        await coordinator.refresh({ workspaceId: 'workspace-1', sessionKey: 'session-1' });
        expect(fixtureActions()).toEqual([]);
        expect(errors).toEqual([]);
    });
});
