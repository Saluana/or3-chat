import { describe, it, expect, beforeEach } from 'vitest';
import {
    registerEditorNode,
    unregisterEditorNode,
    registerEditorMark,
    unregisterEditorMark,
    listEditorNodes,
    listEditorMarks,
    listRegisteredEditorNodeIds,
    listRegisteredEditorMarkIds,
} from '../ui-extensions/editor/useEditorNodes';

// Mock TipTap extension
const mockExtension = { name: 'mock' } as any;

describe('useEditorNodes', () => {
    beforeEach(() => {
        // Clear registries before each test
        listRegisteredEditorNodeIds().forEach((id) => unregisterEditorNode(id));
        listRegisteredEditorMarkIds().forEach((id) => unregisterEditorMark(id));
    });

    it('registers a node extension', () => {
        registerEditorNode({
            id: 'test:custom-node',
            extension: mockExtension,
            order: 300,
        });

        const ids = listRegisteredEditorNodeIds();
        expect(ids).toContain('test:custom-node');
    });

    it('unregisters a node extension', () => {
        registerEditorNode({
            id: 'test:node',
            extension: mockExtension,
        });

        expect(listRegisteredEditorNodeIds()).toContain('test:node');

        unregisterEditorNode('test:node');

        expect(listRegisteredEditorNodeIds()).not.toContain('test:node');
    });

    it('registers a mark extension', () => {
        registerEditorMark({
            id: 'test:custom-mark',
            extension: mockExtension,
            order: 300,
        });

        const ids = listRegisteredEditorMarkIds();
        expect(ids).toContain('test:custom-mark');
    });

    it('unregisters a mark extension', () => {
        registerEditorMark({
            id: 'test:mark',
            extension: mockExtension,
        });

        expect(listRegisteredEditorMarkIds()).toContain('test:mark');

        unregisterEditorMark('test:mark');

        expect(listRegisteredEditorMarkIds()).not.toContain('test:mark');
    });

    it('lists nodes in order', () => {
        registerEditorNode({
            id: 'test:node-1',
            extension: mockExtension,
            order: 300,
        });
        registerEditorNode({
            id: 'test:node-2',
            extension: mockExtension,
            order: 100,
        });
        registerEditorNode({
            id: 'test:node-3',
            extension: mockExtension,
            order: 200,
        });

        const nodes = listEditorNodes();
        expect(nodes.map((n) => n.id)).toEqual([
            'test:node-2',
            'test:node-3',
            'test:node-1',
        ]);
    });

    it('lists marks in order', () => {
        registerEditorMark({
            id: 'test:mark-1',
            extension: mockExtension,
            order: 300,
        });
        registerEditorMark({
            id: 'test:mark-2',
            extension: mockExtension,
            order: 100,
        });

        const marks = listEditorMarks();
        expect(marks.map((m) => m.id)).toEqual(['test:mark-2', 'test:mark-1']);
    });
});
