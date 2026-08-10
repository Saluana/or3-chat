import { describe, expect, it } from 'vitest';
import type { WorkflowData } from 'or3-workflow-core';
import type { WorkflowMessageData } from '~/utils/chat/workflow-types';
import { reconcileWorkflowResume } from '../reconcileWorkflowResume';

function workflow(
    nodeIds: Array<[string, string]>,
    edges: Array<[string, string]>
): WorkflowData {
    return {
        meta: { version: '1', name: 'Resume test' },
        nodes: nodeIds.map(([id, type]) => ({
            id,
            type,
            position: { x: 0, y: 0 },
            data: { label: id },
        })) as WorkflowData['nodes'],
        edges: edges.map(([source, target], index) => ({
            id: `edge-${index}`,
            source,
            target,
        })),
    };
}

function snapshot(input: Partial<WorkflowMessageData>): WorkflowMessageData {
    return {
        type: 'workflow-execution',
        workflowId: 'workflow-1',
        workflowName: 'Resume test',
        prompt: 'Prompt',
        executionState: 'interrupted',
        nodeStates: {},
        executionOrder: [],
        currentNodeId: null,
        lastActiveNodeId: null,
        finalNodeId: null,
        finalOutput: '',
        ...input,
    };
}

describe('reconcileWorkflowResume', () => {
    it('preserves an existing checkpoint when its node still exists', () => {
        const graph = workflow(
            [
                ['start', 'start'],
                ['draft', 'agent'],
                ['review', 'agent'],
            ],
            [
                ['start', 'draft'],
                ['draft', 'review'],
            ]
        );
        const result = reconcileWorkflowResume(
            graph,
            snapshot({
                currentNodeId: 'review',
                nodeStates: {
                    draft: {
                        status: 'completed',
                        label: 'Draft',
                        type: 'agent',
                        output: 'Draft output',
                    },
                    review: {
                        status: 'active',
                        label: 'Review',
                        type: 'agent',
                        output: '',
                    },
                },
                nodeOutputs: {
                    draft: 'Draft output',
                    review: '',
                },
                executionOrder: ['draft', 'review'],
            })
        );

        expect(result.startNodeId).toBe('review');
        expect(result.nodeOutputs).toEqual({ draft: 'Draft output' });
        expect(result.executionOrder).toEqual(['draft']);
        expect(result.usedGraphFallback).toBe(false);
    });

    it('discards removed nodes and resumes at the next ready current node', () => {
        const graph = workflow(
            [
                ['start', 'start'],
                ['architect', 'agent'],
                ['writer-a', 'agent'],
                ['writer-b', 'agent'],
                ['judge', 'agent'],
            ],
            [
                ['start', 'architect'],
                ['architect', 'writer-a'],
                ['architect', 'writer-b'],
                ['writer-a', 'judge'],
                ['writer-b', 'judge'],
            ]
        );
        const result = reconcileWorkflowResume(
            graph,
            snapshot({
                currentNodeId: 'removed-judge',
                nodeStates: {
                    architect: {
                        status: 'completed',
                        label: 'Architect',
                        type: 'agent',
                        output: 'Outline',
                    },
                    'writer-a': {
                        status: 'completed',
                        label: 'Writer A',
                        type: 'agent',
                        output: 'Draft A',
                    },
                    'writer-b': {
                        status: 'completed',
                        label: 'Writer B',
                        type: 'agent',
                        output: 'Draft B',
                    },
                },
                nodeOutputs: {
                    architect: 'Outline',
                    'writer-a': 'Draft A',
                    'writer-b': 'Draft B',
                    'removed-judge': 'Partial result',
                },
                executionOrder: [
                    'architect',
                    'writer-a',
                    'writer-b',
                    'removed-judge',
                ],
            })
        );

        expect(result.startNodeId).toBe('judge');
        expect(result.pendingNodes).toEqual(['judge']);
        expect(result.nodeOutputs).not.toHaveProperty('removed-judge');
        expect(result.nodeOutputs).toMatchObject({
            architect: 'Outline',
            'writer-a': 'Draft A',
            'writer-b': 'Draft B',
        });
        expect(result.usedGraphFallback).toBe(true);
    });

    it('restarts after Start when none of the checkpoint nodes still exist', () => {
        const graph = workflow(
            [
                ['new-start', 'start'],
                ['new-first', 'agent'],
                ['new-output', 'output'],
            ],
            [
                ['new-start', 'new-first'],
                ['new-first', 'new-output'],
            ]
        );
        const result = reconcileWorkflowResume(
            graph,
            snapshot({
                currentNodeId: 'old-agent',
                nodeOutputs: { 'old-agent': 'Old output' },
                executionOrder: ['old-agent'],
            })
        );

        expect(result.startNodeId).toBe('new-first');
        expect(result.nodeOutputs).toEqual({});
        expect(result.executionOrder).toEqual([]);
        expect(result.sessionMessages).toBeUndefined();
        expect(result.usedGraphFallback).toBe(true);
    });

    it('restores an entire ready parallel wave', () => {
        const graph = workflow(
            [
                ['start', 'start'],
                ['architect', 'agent'],
                ['writer-a', 'agent'],
                ['writer-b', 'agent'],
            ],
            [
                ['start', 'architect'],
                ['architect', 'writer-a'],
                ['architect', 'writer-b'],
            ]
        );
        const result = reconcileWorkflowResume(
            graph,
            snapshot({
                nodeStates: {
                    architect: {
                        status: 'completed',
                        label: 'Architect',
                        type: 'agent',
                        output: 'Outline',
                    },
                },
                nodeOutputs: { architect: 'Outline' },
                executionOrder: ['architect'],
            })
        );

        expect(result.startNodeId).toBe('writer-a');
        expect(result.pendingNodes).toEqual(['writer-a', 'writer-b']);
    });
});
