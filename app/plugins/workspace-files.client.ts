import { openFilesTab } from '~/composables/explorer/useExplorerReveal';
import { usePaneApps } from '~/composables/core/usePaneApps';
import { registerSidebarPage } from '~/composables/sidebar/registerSidebarPage';
import { watch } from 'vue';
import { useLocalWorkspaceSession } from '~/composables/auth/useLocalWorkspaceSession';

export default defineNuxtPlugin(() => {
    const cloud = useRuntimeConfig().public.ssrAuthEnabled;
    const data = useLocalWorkspaceSession();
    let dispose: (() => void) | undefined;
    const stop = watch(() => !cloud || data.value?.workspaceItemCapability === 'v1', enabled => {
        dispose?.(); dispose = undefined;
        if (!enabled) return;
        const pane = usePaneApps().registerPaneApp({ id: 'or3-files', label: 'Files', icon: 'i-lucide-files', order: 35,
            component: () => import('~/components/files/WorkspaceFilesPane.vue') });
        const sidebar = registerSidebarPage({ id: 'sidebar-files', label: 'Files', icon: 'i-lucide-files', order: 35,
            component: () => import('~/components/files/WorkspaceFilesPane.vue'), usesDefaultHeader: false,
            canActivate: async () => {
                const { getPaletteHostContext } = await import('~/composables/search/useCommandPalette');
                const host = getPaletteHostContext();
                if (!host) return true;
                const result = await openFilesTab(host);
                if (!result.ok) throw new Error(result.error.message);
                return 'handled';
            } });
        dispose = () => { pane.dispose(); sidebar(); };
    }, { immediate: true });
    if (import.meta.hot) import.meta.hot.dispose(() => { stop(); dispose?.(); });
});
