import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    registerEditorToolbarButton,
    unregisterEditorToolbarButton,
    listRegisteredEditorToolbarButtonIds,
    useEditorToolbarButtons,
} from '../editor/useEditorToolbar';
import { ref, shallowRef } from 'vue';
import type { Editor } from '@tiptap/vue-3';

describe('useEditorToolbar', () => {
    beforeEach(() => {
        // Clear registry before each test
        const ids = listRegisteredEditorToolbarButtonIds();
        ids.forEach((id) => unregisterEditorToolbarButton(id));
    });

    it('registers a toolbar button', () => {
        const onClick = vi.fn();
        const isActive = vi.fn(() => true);
        registerEditorToolbarButton({
            id: 'test:bold',
            icon: 'i-carbon-text-bold',
            tooltip: 'Bold',
            onClick,
            isActive,
        });

        const ids = listRegisteredEditorToolbarButtonIds();
        expect(ids).toContain('test:bold');

        const editor = {} as Editor;
        const buttons = useEditorToolbarButtons(shallowRef(editor));
        const button = buttons.value.find((item) => item.id === 'test:bold');
        expect(button).toBeDefined();
        button!.onClick(editor);
        expect(onClick).toHaveBeenCalledExactlyOnceWith(editor);
        expect(button!.isActive?.(editor)).toBe(true);
        expect(isActive).toHaveBeenCalledExactlyOnceWith(editor);
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
