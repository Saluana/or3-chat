/**
 * @module app/plugins/portable-clients.client
 *
 * Purpose:
 * Start selected isolated-client packages in the contained sandbox, and stop
 * them when the workspace, the selection or the plugin's enablement changes.
 *
 * Behavior:
 * - The runtime manifest is the only source of truth: only a `ready` descriptor
 *   for an `isolated-client` package with a digest-addressed client entry is
 *   started. Everything else is left to the V1 manager or reported by the UI.
 * - An activation is torn down when its descriptor key changes, the plugin stops
 *   being enabled, or the workspace changes, so no sandbox outlives its authority.
 * - A dashboard page is registered per activation and removed on teardown; the
 *   page renders what the plugin renders.
 *
 * Constraints:
 * - Client only, and only when SSR auth and the plugin runtime loader are on.
 * - No package bytes are fetched before the descriptor is verified.
 */

import { defineAsyncComponent, h, watch } from 'vue';
import { useRuntimeConfig } from '#imports';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import type { PluginRuntimeManifestResponse } from '~~/shared/plugins/runtime-manifest';
import type { PackageV2PluginDescriptor } from '~~/shared/plugins/runtime-descriptor';
import {
    activatePortableClient,
    deactivatePortableClient,
    installPortableUnloadTeardown,
    type PortableActivation,
} from '~/composables/plugins/portable-client-runtime';
import {
    registerDashboardPlugin,
    unregisterDashboardPlugin,
    type DashboardPluginPage,
} from '~/composables/dashboard/useDashboardPlugins';
import { WORKSPACE_PLUGIN_RECONCILE_EVENT } from '~/composables/plugins/bundled-v1-manager-runtime';

const DASHBOARD_PLUGIN_PREFIX = 'portable:';

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
        Boolean(descriptor.artifact.client)
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
const PORTABLE_VIEW_MODULES = import.meta.glob('../../components/plugins/PortableClientView.vue');

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

function createSurfacePage(
    descriptor: PackageV2PluginDescriptor
): DashboardPluginPage {
    return {
        id: 'surface',
        title: descriptor.name,
        ...(descriptor.description === undefined ? {} : { description: descriptor.description }),
        component: {
            name: `PortableClientSurface:${descriptor.id}`,
            render: () => h(PORTABLE_CLIENT_VIEW, { pluginId: descriptor.id }),
        },
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

    installPortableUnloadTeardown();

    const session = useSessionContext();
    const active = new Map<string, PortableActivation>();
    let currentRevision = '';
    let syncToken = 0;

    const stop = async (pluginId: string): Promise<void> => {
        active.delete(pluginId);
        unregisterDashboardPlugin(`${DASHBOARD_PLUGIN_PREFIX}${pluginId}`);
        await deactivatePortableClient(pluginId);
    };

    const syncManifest = async (): Promise<void> => {
        const token = ++syncToken;
        const workspaceId = session.data.value?.session?.workspace?.id;
        if (!workspaceId) {
            for (const pluginId of [...active.keys()]) await stop(pluginId);
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
                console.warn('[portable-clients] failed to fetch runtime manifest', error);
            }
            return;
        }
        if (token !== syncToken) return;
        if (manifest.revision === currentRevision) return;

        // Ready isolated-client descriptors, keyed by plugin id.
        const wanted = new Map<string, PackageV2PluginDescriptor>();
        for (const pluginId of manifest.enabledPluginIds) {
            const entry = manifest.runtime[pluginId];
            if (!entry || entry.descriptorStatus !== 'ready') continue;
            if (!isPortableClientDescriptor(entry.descriptor)) continue;
            wanted.set(pluginId, entry.descriptor);
        }

        for (const [pluginId, activation] of [...active.entries()]) {
            const next = wanted.get(pluginId);
            if (next && activation.descriptorKey === next.descriptorKey) continue;
            await stop(pluginId);
        }

        let hadFailure = false;
        for (const [pluginId, descriptor] of wanted) {
            if (token !== syncToken) return;
            if (active.has(pluginId)) continue;
            try {
                const activation = await activatePortableClient({
                    descriptor,
                    workspaceId,
                    runtimeEntry: manifest.runtime[pluginId],
                });
                if (token !== syncToken) {
                    await stop(pluginId);
                    return;
                }
                active.set(pluginId, activation);
                registerDashboardPlugin({
                    id: `${DASHBOARD_PLUGIN_PREFIX}${pluginId}`,
                    icon: 'i-lucide-puzzle',
                    label: descriptor.name,
                    ...(descriptor.description === undefined
                        ? {}
                        : { description: descriptor.description }),
                    pluginId,
                    pages: [createSurfacePage(descriptor)],
                });
            } catch (error) {
                hadFailure = true;
                if (import.meta.dev) {
                    console.error(
                        `[portable-clients] failed to start plugin "${pluginId}"`,
                        error
                    );
                }
            }
        }

        if (token !== syncToken) return;
        // Only commit the revision after a fully successful sync so a transient
        // failure is retried instead of being treated as an empty selection.
        if (!hadFailure) currentRevision = manifest.revision;
    };

    watch(
        () => session.data.value?.session?.workspace?.id,
        () => {
            ++syncToken;
            currentRevision = '';
            for (const pluginId of [...active.keys()]) void stop(pluginId);
            void syncManifest();
        },
        { immediate: true }
    );

    // Reconcile requests are the same signal the V1 manager listens to: a
    // settings/selection change should re-evaluate which packages run.
    window.addEventListener(WORKSPACE_PLUGIN_RECONCILE_EVENT, () => {
        currentRevision = '';
        void syncManifest();
    });
});
