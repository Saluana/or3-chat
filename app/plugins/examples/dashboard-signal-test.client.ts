export default defineNuxtPlugin(() => {
    try {
        registerDashboardPlugin({
            id: 'example:signal-strength',
            icon: 'pixelarticons:cellular-signal-3',
            label: 'Signal',
            description: 'Demo plugin showing signal strength widget.',
            order: 0.5,
            handler() {
                useToast().add({
                    title: 'Signal Plugin',
                    description: 'Signal plugin activated.',
                    duration: 2500,
                });
            },
        });
    } catch (e) {
        console.error('[dashboard-signal-test] register failed', e);
    }
});
