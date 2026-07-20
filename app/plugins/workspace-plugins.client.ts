import { watch } from 'vue';
import { useRuntimeConfig } from '#imports';
import { bundledPluginCatalog } from '#build/or3/bundled-plugin-catalog';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import {
    createWorkspacePluginApi,
    registerWorkspacePluginInstance,
    unregisterWorkspacePluginInstance,
    type Or3WorkspacePlugin,
} from '~/composables/plugins/workspace-runtime';
import { resolveBundledPluginArtifact } from '~~/shared/plugins/bundled-plugin-catalog';
import { createDescriptorResolver } from '~~/shared/plugins/descriptor-resolver';
import type { PluginRuntimeManifestResponse } from '~~/shared/plugins/runtime-manifest';
import { getShadowPluginManager } from '~/composables/plugins/shadow-plugin-manager';

function findLoader(
    modules: Record<string, () => Promise<unknown>>,
    pluginId: string,
    entry?: string
): (() => Promise<unknown>) | null {
    const resolution = resolveBundledPluginArtifact(bundledPluginCatalog, pluginId, entry);
    return resolution.status === 'bundled' ? modules[resolution.artifact.moduleKey] ?? null : null;
}

function parseWorkspacePlugin(mod: unknown, pluginId: string): Or3WorkspacePlugin | null {
    const raw = ((mod as { default?: unknown })?.default ?? mod) as unknown;
    if (!raw || typeof raw !== 'object') return null;
    const plugin = raw as Partial<Or3WorkspacePlugin>;
    if (typeof plugin.register !== 'function') return null;

    const resolvedId =
        typeof plugin.id === 'string' && plugin.id.trim().length > 0 ? plugin.id : pluginId;
    if (resolvedId !== pluginId) {
        return null;
    }

    return {
        id: pluginId,
        register: plugin.register.bind(plugin),
    };
}

