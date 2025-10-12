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

    it('sorts nodes by order, tie-breaking by id', () => {
        const NodeA = Node.create({ name: 'nodeA' });
        const NodeB = Node.create({ name: 'nodeB' });
        const NodeC = Node.create({ name: 'nodeC' });

        registerEditorNode({ id: 'test:c', extension: NodeC, order: 200 });
        registerEditorNode({ id: 'test:a', extension: NodeA, order: 100 });
        registerEditorNode({ id: 'test:b', extension: NodeB, order: 200 });

        const nodes = listEditorNodes();
        expect(nodes.map((n) => n.id)).toEqual(['test:a', 'test:b', 'test:c']);
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

    it('sorts marks by order, tie-breaking by id', () => {
        const MarkA = Mark.create({ name: 'markA' });
        const MarkB = Mark.create({ name: 'markB' });
        const MarkC = Mark.create({ name: 'markC' });

        registerEditorMark({ id: 'test:c', extension: MarkC, order: 200 });
        registerEditorMark({ id: 'test:a', extension: MarkA, order: 100 });
        registerEditorMark({ id: 'test:b', extension: MarkB, order: 200 });

        const marks = listEditorMarks();
        expect(marks.map((m) => m.id)).toEqual(['test:a', 'test:b', 'test:c']);
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
