/**
 * Integration tests for editor extensibility
 *
 * NOTE: These tests require a DOM environment (TipTap dependency) and will not run in
 * standard unit test mode. They are designed for E2E test runners or browser environments.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
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
import {
    registerEditorToolbarButton,
    unregisterEditorToolbarButton,
    listRegisteredEditorToolbarButtonIds,
} from '../editor/useEditorToolbar';
import StarterKit from '@tiptap/starter-kit';

describe('Editor Integration Tests', () => {
    beforeEach(() => {
        // Clear all registries
        listRegisteredEditorNodeIds().forEach((id) => unregisterEditorNode(id));
        listRegisteredEditorMarkIds().forEach((id) => unregisterEditorMark(id));
        listRegisteredEditorToolbarButtonIds().forEach((id) =>
            unregisterEditorToolbarButton(id)
        );
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

    it('7.5: Toolbar renders and triggers onClick', async () => {
        let clickCount = 0;
        let lastEditor: Editor | null = null;

        registerEditorToolbarButton({
            id: 'test:click-counter',
            icon: 'i-carbon-add',
            tooltip: 'Click Counter',
            order: 300,
            isActive: (editor) => clickCount > 0,
            onClick: (editor) => {
                clickCount++;
                lastEditor = editor;
            },
        });

        const { useEditorToolbarButtons } = await import(
            '../editor/useEditorToolbar'
        );

        const editor = new Editor({
            extensions: [StarterKit],
            content: '<p>Test</p>',
        });

        const editorRef = { value: editor };
        const buttons = useEditorToolbarButtons(editorRef as any);

        // Verify button is in the list
        expect(buttons.value.length).toBeGreaterThan(0);
        const testButton = buttons.value.find(
            (b) => b.id === 'test:click-counter'
        );
        expect(testButton).toBeDefined();

        // Verify initial state
        expect(clickCount).toBe(0);
        expect(testButton?.isActive?.(editor)).toBe(false);

        // Trigger onClick
        testButton?.onClick(editor);

        // Verify state changed
        expect(clickCount).toBe(1);
        expect(lastEditor).toBe(editor);
        expect(testButton?.isActive?.(editor)).toBe(true);

        // Trigger again
        testButton?.onClick(editor);
        expect(clickCount).toBe(2);

        editor.destroy();
    });

    it('7.6: Performance - Editor creation with 0/10/30 plugin extensions', async () => {
        const measurements: Record<string, number> = {};

        // Helper to create dummy extensions (no custom commands, so no type assertions needed)
        const createDummyNode = (name: string) =>
            Node.create({
                name,
                group: 'block',
                content: 'inline*',
                parseHTML() {
                    return [{ tag: `div[data-type="${name}"]` }];
                },
                renderHTML() {
                    return ['div', { 'data-type': name }, 0];
                },
            });

        const createDummyMark = (name: string) =>
            Mark.create({
                name,
                parseHTML() {
                    return [{ tag: `span[data-mark="${name}"]` }];
                },
                renderHTML() {
                    return ['span', { 'data-mark': name }, 0];
                },
            });

        // Test with 0 plugins
        const start0 = performance.now();
        const editor0 = new Editor({
            extensions: [StarterKit],
            content: '<p>Test</p>',
        });
        measurements['0 plugins'] = performance.now() - start0;
        editor0.destroy();

        // Test with 10 plugins (5 nodes + 5 marks)
        for (let i = 0; i < 5; i++) {
            registerEditorNode({
                id: `perf-test:node-${i}`,
                extension: createDummyNode(`perfNode${i}`),
            });
            registerEditorMark({
                id: `perf-test:mark-${i}`,
                extension: createDummyMark(`perfMark${i}`),
            });
        }

        const { listEditorNodes: listNodes10, listEditorMarks: listMarks10 } =
            await import('../editor/useEditorNodes');
        const plugins10 = [
            ...listNodes10().map((n) => n.extension),
            ...listMarks10().map((m) => m.extension),
        ];

        const start10 = performance.now();
        const editor10 = new Editor({
            extensions: [StarterKit, ...plugins10],
            content: '<p>Test</p>',
        });
        measurements['10 plugins'] = performance.now() - start10;
        editor10.destroy();

        // Test with 30 plugins (15 nodes + 15 marks)
        for (let i = 5; i < 20; i++) {
            registerEditorNode({
                id: `perf-test:node-${i}`,
                extension: createDummyNode(`perfNode${i}`),
            });
            registerEditorMark({
                id: `perf-test:mark-${i}`,
                extension: createDummyMark(`perfMark${i}`),
            });
        }

        const { listEditorNodes: listNodes30, listEditorMarks: listMarks30 } =
            await import('../editor/useEditorNodes');
        const plugins30 = [
            ...listNodes30().map((n) => n.extension),
            ...listMarks30().map((m) => m.extension),
        ];

        const start30 = performance.now();
        const editor30 = new Editor({
            extensions: [StarterKit, ...plugins30],
            content: '<p>Test</p>',
        });
        measurements['30 plugins'] = performance.now() - start30;
        editor30.destroy();

        // Log measurements for review
        console.log('[Performance Test] Editor creation times:', measurements);

        const baseline = measurements['0 plugins'];
        // Allow some buffer for slower CI or busy hosts by basing thresholds on baseline cost.
        const moderateThreshold = Math.max(120, baseline + 600);
        const heavyThreshold = Math.max(180, baseline + 800);

        expect(baseline).toBeLessThan(400); // sanity guard: base editor should stay fast-ish
        expect(measurements['10 plugins']).toBeLessThan(moderateThreshold);
        expect(measurements['30 plugins']).toBeLessThan(heavyThreshold);

        const overhead10 = Math.max(0, measurements['10 plugins'] - baseline);
        const overhead30 = Math.max(0, measurements['30 plugins'] - baseline);

        console.log(
            '[Performance Test] Overhead: 10 plugins:',
            overhead10.toFixed(2),
            'ms'
        );
        console.log(
            '[Performance Test] Overhead: 30 plugins:',
            overhead30.toFixed(2),
            'ms'
        );

        // Per-plugin overhead should be reasonable (< 50ms per plugin on average)
        const perPlugin10 = overhead10 / Math.max(1, plugins10.length);
        const perPlugin30 = overhead30 / Math.max(1, plugins30.length);
        expect(perPlugin10).toBeLessThan(50);
        expect(perPlugin30).toBeLessThan(50);
    });
});
