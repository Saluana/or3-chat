import { describe, expect, it, vi } from 'vitest';
import type { WorkflowMessageData } from '~/utils/chat/workflow-types';
import {
    createWorkflowActivitySource,
    WORKFLOW_ACTIVITY_SOURCE_ID,
    workflowActivityStatus,
    type WorkflowActivityMessage,
} from '../adapters/workflow';

function state(
    overrides: Partial<WorkflowMessageData> = {}
): WorkflowMessageData {
    return {
        type: 'workflow-execution',
        workflowId: 'wf-1',
        workflowName: 'Research',
        prompt: 'Research this',
        executionState: 'running',
        nodeStates: {},
        executionOrder: [],
        currentNodeId: null,
        finalOutput: '',
        version: 1,
        ...overrides,
    };
}

function message(
    data = state()
): WorkflowActivityMessage {
    return {
        id: 'message-1',
        threadId: 'thread-1',
        createdAt: 1_753_610_400,
        updatedAt: 1_753_614_000,
        data,
    };
}

describe('workflow Activity adapter', () => {
    it('normalizes workflow and approval statuses', () => {
        expect(workflowActivityStatus(state())).toBe('running');
        expect(
            workflowActivityStatus(
                state({ executionState: 'completed' })
            )
        ).toBe('succeeded');
        expect(
            workflowActivityStatus(
                state({
                    hitlRequests: {
                        approval: {
                            id: 'approval',
                            nodeId: 'node-1',
                            nodeLabel: 'Deploy',
                            mode: 'approval',
                            prompt: 'Proceed?',
                            createdAt: '2026-07-27T10:00:00Z',
                        },
                    },
                })
            )
        ).toBe('waiting_approval');
    });

    it('lists canonical messages without copying them', async () => {
        const canonical = message();
        const source = createWorkflowActivitySource({
            store: {
                async list() {
                    return [canonical];
                },
                async get() {
                    return canonical;
                },
            },
            actions: { cancel: vi.fn(() => true) },
        });
        const result = await source.listRuns({});
        expect(result).toMatchObject({
            ok: true,
            value: [
                {
                    id: 'message-1',
                    sourceId: WORKFLOW_ACTIVITY_SOURCE_ID,
                    status: 'running',
                    actions: ['cancel'],
                },
            ],
        });
        expect(canonical.data.executionState).toBe('running');
    });

    it('builds status, node, tool, approval and error detail events', async () => {
        const canonical = message(
            state({
                executionState: 'error',
                nodeStates: {
                    node: {
                        status: 'error',
                        label: 'Code',
                        type: 'agent',
                        output: '',
                        error: 'boom',
                        toolCalls: [
                            {
                                id: 'tool-1',
                                name: 'exec',
                                status: 'error',
                                error: 'denied',
                            },
                        ],
                    },
                },
                hitlRequests: {
                    approval: {
                        id: 'approval',
                        nodeId: 'node',
                        nodeLabel: 'Code',
                        mode: 'approval',
                        prompt: 'Proceed?',
                        createdAt: '2026-07-27T10:00:00Z',
                    },
                },
            })
        );
        const source = createWorkflowActivitySource({
            store: {
                async list() {
                    return [canonical];
                },
                async get() {
                    return canonical;
                },
            },
        });
        const result = await source.getRun?.('message-1');
        expect(result?.ok).toBe(true);
        if (!result?.ok) return;
        expect(result.value.events.map((item) => item.type)).toEqual(
            expect.arrayContaining(['status', 'error', 'approval'])
        );
        expect(result.value.error).toBe('boom');
    });

    it('streams normalized state and disposes the hook subscription', async () => {
        const dispose = vi.fn();
        let listener:
            | ((id: string, data: WorkflowMessageData) => void)
            | undefined;
        const onEvent = vi.fn();
        const source = createWorkflowActivitySource({
            store: {
                async list() {
                    return [];
                },
                async get() {
                    return undefined;
                },
            },
            updates: {
                subscribe(next) {
                    listener = next;
                    return dispose;
                },
            },
            now: () => new Date('2026-07-27T10:00:00Z'),
        });
        const unsubscribe = source.subscribe?.({ onEvent });
        listener?.('message-1', state());
        await vi.waitFor(() => expect(onEvent).toHaveBeenCalled());
        unsubscribe?.();
        expect(dispose).toHaveBeenCalledOnce();
    });

    it('dispatches approval and cancel actions through canonical handlers', async () => {
        const canonical = message(
            state({
                hitlRequests: {
                    approval: {
                        id: 'approval',
                        jobId: 'job-1',
                        nodeId: 'node',
                        nodeLabel: 'Code',
                        mode: 'approval',
                        prompt: 'Proceed?',
                        createdAt: '2026-07-27T10:00:00Z',
                    },
                },
            })
        );
        const cancel = vi.fn(() => true);
        const respond = vi.fn(() => true);
        const source = createWorkflowActivitySource({
            store: {
                async list() {
                    return [canonical];
                },
                async get() {
                    return canonical;
                },
            },
            actions: { cancel, respond },
        });
        await source.executeAction?.({
            runId: canonical.id,
            action: 'cancel',
        });
        await source.executeAction?.({
            runId: canonical.id,
            action: 'approve',
            payload: { approvalId: 'approval', jobId: 'job-1' },
        });
        expect(cancel).toHaveBeenCalledWith('message-1');
        expect(respond).toHaveBeenCalledWith(
            'message-1',
            'approval',
            'approve',
            'job-1'
        );
    });
});

