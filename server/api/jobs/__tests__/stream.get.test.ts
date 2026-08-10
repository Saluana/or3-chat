import { describe, it, expect, beforeAll } from 'vitest';
import type { BackgroundJob } from '../../../utils/background-jobs/types';

let streamModule: typeof import('../[id]/stream.get');

const baseJob: BackgroundJob = {
    id: 'job-1',
    userId: 'user-1',
    threadId: 'thread-1',
    messageId: 'msg-1',
    model: 'model-1',
    status: 'streaming',
    content: 'Hello world',
    chunksReceived: 3,
    startedAt: 123,
    tool_calls: [
        {
            id: 'tool-1',
            name: 'test_tool',
            status: 'complete',
            args: '{}',
            result: 'ok',
        },
    ],
    workflow_state: {
        type: 'workflow-execution',
        workflowId: 'wf-1',
        workflowName: 'Workflow 1',
        prompt: 'Run workflow',
        executionState: 'running',
        nodeStates: {},
        executionOrder: [],
        currentNodeId: null,
        finalOutput: '',
        version: 0,
    },
};

beforeAll(async () => {
    const globalAny = globalThis as typeof globalThis & {
        defineEventHandler?: (handler: unknown) => unknown;
    };

    if (!globalAny.defineEventHandler) {
        globalAny.defineEventHandler = (handler) => handler;
    }

    const mod = await import('../[id]/stream.get');
    streamModule = mod;
});

describe('serializeJobStatus', () => {
    it('includes content by default', () => {
        const status = streamModule.serializeJobStatus(baseJob);

        expect(status.content).toBe(baseJob.content);
        expect(status.content_length).toBe(baseJob.content.length);
    });

    it('omits content when includeContent is false', () => {
        const status = streamModule.serializeJobStatus(baseJob, {
            includeContent: false,
            content_delta: '!',
            content_length: baseJob.content.length + 1,
        });

        expect(status.content).toBeUndefined();
        expect(status.content_delta).toBe('!');
        expect(status.content_length).toBe(baseJob.content.length + 1);
    });

    it('passes through tool calls and workflow state', () => {
        const status = streamModule.serializeJobStatus(baseJob);

        expect(status.tool_calls).toEqual(baseJob.tool_calls);
        expect(status.workflow_state).toEqual(baseJob.workflow_state);
    });

    it('marks a recovered full snapshot as a content reset', () => {
        const status = streamModule.serializeJobStatus(
            { ...baseJob, attempts: 2, content: 'checkpoint' },
            { content_reset: true }
        );

        expect(status).toMatchObject({
            attempt: 2,
            content: 'checkpoint',
            content_reset: true,
        });
    });
});

describe('workflow-only progress', () => {
    it('detects a newer workflow state without requiring content growth', () => {
        expect(
            streamModule.hasWorkflowStateAdvanced(4, {
                ...baseJob.workflow_state!,
                version: 5,
            })
        ).toBe(true);
        expect(
            streamModule.hasWorkflowStateAdvanced(5, {
                ...baseJob.workflow_state!,
                version: 5,
            })
        ).toBe(false);
    });
});

describe('SSE viewer queue performance gate', () => {
    it('caps every viewer at 1 MiB and rejects the first overflowing event', () => {
        expect(streamModule.MAX_SSE_VIEWER_QUEUE_BYTES).toBe(1024 * 1024);
        expect(streamModule.hasSseQueueCapacity(1024, 1024)).toBe(true);
        expect(streamModule.hasSseQueueCapacity(1023, 1024)).toBe(false);
        expect(streamModule.hasSseQueueCapacity(null, 1024)).toBe(true);
    });
});
