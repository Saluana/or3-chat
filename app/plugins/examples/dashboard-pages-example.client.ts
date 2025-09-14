export default defineNuxtPlugin(() => {
    registerDashboardPlugin({
        id: 'example:pages-demo',
        icon: 'pixelarticons:layers',
        label: 'Pages Demo',
        description: 'Shows multi-page plugin support',
        order: 120,
        pages: [
            {
                id: 'overview',
                title: 'Overview',
                icon: 'pixelarticons:dashboard',
                description: 'High level metrics and quick links',
                component: async () =>
                    await import('./examples/dashboard/PagesDemoOverview.vue'),
            },
            {
                id: 'details',
                title: 'Details',
                icon: 'pixelarticons:list-check',
                description: 'Detailed breakdown and debug info',
                component: async () =>
                    await import('./examples/dashboard/PagesDemoDetails.vue'),
            },
        ],
    });
});
