import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWorkflowStreamAccumulator } from '../useWorkflowStreamAccumulator';

describe('useWorkflowStreamAccumulator', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('initializes with default state', () => {
        const accumulator = createWorkflowStreamAccumulator();
        expect(accumulator.state.executionState).toBe('running');
        expect(accumulator.state.isActive).toBe(true);
        expect(accumulator.state.nodeStates).toEqual({});
        expect(accumulator.state.executionOrder).toEqual([]);
    });

    it('tracks node lifecycle', () => {
        const accumulator = createWorkflowStreamAccumulator();

        // Start node
        accumulator.nodeStart('node-1', 'Test Node', 'agent');
        expect(accumulator.state.nodeStates['node-1']).toBeDefined();
        expect(accumulator.state.nodeStates['node-1']!.status).toBe('active');
        expect(accumulator.state.currentNodeId).toBe('node-1');
        expect(accumulator.state.executionOrder).toContain('node-1');

        // Finish node
        accumulator.nodeFinish('node-1', 'Final Output');
        accumulator.finalize({
            result: {
                success: true,
                finalOutput: 'Final Output',
                executionOrder: ['node-1'],
            },
        });

        expect(accumulator.state.nodeStates['node-1']!.status).toBe(
            'completed'
        );
        expect(accumulator.state.nodeStates['node-1']!.output).toBe(
            'Final Output'
        );
        expect(accumulator.state.currentNodeId).toBeNull();
        expect(accumulator.state.finalOutput).toBe('Final Output');
    });

    it('batches token updates using RAF/setTimeout', async () => {
        const accumulator = createWorkflowStreamAccumulator();
        accumulator.nodeStart('node-1', 'Test Node', 'agent');

        // Add tokens
        accumulator.nodeToken('node-1', 'Hello');
        accumulator.nodeToken('node-1', ' World');

        // Should be pending (not immediately applied)
        expect(accumulator.state.nodeStates['node-1']!.streamingText).toBe('');

        // Advance timers to trigger flush
        vi.runAllTimers();

        // Should be applied now
        expect(accumulator.state.nodeStates['node-1']!.streamingText).toBe(
            'Hello World'
        );
    });

    it('tracks parallel branches', () => {
        const accumulator = createWorkflowStreamAccumulator();
        accumulator.nodeStart('parallel-1', 'Parallel Node', 'parallel');

        // Start branch
        accumulator.branchStart('parallel-1', 'branch-a', 'Branch A');
        const branchKey = 'parallel-1:branch-a';

        expect(accumulator.state.branches[branchKey]).toBeDefined();
        expect(accumulator.state.branches[branchKey]!.status).toBe('active');

        // Stream branch tokens
        accumulator.branchToken('parallel-1', 'branch-a', 'Branch A', 'Part 1');
        vi.runAllTimers();
        expect(accumulator.state.branches[branchKey]!.streamingText).toBe(
            'Part 1'
        );

        // Complete branch - streamed content is preferred over engine output
        accumulator.branchComplete(
            'parallel-1',
            'branch-a',
            'Branch A',
            'Branch Result'
        );
        expect(accumulator.state.branches[branchKey]!.status).toBe('completed');
        expect(accumulator.state.branches[branchKey]!.output).toBe('Part 1');
    });

    it('handles errors correctly', () => {
        const accumulator = createWorkflowStreamAccumulator();
        accumulator.nodeStart('node-1', 'Test Node', 'agent');

        const error = new Error('Something went wrong');
        accumulator.nodeError('node-1', error);

        expect(accumulator.state.nodeStates['node-1']!.status).toBe('error');
        expect(accumulator.state.nodeStates['node-1']!.error).toBe(
            'Something went wrong'
        );
        expect(accumulator.state.executionState).toBe('error');
        expect(accumulator.state.error).toBe(error);
    });

    it('finalizes execution state', () => {
        const accumulator = createWorkflowStreamAccumulator();

        // Success case
        accumulator.finalize({ result: { success: true } });
        expect(accumulator.state.executionState).toBe('completed');
        expect(accumulator.state.isActive).toBe(false);

        // Reset
        accumulator.reset();
        expect(accumulator.state.executionState).toBe('running');
        expect(accumulator.state.isActive).toBe(true);

        // Stopped case - execution was interrupted by user
        accumulator.finalize({ stopped: true });
        expect(accumulator.state.executionState).toBe('interrupted');
    });

    it('serializes to message data', () => {
        const accumulator = createWorkflowStreamAccumulator();
        accumulator.nodeStart('node-1', 'Test Node', 'agent');
        accumulator.nodeFinish('node-1', 'Result');
        accumulator.finalize();

        const data = accumulator.toMessageData(
            'wf-1',
            'My Workflow',
            'Run this'
        );

        expect(data.type).toBe('workflow-execution');
        expect(data.workflowId).toBe('wf-1');
        expect(data.workflowName).toBe('My Workflow');
        expect(data.prompt).toBe('Run this');
        expect(data.executionState).toBe('completed');
        expect(data.nodeStates['node-1']!.output).toBe('Result');
        expect(data.finalOutput).toBe('Result');
        expect(data.result?.success).toBe(true);
    });
});
