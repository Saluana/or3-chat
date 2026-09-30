import { useRuntimeConfig } from '#imports';
import { bundledPluginCatalog } from '#build/or3/bundled-plugin-catalog';
import {
    createManagedWorkspacePluginRuntime,
    registerWorkspacePluginInstance,
    unregisterWorkspacePluginInstance,
} from '~/composables/plugins/workspace-runtime';
import type { PluginRuntimeManifestResponse } from '~~/shared/plugins/runtime-manifest';
import { discoverNonCorePlugins } from '~~/shared/plugins/safe-mode';
import { createWorkspacePluginShadowObserver } from '~/composables/plugins/workspace-plugin-shadow-observer';
import { BundledV1Loader } from '~~/shared/plugins/bundled-v1-loader';
import {
    createWorkspaceManagerCanarySelector,
    createStartupSelectedWorkspaceManager,
    createBundledV1WorkspaceManager,
    parseWorkspacePluginModule,
    desiredStateFromManifest,
} from '~/composables/plugins/bundled-v1-manager-runtime';

import { getWorkspacePluginCoordinator } from '~/composables/plugins/workspace-plugin-coordinator';
import type { LegacyCleanupReport } from '~~/shared/plugins/legacy-plugin-scope';

export default defineNuxtPlugin(() => {
    if (!process.client) return;

    const runtimeConfig = useRuntimeConfig();
    const runtimeLoaderEnabled =
        runtimeConfig.public?.admin?.pluginRuntimeLoaderEnabled !== false;
    if (runtimeConfig.public?.ssrAuthEnabled !== true || !runtimeLoaderEnabled) {
        return;
    }

    const modules = discoverNonCorePlugins(runtimeConfig.public?.admin, () => ({
        ...import.meta.glob('../../extensions/plugins/*/**/*.client.ts'),
        ...import.meta.glob('../../extensions/plugins/*/**/*.client.js'),
        ...import.meta.glob('../../extensions/plugins/*/**/*.client.mjs'),
        // Production-build compatibility corpus. These modules are bundled so the
        // V1 loader boundary is exercised, but they are outside the installed
        // extension inventory and therefore can never be enabled at runtime.
        ...import.meta.glob(
            '../../tests/plugin-runtime/build-fixtures/extensions/plugins/*/**/*.client.ts'
        ),
    })) as Record<string, () => Promise<unknown>> | undefined;
    if (!modules) return;
    const bundledV1Loader = new BundledV1Loader(bundledPluginCatalog, modules);

    // Snapshot startup-only cutover flags before any plugin code executes.
    const managerFlags = Object.freeze({
        enabled: runtimeConfig.public?.admin?.pluginRuntimeV2Enabled === true,
        workspaceIds: Object.freeze([
            ...(runtimeConfig.public?.admin?.pluginRuntimeV2WorkspaceIds ?? []),
        ]),
    });
    const isManagerWorkspace = createWorkspaceManagerCanarySelector(managerFlags);
    const v2Manager = createStartupSelectedWorkspaceManager(managerFlags.enabled, () =>
        createBundledV1WorkspaceManager({
            loader: bundledV1Loader,
        })
    );
    const shadowObserver = createWorkspacePluginShadowObserver({
        enabled: runtimeConfig.public?.admin?.pluginRuntimeShadowEnabled !== false,
        catalog: bundledPluginCatalog,
    });
    const managedPluginIds = new Set<string>();
    const descriptorKeys = new Map<string, string>();
    const disposers = new Map<string, () => Promise<LegacyCleanupReport>>();
    const stopLegacyPlugin = async (id: string) => {
        const report = await disposers.get(id)?.();
        if (report && (report.timedOut || report.errors.length)) throw new Error(`Plugin ${id} cleanup failed`);
        unregisterWorkspacePluginInstance(id);
        managedPluginIds.delete(id);
        descriptorKeys.delete(id);
        disposers.delete(id);
        shadowObserver?.observeStop(id);
    };

    const syncManifest = async (manifest: PluginRuntimeManifestResponse, isCurrent: () => boolean) => {
        const workspaceId = manifest.workspaceId!;
        // Server-authoritative load set: only plugins the host decided are loadable.
        const enabledSet = new Set(
            manifest.enabledPluginIds.filter((pluginId) => {
                const runtime = manifest.runtime[pluginId];
                return (
                    runtime?.descriptorStatus === 'ready' &&
                    runtime.descriptor.manifestVersion === 1
                );
            })
        );

        for (const id of Array.from(managedPluginIds)) {
            const entry = manifest.runtime[id];
            if (!enabledSet.has(id) || (entry?.descriptorStatus === 'ready' && descriptorKeys.get(id) !== entry.descriptor.descriptorKey)) {
                await stopLegacyPlugin(id);
                if (!isCurrent()) return;
            }
        }

        for (const pluginId of Array.from(enabledSet)) {
            if (!isCurrent()) return;

            if (managedPluginIds.has(pluginId)) {
                continue;
            }

            const loaderResolution = bundledV1Loader.resolve(
                pluginId,
                manifest.runtime[pluginId]?.clientEntry
            );
            if (loaderResolution.status !== 'ready') {
                const clientEntry = manifest.runtime[pluginId]?.clientEntry;
                const runtimeEntry = manifest.runtime[pluginId];
                shadowObserver?.recordDivergence({
                    pluginId,
                    workspaceId: manifest.workspaceId ?? workspaceId,
                    runtimeEntry,
                });
                if (clientEntry) {
                    console.warn(
                        `[workspace-plugins] no bundled client entry resolved for plugin "${pluginId}". ` +
                            `Post-build ZIP installs require a rebuild so Vite can include the client entry ` +
                            `(${clientEntry}).`
                    );
                }
                continue;
            }

            let dispose: (() => Promise<LegacyCleanupReport>) | null = null;
            try {
                const mod = await loaderResolution.load();
                if (!isCurrent()) {
                    return;
                }

                const plugin = parseWorkspacePluginModule(mod, pluginId);
                if (!plugin) {
                    throw new Error('Invalid plugin module export or plugin id mismatch');
                }

                const runtime = createManagedWorkspacePluginRuntime({ pluginId });
                dispose = runtime.dispose;
                await plugin.register(runtime.api);
                if (!isCurrent()) {
                    await dispose();
                    return;
                }

                const registration = registerWorkspacePluginInstance(
                    pluginId,
                    'extension',
                    async () => { await runtime.dispose(); }
                );
                if (!registration.accepted) {
                    await dispose();
                    dispose = null;
                    continue;
                }
                managedPluginIds.add(pluginId);
                disposers.set(pluginId, runtime.dispose);
                const entry = manifest.runtime[pluginId];
                if (entry?.descriptorStatus === 'ready') descriptorKeys.set(pluginId, entry.descriptor.descriptorKey);
                // Shadow-only: V1 has already imported and registered. Descriptor
                // verification observes that outcome and never controls it.
                shadowObserver?.observeActivation({
                    pluginId,
                    workspaceId: manifest.workspaceId ?? workspaceId,
                    runtimeEntry: manifest.runtime[pluginId],
                    isStillManaged: () => managedPluginIds.has(pluginId),
                });
                dispose = null;
            } catch (error) {
                shadowObserver?.recordDivergence({
                    pluginId,
                    workspaceId: manifest.workspaceId ?? workspaceId,
                    runtimeEntry: manifest.runtime[pluginId],
                });
                if (dispose) {
                    await dispose();
                }
                if (import.meta.dev) {
                    console.error(
                        `[workspace-plugins] failed to load plugin "${pluginId}"`,
                        error
                    );
                }
            }
        }

    };

    const unregister = getWorkspacePluginCoordinator().register({
        name: 'bundled-v1',
        async stop() {
            const results = await Promise.allSettled([
                ...(v2Manager ? [v2Manager.stopAll('workspace-session-change')] : []),
                ...Array.from(managedPluginIds, stopLegacyPlugin),
            ]);
            const failures = results.filter((result) => result.status === 'rejected');
            if (failures.length) throw new AggregateError(failures.map((result) => result.reason), 'Bundled plugin teardown failed');
        },
        async reconcile(manifest, isCurrent) {
            if (isManagerWorkspace(manifest.workspaceId)) {
                await v2Manager?.reconcile(desiredStateFromManifest(manifest, manifest.workspaceId!), 'accepted-manifest');
            } else {
                await syncManifest(manifest, isCurrent);
            }
        },
    });
    if (import.meta.hot) import.meta.hot.dispose(() => { void unregister(); });
});
