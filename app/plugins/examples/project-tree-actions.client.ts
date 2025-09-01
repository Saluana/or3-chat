import type { ProjectTreeHandlerCtx } from '@/composables/ui-extensions/projects/useProjectTreeActions';

export default defineNuxtPlugin(() => {
    // Test plugin to register thread history actions for development/debugging.
    // Registers two actions and logs output to console + toasts. Cleans up on app unmount.
    try {
        console.info('[thread-history-test] registering actions');

        // Inspect thread action — shows a console group and a toast
        registerProjectTreeAction({
            id: 'test:inspect-thread',
            icon: 'i-lucide-eye',
            label: 'Inspect Thread',
            order: 300,
            showOn: ['root', 'chat'],
            async handler(ctx: ProjectTreeHandlerCtx) {
                // Keep the same runtime behavior; log the typed context for authors.
                console.log(ctx);
            },
        });
    } catch (e) {
        console.error('[thread-history-test] registration error', e);
    }
});
