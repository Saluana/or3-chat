/**
 * Workflow Message Integration Tests
 *
 * This file contains comprehensive integration tests for:
 * - Phase 8.1: Workflow message persistence
 * - Phase 8.2: Workflow message loading
 * - Phase 8.3: Real-time updates
 *
 * Tests cover the full workflow lifecycle including edge cases,
 * error recovery, and performance considerations.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, nextTick, watch } from 'vue';
import { createWorkflowStreamAccumulator } from '../useWorkflowStreamAccumulator';
import type { WorkflowStreamAccumulatorApi } from '../useWorkflowStreamAccumulator';
import { ensureUiMessage } from '~/utils/chat/uiMessages';
import {
    isWorkflowMessageData,
    isBaseMessageData,
    deriveStartNodeId,
    MERGE_BRANCH_ID,
    MERGE_BRANCH_LABEL,
    type WorkflowMessageData,
    type NodeState,
    type BranchState,
} from '~/utils/chat/workflow-types';

// ─────────────────────────────────────────────────────────────────────────────
// Test Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a mock workflow message data structure for testing
 */
function createMockWorkflowData(
    overrides: Partial<WorkflowMessageData> = {}
): WorkflowMessageData {
    return {
        type: 'workflow-execution',
        workflowId: 'wf-test-1',
        workflowName: 'Test Workflow',
        prompt: 'Test prompt',
        executionState: 'running',
        nodeStates: {},
        executionOrder: [],
        currentNodeId: null,
        finalOutput: '',
        ...overrides,
    };
}

/**
 * Creates a mock node state
 */
function createMockNodeState(
    overrides: Partial<NodeState> = {}
): NodeState {
    return {
        status: 'pending',
        label: 'Test Node',
        type: 'agent',
        output: '',
        ...overrides,
    };
}

/**
 * Creates a mock branch state
 */
function createMockBranchState(
    overrides: Partial<BranchState> = {}
): BranchState {
    return {
        id: 'branch-1',
        label: 'Test Branch',
        status: 'pending',
        output: '',
        ...overrides,
    };
}

/**
 * Creates a mock database message
 */
function createMockDbMessage(
    overrides: Record<string, unknown> = {}
): Record<string, unknown> {
    return {
        id: 'msg-1',
        role: 'assistant',
        thread_id: 'thread-1',
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
        data: null,
        ...overrides,
    };
}

/**
 * Simulates RAF timing by advancing timers
 */
