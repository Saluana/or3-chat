/**
 * @module app/plugins/portable-clients.client
 *
 * Purpose:
 * Record which isolated-client packages the active workspace may run, register
 * their surfaces, and tear them down when the workspace or selection changes.
 *
 * Behavior:
 * - The runtime manifest is the only source of truth: only a `ready` descriptor
 *   for an `isolated-client` package with a digest-addressed client entry is
 *   made available to a surface.
 * - Activation is demand-driven. A contained activation has a hard wall-clock
 *   budget (the containment watchdog), so a plugin is started when its surface
 *   opens or the user asks it to restart — never eagerly for every enabled
 *   package, which would spend the budget before anyone used the plugin.
 * - A source whose descriptor key changes is stopped and replaced; a source
 *   that stops being enabled is stopped and removed.
 * - A dashboard page is registered per available source and removed on
 *   teardown; the page renders what the plugin renders.
 *
 * Constraints:
 * - Client only, and only when SSR auth and the plugin runtime loader are on.
 * - No package bytes are fetched before the descriptor is verified.
 */

import { defineAsyncComponent, h } from 'vue';
import { useRuntimeConfig } from '#imports';
import type { PluginRuntimeManifestResponse } from '~~/shared/plugins/runtime-manifest';
import type { PackageV2PluginDescriptor } from '~~/shared/plugins/runtime-descriptor';
import { buildPluginPackageAssetUrl } from '~~/shared/plugins/module-v2-loader';
import {
    registerDashboardPlugin,
    unregisterDashboardPlugin,
    type DashboardPluginPage,
} from '~/composables/dashboard/useDashboardPlugins';
import { getWorkspacePluginCoordinator } from '~/composables/plugins/workspace-plugin-coordinator';

import { usePaneApps } from "~/composables/core/usePaneApps";
import { registerSidebarPage } from "~/composables/sidebar/registerSidebarPage";

const DASHBOARD_PLUGIN_PREFIX = 'portable:';

export function packageIconUrl(descriptor: PackageV2PluginDescriptor): string | undefined {
    if (!descriptor.icon) return undefined;
    return buildPluginPackageAssetUrl({
        pluginId: descriptor.id,
        packageDigest: descriptor.artifact.packageDigest,
        entryPath: descriptor.icon.path,
    });
}

export function isPortableClientDescriptor(
    entry: unknown
): entry is PackageV2PluginDescriptor {
    if (!entry || typeof entry !== 'object') return false;
    const descriptor = entry as PackageV2PluginDescriptor;
    return (
        descriptor.manifestVersion === 2 &&
        descriptor.source === 'package' &&
        descriptor.trust === 'isolated-client' &&
        descriptor.artifact?.kind === 'package-v2' &&
        (descriptor.artifact.client?.isolation === 'iframe' || descriptor.artifact.client?.isolation === 'worker')
    );
}

/**
 * The plugin's own surface: what it renders, contributes and logs. The view is
 * loaded lazily so a workspace with no portable plugins never downloads it.
 */
// `import.meta.glob` keeps the view path out of TypeScript's module resolution
// (the app tsconfig does not include the `.vue` shim) while still letting Vite
// bundle it lazily. The lookup takes the single match by value: an alias-based
// key is not stable, and an undefined component would break plugin startup.
const PORTABLE_VIEW_MODULES = import.meta.glob('../components/plugins/PortableClientView.vue');

const PORTABLE_CLIENT_VIEW: Component = (() => {
    const loader = Object.values(PORTABLE_VIEW_MODULES)[0] as
        | (() => Promise<unknown>)
        | undefined;
    if (!loader) {
        return {
            name: 'PortableClientViewUnavailable',
            render: () =>
                h('div', { class: 'text-sm' }, 'This plugin surface is unavailable in this build.'),
        };
    }
    return defineAsyncComponent(() => loader() as never);
})();

export function createSurfacePage(
    descriptor: PackageV2PluginDescriptor
): DashboardPluginPage {
    const image = packageIconUrl(descriptor);
    return {
        id: 'surface',
        title: descriptor.name,
        icon: 'i-lucide-app-window',
        ...(image ? { image } : {}),
        ...(descriptor.description === undefined ? {} : { description: descriptor.description }),
        component: {
            name: `PortableClientSurface:${descriptor.id}`,
            render: () => h(PORTABLE_CLIENT_VIEW, { pluginId: descriptor.id }),
        },
    };
}

