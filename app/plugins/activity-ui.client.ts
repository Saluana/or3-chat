import { defineNuxtPlugin } from '#app';
import { usePaneApps } from '~/composables/core/usePaneApps';
import { useSidebarPages } from '~/composables/sidebar/useSidebarPages';
import {
    ACTIVITY_DETAIL_PANE_APP_ID,
    ACTIVITY_SIDEBAR_PAGE_ID,
} from '~/core/activity/run-ref';

export default defineNuxtPlugin(() => {
    const paneHandle = usePaneApps().registerPaneApp({
        id: ACTIVITY_DETAIL_PANE_APP_ID,
        label: 'Activity detail',
        icon: 'lucide:activity',
        order: 80,
        component: () =>
            import('~/components/activity/ActivityDetailPane.vue'),
    });
    const unregisterSidebar = useSidebarPages().registerSidebarPage({
        id: ACTIVITY_SIDEBAR_PAGE_ID,
        label: 'Activity',
        icon: 'lucide:activity',
        order: 80,
        keepAlive: true,
        usesDefaultHeader: false,
        component: () =>
            import('~/components/activity/ActivitySidebarPage.vue'),
    });

    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            paneHandle.dispose();
            unregisterSidebar();
        });
    }
});

