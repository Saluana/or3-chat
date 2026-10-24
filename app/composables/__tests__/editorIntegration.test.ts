/** TipTap plugin command integration in jsdom. */
import { describe, it, expect, beforeEach } from 'vitest';
import { Editor } from '@tiptap/vue-3';
import { Node, Mark } from '@tiptap/core';
import {
    registerEditorNode,
    unregisterEditorNode,
    registerEditorMark,
    unregisterEditorMark,
    listRegisteredEditorNodeIds,
    listRegisteredEditorMarkIds,
} from '../editor/useEditorNodes';
import StarterKit from '@tiptap/starter-kit';

describe('Editor Integration Tests', () => {
    beforeEach(() => {
        // Clear all registries
        listRegisteredEditorNodeIds().forEach((id) => unregisterEditorNode(id));
        listRegisteredEditorMarkIds().forEach((id) => unregisterEditorMark(id));
    });

    it('7.4: Editor creates with plugin nodes and marks, commands operate', async () => {
        // Register a custom node
        // Note: Using type assertion for test-only extensions - real extensions would augment RawCommands interface
        const CalloutNode = Node.create({
            name: 'callout',
            group: 'block',
            content: 'inline*',
            parseHTML() {
                return [{ tag: 'div[data-type="callout"]' }];
            },
            renderHTML() {
                return ['div', { 'data-type': 'callout' }, 0];
            },
            addCommands() {
                return {
                    setCallout:
                        () =>
                        ({ commands }: any) => {
                            return commands.setNode(this.name);
                        },
                };
            },
        } as any);

        // Register a custom mark
        const HighlightMark = Mark.create({
            name: 'highlight',
            parseHTML() {
                return [{ tag: 'mark' }];
            },
            renderHTML() {
                return ['mark', 0];
            },
            addCommands() {
                return {
                    toggleHighlight:
                        () =>
                        ({ commands }: any) => {
                            return commands.toggleMark(this.name);
                        },
                };
            },
        } as any);

        registerEditorNode({
            id: 'test:callout',
            extension: CalloutNode,
            order: 300,
        });

        registerEditorMark({
            id: 'test:highlight',
            extension: HighlightMark,
            order: 300,
        });

        // Import dynamically to get fresh registered extensions
        const { listEditorNodes, listEditorMarks } = await import(
            '../editor/useEditorNodes'
        );

        const pluginNodes = listEditorNodes().map((n) => n.extension);
        const pluginMarks = listEditorMarks().map((m) => m.extension);

        // Create editor with plugin extensions
        const editor = new Editor({
            extensions: [StarterKit, ...pluginNodes, ...pluginMarks],
            content: '<p>Hello world</p>',
        });

        // Verify extensions are loaded
        expect(
            editor.extensionManager.extensions.some(
                (ext) => ext.name === 'callout'
            )
        ).toBe(true);
        expect(
            editor.extensionManager.extensions.some(
                (ext) => ext.name === 'highlight'
            )
        ).toBe(true);

        // Verify commands are available
        expect((editor.commands as any).setCallout).toBeDefined();
        expect((editor.commands as any).toggleHighlight).toBeDefined();

        // Test commands operate correctly
        (editor.commands as any).setCallout();
        expect(editor.isActive('callout')).toBe(true);

        editor.commands.setContent('<p>Test</p>');
        editor.commands.selectAll();
        (editor.commands as any).toggleHighlight();
        expect(editor.isActive('highlight')).toBe(true);

        editor.destroy();
    });
});
