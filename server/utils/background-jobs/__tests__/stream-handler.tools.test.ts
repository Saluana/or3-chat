import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundJobProvider, BackgroundJob } from '../types';
import {
    consumeBackgroundStreamWithTools,
} from '../stream-handler';
import {
    registerServerTool,
    unregisterServerTool,
} from '../../chat/tool-registry';
import type { ToolDefinition } from '~/utils/chat/types';

function makeSseStream(chunks: unknown[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    const payload =
        chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') +
        'data: [DONE]\n\n';
    return new ReadableStream({
        start(controller) {
            controller.enqueue(encoder.encode(payload));
            controller.close();
        },
    });
}

function makeToolCallResponse(): Response {
    return new Response(
        makeSseStream([
            {
                choices: [
                    {
                        delta: {
                            tool_calls: [
                                {
                                    index: 0,
                                    id: 'call-1',
                                    function: {
                                        name: 'server_echo',
                                        arguments: '{"value":"ok"}',
                                    },
                                },
                            ],
                        },
                        finish_reason: 'tool_calls',
                    },
                ],
            },
        ])
    );
}

function makeTextResponse(text: string): Response {
    return new Response(
        makeSseStream([
            {
                choices: [
                    {
                        delta: {
                            content: text,
                        },
                    },
                ],
            },
        ])
    );
}

function createProvider(statusRef: { status: BackgroundJob['status'] }) {
    const updateJob = vi.fn(async () => {});
    const completeJob = vi.fn(async () => {
        statusRef.status = 'complete';
    });

    const provider: BackgroundJobProvider = {
        name: 'memory',
        async createJob() {
            return 'job-1';
        },
        async getJob() {
            return {
                id: 'job-1',
                userId: 'user-1',
                threadId: 'thread-1',
                messageId: 'msg-1',
                model: 'test-model',
                status: statusRef.status,
                content: '',
                chunksReceived: 0,
                startedAt: Date.now(),
            };
        },
        updateJob,
        completeJob,
        async failJob() {},
        async abortJob() {
            return false;
        },
        async cleanupExpired() {
            return 0;
        },
    };

    return { provider, updateJob, completeJob };
}

const toolDef: ToolDefinition = {
    type: 'function',
    function: {
        name: 'server_echo',
        description: 'Echo value',
        parameters: {
            type: 'object',
            properties: {
                value: { type: 'string' },
            },
            required: ['value'],
        },
    },
    runtime: 'hybrid',
};

describe('consumeBackgroundStreamWithTools', () => {
    beforeEach(() => {
        registerServerTool(
            toolDef,
            ({ value }: { value: string }) => value,
            { override: true }
        );
    });

    afterEach(() => {
        unregisterServerTool('server_echo');
        vi.unstubAllGlobals();
    });

    it('executes registered server tools and completes with follow-up text', async () => {
        const statusRef = { status: 'streaming' as const };
        const { provider, updateJob, completeJob } = createProvider(statusRef);
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(makeToolCallResponse())
            .mockResolvedValueOnce(makeTextResponse('final answer'));
        vi.stubGlobal('fetch', fetchMock);

        await consumeBackgroundStreamWithTools({
            jobId: 'job-1',
            body: {
                model: 'test-model',
                messages: [],
                tools: [toolDef],
            },
            apiKey: 'key',
            referer: 'http://localhost:3000',
            provider,
            context: {
                body: {},
                apiKey: 'key',
                userId: 'user-1',
                workspaceId: 'ws-1',
                threadId: 'thread-1',
                messageId: 'msg-1',
                referer: 'http://localhost:3000',
            },
        });

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(completeJob).toHaveBeenCalledWith('job-1', 'final answer');
        const hasToolCallUpdate = (
            updateJob.mock.calls as Array<unknown[]>
        ).some((call) => {
            const update = call[1] as { tool_calls?: unknown[] } | undefined;
            return Array.isArray(update?.tool_calls);
        });
        expect(hasToolCallUpdate).toBe(true);
    });

    it('does not complete when job status is already aborted', async () => {
        const statusRef = { status: 'aborted' as const };
        const { provider, completeJob } = createProvider(statusRef);
        const fetchMock = vi.fn().mockResolvedValue(makeTextResponse('partial'));
        vi.stubGlobal('fetch', fetchMock);

        await consumeBackgroundStreamWithTools({
            jobId: 'job-1',
            body: {
                model: 'test-model',
                messages: [],
                tools: [toolDef],
            },
            apiKey: 'key',
            referer: 'http://localhost:3000',
            provider,
            context: {
                body: {},
                apiKey: 'key',
                userId: 'user-1',
                workspaceId: 'ws-1',
                threadId: 'thread-1',
                messageId: 'msg-1',
                referer: 'http://localhost:3000',
            },
        });

        expect(completeJob).not.toHaveBeenCalled();
    });

    it('throws when tool loop exceeds max iterations', async () => {
        const statusRef = { status: 'streaming' as const };
        const { provider, completeJob } = createProvider(statusRef);
        const fetchMock = vi.fn().mockImplementation(() => makeToolCallResponse());
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            consumeBackgroundStreamWithTools({
                jobId: 'job-1',
                body: {
                    model: 'test-model',
                    messages: [],
                    tools: [toolDef],
                },
                apiKey: 'key',
                referer: 'http://localhost:3000',
                provider,
                context: {
                    body: {},
                    apiKey: 'key',
                    userId: 'user-1',
                    workspaceId: 'ws-1',
                    threadId: 'thread-1',
                    messageId: 'msg-1',
                    referer: 'http://localhost:3000',
                },
            })
        ).rejects.toThrow('max iterations');

        expect(completeJob).not.toHaveBeenCalled();
    });
});
