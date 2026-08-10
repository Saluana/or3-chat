import { describe, expect, it } from 'vitest';
import { normalizeTerminalWorkflowState } from '../backgroundJobPersistence';

describe('normalizeTerminalWorkflowState', () => {
    it('turns a terminal job error into a terminal workflow card state', () => {
        const state = normalizeTerminalWorkflowState(
            {
                type: 'workflow-execution',
                workflowId: 'wf-1',
                workflowName: 'Workflow',
                prompt: 'run it',
                executionState: 'running',
                nodeStates: {
                    writer: {
                        status: 'active',
                        label: 'Writer',
                        type: 'agent',
                        output: '',
                    },
                },
                executionOrder: ['writer'],
                currentNodeId: 'writer',
                finalOutput: '',
                version: 4,
            },
            'error',
            'Provider request failed'
        );

        expect(state).toMatchObject({
            executionState: 'error',
            currentNodeId: null,
            failedNodeId: 'writer',
            result: {
                success: false,
                error: 'Provider request failed',
            },
            version: 5,
        });
    });

    it.each([
        ['aborted', 'stopped', false],
        ['complete', 'completed', true]
    ] as const)('projects %s into %s immediately', (jobStatus, executionState, success) => {
        const state = normalizeTerminalWorkflowState(
            {
                type: 'workflow-execution',
                workflowId: 'wf-1',
                workflowName: 'Workflow',
                prompt: 'run it',
                executionState: 'running',
                nodeStates: {},
                executionOrder: [],
                currentNodeId: 'writer',
                finalOutput: '',
                version: 2
            },
            jobStatus,
            undefined
        );

        expect(state).toMatchObject({
            executionState,
            currentNodeId: null,
            result: { success },
            version: 3
        });
    });
});
