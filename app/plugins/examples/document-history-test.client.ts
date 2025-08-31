export default defineNuxtPlugin(() => {
    // Simple test plugin that registers a document history action.
    // Mirrors the pattern used by app/plugins/message-actions.client.ts
    try {
        console.info('[doc-history-test] registering action');

        registerDocumentHistoryAction({
            id: 'test:inspect-doc',
            icon: 'i-lucide-eye',
            label: 'Inspect Document',
            order: 300,
            async handler({ document }) {
                // Detailed console output for inspection
                console.group('[doc-history-test] Inspect Document');
                try {
                    console.log('document.id:', document?.id);
                    console.log('document.title:', document?.title);
                    console.log('document.content (snippet):',
                        typeof document?.content === 'string'
                            ? document.content.slice(0, 200)
                            : document?.content
                    );
                    console.log('full document object:', document);
                } catch (e) {
                    console.error('[doc-history-test] logging error', e);
                }
                console.groupEnd();

                // Show a friendly toast for quick UI verification
                try {
                    useToast().add({
                        title: 'Inspect Document',
                        description: `id: ${document?.id ?? 'unknown'} — title: ${document?.title ?? 'Untitled'}`,
                        duration: 4000,
                    });
                } catch (e) {
                    // If useToast isn't available, still continue — we logged details above
                    // eslint-disable-next-line no-console
                    console.warn('[doc-history-test] useToast unavailable', e);
                }
            },
        });

        // Log current registered ids for debugging
        try {
            const ids = listRegisteredDocumentHistoryActionIds?.() ?? [];
            console.info('[doc-history-test] registered action ids:', ids);
        } catch (e) {
            // ignore
        }
    } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[doc-history-test] plugin failed to initialize', e);
    }
});
