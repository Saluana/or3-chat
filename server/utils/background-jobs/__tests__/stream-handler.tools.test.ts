import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundJobProvider, BackgroundJob, JobUpdate } from '../types';
import {
    consumeBackgroundStreamWithTools,
} from '../stream-handler';
import {
    registerServerTool,
    unregisterServerTool,
} from '../../chat/tool-registry';
import type { ToolDefinition } from '~/utils/chat/types';
import { toolCallFingerprint } from '~~/shared/chat/tool-ledger';
import { canonicalToolResultData } from '~~/shared/chat/canonical-tool-transcript';
import { toolResultTranscriptData } from '~/utils/chat/transcript';

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

function makeToolCallResponse(name = 'server_echo', args = '{"value":"ok"}'): Response {
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
                                        name,
                                        arguments: args,
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

function makeManyTextResponse(count: number): Response {
    return new Response(makeSseStream(Array.from({ length: count }, () => ({
        choices: [{ delta: { content: 'x' } }],
    }))));
}

function createProvider(
    statusRef: { status: BackgroundJob['status'] },
    initialToolCalls?: BackgroundJob['tool_calls']
) {
    const updateJob = vi.fn(async (_jobId: string, _update: JobUpdate) => {});
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
                tool_calls: initialToolCalls,
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

    it('coalesces 500 provider text updates without losing terminal content', async () => {
        const statusRef = { status: 'streaming' as const };
        const { provider, updateJob, completeJob } = createProvider(statusRef);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeManyTextResponse(500)));

        await consumeBackgroundStreamWithTools({
            jobId: 'job-1',
            body: { model: 'test-model', messages: [], tools: [] },
            apiKey: 'key', referer: 'http://localhost:3000', provider,
            context: {
                body: {}, apiKey: 'key', userId: 'user-1', workspaceId: 'ws-1',
                threadId: 'thread-1', messageId: 'msg-1', referer: 'http://localhost:3000',
            },
        });

        expect(updateJob.mock.calls.length).toBeLessThanOrEqual(10);
        expect(completeJob).toHaveBeenCalledWith('job-1', 'x'.repeat(500));
        const persisted = updateJob.mock.calls
            .map((call) => (call[1] as { contentChunk?: string }).contentChunk ?? '')
            .join('');
        expect(persisted).toBe('x'.repeat(500));
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

        const completedCall = updateJob.mock.calls
            .flatMap((call) => (call[1] as JobUpdate).tool_calls ?? [])
            .find((call) => call.id === 'call-1' && call.status === 'complete');
        expect(completedCall?.transcript).toBeDefined();
        expect(canonicalToolResultData(completedCall!.transcript!)).toEqual(
            toolResultTranscriptData({
                turnId: 'msg-1',
                parentAssistantId: 'msg-1',
                callId: 'call-1',
                toolName: 'server_echo',
                fingerprint: toolCallFingerprint(
                    'server_echo',
                    '{"value":"ok"}'
                ),
                status: 'complete',
                result: 'ok',
            })
        );
    });

    it('never invokes a registered server tool that was not advertised', async () => {
        const privileged = vi.fn(() => 'secret');
        const privilegedDef: ToolDefinition = {
            ...toolDef,
            function: { ...toolDef.function, name: 'privileged_tool' },
            runtime: 'server',
        };
        registerServerTool(privilegedDef, privileged, { override: true });
        const statusRef = { status: 'streaming' as const };
        const { provider, completeJob } = createProvider(statusRef);
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce(makeToolCallResponse('privileged_tool'))
            .mockResolvedValueOnce(makeTextResponse('safe')));

        await consumeBackgroundStreamWithTools({
            jobId: 'job-1',
            body: { model: 'test-model', messages: [], tools: [toolDef] },
            apiKey: 'key',
            referer: 'http://localhost:3000',
            provider,
            context: {
                body: {}, apiKey: 'key', userId: 'user-1', workspaceId: 'ws-1',
                threadId: 'thread-1', messageId: 'msg-1', referer: 'http://localhost:3000',
            },
        });

        expect(privileged).not.toHaveBeenCalled();
        expect(completeJob).toHaveBeenCalledWith('job-1', 'safe');
        unregisterServerTool('privileged_tool');
    });

    it('passes the exact authenticated job context into the admitted handler', async () => {
        let received: unknown;
        registerServerTool(toolDef, (_args, context) => {
            received = context;
            return 'ok';
        }, { override: true });
        const statusRef = { status: 'streaming' as const };
        const { provider } = createProvider(statusRef);
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce(makeToolCallResponse())
            .mockResolvedValueOnce(makeTextResponse('done')));
        const abortController = new AbortController();

        await consumeBackgroundStreamWithTools({
            jobId: 'job-1',
            body: { model: 'test-model', messages: [], tools: [toolDef] },
            apiKey: 'key', referer: 'http://localhost:3000', provider,
            context: {
                body: {}, apiKey: 'key', userId: 'user-1', workspaceId: 'ws-1',
                threadId: 'thread-1', messageId: 'msg-1', referer: 'http://localhost:3000',
            },
            abortSignal: abortController.signal,
        });

        expect(received).toMatchObject({
            subject: 'user-1', workspaceId: 'ws-1', threadId: 'thread-1',
            messageId: 'msg-1', callId: 'call-1', requestId: 'job-1',
            abortSignal: expect.any(AbortSignal),
        });
        expect((received as { abortSignal: AbortSignal }).abortSignal).not.toBe(abortController.signal);
    });

    it('logs only metadata for sensitive tool arguments and results', async () => {
        const secretArgs = '{"value":"hunter2","email":"person@example.com","apiKey":"sk-test-secret"}';
        const secretResult = 'person@example.com sk-result-secret';
        registerServerTool(toolDef, () => secretResult, { override: true });
        const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
        const statusRef = { status: 'streaming' as const };
        const { provider } = createProvider(statusRef);
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce(makeToolCallResponse('server_echo', secretArgs))
            .mockResolvedValueOnce(makeTextResponse('done')));

        await consumeBackgroundStreamWithTools({
            jobId: 'job-1', body: { model: 'test-model', messages: [], tools: [toolDef] },
            apiKey: 'key', referer: 'http://localhost:3000', provider,
            context: {
                body: {}, apiKey: 'key', userId: 'user-1', workspaceId: 'ws-1',
                threadId: 'thread-1', messageId: 'msg-1', referer: 'http://localhost:3000',
            },
        });

        const logs = info.mock.calls.flat().join('\n');
        expect(logs).not.toContain('hunter2');
        expect(logs).not.toContain('person@example.com');
        expect(logs).not.toContain('sk-test-secret');
        expect(logs).not.toContain('sk-result-secret');
        expect(logs).toContain('argumentMetadata');
        expect(logs).toContain('resultMetadata');

        info.mockClear();
        const oversizedMarker = 'OVERSIZED_SECRET_MARKER';
        const oversizedArgs = JSON.stringify({ value: `${oversizedMarker}${'x'.repeat(1_000_000)}` });
        const malformedMarker = 'MALFORMED_SECRET_MARKER';
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce(makeToolCallResponse('server_echo', oversizedArgs))
            .mockResolvedValueOnce(makeTextResponse('done'))
            .mockResolvedValueOnce(makeToolCallResponse('server_echo', `{"value":"${malformedMarker}`))
            .mockResolvedValueOnce(makeTextResponse('done')));
        for (let index = 0; index < 2; index += 1) {
            const nextStatus = { status: 'streaming' as const };
            await consumeBackgroundStreamWithTools({
                jobId: 'job-1', body: { model: 'test-model', messages: [], tools: [toolDef] },
                apiKey: 'key', referer: 'http://localhost:3000', provider: createProvider(nextStatus).provider,
                context: {
                    body: {}, apiKey: 'key', userId: 'user-1', workspaceId: 'ws-1',
                    threadId: 'thread-1', messageId: 'msg-1', referer: 'http://localhost:3000',
                },
            });
        }
        const adversarialLogs = info.mock.calls.flat().join('\n');
        expect(adversarialLogs).not.toContain(oversizedMarker);
        expect(adversarialLogs).not.toContain(malformedMarker);
    });

    it('reuses a persisted completed call and refuses a persisted running call', async () => {
        const handler = vi.fn(() => 'must-not-run');
        registerServerTool(toolDef, handler, { override: true });
        const fingerprint = toolCallFingerprint('server_echo', '{"value":"ok"}');

        for (const persisted of [
            { status: 'complete' as const, result: 'persisted-result' },
            { status: 'loading' as const, result: undefined },
        ]) {
            const statusRef = { status: 'streaming' as const };
            const { provider } = createProvider(statusRef, [{
                id: 'call-1', name: 'server_echo', status: persisted.status,
                args: '{"value":"ok"}', result: persisted.result,
                argument_fingerprint: fingerprint,
            }]);
            vi.stubGlobal('fetch', vi.fn()
                .mockResolvedValueOnce(makeToolCallResponse())
                .mockResolvedValueOnce(makeTextResponse('done')));
            await consumeBackgroundStreamWithTools({
                jobId: 'job-1', body: { model: 'test-model', messages: [], tools: [toolDef] },
                apiKey: 'key', referer: 'http://localhost:3000', provider,
                context: {
                    body: {}, apiKey: 'key', userId: 'user-1', workspaceId: 'ws-1',
                    threadId: 'thread-1', messageId: 'msg-1', referer: 'http://localhost:3000',
                },
            });
        }
        expect(handler).not.toHaveBeenCalled();
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
