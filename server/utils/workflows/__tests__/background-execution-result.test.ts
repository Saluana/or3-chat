import { describe, expect, it } from 'vitest';
import type { ExecutionResult, WorkflowData } from 'or3-workflow-core';
import type { WorkflowMessageData } from '~/utils/chat/workflow-types';
import {
    assertBackgroundWorkflowSucceeded,
    hydrateWorkflowStateFromResume,
} from '../background-execution';

function result(
    success: boolean,
    error?: Error
): ExecutionResult {
    return {
        success,
        output: '',
        finalOutput: '',
        executionOrder: [],
        nodeOutputs: {},
        sessionMessages: [],
        duration: 0,
        error: error as ExecutionResult['error'],
    };
}

describe('background workflow terminal result', () => {
    it('allows successful adapter results', () => {
        expect(() =>
            assertBackgroundWorkflowSucceeded(result(true))
        ).not.toThrow();
    });

    it('throws the adapter error instead of marking the job completed', () => {
        const error = new Error('No endpoints found');
        expect(() =>
            assertBackgroundWorkflowSucceeded(result(false, error))
        ).toThrow(error);
    });
});

describe('background workflow resume projection', () => {
    it('keeps completed checkpoint nodes when the resumed node starts later', () => {
        const state: WorkflowMessageData = {
            type: 'workflow-execution',
            workflowId: 'wf-1',
            workflowName: 'Tournament',
            prompt: 'write a story',
            executionState: 'running',
            nodeStates: {},
            executionOrder: [],
            currentNodeId: null,
            finalOutput: '',
            version: 12,
        };
        const workflow = {
            meta: { version: '2.0.0', name: 'Tournament' },
            nodes: [
                {
                    id: 'writer-a',
                    type: 'agent',
                    position: { x: 0, y: 0 },
                    data: { label: 'Writer A' },
                },
                {
                    id: 'judge',
                    type: 'agent',
                    position: { x: 0, y: 100 },
                    data: { label: 'Judge Part 1' },
                },
            ],
            edges: [],
        } as WorkflowData;

        hydrateWorkflowStateFromResume(state, workflow, {
            startNodeId: 'judge',
            pendingNodes: ['judge'],
            nodeOutputs: {
                'writer-a': 'saved draft',
                judge: 'discard this partial result',
            },
            executionOrder: ['writer-a', 'judge'],
            lastActiveNodeId: 'writer-a',
        });

        expect(state.executionOrder).toEqual(['writer-a']);
        expect(state.nodeStates).toEqual({
            'writer-a': {
                status: 'completed',
                label: 'Writer A',
                type: 'agent',
                output: 'saved draft',
            },
        });
        expect(state.nodeOutputs).toEqual({
            'writer-a': 'saved draft',
        });
        expect(state.lastActiveNodeId).toBe('writer-a');
        expect(state.version).toBe(12);
    });
});
