import { useRuntimeConfig } from '#imports';
import { bundledPluginCatalog } from '#build/or3/bundled-plugin-catalog';
import { discoverNonCorePlugins } from '~~/shared/plugins/safe-mode';
import { BundledV1Loader } from '~~/shared/plugins/bundled-v1-loader';
import {
    createBundledV1WorkspaceManager,
    desiredStateFromManifest,
} from '~/composables/plugins/bundled-v1-manager-runtime';
import { getWorkspacePluginCoordinator } from '~/composables/plugins/workspace-plugin-coordinator';

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
        // loader boundary is exercised, but they are outside the installed
        // extension inventory and therefore can never be enabled at runtime.
        ...import.meta.glob(
            '../../tests/plugin-runtime/build-fixtures/extensions/plugins/*/**/*.client.ts'
        ),
    })) as Record<string, () => Promise<unknown>> | undefined;
    if (!modules) return;

    const manager = createBundledV1WorkspaceManager({
        loader: new BundledV1Loader(bundledPluginCatalog, modules),
    });
    const unregister = getWorkspacePluginCoordinator().register({
        name: 'bundled',
        stop: () => manager.stopAll('workspace-session-change'),
        async reconcile(manifest, isCurrent) {
            if (!isCurrent()) return;
            await manager.reconcile(
                desiredStateFromManifest(manifest, manifest.workspaceId!),
                'accepted-manifest'
            );
        },
    });
    if (import.meta.hot) import.meta.hot.dispose(() => { void unregister(); });
});
