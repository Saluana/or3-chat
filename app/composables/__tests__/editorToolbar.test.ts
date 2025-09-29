import { describe, it, expect, beforeEach } from 'vitest';
import {
    registerEditorToolbarButton,
    unregisterEditorToolbarButton,
    listRegisteredEditorToolbarButtonIds,
} from '../ui-extensions/editor/useEditorToolbar';

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
});
