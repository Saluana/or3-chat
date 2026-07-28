import { defineNuxtPlugin } from '#app';
import { usePaneApps } from '~/composables/core/usePaneApps';
import { registerDashboardPlugin } from '~/composables/dashboard/useDashboardPlugins';
import {
    ACTIVITY_DASHBOARD_APP_ID,
    ACTIVITY_DETAIL_PANE_APP_ID,
} from '~/core/activity/run-ref';

export default defineNuxtPlugin(() => {
    const dashboardHandle = registerDashboardPlugin({
        id: ACTIVITY_DASHBOARD_APP_ID,
        label: 'Activity',
        icon: 'lucide:activity',
        description:
            'Review running work, approvals, failures, results, and artifacts.',
        order: 80,
        pages: [
            {
                id: 'overview',
                title: 'Activity Center',
                icon: 'lucide:activity',
                description:
                    'Inspect ongoing and recent work across connected sources.',
                component: () =>
                    import('~/components/activity/ActivityDashboardPage.vue'),
            },
        ],
    });
    const paneHandle = usePaneApps().registerPaneApp({
        id: ACTIVITY_DETAIL_PANE_APP_ID,
        label: 'Activity detail',
        icon: 'lucide:activity',
        order: 80,
        component: () =>
            import('~/components/activity/ActivityDetailPane.vue'),
    });

    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            dashboardHandle.dispose();
            paneHandle.dispose();
        });
    }
});
