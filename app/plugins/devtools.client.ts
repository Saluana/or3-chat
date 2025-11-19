export default defineNuxtPlugin(() => {
    // Only register devtools in development mode
    if (import.meta.env.PROD) {
        return;
    }

    registerDashboardPlugin({
        id: 'devtools',
        icon: 'tabler:bug',
        label: 'Dev Tools',
        description: 'Developer tools for debugging hooks and extension points',
        order: 300, // Show near the end
        pages: [
            {
                id: 'hook-inspector',
                title: 'Hook Inspector',
                icon: 'pixelarticons:sync',
                description: 'View hook timings, counts, and errors',
                component: async () =>
                    await import('./devtools/HookInspector.vue'),
            },
        ],
    });
});
