import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    registerEditorToolbarButton,
    unregisterEditorToolbarButton,
    listRegisteredEditorToolbarButtonIds,
    useEditorToolbarButtons,
} from '../ui-extensions/editor/useEditorToolbar';
import { ref } from 'vue';

describe('useEditorToolbar', () => {
    beforeEach(() => {
        // Clear registry before each test
        const ids = listRegisteredEditorToolbarButtonIds();
        ids.forEach((id) => unregisterEditorToolbarButton(id));
    });

    it('registers a toolbar button', () => {
        registerEditorToolbarButton({
            id: 'test:bold',
            icon: 'i-carbon-text-bold',
            tooltip: 'Bold',
            onClick: (editor) => {
                editor.chain().focus().toggleBold().run();
            },
        });

        const ids = listRegisteredEditorToolbarButtonIds();
        expect(ids).toContain('test:bold');
    });

    it('unregisters a toolbar button', () => {
        registerEditorToolbarButton({
            id: 'test:italic',
            icon: 'i-carbon-text-italic',
            tooltip: 'Italic',
            onClick: (editor) => {
                editor.chain().focus().toggleItalic().run();
            },
        });

        expect(listRegisteredEditorToolbarButtonIds()).toContain('test:italic');

        unregisterEditorToolbarButton('test:italic');

        expect(listRegisteredEditorToolbarButtonIds()).not.toContain(
            'test:italic'
        );
    });

    it('replaces button with duplicate id', () => {
        registerEditorToolbarButton({
            id: 'test:action',
            icon: 'i-carbon-add',
            tooltip: 'First',
            onClick: () => {},
        });

        registerEditorToolbarButton({
            id: 'test:action',
            icon: 'i-carbon-subtract',
            tooltip: 'Second',
            onClick: () => {},
        });

        const ids = listRegisteredEditorToolbarButtonIds();
        expect(ids.filter((id) => id === 'test:action')).toHaveLength(1);
    });

    it('sorts buttons by order, tie-breaking by id', () => {
        registerEditorToolbarButton({
            id: 'test:c',
            icon: 'i-carbon-add',
            tooltip: 'C',
            order: 200,
            onClick: () => {},
        });

        registerEditorToolbarButton({
            id: 'test:a',
            icon: 'i-carbon-add',
            tooltip: 'A',
            order: 100,
            onClick: () => {},
        });

        registerEditorToolbarButton({
            id: 'test:b',
            icon: 'i-carbon-add',
            tooltip: 'B',
            order: 200,
            onClick: () => {},
        });

        const mockEditor = { isActive: () => false } as any;
        const editorRef = ref(mockEditor);
        const buttons = useEditorToolbarButtons(editorRef);

        // Order: test:a (100), test:b (200), test:c (200)
        // Among 200s, tie-break alphabetically: test:b < test:c
        expect(buttons.value.map((b) => b.id)).toEqual([
            'test:a',
            'test:b',
            'test:c',
        ]);
    });

    it('handles visible() exceptions gracefully', () => {
        const consoleErrorSpy = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        registerEditorToolbarButton({
            id: 'test:throws-visible',
            icon: 'i-carbon-add',
            tooltip: 'Throws',
            onClick: () => {},
            visible: () => {
                throw new Error('Visibility check failed');
            },
        });

        registerEditorToolbarButton({
            id: 'test:valid',
            icon: 'i-carbon-add',
            tooltip: 'Valid',
            onClick: () => {},
        });

        const mockEditor = { isActive: () => false } as any;
        const editorRef = ref(mockEditor);
        const buttons = useEditorToolbarButtons(editorRef);

        // Button that throws should be filtered out
        expect(buttons.value.map((b) => b.id)).toEqual(['test:valid']);

        // Error should be logged in dev
        if (import.meta.dev) {
            expect(consoleErrorSpy).toHaveBeenCalled();
        }

        consoleErrorSpy.mockRestore();
    });
});
