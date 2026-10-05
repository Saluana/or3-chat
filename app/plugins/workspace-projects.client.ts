import { usePaneApps } from '~/composables/core/usePaneApps';
import { registerSidebarPage } from '~/composables/sidebar/registerSidebarPage';
import { watch } from 'vue';
import { useSessionContext } from '~/composables/auth/useSessionContext';

export default defineNuxtPlugin(() => {
    const cloud = useRuntimeConfig().public.ssrAuthEnabled;
    const { data } = useSessionContext();
    let dispose: (() => void) | undefined;
    const stop = watch(
        () => !cloud || data.value?.workspaceItemCapability === 'v1',
        (enabled) => {
            dispose?.();
            dispose = undefined;
            if (!enabled) return;
            const pane = usePaneApps().registerPaneApp({
                id: 'or3-projects',
                label: 'Projects',
                icon: 'i-lucide-folders',
                order: 30,
                component: () =>
                    import('~/components/projects/ProjectsPane.vue'),
            });
            const sidebar = registerSidebarPage({
                id: 'sidebar-projects-home',
                label: 'Projects',
                icon: 'i-lucide-folders',
                order: 30,
                component: () =>
                    import('~/components/projects/ProjectsPane.vue'),
                usesDefaultHeader: false,
                canActivate: async () => {
                    const { getPaletteHostContext } =
                        await import('~/composables/search/useCommandPalette');
                    const host = getPaletteHostContext();
                    if (!host) return true;
                    const { getOpenWorkspaceTabs } =
                        await import('~/core/search/command-palette/sources/workspace-tab-source');
                    const existing = getOpenWorkspaceTabs().find(
                        (tab) =>
                            tab.resource.kind === 'app' &&
                            tab.resource.appId === 'or3-projects' &&
                            !tab.resource.recordId,
                    );
                    const result =
                        existing && host.openWorkspaceTab
                            ? await host.openWorkspaceTab(existing.id)
                            : await host.openPaneApp(
                                  'or3-projects',
                                  undefined,
                                  'active',
                              );
                    if (!result.ok) throw new Error(result.error.message);
                    return 'handled';
                },
            });
            dispose = () => {
                pane.dispose();
                sidebar();
            };
        },
        { immediate: true },
    );
    if (import.meta.hot)
        import.meta.hot.dispose(() => {
            stop();
            dispose?.();
        });
});
