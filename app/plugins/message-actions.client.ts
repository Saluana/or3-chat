import { getGlobalMultiPaneApi } from '~/utils/multiPaneApi';
import { useToast } from '#imports';
import { createDocument, type CreateDocumentInput } from '~/db/documents';
import { registerMessageAction } from '~/composables/chat/useMessageActions';
import { isMobile } from '~/state/global';
import { markdownToTipTapDoc } from '~/utils/chat/markdownToTipTapDoc';
import type { JSONContent } from '@tiptap/core';

const MAX_TITLE_CHARS = 80;

/** First heading, else first prose paragraph, as a one-line title. */
function titleFromDoc(doc: JSONContent): string {
    const textOf = (node: JSONContent): string =>
        node.text ?? (node.content ?? []).map(textOf).join('');
    const isProse = (text: string) => text.trim() && !/^\$\$[\s\S]*\$\$$/.test(text.trim());
    const blocks = doc.content ?? [];
    const source =
        blocks.find((block) => block.type === 'heading' && textOf(block).trim()) ??
        blocks.find((block) => block.type === 'paragraph' && isProse(textOf(block)));
    const line = source ? textOf(source).replace(/\s+/g, ' ').trim() : '';
    if (!line) return 'Untitled';
    return line.length > MAX_TITLE_CHARS
        ? `${line.slice(0, MAX_TITLE_CHARS - 1)}…`
        : line;
}

export default defineNuxtPlugin(() => {
    registerMessageAction({
        id: 'Create document', // unique id
        icon: 'pixelarticons:notes-plus', // any icon name supported by <UButton>
        tooltip: 'Create document',
        showOn: 'assistant', // 'user' | 'assistant' | 'both'
        order: 300, // optional; after built-ins ( <200 reserved )
        async handler({ message }) {
            if (import.meta.dev)
                console.debug('Create document action invoked', message);

            // UiChatMessage usually has 'text' property for text content
            const markdownSource = message.text || '';

            let tiptapDoc: ReturnType<typeof markdownToTipTapDoc>;
            try {
                tiptapDoc = markdownToTipTapDoc(markdownSource);
            } catch (conversionError) {
                console.error(
                    'Failed to convert message Markdown:',
                    conversionError
                );
                useToast().add({
                    title: 'Error converting markdown',
                    description:
                        'The document was not created. Please try again.',
                    color: 'error',
                });
                return;
            }

            let doc: Awaited<ReturnType<typeof createDocument>>;
            try {
                doc = await createDocument({
                    title: titleFromDoc(tiptapDoc),
                    content: tiptapDoc as CreateDocumentInput['content'],
                });
            } catch (createErr) {
                console.error('Failed to create document:', createErr);
                useToast().add({
                    title: 'Error creating document',
                    color: 'error',
                });
                return;
            }

            if (import.meta.dev) console.debug('Created document record', doc);

            // Attempt to open in a new pane (if capacity) else reuse active pane
            const mp = getGlobalMultiPaneApi();
            let openedInNewPane = false;
            try {
                if (mp) {
                    const panesBeforeAdd = mp.panes?.value?.length ?? 0;
                    const couldAdd =
                        !isMobile.value && mp.canAddPane?.value === true;
                    if (couldAdd && typeof mp.addPane === 'function') {
                        mp.addPane(); // sets new pane active
                        openedInNewPane =
                            (mp.panes?.value?.length ?? 0) > panesBeforeAdd;
                    }
                    const panes = mp.panes?.value;

                    const activeIndex = mp.activePaneIndex?.value ?? 0;

                    if (Array.isArray(panes)) {
                        const pane = panes[activeIndex];
                        if (pane) {
                            pane.mode = 'doc';
                            pane.documentId = doc.id;
                            // Reset chat-related fields when switching
                            pane.threadId = '';
                            pane.messages = [];
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
                    openedInNewPane ? 'a new' : 'the current'
                } pane.`,
                duration: 2600,
            });
        },
    });
});
