import {
    registerEditorToolbarButton,
    listRegisteredEditorToolbarButtonIds,
} from '~/composables';
import type { Editor } from '@tiptap/vue-3';

export default defineNuxtPlugin(() => {
    // Test plugin to register editor toolbar button for development/debugging.
    try {
        console.info('[editor-toolbar-test] registering toolbar button');

        registerEditorToolbarButton({
            id: 'test:strikethrough',
            icon: 'pixelarticons:text-strikethrough',
            tooltip: 'Strikethrough (test)',
            order: 300,
            isActive: (editor: Editor) => editor.isActive('strike'),
            onClick: (editor: Editor) => {
                editor.chain().focus().toggleStrike().run();
                console.log('[editor-toolbar-test] strikethrough toggled');
            },
        });

        // Debug: list current registered button ids
        try {
            const ids = listRegisteredEditorToolbarButtonIds?.() ?? [];
            console.info('[editor-toolbar-test] registered button ids:', ids);
        } catch (e) {
            // ignore
        }
    } catch (e) {
        console.error('[editor-toolbar-test] plugin failed to initialize', e);
    }
});
