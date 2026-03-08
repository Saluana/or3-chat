export default defineNuxtPlugin(() => {
    const runtimeConfig = useRuntimeConfig();
    if (!runtimeConfig.public.webhooks?.enabled) {
        return;
    }

    registerDashboardPlugin({
        id: 'core:webhooks',
        icon: 'i-lucide-webhook',
        label: 'Webhooks',
        description: 'Manage outbound webhook subscriptions',
        order: 50,
        access: { authRequired: true },
        pages: [
            {
                id: 'webhooks-manage',
                title: 'Manage Webhooks',
                icon: 'i-lucide-webhook',
                description: 'Create, test, and inspect webhook deliveries',
                component: async () =>
                    await import('~/components/dashboard/webhooks/WebhooksPage.vue'),
            },
        ],
    });
});
