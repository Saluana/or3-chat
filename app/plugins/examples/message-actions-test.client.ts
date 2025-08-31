export default defineNuxtPlugin(() => {
    try {
        console.info('[message-actions-test] registering action');

        registerMessageAction({
            id: 'test:create-doc',
            icon: 'pixelarticons:frame-delete',
            tooltip: 'Create test document',
            showOn: 'both',
            order: 300,
            async handler({ message }) {
                console.group('[message-actions-test] handler invoked');
                try {
                    console.log('message id:', message?.id);
                    console.log('message role:', message?.role);
                    console.log(
                        'message content (preview):',
                        typeof message?.content === 'string'
                            ? message.content.slice(0, 300)
                            : message?.content
                    );
                    console.log('full message object:', message);
                } catch (e) {
                    console.error('[message-actions-test] logging error', e);
                }
                console.groupEnd();

                try {
                    useToast().add({
                        title: 'Test Create Document',
                        description: `message id: ${
                            message?.id ?? 'unknown'
                        } — role: ${message?.role ?? 'unknown'}`,
                        duration: 3500,
                    });
                } catch (e) {
                    console.warn(
                        '[message-actions-test] useToast unavailable',
                        e
                    );
                }
            },
        });

        try {
            const ids = listRegisteredMessageActionIds?.() ?? [];
            console.info('[message-actions-test] registered action ids:', ids);
        } catch (e) {
            // ignore
        }
    } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[message-actions-test] plugin failed to initialize', e);
    }
});
