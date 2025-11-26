export default defineNuxtPlugin(() => {
    // Test plugin to register thread history actions for development/debugging.
    // Registers two actions and logs output to console + toasts. Cleans up on app unmount.
    try {
        console.info('[thread-history-test] registering actions');

        // Inspect thread action — shows a console group and a toast
        registerThreadHistoryAction({
            id: 'test:inspect-thread',
            icon: 'i-lucide-eye',
            label: 'Inspect Thread',
            order: 300,
            async handler(ctx: any) {
                const t = ctx?.thread ?? ctx?.document ?? ctx;
                console.group('[thread-history-test] Inspect Thread');
                try {
                    if (import.meta.dev) {
                        console.debug('id:', t?.id);
                        console.debug('title:', t?.title);
                        console.debug(
                            'snippet (messages or content):',
                            Array.isArray(t?.messages)
                                ? t.messages.slice(0, 5)
                                : t?.content
                        );
                        console.debug('full thread object:', t);
                    }
                } catch (e) {
                    console.error('[thread-history-test] logging error', e);
                }
                console.groupEnd();

                try {
                    useToast().add({
                        title: 'Inspect Thread',
                        description: `id: ${t?.id ?? 'unknown'} — title: ${
                            t?.title ?? 'Untitled'
                        }`,
                        duration: 4000,
                    });
                } catch (e) {
                    console.warn(
                        '[thread-history-test] useToast unavailable',
                        e
                    );
                }
            },
        });

        // Dump thread to console action — lightweight, useful for automation tests
        registerThreadHistoryAction({
            id: 'test:dump-thread',
            icon: 'i-lucide-copy',
            label: 'Dump thread',
            order: 310,
            handler(ctx: any) {
                const t = ctx?.thread ?? ctx?.document ?? ctx;
                try {
                    console.info('[thread-history-test] dump-thread', t);
                    useToast()?.add?.({
                        title: 'Dumped Thread',
                        description: `Thread ${
                            t?.id ?? 'unknown'
                        } logged to console.`,
                        duration: 2500,
                    });
                } catch (e) {
                    // Best-effort: fall back to console only
                    console.info(
                        '[thread-history-test] toast unavailable, logged to console'
                    );
                }
            },
        });

        // Debug: list current registered action ids (if helper available)
        try {
            const ids = listRegisteredThreadHistoryActionIds?.() ?? [];
            console.info(
                '[thread-history-test] registered thread action ids:',
                ids
            );
        } catch (e) {
            // ignore
        }

        // Clean up on app unmount (use Nuxt hook) so HMR doesn't duplicate actions.
        try {
            const nuxtApp = useNuxtApp();
            // Cast hook key to any to avoid strict HookKeys typing; this is a dev helper plugin.
            (nuxtApp.hook as any)('app:beforeUnmount', () => {
                try {
                    unregisterThreadHistoryAction?.('test:inspect-thread');
                    unregisterThreadHistoryAction?.('test:dump-thread');
                    console.info(
                        '[thread-history-test] unregistered actions on app:beforeUnmount'
                    );
                } catch (e) {
                    console.warn('[thread-history-test] cleanup failed', e);
                }
            });
        } catch (e) {
            // if hooks unavailable, it's non-fatal — actions will persist for dev session
        }
    } catch (e) {
         
        console.error('[thread-history-test] plugin failed to initialize', e);
    }
});
