import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadEditorExtensions } from '../useEditorExtensionLoader';
import type {
    EditorNodeDescriptor,
    EditorMarkDescriptor,
    EditorExtensionDescriptor,
} from '../useEditorExtensionLoader';

describe('useEditorExtensionLoader', () => {
    let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleWarnSpy.mockRestore();
    });

    describe('loadEditorExtensions', () => {
        it('should load all extensions successfully', async () => {
            const mockNode = { name: 'customNode' };
            const mockMark = { name: 'customMark' };
            const mockExtension = { name: 'customExtension' };

            const nodes: EditorNodeDescriptor[] = [
                { id: 'node1', factory: async () => mockNode as any },
            ];
            const marks: EditorMarkDescriptor[] = [
                { id: 'mark1', factory: async () => mockMark as any },
            ];
            const extensions: EditorExtensionDescriptor[] = [
                { id: 'ext1', factory: async () => mockExtension as any },
            ];

            const result = await loadEditorExtensions(nodes, marks, extensions);

            expect(result).toEqual({
                nodes: [mockNode],
                marks: [mockMark],
                extensions: [mockExtension],
            });
        });

        it('should skip failed extensions and log warnings', async () => {
            const mockNode = { name: 'goodNode' };
            const nodes: EditorNodeDescriptor[] = [
                { id: 'good-node', factory: async () => mockNode as any },
                {
                    id: 'bad-node',
                    factory: async () => {
                        throw new Error('Load failed');
                    },
                },
            ];

            const result = await loadEditorExtensions(nodes, [], []);

            expect(result.nodes).toEqual([mockNode]);
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining(
                    '[EditorExtensionLoader] Failed to load node bad-node'
                ),
                expect.any(Error)
            );
        });

        it('should handle partial failures across all descriptor types', async () => {
            const mockNode = { name: 'node' };
            const mockMark = { name: 'mark' };

            const nodes: EditorNodeDescriptor[] = [
                { id: 'node1', factory: async () => mockNode as any },
                {
                    id: 'node2',
                    factory: async () => {
                        throw new Error('Node fail');
                    },
                },
            ];
            const marks: EditorMarkDescriptor[] = [
                { id: 'mark1', factory: async () => mockMark as any },
                {
                    id: 'mark2',
                    factory: async () => {
                        throw new Error('Mark fail');
                    },
                },
            ];
            const extensions: EditorExtensionDescriptor[] = [
                {
                    id: 'ext1',
                    factory: async () => {
                        throw new Error('Extension fail');
                    },
                },
            ];

            const result = await loadEditorExtensions(nodes, marks, extensions);

            expect(result.nodes).toEqual([mockNode]);
            expect(result.marks).toEqual([mockMark]);
            expect(result.extensions).toEqual([]);
            expect(consoleWarnSpy).toHaveBeenCalledTimes(3);
        });

        it('should handle empty descriptor arrays', async () => {
            const result = await loadEditorExtensions([], [], []);

            expect(result).toEqual({
                nodes: [],
                marks: [],
                extensions: [],
            });
            expect(consoleWarnSpy).not.toHaveBeenCalled();
        });

        it('should handle mixed eager and lazy extensions', async () => {
            const eagerNode = { name: 'eagerNode' };
            const lazyNode = { name: 'lazyNode' };

            const nodes: EditorNodeDescriptor[] = [
                { id: 'eager', extension: eagerNode as any },
                { id: 'lazy', factory: async () => lazyNode as any },
            ];

            const result = await loadEditorExtensions(nodes, [], []);

            expect(result.nodes).toEqual([eagerNode, lazyNode]);
        });
    });
});