export default defineNuxtPlugin(async () => {
    if (!process.client) return;

    const runtimeConfig = useRuntimeConfig();
    const runtimeLoaderEnabled =
        runtimeConfig.public?.admin?.pluginRuntimeLoaderEnabled !== false;
    if (runtimeConfig.public?.ssrAuthEnabled !== true || !runtimeLoaderEnabled) {
        return;
    }

    const [
        { registerPortableToolCards },
        {
            clearPortableSurfaceRegistrations,
            deactivatePortableClient,
            listPortableActivations,
            listPortableClientSources,
            removePortableClientSource,
            reportPortableContributionReadiness,
            setPortableClientSource,
        },
        { registerPortableTools, toolDiscoveryCode },
        { portablePaneId },
    ] = await Promise.all([
        import('~/composables/plugins/portable-tool-cards'),
        import('~/composables/plugins/portable-client-runtime'),
        import('~/composables/plugins/portable-tools'),
        import('~/composables/plugins/portable-pane'),
    ]);

    const registeredPages = new Set<string>();
    const surfaceDisposers = new Map<string, () => void>();

    const stop = async (pluginId: string, preserveDrafts = false): Promise<void> => {
        surfaceDisposers.get(pluginId)?.();
        surfaceDisposers.delete(pluginId);
        registeredPages.delete(pluginId);
        unregisterDashboardPlugin(`${DASHBOARD_PLUGIN_PREFIX}${pluginId}`);
        removePortableClientSource(pluginId, preserveDrafts);
        clearPortableSurfaceRegistrations(pluginId);
        await deactivatePortableClient(pluginId);
    };

    const syncManifest = async (
        manifest: PluginRuntimeManifestResponse,
        isCurrent: () => boolean
    ): Promise<void> => {
        const workspaceId = manifest.workspaceId!;
        // Ready isolated-client descriptors, keyed by plugin id.
        const wanted = new Map<string, PackageV2PluginDescriptor>();
        for (const pluginId of manifest.enabledPluginIds) {
            const entry = manifest.runtime[pluginId];
            if (!entry || entry.descriptorStatus !== 'ready') continue;
            if (!isPortableClientDescriptor(entry.descriptor)) continue;
            wanted.set(pluginId, entry.descriptor);
        }

        // A source that is gone, replaced or running on another workspace is
        // stopped and removed before the new selection is recorded.
        for (const activation of listPortableActivations()) {
            if (activation.workspaceId !== workspaceId) {
                await stop(activation.pluginId);
            }
        }
        for (const source of listPortableClientSources()) {
            const next = wanted.get(source.descriptor.id);
            if (
                next &&
                next.descriptorKey === source.descriptor.descriptorKey &&
                source.workspaceId === workspaceId
            ) {
                continue;
            }
            await stop(source.descriptor.id, Boolean(next && source.workspaceId === workspaceId));
        }

        for (const [pluginId, descriptor] of wanted) {
            if (!isCurrent()) return;
            setPortableClientSource({
                descriptor,
                workspaceId,
                runtimeEntry: manifest.runtime[pluginId],
            });
            if (registeredPages.has(pluginId)) continue;
            registeredPages.add(pluginId);
            const image = packageIconUrl(descriptor);
            const pane = usePaneApps().registerPaneApp({
                id: portablePaneId(pluginId), label: descriptor.name,
                icon: "i-lucide-app-window", pluginId,
                ...(image ? { image } : {}),
                component: { render: () => h("div", {class:"h-full min-h-0 overflow-hidden"}, [h(PORTABLE_CLIENT_VIEW, {pluginId,surface:"pane"})]) },
            });
            const sidebar = registerSidebarPage({
                id: portablePaneId(pluginId), label: descriptor.name,
                icon: "i-lucide-app-window", pluginId,
                ...(image ? { image } : {}),
                component: { render: () => h("div", {class:"px-3 py-5"}, [h(PORTABLE_CLIENT_VIEW, {pluginId,surface:"sidebar"})]) },
                usesDefaultHeader: false,
            });
            let disposeTools = () => {};
            let disposed = false;
            surfaceDisposers.set(pluginId, () => { disposed = true; disposeTools(); sidebar(); pane.dispose(); });
            // Pane and sidebar registration above are synchronous host calls: when
            // they return, the surfaces settled for this descriptor. Tools
            // discovery is asynchronous and optional, so its outcome is reported
            // separately and a failure degrades rather than fails the activation.
            reportPortableContributionReadiness(pluginId, 'pane', 'ready', {
                descriptorKey: descriptor.descriptorKey,
                workspaceId,
            });
            reportPortableContributionReadiness(pluginId, 'sidebar', 'ready', {
                descriptorKey: descriptor.descriptorKey,
                workspaceId,
            });
            if (descriptor.effectiveGrants.includes('tools.register.client')) {
                void registerPortableTools(pluginId)
                    .then((dispose) => {
                        if (disposed) dispose();
                        else {
                            try {
                                const disposeCards =
                                    registerPortableToolCards(pluginId);
                                disposeTools = () => {
                                    disposeCards();
                                    dispose();
                                };
                            } catch (error) {
                                dispose();
                                throw error;
                            }
                        }
                        if (!disposed) {
                        reportPortableContributionReadiness(pluginId, 'tools', 'ready', {
                            descriptorKey: descriptor.descriptorKey,
                            workspaceId,
                        });
                    }
                    })
                    .catch(error => {
                    console.warn("[portable-clients] tool registration failed", pluginId, error);
                    reportPortableContributionReadiness(pluginId, 'tools', 'failed', {
                        descriptorKey: descriptor.descriptorKey,
                        workspaceId,
                        code: toolDiscoveryCode(error),
                    });
                });
            }
            registerDashboardPlugin({
                id: `${DASHBOARD_PLUGIN_PREFIX}${pluginId}`,
                icon: 'i-lucide-puzzle',
                ...(image ? { image } : {}),
                label: descriptor.name,
                ...(descriptor.description === undefined
                    ? {}
                    : { description: descriptor.description }),
                pluginId,
                pages: [createSurfacePage(descriptor)],
            });
        }
    };

    const unregister = getWorkspacePluginCoordinator().register({
        name: 'portable',
        async stop() {
            const ids = new Set([
                ...listPortableClientSources().map((source) => source.descriptor.id),
                ...listPortableActivations().map((activation) => activation.pluginId),
            ]);
            await Promise.all(Array.from(ids, (id) => stop(id)));
        },
        reconcile: syncManifest,
    });
    if (import.meta.hot)
        import.meta.hot.dispose(() => {
            void unregister();
        });
});
