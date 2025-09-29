export default defineNuxtPlugin(() => {
    // Only register devtools in development mode
    if (!process.dev) {
        return;
    }

    registerDashboardPlugin({
        id: 'devtools',
        icon: 'pixelarticons:debug',
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
                    // @ts-expect-error - Dynamic import type inference
                    await import('./devtools/HookInspector.vue'),
            },
        ],
    });
});