export default defineNuxtPlugin(() => {
    if (!process.client) return;

    const runtimeConfig = useRuntimeConfig();
    const runtimeLoaderEnabled =
        runtimeConfig.public?.admin?.pluginRuntimeLoaderEnabled !== false;
    if (runtimeConfig.public?.ssrAuthEnabled !== true || !runtimeLoaderEnabled) {
        return;
    }

    const modules = {
        ...import.meta.glob('../../extensions/plugins/*/**/*.client.ts'),
        ...import.meta.glob('../../extensions/plugins/*/**/*.client.js'),
        ...import.meta.glob('../../extensions/plugins/*/**/*.client.mjs'),
        // Production-build compatibility corpus. These modules are bundled so the
        // V1 loader boundary is exercised, but they are outside the installed
        // extension inventory and therefore can never be enabled at runtime.
        ...import.meta.glob(
            '../../tests/plugin-runtime/build-fixtures/extensions/plugins/*/**/*.client.ts'
        ),
    } as Record<string, () => Promise<unknown>>;

    const session = useSessionContext();
    const descriptorResolver = createDescriptorResolver(bundledPluginCatalog);
    const shadowManager = getShadowPluginManager();
    let currentRevision = '';
    let syncToken = 0;
    const managedPluginIds = new Set<string>();
    const shadowObservationTokens = new Map<string, symbol>();

    const syncManifest = async () => {
        const token = ++syncToken;
        const workspaceId = session.data.value?.session?.workspace?.id;
        if (!workspaceId) {
            for (const id of Array.from(managedPluginIds)) {
                unregisterWorkspacePluginInstance(id);
                managedPluginIds.delete(id);
                shadowObservationTokens.delete(id);
                shadowManager.observeManagedStop(id);
            }
            currentRevision = '';
            return;
        }

        let manifest: PluginRuntimeManifestResponse;
        try {
            manifest = await $fetch<PluginRuntimeManifestResponse>(
                '/api/plugins/runtime-manifest',
                { cache: 'no-store' }
            );
        } catch (error) {
            if (import.meta.dev) {
                console.warn('[workspace-plugins] failed to fetch runtime manifest', error);
            }
            return;
        }

        if (token !== syncToken) return;

        if (manifest.revision === currentRevision) {
            return;
        }

        // Server-authoritative load set: only plugins the host decided are loadable.
        const enabledSet = new Set(
            manifest.enabledPluginIds.filter((pluginId) => {
                const runtime = manifest.runtime[pluginId];
                return runtime?.loadAllowed !== false;
            })
        );

        for (const id of Array.from(managedPluginIds)) {
            if (!enabledSet.has(id)) {
                unregisterWorkspacePluginInstance(id);
                managedPluginIds.delete(id);
                shadowObservationTokens.delete(id);
                shadowManager.observeManagedStop(id);
            }
        }

        let hadFailure = false;

        for (const pluginId of Array.from(enabledSet)) {
            if (token !== syncToken) return;

            if (managedPluginIds.has(pluginId)) {
                continue;
            }

            const loader = findLoader(modules, pluginId, manifest.runtime[pluginId]?.clientEntry);
            if (!loader) {
                const clientEntry = manifest.runtime[pluginId]?.clientEntry;
                const runtimeEntry = manifest.runtime[pluginId];
                shadowManager.recordDivergence({
                    kind:
                        runtimeEntry?.descriptorStatus === 'rebuild-required'
                            ? 'rebuild-required'
                            : 'desired-not-observed',
                    desiredPluginId: pluginId,
                    desiredSource: 'extension',
                    desiredWorkspaceId: manifest.workspaceId ?? workspaceId,
                    rebuildRequiredReason:
                        runtimeEntry?.descriptorStatus === 'rebuild-required'
                            ? runtimeEntry.rebuildRequiredReason
                            : undefined,
                });
                if (clientEntry) {
                    console.warn(
                        `[workspace-plugins] no bundled client entry resolved for plugin "${pluginId}". ` +
                            `Post-build ZIP installs require a rebuild so Vite can include the client entry ` +
                            `(${clientEntry}).`
                    );
                }
                hadFailure = true;
                continue;
            }

            let dispose: (() => void) | null = null;
            try {
                const mod = await loader();
                if (token !== syncToken) {
                    return;
                }

                const plugin = parseWorkspacePlugin(mod, pluginId);
                if (!plugin) {
                    throw new Error('Invalid plugin module export or plugin id mismatch');
                }

                const runtime = createWorkspacePluginApi();
                dispose = runtime.dispose;
                await plugin.register(runtime.api);
                if (token !== syncToken) {
                    dispose();
                    return;
                }

                const registration = registerWorkspacePluginInstance(
                    pluginId,
                    'extension',
                    dispose
                );
                if (!registration.accepted) {
                    dispose();
                    dispose = null;
                    continue;
                }
                managedPluginIds.add(pluginId);
                const shadowObservationToken = Symbol(pluginId);
                shadowObservationTokens.set(pluginId, shadowObservationToken);
                // Shadow-only: V1 has already imported and registered. Descriptor
                // verification observes that outcome and never controls it.
                void descriptorResolver
                    .resolveBundled({
                        pluginId,
                        workspaceId: manifest.workspaceId ?? workspaceId,
                        runtimeEntry: manifest.runtime[pluginId],
                    })
                    .then((resolution) => {
                        if (
                            shadowObservationTokens.get(pluginId) !== shadowObservationToken ||
                            !managedPluginIds.has(pluginId)
                        ) {
                            return;
                        }
                        if (resolution.status !== 'ready') {
                            shadowManager.recordDivergence({
                                kind:
                                    resolution.failure.code === 'rebuild-required'
                                        ? 'rebuild-required'
                                        : resolution.failure.code === 'workspace-id-mismatch'
                                          ? 'workspace-mismatch'
                                          : 'identity-mismatch',
                                desiredPluginId: pluginId,
                                observedPluginId: pluginId,
                                desiredSource: 'extension',
                                observedSource: 'extension',
                                desiredWorkspaceId: manifest.workspaceId ?? workspaceId,
                                observedWorkspaceId: workspaceId,
                                rebuildRequiredReason:
                                    manifest.runtime[pluginId]?.descriptorStatus ===
                                    'rebuild-required'
                                        ? manifest.runtime[pluginId]?.rebuildRequiredReason
                                        : undefined,
                            });
                            return;
                        }
                        shadowManager.observeManagedActivation({
                            descriptor: resolution.descriptor,
                            lifecycleCoverage:
                                manifest.runtime[pluginId]?.lifecycleCoverage ??
                                'legacy-global-possible',
                        });
                    });
                dispose = null;
            } catch (error) {
                hadFailure = true;
                shadowManager.recordDivergence({
                    kind: 'desired-not-observed',
                    desiredPluginId: pluginId,
                    desiredSource: 'extension',
                    desiredWorkspaceId: manifest.workspaceId ?? workspaceId,
                });
                if (dispose) {
                    dispose();
                }
                if (import.meta.dev) {
                    console.error(
                        `[workspace-plugins] failed to load plugin "${pluginId}"`,
                        error
                    );
                }
            }
        }

        if (token !== syncToken) return;

        // Only commit revision after a fully successful sync so transient failures retry.
        if (!hadFailure) {
            currentRevision = manifest.revision;
        }
    };

    const stopWatcher = watch(
        () => session.data.value?.session?.workspace?.id ?? null,
        () => {
            void syncManifest();
        },
        { immediate: true }
    );

    const onFocus = () => {
        void syncManifest();
    };
    window.addEventListener('focus', onFocus);

    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            stopWatcher();
            window.removeEventListener('focus', onFocus);
            for (const id of Array.from(managedPluginIds)) {
                unregisterWorkspacePluginInstance(id);
                shadowObservationTokens.delete(id);
                shadowManager.observeManagedStop(id);
            }
            managedPluginIds.clear();
        });
    }
});
