export default defineNuxtPlugin(() => {
    try {
        registerDashboardPlugin({
            id: 'example:hello',
            icon: 'pixelarticons:star',
            label: 'Hello',
            description: 'Example dashboard plugin',
            order: 250,
            handler() {
                useToast().add({
                    title: 'Hello plugin',
                    description: 'Example plugin clicked',
                    duration: 2500,
                });
            },
        });
    } catch (e) {
        console.error('[dashboard-plugins-example] failed', e);
    }
});
