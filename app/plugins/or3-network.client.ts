import { registerDashboardPlugin } from '~/composables/dashboard/useDashboardPlugins';
import { usePaneApps } from '~/composables/core/usePaneApps';

export default defineNuxtPlugin(() => {
    const runtimeConfig = useRuntimeConfig() as {
        public: {
            ssrAuthEnabled?: boolean;
            or3Net?: { enabled?: boolean };
        };
    };

    if (
        runtimeConfig.public.ssrAuthEnabled !== true ||
        runtimeConfig.public.or3Net?.enabled !== true
    ) {
        return;
    }

    const { registerPaneApp } = usePaneApps();

    registerPaneApp({
        id: 'or3-net-preview',
        label: 'OR3 Net Preview',
        icon: 'pixelarticons:window',
        component: async () =>
            await import('~/components/dashboard/or3-net/Or3NetPreviewPane.vue'),
        order: 180,
    });

    registerDashboardPlugin({
        id: 'core:or3-network',
        icon: 'pixelarticons:cloud-done',
        label: 'OR3 Network',
        description: 'Connect the active workspace to the OR3 Net control plane.',
        order: 70,
        access: { authRequired: true },
        pages: [
            {
                id: 'overview',
                title: 'OR3 Network',
                description: 'Connect and inspect the active workspace network session.',
                icon: 'pixelarticons:cloud-done',
                component: async () =>
                    await import('~/components/dashboard/or3-net/Or3NetworkPage.vue'),
            },
        ],
    });
});
