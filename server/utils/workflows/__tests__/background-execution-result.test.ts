import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionResult } from 'or3-workflow-core';
import type { BackgroundJobProvider } from '../../background-jobs/types';
import {
    assertBackgroundWorkflowSucceeded,
    executeWorkflowToolCall,
    listWorkflowEligibleServerTools,
    monitorBackgroundWorkflowAbort,
} from '../background-execution';
import {
    registerServerTool,
    unregisterServerTool,
} from '../../chat/tool-registry';

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
    afterEach(() => {
        unregisterServerTool('workflow_explicit_test');
        unregisterServerTool('workflow_implicit_test');
        unregisterServerTool('workflow_context_test');
        vi.useRealTimers();
    });

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

    it('stops execution when the in-process provider aborts', () => {
        const controller = new AbortController();
        const stop = vi.fn();
        const cleanup = monitorBackgroundWorkflowAbort(
            {
                getAbortController: () => controller,
            } as unknown as BackgroundJobProvider,
            'job-1',
            stop
        );

        controller.abort();

        expect(stop).toHaveBeenCalledTimes(1);
        cleanup();
    });

    it('polls durable providers for abort state', async () => {
        vi.useFakeTimers();
        const stop = vi.fn();
        const checkJobAborted = vi.fn().mockResolvedValue(true);
        const cleanup = monitorBackgroundWorkflowAbort(
            { checkJobAborted } as unknown as BackgroundJobProvider,
            'job-1',
            stop
        );

        await vi.advanceTimersByTimeAsync(250);

        expect(checkJobAborted).toHaveBeenCalledWith('job-1');
        expect(stop).toHaveBeenCalledTimes(1);
        cleanup();
    });

    it('exposes only tools that explicitly opt into workflow execution', () => {
        registerServerTool(
            {
                type: 'function',
                function: {
                    name: 'workflow_implicit_test',
                    description: 'Implicit',
                    parameters: { type: 'object', properties: {} },
                },
            },
            async () => 'implicit'
        );
        registerServerTool(
            {
                type: 'function',
                function: {
                    name: 'workflow_explicit_test',
                    description: 'Explicit',
                    parameters: { type: 'object', properties: {} },
                },
            },
            async () => 'explicit',
            {
                workflowPolicy: {
                    sideEffect: 'none',
                    approval: 'never',
                    parallelSafe: true,
                },
            }
        );

        const names = listWorkflowEligibleServerTools().map(
            (tool) => tool.definition.function.name
        );
        expect(names).toContain('workflow_explicit_test');
        expect(names).not.toContain('workflow_implicit_test');
    });

    it('passes workflow user and workspace authority to tool handlers', async () => {
        const seen = vi.fn();
        registerServerTool(
            {
                type: 'function',
                function: {
                    name: 'workflow_context_test',
                    description: 'Context',
                    parameters: { type: 'object', properties: {} },
                },
            },
            async (_args, context) => {
                seen(context);
                return 'ok';
            },
            {
                workflowPolicy: {
                    sideEffect: 'none',
                    approval: 'never',
                    parallelSafe: true,
                },
            }
        );
        const abortController = new AbortController();

        await expect(
            executeWorkflowToolCall('workflow_context_test', {}, {
                jobId: 'job-1',
                workflowId: 'workflow-1',
                userId: 'user-1',
                workspaceId: 'ws-1',
                threadId: 'thread-1',
                messageId: 'message-1',
                abortSignal: abortController.signal,
            })
        ).resolves.toBe('ok');
        expect(seen).toHaveBeenCalledWith(
            expect.objectContaining({
                subject: 'user-1',
                workspaceId: 'ws-1',
                threadId: 'thread-1',
                messageId: 'message-1',
                abortSignal: expect.any(AbortSignal),
            })
        );
    });
});