async function flushRAF(timers: typeof vi): Promise<void> {
    timers.runAllTimers();
    await nextTick();
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 8.1: Workflow Message Persistence Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 8.1: Workflow Message Persistence', () => {
    let accumulator: WorkflowStreamAccumulatorApi;

    beforeEach(() => {
        vi.useFakeTimers();
        accumulator = createWorkflowStreamAccumulator();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('toMessageData serialization', () => {
        it('serializes initial running state correctly', () => {
            const data = accumulator.toMessageData('wf-1', 'My Workflow', 'Run this');

            expect(data.type).toBe('workflow-execution');
            expect(data.workflowId).toBe('wf-1');
            expect(data.workflowName).toBe('My Workflow');
            expect(data.prompt).toBe('Run this');
            expect(data.executionState).toBe('running');
            expect(data.nodeStates).toEqual({});
            expect(data.executionOrder).toEqual([]);
            expect(data.currentNodeId).toBeNull();
            expect(data.finalOutput).toBe('');
        });

        it('serializes node states with all properties', () => {
            accumulator.nodeStart('node-1', 'Agent Node', 'agent');
            accumulator.nodeFinish('node-1', 'Node output');
            accumulator.finalize({ result: { success: true, finalOutput: 'Node output' } });

            const data = accumulator.toMessageData('wf-1', 'My Workflow', 'Test');

            expect(data.nodeStates['node-1']).toBeDefined();
            expect(data.nodeStates['node-1']!.status).toBe('completed');
            expect(data.nodeStates['node-1']!.label).toBe('Agent Node');
            expect(data.nodeStates['node-1']!.type).toBe('agent');
            expect(data.nodeStates['node-1']!.output).toBe('Node output');
            expect(data.nodeStates['node-1']!.startedAt).toBeDefined();
            expect(data.nodeStates['node-1']!.finishedAt).toBeDefined();
        });

        it('serializes execution order in correct sequence', () => {
            accumulator.nodeStart('node-1', 'First', 'agent');
            accumulator.nodeFinish('node-1', 'Output 1');
            accumulator.nodeStart('node-2', 'Second', 'agent');
            accumulator.nodeFinish('node-2', 'Output 2');
            accumulator.nodeStart('node-3', 'Third', 'agent');
            accumulator.nodeFinish('node-3', 'Output 3');
            accumulator.finalize({ result: { success: true, finalOutput: 'Output 3' } });

            const data = accumulator.toMessageData('wf-1', 'Workflow', 'Test');

            expect(data.executionOrder).toEqual(['node-1', 'node-2', 'node-3']);
        });

        it('serializes branch states for parallel nodes', () => {
            accumulator.nodeStart('parallel-1', 'Parallel Node', 'parallel');
            accumulator.branchStart('parallel-1', 'branch-a', 'Branch A');
            accumulator.branchStart('parallel-1', 'branch-b', 'Branch B');
            accumulator.branchComplete('parallel-1', 'branch-a', 'Result A');
            accumulator.branchComplete('parallel-1', 'branch-b', 'Result B');
            accumulator.nodeFinish('parallel-1', 'Merged');
            accumulator.finalize({ result: { success: true, finalOutput: 'Merged' } });

            const data = accumulator.toMessageData('wf-1', 'Workflow', 'Test');

            expect(data.branches).toBeDefined();
            expect(data.branches!['parallel-1:branch-a']).toBeDefined();
            expect(data.branches!['parallel-1:branch-a']!.status).toBe('completed');
            expect(data.branches!['parallel-1:branch-a']!.output).toBe('Result A');
            expect(data.branches!['parallel-1:branch-b']).toBeDefined();
            expect(data.branches!['parallel-1:branch-b']!.status).toBe('completed');
        });

        it('serializes error state with failed node info', () => {
            accumulator.nodeStart('node-1', 'Will Fail', 'agent');
            const error = new Error('Execution failed');
            accumulator.nodeError('node-1', error);

            const data = accumulator.toMessageData('wf-1', 'Workflow', 'Test');

            expect(data.executionState).toBe('error');
            expect(data.failedNodeId).toBe('node-1');
            expect(data.nodeStates['node-1']!.status).toBe('error');
            expect(data.nodeStates['node-1']!.error).toBe('Execution failed');
            expect(data.result?.success).toBe(false);
            expect(data.result?.error).toBe('Execution failed');
        });

        it('serializes stopped/interrupted state correctly', () => {
            accumulator.nodeStart('node-1', 'Node', 'agent');
            accumulator.finalize({ stopped: true });

            const data = accumulator.toMessageData('wf-1', 'Workflow', 'Test');

            expect(data.executionState).toBe('interrupted');
            expect(data.result?.success).toBe(false);
        });

        it('includes token usage data when available', () => {
            accumulator.nodeStart('node-1', 'Node', 'agent');
            accumulator.tokenUsage('node-1', {
                promptTokens: 100,
                completionTokens: 50,
                totalTokens: 150,
            });
            accumulator.nodeFinish('node-1', 'Done');
            accumulator.finalize({
                result: {
                    success: true,
                    finalOutput: 'Done',
                    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
                    tokenUsageDetails: [
                        { nodeId: 'node-1', promptTokens: 100, completionTokens: 50, totalTokens: 150 },
                    ],
                },
            });

            const data = accumulator.toMessageData('wf-1', 'Workflow', 'Test');

            expect(data.result?.totalTokens).toBe(150);
            expect(data.result?.usage).toEqual({
                promptTokens: 100,
                completionTokens: 50,
                totalTokens: 150,
            });
            expect(data.result?.tokenUsageDetails).toHaveLength(1);
        });

        it('calculates duration from node timestamps', () => {
            const startTime = Date.now();
            vi.setSystemTime(startTime);

            accumulator.nodeStart('node-1', 'Node', 'agent');

            // Advance time by 1 second
            vi.setSystemTime(startTime + 1000);
            accumulator.nodeFinish('node-1', 'Done');
            accumulator.finalize({ result: { success: true, finalOutput: 'Done' } });

            const data = accumulator.toMessageData('wf-1', 'Workflow', 'Test');

            expect(data.result?.duration).toBeGreaterThanOrEqual(1000);
        });
    });

    describe('nodeOutputs for resume capability', () => {
        it('captures node outputs for potential resume', () => {
            accumulator.nodeStart('node-1', 'First', 'agent');
            accumulator.nodeFinish('node-1', 'Output 1');
            accumulator.nodeStart('node-2', 'Second', 'agent');
            accumulator.nodeFinish('node-2', 'Output 2');
            accumulator.finalize({ result: { success: true, finalOutput: 'Output 2' } });

            const data = accumulator.toMessageData('wf-1', 'Workflow', 'Test');

            expect(data.nodeOutputs).toBeDefined();
            expect(data.nodeOutputs!['node-1']).toBe('Output 1');
            expect(data.nodeOutputs!['node-2']).toBe('Output 2');
        });

        it('builds resume state on error', () => {
            accumulator.nodeStart('node-1', 'First', 'agent');
            accumulator.nodeFinish('node-1', 'Output 1');
            accumulator.nodeStart('node-2', 'Second', 'agent');
            accumulator.nodeError('node-2', new Error('Failed'));

            const data = accumulator.toMessageData('wf-1', 'Workflow', 'Test');

            expect(data.resumeState).toBeDefined();
            expect(data.resumeState!.startNodeId).toBe('node-2');
            expect(data.resumeState!.nodeOutputs['node-1']).toBe('Output 1');
            expect(data.resumeState!.executionOrder).toContain('node-1');
        });

        it('builds resume state on interruption', () => {
            accumulator.nodeStart('node-1', 'First', 'agent');
            accumulator.nodeFinish('node-1', 'Output 1');
            accumulator.nodeStart('node-2', 'Second', 'agent');
            accumulator.finalize({ stopped: true });

            const data = accumulator.toMessageData('wf-1', 'Workflow', 'Test');

            expect(data.resumeState).toBeDefined();
            expect(data.resumeState!.startNodeId).toBe('node-2');
        });

        it('does not include resume state on successful completion', () => {
            accumulator.nodeStart('node-1', 'Node', 'agent');
            accumulator.nodeFinish('node-1', 'Done');
            accumulator.finalize({ result: { success: true, finalOutput: 'Done' } });

            const data = accumulator.toMessageData('wf-1', 'Workflow', 'Test');

            expect(data.resumeState).toBeUndefined();
        });
    });

    describe('session messages preservation', () => {
        it('preserves session messages in finalize result', () => {
            const sessionMessages = [
                { role: 'user' as const, content: 'Hello' },
                { role: 'assistant' as const, content: 'Hi there' },
            ];

            accumulator.nodeStart('node-1', 'Node', 'agent');
            accumulator.nodeFinish('node-1', 'Done');
            accumulator.finalize({
                result: {
                    success: true,
                    finalOutput: 'Done',
                    sessionMessages,
                },
            });

            const data = accumulator.toMessageData('wf-1', 'Workflow', 'Test');

            expect(data.sessionMessages).toEqual(sessionMessages);
        });
    });

    describe('edge cases', () => {
        it('handles empty workflow (no nodes executed)', () => {
            accumulator.finalize({ result: { success: true, finalOutput: '' } });

            const data = accumulator.toMessageData('wf-1', 'Empty Workflow', 'Test');

            expect(data.nodeStates).toEqual({});
            expect(data.executionOrder).toEqual([]);
            expect(data.executionState).toBe('completed');
        });

        it('handles node started but never finished', () => {
            accumulator.nodeStart('node-1', 'Stuck Node', 'agent');
            accumulator.finalize({ stopped: true });

            const data = accumulator.toMessageData('wf-1', 'Workflow', 'Test');

            expect(data.nodeStates['node-1']!.status).toBe('active');
            expect(data.executionState).toBe('interrupted');
        });

        it('handles duplicate node start calls', () => {
            accumulator.nodeStart('node-1', 'Node', 'agent');
            accumulator.nodeStart('node-1', 'Node Updated', 'tool');
            accumulator.nodeFinish('node-1', 'Done');
            accumulator.finalize({ result: { success: true, finalOutput: 'Done' } });

            const data = accumulator.toMessageData('wf-1', 'Workflow', 'Test');

            // Should use latest values
            expect(data.nodeStates['node-1']!.label).toBe('Node Updated');
            expect(data.nodeStates['node-1']!.type).toBe('tool');
            // Should only appear once in execution order
            expect(data.executionOrder.filter((id) => id === 'node-1')).toHaveLength(1);
        });

        it('handles very long node output (memory warning threshold)', () => {
            const longOutput = 'x'.repeat(150000); // 150KB
            accumulator.nodeStart('node-1', 'Node', 'agent');
            accumulator.nodeFinish('node-1', longOutput);
            accumulator.finalize({ result: { success: true, finalOutput: longOutput } });

            const data = accumulator.toMessageData('wf-1', 'Workflow', 'Test');

            expect(data.nodeStates['node-1']!.output).toBe(longOutput);
            expect(data.finalOutput).toBe(longOutput);
        });

        it('handles special characters in node labels and outputs', () => {
            const specialLabel = 'Node with "quotes" and <html> & unicode: 你好';
            const specialOutput = '{"json": true, "nested": {"key": "value"}}';

            accumulator.nodeStart('node-1', specialLabel, 'agent');
            accumulator.nodeFinish('node-1', specialOutput);
            accumulator.finalize({ result: { success: true, finalOutput: specialOutput } });

            const data = accumulator.toMessageData('wf-1', 'Workflow', 'Test');

            expect(data.nodeStates['node-1']!.label).toBe(specialLabel);
            expect(data.nodeStates['node-1']!.output).toBe(specialOutput);
        });

        it('handles merge branch correctly', () => {
            accumulator.nodeStart('parallel-1', 'Parallel', 'parallel');
            accumulator.branchStart('parallel-1', 'branch-a', 'A');
            accumulator.branchComplete('parallel-1', 'branch-a', 'Result A');
            accumulator.branchStart('parallel-1', MERGE_BRANCH_ID, MERGE_BRANCH_LABEL);
            accumulator.branchComplete('parallel-1', MERGE_BRANCH_ID, 'Merged');
            accumulator.nodeFinish('parallel-1', 'Final');
            accumulator.finalize({ result: { success: true, finalOutput: 'Final' } });

            const data = accumulator.toMessageData('wf-1', 'Workflow', 'Test');

            expect(data.branches![`parallel-1:${MERGE_BRANCH_ID}`]).toBeDefined();
            expect(data.branches![`parallel-1:${MERGE_BRANCH_ID}`]!.label).toBe(MERGE_BRANCH_LABEL);
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 8.2: Workflow Message Loading Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 8.2: Workflow Message Loading', () => {
    describe('ensureUiMessage transformation', () => {
        it('transforms workflow message data correctly', () => {
            const workflowData = createMockWorkflowData({
                workflowId: 'wf-123',
                workflowName: 'Test Flow',
                executionState: 'completed',
                finalOutput: 'Final result',
                nodeStates: {
                    'node-1': createMockNodeState({
                        status: 'completed',
                        output: 'Node output',
                    }),
                },
                executionOrder: ['node-1'],
            });

            const dbMessage = createMockDbMessage({ data: workflowData });
            const uiMessage = ensureUiMessage(dbMessage as any);

            expect(uiMessage.isWorkflow).toBe(true);
            expect(uiMessage.workflowState).toBeDefined();
            expect(uiMessage.workflowState!.workflowId).toBe('wf-123');
            expect(uiMessage.workflowState!.workflowName).toBe('Test Flow');
            expect(uiMessage.workflowState!.executionState).toBe('completed');
            expect(uiMessage.text).toBe('Final result');
        });

        it('handles regular message (non-workflow) correctly', () => {
            const dbMessage = createMockDbMessage({
                text: 'Regular message',
                data: null,
            });

            const uiMessage = ensureUiMessage(dbMessage as any);

            expect(uiMessage.isWorkflow).toBeFalsy();
            expect(uiMessage.workflowState).toBeUndefined();
            expect(uiMessage.text).toBe('Regular message');
        });

        it('handles message with other data types', () => {
            const dbMessage = createMockDbMessage({
                text: 'Message with data',
                data: { reasoning_text: 'Some reasoning' },
            });

            const uiMessage = ensureUiMessage(dbMessage as any);

            expect(uiMessage.isWorkflow).toBeFalsy();
            expect(uiMessage.workflowState).toBeUndefined();
            expect(uiMessage.reasoning_text).toBe('Some reasoning');
        });

        it('correctly populates workflowState branches', () => {
            const workflowData = createMockWorkflowData({
                nodeStates: {
                    'parallel-1': createMockNodeState({ status: 'completed' }),
                },
                branches: {
                    'parallel-1:branch-a': createMockBranchState({
                        id: 'branch-a',
                        label: 'Branch A',
                        status: 'completed',
                        output: 'Result A',
                    }),
                },
            });

            const dbMessage = createMockDbMessage({ data: workflowData });
            const uiMessage = ensureUiMessage(dbMessage as any);

            expect(uiMessage.workflowState!.branches).toBeDefined();
            expect(uiMessage.workflowState!.branches!['parallel-1:branch-a']).toBeDefined();
        });

        it('handles interrupted state with resume info', () => {
            const workflowData = createMockWorkflowData({
                executionState: 'interrupted',
                failedNodeId: 'node-2',
                resumeState: {
                    startNodeId: 'node-2',
                    nodeOutputs: { 'node-1': 'Output 1' },
                    executionOrder: ['node-1'],
                },
            });

            const dbMessage = createMockDbMessage({ data: workflowData });
            const uiMessage = ensureUiMessage(dbMessage as any);

            expect(uiMessage.workflowState!.executionState).toBe('interrupted');
            expect(uiMessage.workflowState!.failedNodeId).toBe('node-2');
            expect(uiMessage.workflowState!.resumeState).toBeDefined();
            expect(uiMessage.workflowState!.resumeState!.startNodeId).toBe('node-2');
        });

        it('uses finalOutput as text for workflow messages', () => {
            const workflowData = createMockWorkflowData({
                finalOutput: 'Workflow final output',
            });

            const dbMessage = createMockDbMessage({
                text: 'Should be ignored',
                content: 'Also ignored',
                data: workflowData,
            });

            const uiMessage = ensureUiMessage(dbMessage as any);

            expect(uiMessage.text).toBe('Workflow final output');
        });

        it('handles empty finalOutput gracefully', () => {
            const workflowData = createMockWorkflowData({
                executionState: 'running',
                finalOutput: '',
            });

            const dbMessage = createMockDbMessage({ data: workflowData });
            const uiMessage = ensureUiMessage(dbMessage as any);

            expect(uiMessage.text).toBe('');
            expect(uiMessage.isWorkflow).toBe(true);
        });
    });

    describe('type guards', () => {
        it('isWorkflowMessageData identifies workflow data', () => {
            const workflowData = createMockWorkflowData();
            expect(isWorkflowMessageData(workflowData)).toBe(true);
        });

        it('isWorkflowMessageData rejects non-workflow data', () => {
            expect(isWorkflowMessageData(null)).toBe(false);
            expect(isWorkflowMessageData(undefined)).toBe(false);
            expect(isWorkflowMessageData({})).toBe(false);
            expect(isWorkflowMessageData({ type: 'message' })).toBe(false);
            expect(isWorkflowMessageData({ type: 'other' })).toBe(false);
            expect(isWorkflowMessageData('string')).toBe(false);
            expect(isWorkflowMessageData(123)).toBe(false);
        });

        it('isBaseMessageData identifies regular messages', () => {
            expect(isBaseMessageData(null)).toBe(true);
            expect(isBaseMessageData(undefined)).toBe(true);
            expect(isBaseMessageData({ type: 'message' })).toBe(true);
            expect(isBaseMessageData({ reasoning_text: 'test' })).toBe(true);
            expect(isBaseMessageData({})).toBe(true);
        });

        it('isBaseMessageData rejects workflow data', () => {
            const workflowData = createMockWorkflowData();
            expect(isBaseMessageData(workflowData)).toBe(false);
        });
    });

    describe('deriveStartNodeId utility', () => {
        it('returns resumeState.startNodeId if available', () => {
            const result = deriveStartNodeId({
                resumeState: { startNodeId: 'resume-node', nodeOutputs: {}, executionOrder: [] },
                failedNodeId: 'failed-node',
                currentNodeId: 'current-node',
            });

            expect(result).toBe('resume-node');
        });

        it('falls back to failedNodeId', () => {
            const result = deriveStartNodeId({
                failedNodeId: 'failed-node',
                currentNodeId: 'current-node',
            });

            expect(result).toBe('failed-node');
        });

        it('falls back to currentNodeId', () => {
            const result = deriveStartNodeId({
                currentNodeId: 'current-node',
                lastActiveNodeId: 'last-active',
            });

            expect(result).toBe('current-node');
        });

        it('falls back to active node from nodeStates', () => {
            const result = deriveStartNodeId({
                nodeStates: {
                    'completed-node': createMockNodeState({ status: 'completed' }),
                    'active-node': createMockNodeState({ status: 'active' }),
                },
                lastActiveNodeId: 'last-active',
            });

            expect(result).toBe('active-node');
        });

        it('falls back to lastActiveNodeId', () => {
            const result = deriveStartNodeId({
                nodeStates: {
                    'completed-node': createMockNodeState({ status: 'completed' }),
                },
                lastActiveNodeId: 'last-active',
            });

            expect(result).toBe('last-active');
        });

        it('returns undefined when no suitable node found', () => {
            const result = deriveStartNodeId({});
            expect(result).toBeUndefined();
        });
    });

    describe('edge cases for loading', () => {
        it('handles malformed workflow data gracefully', () => {
            // Missing required fields
            const partialData = {
                type: 'workflow-execution',
                workflowId: 'wf-1',
                // Missing other required fields
            };

            expect(isWorkflowMessageData(partialData)).toBe(true);
        });

        it('handles null branches in workflow state', () => {
            const workflowData = createMockWorkflowData({
                branches: undefined,
            });

            const dbMessage = createMockDbMessage({ data: workflowData });
            const uiMessage = ensureUiMessage(dbMessage as any);

            expect(uiMessage.workflowState!.branches).toBeUndefined();
        });

        it('handles null node states values', () => {
            const workflowData = createMockWorkflowData({
                nodeStates: {
                    'node-1': createMockNodeState({
                        streamingText: undefined,
                        error: undefined,
                        startedAt: undefined,
                        finishedAt: undefined,
                    }),
                },
            });

            const dbMessage = createMockDbMessage({ data: workflowData });
            const uiMessage = ensureUiMessage(dbMessage as any);

            expect(uiMessage.workflowState!.nodeStates['node-1']).toBeDefined();
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 8.3: Real-time Updates Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 8.3: Real-time Updates', () => {
    let accumulator: WorkflowStreamAccumulatorApi;

    beforeEach(() => {
        vi.useFakeTimers();
        accumulator = createWorkflowStreamAccumulator();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('version counter reactivity', () => {
        it('increments version on nodeStart', () => {
            const initialVersion = accumulator.state.version;
            accumulator.nodeStart('node-1', 'Node', 'agent');
            expect(accumulator.state.version).toBe(initialVersion + 1);
        });

        it('increments version on nodeFinish', () => {
            accumulator.nodeStart('node-1', 'Node', 'agent');
            const version = accumulator.state.version;
            accumulator.nodeFinish('node-1', 'Done');
            expect(accumulator.state.version).toBe(version + 1);
        });

        it('increments version on nodeError', () => {
            accumulator.nodeStart('node-1', 'Node', 'agent');
            const version = accumulator.state.version;
            accumulator.nodeError('node-1', new Error('Failed'));
            expect(accumulator.state.version).toBe(version + 1);
        });

        it('increments version on branchStart', () => {
            accumulator.nodeStart('parallel-1', 'Parallel', 'parallel');
            const version = accumulator.state.version;
            accumulator.branchStart('parallel-1', 'branch-a', 'A');
            expect(accumulator.state.version).toBe(version + 1);
        });

        it('increments version on branchComplete', () => {
            accumulator.nodeStart('parallel-1', 'Parallel', 'parallel');
            accumulator.branchStart('parallel-1', 'branch-a', 'A');
            const version = accumulator.state.version;
            accumulator.branchComplete('parallel-1', 'branch-a', 'Done');
            expect(accumulator.state.version).toBe(version + 1);
        });

        it('increments version on finalize', () => {
            const version = accumulator.state.version;
            accumulator.finalize({ result: { success: true } });
            expect(accumulator.state.version).toBe(version + 1);
        });

        it('increments version on reset', () => {
            accumulator.nodeStart('node-1', 'Node', 'agent');
            accumulator.finalize({ result: { success: true } });
            const version = accumulator.state.version;
            accumulator.reset();
            expect(accumulator.state.version).toBe(version + 1);
        });

        it('increments version on routeSelected', () => {
            accumulator.nodeStart('router-1', 'Router', 'router');
            const version = accumulator.state.version;
            accumulator.routeSelected('router-1', 'path-a');
            expect(accumulator.state.version).toBe(version + 1);
        });

        it('increments version on tokenUsage', () => {
            accumulator.nodeStart('node-1', 'Node', 'agent');
            const version = accumulator.state.version;
            accumulator.tokenUsage('node-1', { totalTokens: 100 });
            expect(accumulator.state.version).toBe(version + 1);
        });
    });

    describe('RAF batching for tokens', () => {
        it('batches multiple nodeToken calls', async () => {
            accumulator.nodeStart('node-1', 'Node', 'agent');

            // Add multiple tokens rapidly
            accumulator.nodeToken('node-1', 'Hello');
            accumulator.nodeToken('node-1', ' ');
            accumulator.nodeToken('node-1', 'World');

            // Tokens should be pending, not yet applied
            expect(accumulator.state.nodeStates['node-1']!.streamingText).toBe('');

            // Flush RAF
            await flushRAF(vi);

            // Now tokens should be applied
            expect(accumulator.state.nodeStates['node-1']!.streamingText).toBe('Hello World');
        });

        it('batches multiple branchToken calls', async () => {
            accumulator.nodeStart('parallel-1', 'Parallel', 'parallel');
            accumulator.branchStart('parallel-1', 'branch-a', 'A');

            accumulator.branchToken('parallel-1', 'branch-a', 'A', 'Token1');
            accumulator.branchToken('parallel-1', 'branch-a', 'A', 'Token2');

            expect(accumulator.state.branches['parallel-1:branch-a']!.streamingText).toBe('');

            await flushRAF(vi);

            expect(accumulator.state.branches['parallel-1:branch-a']!.streamingText).toBe('Token1Token2');
        });

        it('flushes pending tokens on nodeFinish', async () => {
            accumulator.nodeStart('node-1', 'Node', 'agent');
            accumulator.nodeToken('node-1', 'Pending');

            // Finish should flush
            accumulator.nodeFinish('node-1', 'Final');

            // Tokens should be flushed immediately
            expect(accumulator.state.nodeStates['node-1']!.output).toBe('Final');
            // streamingText should be cleared on finish
            expect(accumulator.state.nodeStates['node-1']!.streamingText).toBeUndefined();
        });

        it('flushes pending tokens on finalize', async () => {
            accumulator.nodeStart('node-1', 'Node', 'agent');
            accumulator.nodeToken('node-1', 'Pending');

            accumulator.finalize({ result: { success: true } });

            // Should have flushed before finalizing
            // Version should have incremented from flush + finalize
            expect(accumulator.state.isActive).toBe(false);
        });

        it('handles empty token gracefully', async () => {
            accumulator.nodeStart('node-1', 'Node', 'agent');
            accumulator.nodeToken('node-1', '');
            accumulator.nodeToken('node-1', '');

            await flushRAF(vi);

            expect(accumulator.state.nodeStates['node-1']!.streamingText).toBe('');
        });

        it('handles high-frequency token stream', async () => {
            accumulator.nodeStart('node-1', 'Node', 'agent');

            // Simulate rapid token stream (100 tokens)
            for (let i = 0; i < 100; i++) {
                accumulator.nodeToken('node-1', `t${i}`);
            }

            // Should still be pending
            expect(accumulator.state.nodeStates['node-1']!.streamingText).toBe('');

            await flushRAF(vi);

            // All tokens should be concatenated
            const expected = Array.from({ length: 100 }, (_, i) => `t${i}`).join('');
            expect(accumulator.state.nodeStates['node-1']!.streamingText).toBe(expected);
        });
    });

    describe('workflowToken streaming', () => {
        it('updates finalOutput immediately (not batched)', () => {
            accumulator.workflowToken('Hello');
            accumulator.workflowToken(' World');

            // workflowToken updates immediately
            expect(accumulator.state.finalOutput).toBe('Hello World');
            expect(accumulator.state.finalStreamingText).toBe('Hello World');
        });

        it('preserves workflow tokens after finalize', () => {
            accumulator.workflowToken('Streamed content');
            accumulator.finalize({ result: { success: true } });

            expect(accumulator.state.finalOutput).toBe('Streamed content');
        });

        it('prefers result.finalOutput over streaming text', () => {
            accumulator.workflowToken('Partial');
            accumulator.finalize({
                result: { success: true, finalOutput: 'Complete output' },
            });

            expect(accumulator.state.finalOutput).toBe('Complete output');
        });
    });

    describe('state transitions', () => {
        it('transitions from running to completed', () => {
            expect(accumulator.state.executionState).toBe('running');
            expect(accumulator.state.isActive).toBe(true);

            accumulator.finalize({ result: { success: true } });

            expect(accumulator.state.executionState).toBe('completed');
            expect(accumulator.state.isActive).toBe(false);
        });

        it('transitions from running to error', () => {
            accumulator.nodeStart('node-1', 'Node', 'agent');
            accumulator.nodeError('node-1', new Error('Failed'));

            expect(accumulator.state.executionState).toBe('error');
            expect(accumulator.state.failedNodeId).toBe('node-1');
            expect(accumulator.state.currentNodeId).toBe('node-1');
        });

        it('transitions from running to stopped', () => {
            accumulator.nodeStart('node-1', 'Node', 'agent');
            accumulator.finalize({ stopped: true });

            expect(accumulator.state.executionState).toBe('interrupted');
            expect(accumulator.state.isActive).toBe(false);
        });

        it('resets state correctly', () => {
            accumulator.nodeStart('node-1', 'Node', 'agent');
            accumulator.nodeFinish('node-1', 'Done');
            accumulator.finalize({ result: { success: true } });

            accumulator.reset();

            expect(accumulator.state.executionState).toBe('running');
            expect(accumulator.state.isActive).toBe(true);
            expect(accumulator.state.nodeStates).toEqual({});
            expect(accumulator.state.executionOrder).toEqual([]);
            expect(accumulator.state.branches).toEqual({});
            expect(accumulator.state.finalOutput).toBe('');
            expect(accumulator.state.error).toBeNull();
            expect(accumulator.state.failedNodeId).toBeNull();
        });
    });

    describe('ignoring updates after finalize', () => {
        it('ignores nodeStart after finalize', () => {
            accumulator.finalize({ result: { success: true } });
            accumulator.nodeStart('node-1', 'Node', 'agent');

            expect(accumulator.state.nodeStates['node-1']).toBeUndefined();
        });

        it('ignores nodeToken after finalize', async () => {
            accumulator.nodeStart('node-1', 'Node', 'agent');
            const streamingBefore = accumulator.state.nodeStates['node-1']!.streamingText;
            accumulator.finalize({ result: { success: true } });
            accumulator.nodeToken('node-1', 'Ignored');

            await flushRAF(vi);

            // Should not have added streaming text - value should remain unchanged from before finalize
            expect(accumulator.state.nodeStates['node-1']!.streamingText).toBe(streamingBefore);
        });

        it('ignores nodeFinish after finalize', () => {
            accumulator.nodeStart('node-1', 'Node', 'agent');
            accumulator.finalize({ result: { success: true } });
            const version = accumulator.state.version;
            accumulator.nodeFinish('node-1', 'Ignored');

            // Version should not increment
            expect(accumulator.state.version).toBe(version);
        });

        it('merges late-arriving result data after finalize', () => {
            accumulator.nodeStart('node-1', 'Node', 'agent');
            accumulator.nodeFinish('node-1', 'Done');
            accumulator.finalize({ result: { success: true } });

            const sessionMessages = [{ role: 'user' as const, content: 'Late message' }];
            accumulator.finalize({
                result: {
                    success: true,
                    sessionMessages,
                },
            });

            expect(accumulator.state.sessionMessages).toEqual(sessionMessages);
        });
    });

    describe('concurrent branch updates', () => {
        it('handles multiple branches streaming simultaneously', async () => {
            accumulator.nodeStart('parallel-1', 'Parallel', 'parallel');
            accumulator.branchStart('parallel-1', 'branch-a', 'A');
            accumulator.branchStart('parallel-1', 'branch-b', 'B');
            accumulator.branchStart('parallel-1', 'branch-c', 'C');

            // Interleaved token streams
            accumulator.branchToken('parallel-1', 'branch-a', 'A', 'A1');
            accumulator.branchToken('parallel-1', 'branch-b', 'B', 'B1');
            accumulator.branchToken('parallel-1', 'branch-c', 'C', 'C1');
            accumulator.branchToken('parallel-1', 'branch-a', 'A', 'A2');
            accumulator.branchToken('parallel-1', 'branch-b', 'B', 'B2');

            await flushRAF(vi);

            expect(accumulator.state.branches['parallel-1:branch-a']!.streamingText).toBe('A1A2');
            expect(accumulator.state.branches['parallel-1:branch-b']!.streamingText).toBe('B1B2');
            expect(accumulator.state.branches['parallel-1:branch-c']!.streamingText).toBe('C1');
        });

        it('tracks branch completion independently', () => {
            accumulator.nodeStart('parallel-1', 'Parallel', 'parallel');
            accumulator.branchStart('parallel-1', 'branch-a', 'A');
            accumulator.branchStart('parallel-1', 'branch-b', 'B');

            accumulator.branchComplete('parallel-1', 'branch-a', 'Result A');

            expect(accumulator.state.branches['parallel-1:branch-a']!.status).toBe('completed');
            expect(accumulator.state.branches['parallel-1:branch-b']!.status).toBe('active');
        });
    });

    describe('currentNodeId tracking', () => {
        it('updates currentNodeId on nodeStart', () => {
            expect(accumulator.state.currentNodeId).toBeNull();
            accumulator.nodeStart('node-1', 'Node', 'agent');
            expect(accumulator.state.currentNodeId).toBe('node-1');
        });

        it('clears currentNodeId on nodeFinish', () => {
            accumulator.nodeStart('node-1', 'Node', 'agent');
            accumulator.nodeFinish('node-1', 'Done');
            expect(accumulator.state.currentNodeId).toBeNull();
        });

        it('updates currentNodeId to error node on error', () => {
            accumulator.nodeStart('node-1', 'Node', 'agent');
            accumulator.nodeError('node-1', new Error('Failed'));
            expect(accumulator.state.currentNodeId).toBe('node-1');
        });

        it('tracks node transitions correctly', () => {
            accumulator.nodeStart('node-1', 'First', 'agent');
            expect(accumulator.state.currentNodeId).toBe('node-1');

            accumulator.nodeFinish('node-1', 'Done');
            expect(accumulator.state.currentNodeId).toBeNull();

            accumulator.nodeStart('node-2', 'Second', 'agent');
            expect(accumulator.state.currentNodeId).toBe('node-2');
        });
    });

    describe('lastActiveNodeId tracking', () => {
        it('updates lastActiveNodeId on nodeStart', () => {
            accumulator.nodeStart('node-1', 'Node', 'agent');
            expect(accumulator.state.lastActiveNodeId).toBe('node-1');
        });

        it('updates lastActiveNodeId on nodeFinish', () => {
            accumulator.nodeStart('node-1', 'First', 'agent');
            accumulator.nodeFinish('node-1', 'Done');
            accumulator.nodeStart('node-2', 'Second', 'agent');

            expect(accumulator.state.lastActiveNodeId).toBe('node-2');

            accumulator.nodeFinish('node-2', 'Done');
            expect(accumulator.state.lastActiveNodeId).toBe('node-2');
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional Edge Cases and Robustness Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Edge Cases and Robustness', () => {
    let accumulator: WorkflowStreamAccumulatorApi;

    beforeEach(() => {
        vi.useFakeTimers();
        accumulator = createWorkflowStreamAccumulator();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('unknown node references', () => {
        it('handles nodeToken for non-existent node', async () => {
            // Don't call nodeStart first
            accumulator.nodeToken('unknown-node', 'Token');

            await flushRAF(vi);

            // Should not crash, node should not exist
            expect(accumulator.state.nodeStates['unknown-node']).toBeUndefined();
        });

        it('handles nodeFinish for non-existent node', () => {
            accumulator.nodeFinish('unknown-node', 'Output');

            // Should not crash
            expect(accumulator.state.nodeStates['unknown-node']).toBeUndefined();
        });

        it('handles branchToken for non-existent branch', async () => {
            accumulator.branchToken('node-1', 'unknown-branch', 'Label', 'Token');

            await flushRAF(vi);

            // Should not crash
            expect(accumulator.state.branches['node-1:unknown-branch']).toBeUndefined();
        });

        it('handles branchComplete for non-existent branch', () => {
            accumulator.branchComplete('node-1', 'unknown-branch', 'Output');

            // Should not crash
            expect(accumulator.state.branches['node-1:unknown-branch']).toBeUndefined();
        });

        it('handles tokenUsage for non-existent node', () => {
            const version = accumulator.state.version;
            accumulator.tokenUsage('unknown-node', { totalTokens: 100 });

            // Should not crash, version should not change
            expect(accumulator.state.version).toBe(version);
        });

        it('handles routeSelected for non-existent node', () => {
            const version = accumulator.state.version;
            accumulator.routeSelected('unknown-node', 'route');

            // Should not crash, version should not change
            expect(accumulator.state.version).toBe(version);
        });
    });

    describe('error message handling', () => {
        it('handles Error with empty message', () => {
            accumulator.nodeStart('node-1', 'Node', 'agent');
            accumulator.nodeError('node-1', new Error(''));

            expect(accumulator.state.nodeStates['node-1']!.error).toBe('');
        });

        it('handles Error with very long message', () => {
            const longMessage = 'x'.repeat(10000);
            accumulator.nodeStart('node-1', 'Node', 'agent');
            accumulator.nodeError('node-1', new Error(longMessage));

            expect(accumulator.state.nodeStates['node-1']!.error).toBe(longMessage);
        });
    });

    describe('memory and cleanup', () => {
        it('clears streaming buffers on node finish', () => {
            accumulator.nodeStart('node-1', 'Node', 'agent');
            accumulator.nodeToken('node-1', 'Streaming content');
            vi.runAllTimers();

            accumulator.nodeFinish('node-1', 'Final');

            expect(accumulator.state.nodeStates['node-1']!.streamingText).toBeUndefined();
            expect(accumulator.state.nodeStates['node-1']!.output).toBe('Final');
        });

        it('clears streaming buffers on branch complete', () => {
            accumulator.nodeStart('parallel-1', 'Parallel', 'parallel');
            accumulator.branchStart('parallel-1', 'branch-a', 'A');
            accumulator.branchToken('parallel-1', 'branch-a', 'A', 'Streaming');
            vi.runAllTimers();

            accumulator.branchComplete('parallel-1', 'branch-a', 'Final');

            expect(accumulator.state.branches['parallel-1:branch-a']!.streamingText).toBeUndefined();
            expect(accumulator.state.branches['parallel-1:branch-a']!.output).toBe('Final');
        });

        it('reset clears all state including pending tokens', async () => {
            accumulator.nodeStart('node-1', 'Node', 'agent');
            accumulator.nodeToken('node-1', 'Pending token');

            accumulator.reset();

            await flushRAF(vi);

            expect(accumulator.state.nodeStates).toEqual({});
        });
    });

    describe('timestamp handling', () => {
        it('records startedAt on nodeStart', () => {
            const now = Date.now();
            vi.setSystemTime(now);

            accumulator.nodeStart('node-1', 'Node', 'agent');

            expect(accumulator.state.nodeStates['node-1']!.startedAt).toBe(now);
        });

        it('records finishedAt on nodeFinish', () => {
            const start = Date.now();
            vi.setSystemTime(start);
            accumulator.nodeStart('node-1', 'Node', 'agent');

            const end = start + 1000;
            vi.setSystemTime(end);
            accumulator.nodeFinish('node-1', 'Done');

            expect(accumulator.state.nodeStates['node-1']!.finishedAt).toBe(end);
        });

        it('records finishedAt on nodeError', () => {
            const now = Date.now();
            vi.setSystemTime(now);

            accumulator.nodeStart('node-1', 'Node', 'agent');
            accumulator.nodeError('node-1', new Error('Failed'));

            expect(accumulator.state.nodeStates['node-1']!.finishedAt).toBe(now);
        });
    });

    describe('token count estimation', () => {
        it('estimates token count from token stream', async () => {
            accumulator.nodeStart('node-1', 'Node', 'agent');
            accumulator.nodeToken('node-1', 'word1');
            accumulator.nodeToken('node-1', 'word2');
            accumulator.nodeToken('node-1', 'word3');

            await flushRAF(vi);

            // Token count should reflect number of tokens added
            expect(accumulator.state.nodeStates['node-1']!.tokenCount).toBe(3);
        });

        it('adds to token count from tokenUsage', () => {
            accumulator.nodeStart('node-1', 'Node', 'agent');
            accumulator.tokenUsage('node-1', { totalTokens: 100 });

            expect(accumulator.state.nodeStates['node-1']!.tokenCount).toBe(100);
        });

        it('accumulates token counts', () => {
            accumulator.nodeStart('node-1', 'Node', 'agent');
            accumulator.tokenUsage('node-1', { totalTokens: 50 });
            accumulator.tokenUsage('node-1', { totalTokens: 50 });

            expect(accumulator.state.nodeStates['node-1']!.tokenCount).toBe(100);
        });
    });

    describe('Vue reactivity integration', () => {
        it('state is reactive (can be watched)', async () => {
            const changes: number[] = [];

            watch(
                () => accumulator.state.version,
                (newVersion) => {
                    changes.push(newVersion);
                },
                { immediate: false }
            );

            accumulator.nodeStart('node-1', 'Node', 'agent');
            await nextTick();

            accumulator.nodeFinish('node-1', 'Done');
            await nextTick();

            expect(changes.length).toBeGreaterThan(0);
        });

        it('nested state changes are reactive', async () => {
            const nodeLabels: string[] = [];

            watch(
                () => Object.values(accumulator.state.nodeStates).map((n) => n.label),
                (labels) => {
                    nodeLabels.push(...labels);
                },
                { deep: true }
            );

            accumulator.nodeStart('node-1', 'First', 'agent');
            await nextTick();

            accumulator.nodeStart('node-2', 'Second', 'agent');
            await nextTick();

            expect(nodeLabels).toContain('First');
            expect(nodeLabels).toContain('Second');
        });
    });

    describe('finalOutput derivation', () => {
        it('uses result.finalOutput when provided', () => {
            accumulator.nodeStart('node-1', 'Node', 'agent');
            accumulator.nodeFinish('node-1', 'Node output');
            accumulator.finalize({
                result: { success: true, finalOutput: 'Result output' },
            });

            expect(accumulator.state.finalOutput).toBe('Result output');
        });

        it('falls back to finalStreamingText when no result.finalOutput', () => {
            accumulator.workflowToken('Streaming');
            accumulator.workflowToken(' output');
            accumulator.finalize({ result: { success: true } });

            expect(accumulator.state.finalOutput).toBe('Streaming output');
        });

        it('falls back to last node output when no streaming', () => {
            accumulator.nodeStart('node-1', 'First', 'agent');
            accumulator.nodeFinish('node-1', 'Output 1');
            accumulator.nodeStart('node-2', 'Second', 'agent');
            accumulator.nodeFinish('node-2', 'Output 2');
            accumulator.finalize({
                result: { success: true, executionOrder: ['node-1', 'node-2'] },
            });

            expect(accumulator.state.finalOutput).toBe('Output 2');
        });

        it('uses empty string when no output available', () => {
            accumulator.finalize({ result: { success: true } });

            expect(accumulator.state.finalOutput).toBe('');
        });
    });

    describe('reasoning tokens', () => {
        it('handles nodeReasoning like nodeToken', async () => {
            accumulator.nodeStart('node-1', 'Node', 'agent');
            accumulator.nodeReasoning('node-1', 'Thinking...');

            await flushRAF(vi);

            expect(accumulator.state.nodeStates['node-1']!.streamingText).toBe('Thinking...');
        });

        it('handles branchReasoning like branchToken', async () => {
            accumulator.nodeStart('parallel-1', 'Parallel', 'parallel');
            accumulator.branchStart('parallel-1', 'branch-a', 'A');
            accumulator.branchReasoning('parallel-1', 'branch-a', 'A', 'Reasoning...');

            await flushRAF(vi);

            expect(accumulator.state.branches['parallel-1:branch-a']!.streamingText).toBe('Reasoning...');
        });
    });
});
