import { registerMessageAction } from '~/composables/useMessageActions';
import { useToast } from '#imports';
import { newDocument } from '~/composables/useDocumentsStore';

export default defineNuxtPlugin(() => {
    registerMessageAction({
        id: 'Create document', // unique id
        icon: 'pixelarticons:notes-plus', // any icon name supported by <UButton>
        tooltip: 'Create document',
        showOn: 'assistant', // 'user' | 'assistant' | 'both'
        order: 300, // optional; after built-ins ( <200 reserved )
        async handler({ message }) {
            console.log('Create document action invoked', message);

            const doc = await newDocument({
                title: (message as any).title || 'Untitled',
                content: message.content || '',
            });

            console.log('Created document record', doc);

            // Attempt to open in a new pane (if capacity) else reuse active pane
            const mp: any = (globalThis as any).__or3MultiPaneApi;
            try {
                if (mp) {
                    const couldAdd = mp.canAddPane?.value === true; // snapshot before add
                    if (couldAdd && typeof mp.addPane === 'function') {
                        mp.addPane(); // sets new pane active
                    }
                    const panes = mp.panes?.value;

                    const activeIndex = mp.activePaneIndex?.value ?? 0;

                    if (Array.isArray(panes)) {
                        const pane = panes[activeIndex];
                        if (pane) {
                            pane.mode = 'doc';
                            pane.documentId = doc.id;
                            // Reset chat-related fields when switching
                            pane.threadId =
                                pane.mode === 'doc'
                                    ? pane.threadId
                                    : pane.threadId;
                        }
                    }
                }
            } catch (e) {
                // non-fatal; fallback is just created doc without auto-open
                console.warn('Open document in pane failed', e);
            }

            useToast().add({
                title: 'Document created',
                description: `Opened in ${
                    mp?.canAddPane?.value ? 'new' : 'current'
                } pane: ${doc.id}`,
                duration: 2600,
            });
        },
    });
});
