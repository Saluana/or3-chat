import type { PluginRuntimeManifestResponse } from '~~/shared/plugins/runtime-manifest';
import { watch } from 'vue';
import { useSessionContext } from '~/composables/auth/useSessionContext';
import { WorkspacePluginCoordinator } from '~~/shared/plugins/workspace-plugin-coordinator';
import { installWorkspacePluginCoordinator } from '~/composables/plugins/workspace-plugin-coordinator';
import { WORKSPACE_PLUGIN_RECONCILE_EVENT } from '~/composables/plugins/workspace-plugin-coordinator';

export default defineNuxtPlugin((nuxtApp) => {
    const config = useRuntimeConfig();
    if (config.public.ssrAuthEnabled !== true || config.public.admin?.pluginRuntimeLoaderEnabled === false) return;
    const session = useSessionContext();
    const coordinator = new WorkspacePluginCoordinator({
        fetchManifest: (signal) => $fetch<PluginRuntimeManifestResponse>('/api/plugins/runtime-manifest', { cache: 'no-store', signal }),
        onError: (error) => console.error('[workspace-plugins] reconciliation failed', error),
    });
    installWorkspacePluginCoordinator(coordinator);
    const context = () => {
        const current = session.data.value?.session;
        return {
            workspaceId: current?.authenticated ? current.workspace?.id ?? null : null,
            sessionKey: current?.authenticated ? current.user?.id ?? null : null,
        };
    };
    const refresh = () => { void coordinator.refresh(context()); };
    const stop = () => { void coordinator.refresh({ workspaceId: null, sessionKey: null }); };
    let stopWatcher = () => {};
    // All execution adapters register during plugin setup, before the boot fetch.
    const removeMountedHook = nuxtApp.hook('app:mounted', () => {
        stopWatcher = watch(() => [context().workspaceId, context().sessionKey], refresh, { immediate: true, flush: 'sync' });
    });
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    window.addEventListener('pagehide', stop);
    window.addEventListener(WORKSPACE_PLUGIN_RECONCILE_EVENT, refresh);
    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            removeMountedHook();
            stopWatcher();
            window.removeEventListener('focus', refresh);
            window.removeEventListener('pageshow', refresh);
            window.removeEventListener('pagehide', stop);
            window.removeEventListener(WORKSPACE_PLUGIN_RECONCILE_EVENT, refresh);
            installWorkspacePluginCoordinator(null);
            void coordinator.dispose().catch((error) => console.error('[workspace-plugins] teardown failed', error));
        });
    }
});
