import { describe, it, expect, beforeEach } from 'vitest';
import {
    registerEditorNode,
    unregisterEditorNode,
    listEditorNodes,
    listRegisteredEditorNodeIds,
    registerEditorMark,
    unregisterEditorMark,
    listEditorMarks,
    listRegisteredEditorMarkIds,
} from '../editor/useEditorNodes';
import { Node, Mark } from '@tiptap/core';

describe('useEditorNodes', () => {
    beforeEach(() => {
        // Clear registries before each test
        listRegisteredEditorNodeIds().forEach((id) => unregisterEditorNode(id));
        listRegisteredEditorMarkIds().forEach((id) => unregisterEditorMark(id));
    });

    it('registers and lists nodes', () => {
        const TestNode = Node.create({ name: 'test' });

        registerEditorNode({
            id: 'test:node',
            extension: TestNode,
        });

        expect(listRegisteredEditorNodeIds()).toContain('test:node');
        expect(listEditorNodes()).toHaveLength(1);
    });

    it('registers and lists marks', () => {
        const TestMark = Mark.create({ name: 'test' });

        registerEditorMark({
            id: 'test:mark',
            extension: TestMark,
        });

        expect(listRegisteredEditorMarkIds()).toContain('test:mark');
        expect(listEditorMarks()).toHaveLength(1);
    });

    it('unregisters nodes', () => {
        const TestNode = Node.create({ name: 'test' });

        registerEditorNode({
            id: 'test:node',
            extension: TestNode,
        });

        expect(listRegisteredEditorNodeIds()).toContain('test:node');

        unregisterEditorNode('test:node');

        expect(listRegisteredEditorNodeIds()).not.toContain('test:node');
    });
});
