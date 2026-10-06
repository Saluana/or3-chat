import { registerSidebarPage } from '~/composables/sidebar/registerSidebarPage';
import { useProjectSidebar } from '~/composables/sidebar/useProjectSidebar';
import { subscribeActiveWorkspaceDb } from '~/db/client';
import { watch } from 'vue';
import { useSessionContext } from '~/composables/auth/useSessionContext';

export default defineNuxtPlugin(() => {
    const cloud = useRuntimeConfig().public.ssrAuthEnabled;
    const { data } = useSessionContext();
    const { projectId } = useProjectSidebar();
    const stopWorkspace = subscribeActiveWorkspaceDb(() => {
        projectId.value = '';
    });
    let dispose: (() => void) | undefined;
    const stop = watch(
        () => !cloud || data.value?.workspaceItemCapability === 'v1',
        (enabled) => {
            dispose?.();
            dispose = undefined;
            if (!enabled) {
                projectId.value = '';
                return;
            }
            dispose = registerSidebarPage({
                id: 'sidebar-projects-home',
                label: 'Projects',
                icon: 'i-lucide-folders',
                order: 30,
                component: () =>
                    import('~/components/sidebar/SidebarProjectsPage.vue'),
                usesDefaultHeader: true,
                keepAlive: true,
            });
        },
        { immediate: true },
    );
    if (import.meta.hot)
        import.meta.hot.dispose(() => {
            stop();
            stopWorkspace();
            dispose?.();
        });
});
