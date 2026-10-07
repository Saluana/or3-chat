import { useRuntimeConfig } from '#imports';
import { registerAuthWorkspaceStore } from '../../../auth/store/registry';
import type { AuthWorkspaceStore } from '../../../auth/store/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundJobProvider, BackgroundJob, JobUpdate } from '../types';
import {
    consumeBackgroundStream,
    consumeBackgroundStreamWithTools,
    executeBackgroundJob,
} from '../stream-handler';
import { clearAllJobs, memoryJobProvider } from '../providers/memory';
import { reconcileBackgroundJobHistory } from '../history';
import { registerSyncGatewayAdapter } from '../../../sync/gateway/registry';
import type { SyncGatewayAdapter } from '../../../sync/gateway/types';
import type { CanonicalGenerationSnapshot, ChatGenerationAdmissionEnvelope, CanonicalHistoryActor } from '~~/shared/chat/background-history';
import { captureUsagePrefix } from '~~/shared/chat/request-usage';
import { readRequestUsage } from '~~/shared/chat/compaction';
import { countTokensApprox } from '~/utils/chat/tokens';
import type { ContextRequestEnvelope } from '~~/shared/chat/context-budget';
import {
    registerServerTool,
    unregisterServerTool,
} from '../../chat/tool-registry';
import type { ToolDefinition } from '~/utils/chat/types';
import { toolCallFingerprint } from '~~/shared/chat/tool-ledger';
import { canonicalToolResultData } from '~~/shared/chat/canonical-tool-transcript';
import { toolResultTranscriptData } from '~/utils/chat/transcript';
import {
    registerJobStream,
    resetJobViewersForTests,
    emitJobStatus,
    getJobLiveState,
} from '../viewers';

const contextCatalog = vi.hoisted(() => ({ capacity: 1_000_000, calls: 0 }));
vi.mock('~~/shared/openrouter', async (original) => ({
    ...await original<typeof import('~~/shared/openrouter')>(),
    createOpenRouterClient: () => ({ models: { list: async () => ({
        async *[Symbol.asyncIterator]() {
            contextCatalog.calls++;
            yield { result: { data: [{ id: 'test-model', name: 'Test', contextLength: contextCatalog.capacity,
                architecture: { inputModalities: ['text'], outputModalities: ['text'] },
                topProvider: { contextLength: contextCatalog.capacity, maxCompletionTokens: 4096, isModerated: false },
                pricing: { prompt: '0', completion: '0' }, supportedParameters: ['tools'] }] } };
        },
    }) } }),
}));

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
    const updateJobExecution = vi.fn(async () => true);
    const failJob = vi.fn(async () => {});

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
                reasoning: '',
                chunksReceived: 0,
                startedAt: Date.now(),
                tool_calls: initialToolCalls,
            };
        },
        updateJob,
        completeJob,
        failJob,
        async abortJob() {
            return false;
        },
        async cleanupExpired() {
            return 0;
        },
        updateJobExecution,
    };

    return {
        provider, updateJob, completeJob, updateJobExecution, failJob,
    };
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

const clientToolDef: ToolDefinition = {
    ...toolDef,
    function: { ...toolDef.function, name: 'client_echo' },
    runtime: 'client',
};

describe('consumeBackgroundStreamWithTools', () => {
    // These execution tests use an authorized unowned canonical chat. The
    // project policy itself is production code, not a mocked permission check.
    beforeEach(() => {
        vi.mocked(useRuntimeConfig).mockReturnValue({ public: { sync: { provider: 'unowned-tools-fixture' } } } as ReturnType<typeof useRuntimeConfig>);
        registerSyncGatewayAdapter({ id: 'unowned-tools-fixture', create: () => ({
            capabilities: { canonicalChatHistory: 'v1' },
            readChatHistory: async (_actor: CanonicalHistoryActor, query: import('~~/shared/chat/history-reader').CanonicalChatQuery) => ({ status: 'ok', project_ownership: 'resolved',
                thread: query.kind === 'thread' ? { id: query.thread_id, project_id: null, clock: 1 } : undefined }),
        }) as SyncGatewayAdapter });
        registerAuthWorkspaceStore({ id: 'unowned-tools-fixture', create: () => ({
            listUserWorkspaces: async subject => subject === 'user-1' ? [{ id: 'ws-1', name: 'Fixture', role: 'owner' }] : [],
        }) as AuthWorkspaceStore });
    });

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
        resetJobViewersForTests();
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

    it('parks a client tool call with a restart-safe continuation', async () => {
        const statusRef = { status: 'streaming' as const };
        const { provider, updateJob, updateJobExecution, completeJob } =
            createProvider(statusRef);
        const execution = {
            version: 1 as const,
            body: {
                model: 'test-model',
                messages: [],
                tools: [clientToolDef],
            },
            workspaceId: 'ws-1',
            referer: 'http://localhost:3000',
            apiKeyCiphertext: 'ciphertext',
            checkpointedToolCallIds: [],
        };
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(makeToolCallResponse('client_echo'));
        vi.stubGlobal('fetch', fetchMock);

        await consumeBackgroundStreamWithTools({
            jobId: 'job-1',
            body: execution.body,
            apiKey: 'key',
            referer: execution.referer,
            provider,
            toolRuntime: { client_echo: 'client' },
            context: {
                body: execution.body,
                apiKey: 'key',
                userId: 'user-1',
                workspaceId: 'ws-1',
                threadId: 'thread-1',
                messageId: 'msg-1',
                referer: execution.referer,
                execution,
                leaseOwner: 'worker-1',
            },
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(completeJob).not.toHaveBeenCalled();
        expect(updateJobExecution).toHaveBeenCalledWith(
            'job-1',
            expect.objectContaining({
                clientToolCall: expect.objectContaining({
                    callId: 'call-1',
                    name: 'client_echo',
                }),
                pendingToolCalls: [
                    expect.objectContaining({ id: 'call-1' }),
                ],
                body: expect.objectContaining({
                    messages: [
                        expect.objectContaining({ role: 'assistant' }),
                    ],
                }),
            }),
            'worker-1'
        );
        expect(
            updateJob.mock.calls
                .flatMap((call) => (call[1] as JobUpdate).tool_calls ?? [])
                .find(
                    (call) =>
                        call.id === 'call-1' && call.runtime === 'client'
                )
        ).toMatchObject({ status: 'pending', runtime: 'client' });
    });

    it('drains the remaining batch before resuming the model', async () => {
        const statusRef = { status: 'streaming' as const };
        const serverArgs = '{"value":"after-client"}';
        const { provider, completeJob } = createProvider(statusRef, [
            {
                id: 'client-call',
                name: 'client_echo',
                status: 'complete',
                result: 'client-result',
                argument_fingerprint: 'client-fingerprint',
            },
            {
                id: 'server-call',
                name: 'server_echo',
                status: 'pending',
                args: serverArgs,
                argument_fingerprint: toolCallFingerprint(
                    'server_echo',
                    serverArgs
                ),
            },
        ]);
        const execution = {
            version: 1 as const,
            body: {
                model: 'test-model',
                messages: [
                    {
                        role: 'assistant',
                        tool_calls: [
                            {
                                id: 'client-call',
                                type: 'function',
                                function: {
                                    name: 'client_echo',
                                    arguments: '{}',
                                },
                            },
                            {
                                id: 'server-call',
                                type: 'function',
                                function: {
                                    name: 'server_echo',
                                    arguments: serverArgs,
                                },
                            },
                        ],
                    },
                    {
                        role: 'tool',
                        tool_call_id: 'client-call',
                        name: 'client_echo',
                        content: [{ type: 'text', text: 'client-result' }],
                    },
                ],
                tools: [toolDef, clientToolDef],
            },
            workspaceId: 'ws-1',
            referer: 'http://localhost:3000',
            apiKeyCiphertext: 'ciphertext',
            pendingToolCalls: [
                {
                    id: 'server-call',
                    type: 'function' as const,
                    function: { name: 'server_echo', arguments: serverArgs },
                },
            ],
            checkpointedToolCallIds: ['client-call'],
        };
        const fetchMock = vi.fn().mockResolvedValueOnce(makeTextResponse('done'));
        vi.stubGlobal('fetch', fetchMock);

        await consumeBackgroundStreamWithTools({
            jobId: 'job-1',
            body: execution.body,
            apiKey: 'key',
            referer: execution.referer,
            provider,
            toolRuntime: { client_echo: 'client', server_echo: 'server' },
            context: {
                body: execution.body,
                apiKey: 'key',
                userId: 'user-1',
                workspaceId: 'ws-1',
                threadId: 'thread-1',
                messageId: 'msg-1',
                referer: execution.referer,
                execution,
                leaseOwner: 'worker-2',
            },
        });

        expect(completeJob).toHaveBeenCalledWith(
            'job-1',
            'done',
            'worker-2'
        );
        const requestBody = JSON.parse(
            String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)
        );
        expect(requestBody.messages).toContainEqual(
            expect.objectContaining({
                role: 'tool',
                tool_call_id: 'server-call',
            })
        );
    });

    it('checkpoints a relaxed tool choice before the follow-up request', async () => {
        const statusRef = { status: 'streaming' as const };
        const { provider, updateJobExecution } = createProvider(statusRef);
        vi.stubGlobal(
            'fetch',
            vi.fn()
                .mockResolvedValueOnce(makeToolCallResponse())
                .mockResolvedValueOnce(makeTextResponse('done'))
        );
        const forcedChoice = {
            type: 'function' as const,
            function: { name: 'server_echo' },
        };
        const execution = {
            version: 1 as const,
            body: {
                model: 'test-model',
                messages: [],
                tools: [toolDef],
                tool_choice: forcedChoice,
            },
            workspaceId: 'ws-1',
            referer: 'http://localhost:3000',
            apiKeyCiphertext: 'ciphertext',
            contentBase: '',
            checkpointedToolCallIds: [],
        };

        await consumeBackgroundStreamWithTools({
            jobId: 'job-1', body: execution.body, apiKey: 'key',
            referer: execution.referer, provider,
            context: {
                body: execution.body, apiKey: 'key', userId: 'user-1',
                workspaceId: 'ws-1', threadId: 'thread-1', messageId: 'msg-1',
                referer: execution.referer, execution, leaseOwner: 'worker-1',
            },
        });

        expect(updateJobExecution).toHaveBeenCalledWith(
            'job-1',
            expect.objectContaining({
                body: expect.objectContaining({ tool_choice: 'auto' }),
            }),
            'worker-1'
        );
    });

    it('treats a fenced progress write as a handoff without an error event', async () => {
        const statusRef = { status: 'streaming' as const };
        const { provider, updateJob, completeJob, failJob } =
            createProvider(statusRef);
        const leaseError = new Error('Background job lease was superseded');
        leaseError.name = 'BackgroundJobLeaseLostError';
        updateJob.mockRejectedValueOnce(leaseError);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeTextResponse('done')));
        const events: unknown[] = [];
        const dispose = registerJobStream('job-1', (event) => events.push(event));

        await expect(
            consumeBackgroundStreamWithTools({
                jobId: 'job-1',
                body: { model: 'test-model', messages: [], tools: [toolDef] },
                apiKey: 'key', referer: 'http://localhost:3000', provider,
                context: {
                    body: {}, apiKey: 'key', userId: 'user-1',
                    workspaceId: 'ws-1', threadId: 'thread-1',
                    messageId: 'msg-1', referer: 'http://localhost:3000',
                    leaseOwner: 'worker-old',
                },
            })
        ).rejects.toMatchObject({ name: 'BackgroundJobLeaseLostError' });

        expect(completeJob).not.toHaveBeenCalled();
        expect(failJob).not.toHaveBeenCalled();
        expect(events).not.toContainEqual(
            expect.objectContaining({ type: 'status', status: 'error' })
        );
        dispose();
    });

    it('hands off a fenced plain-text stream without publishing failure', async () => {
        const statusRef = { status: 'streaming' as const };
        const { provider, updateJob, completeJob, failJob } =
            createProvider(statusRef);
        const leaseError = new Error('Background job lease was superseded');
        leaseError.name = 'BackgroundJobLeaseLostError';
        updateJob.mockRejectedValueOnce(leaseError);
        const events: unknown[] = [];
        const dispose = registerJobStream('job-1', (event) => events.push(event));

        await expect(
            consumeBackgroundStream({
                jobId: 'job-1',
                stream: makeSseStream([{
                    choices: [{ delta: { content: 'partial' } }],
                }]),
                provider,
                flushOnEveryChunk: true,
                context: {
                    body: {}, apiKey: 'key', userId: 'user-1',
                    workspaceId: 'ws-1', threadId: 'thread-1',
                    messageId: 'msg-1', referer: 'http://localhost:3000',
                    leaseOwner: 'worker-old',
                },
            })
        ).rejects.toMatchObject({ name: 'BackgroundJobLeaseLostError' });

        expect(completeJob).not.toHaveBeenCalled();
        expect(failJob).not.toHaveBeenCalled();
        expect(events).not.toContainEqual(
            expect.objectContaining({ type: 'status', status: 'error' })
        );
        dispose();
    });

    it('completes a plain-text background stream after flushing its final content', async () => {
        const statusRef = { status: 'streaming' as const };
        const { provider, updateJob, completeJob, failJob } = createProvider(statusRef);

        await consumeBackgroundStream({
            jobId: 'job-1',
            stream: makeSseStream([{
                choices: [{ delta: { content: 'complete answer' } }],
            }]),
            provider,
            context: {
                body: {}, apiKey: 'key', userId: 'user-1',
                workspaceId: 'ws-1', threadId: 'thread-1',
                messageId: 'msg-1', referer: 'http://localhost:3000',
            },
        });

        expect(updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({
            contentChunk: 'complete answer',
        }));
        expect(completeJob).toHaveBeenCalledWith('job-1', 'complete answer');
        expect(failJob).not.toHaveBeenCalled();
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

/**
 * Failure owners: real job storage and real terminal-history reconciliation.
 * The canonical adapter is the observed external boundary, not a substitute
 * for provider-source serialization/sync conformance (qualified separately).
 * Risks: dropped usage, summed prompts, mutated prefix, missing final counters,
 * duplicate usage, error/abort after a measured iteration, and stale lease writes.
 */
describe('background usage through terminal history', () => {
    const delivered: CanonicalGenerationSnapshot[] = [];
    const finalize = vi.fn(async (_actor: unknown, input: { snapshot: CanonicalGenerationSnapshot }) => {
        delivered.push(structuredClone(input.snapshot));
        return { status: 'committed' as const, replayed: false, serverVersion: 2 };
    });
    beforeEach(() => {
        clearAllJobs();
        contextCatalog.capacity = 1_000_000; contextCatalog.calls = 0;
        delivered.length = 0;
        finalize.mockClear();
        vi.stubGlobal('useRuntimeConfig', () => ({ backgroundJobs: {}, public: { sync: { provider: 'usage-boundary' } } }));
        vi.mocked(useRuntimeConfig).mockImplementation(() => (globalThis as any).useRuntimeConfig());
        registerAuthWorkspaceStore({ id: 'usage-boundary', create: () => ({ listUserWorkspaces: async (subject: string) => subject === 'owner' ? [{ id: 'workspace', name: 'Fixture', role: 'owner' }] : [] }) as AuthWorkspaceStore });
        registerSyncGatewayAdapter({
            id: 'usage-boundary',
            create: () => ({
                capabilities: { backgroundGenerationHistory: 'v1', canonicalChatHistory: 'v1' },
                readChatHistory: async (_actor: CanonicalHistoryActor, query: import('~~/shared/chat/history-reader').CanonicalChatQuery) => ({ status: 'ok', project_ownership: 'resolved', thread: query.kind === 'thread' ? { id: query.thread_id, clock: 1, project_id: null } : undefined }),
                admitChatGeneration: async () => ({ status: 'admitted', replayed: false, serverVersion: 1 }),
                finalizeChatGeneration: finalize,
            }) as unknown as SyncGatewayAdapter,
        });
        registerServerTool(toolDef, ({ value }: { value: string }) => value, { override: true });
    });
    afterEach(() => {
        clearAllJobs();
        vi.restoreAllMocks();
        unregisterServerTool('server_echo');
        resetJobViewersForTests();
        vi.unstubAllGlobals();
    });

    async function admitted(withTools = true, contextEnvelope?: ContextRequestEnvelope) {
        const history: ChatGenerationAdmissionEnvelope = {
            version: 1, kind: 'new-turn', admissionId: 'admission', generationId: 'generation',
            workspaceId: 'workspace', threadId: 'thread', messageId: 'assistant',
            thread: { id: 'thread', clock: 1 },
            userMessage: { id: 'user', clock: 1, thread_id: 'thread', role: 'user' },
            assistantMessage: { id: 'assistant', clock: 1, thread_id: 'thread', role: 'assistant' },
        };
        const body = {
            model: 'test-model', messages: [{ role: 'user', content: 'immutable original' }],
            ...(withTools ? { tools: [toolDef] } : {}),
            _background: true, _threadId: 'thread', _messageId: 'assistant', _history: history,
            ...(contextEnvelope ? { _context: structuredClone(contextEnvelope) } : {}),
        };
        const execution = {
            version: 1 as const, body, workspaceId: 'workspace',
            referer: 'http://localhost', apiKeyCiphertext: 'unused-by-direct-executor', history,
        };
        const jobId = await memoryJobProvider.createJob({
            userId: 'owner', threadId: 'thread', messageId: 'assistant', model: 'test-model',
            generationId: 'generation', syncProviderId: 'usage-boundary',
            historyPhase: 'admission_pending', execution,
        });
        expect(await reconcileBackgroundJobHistory(memoryJobProvider, (await memoryJobProvider.getJob(jobId, 'owner'))!)).toBe('ready');
        const now = Date.now();
        await memoryJobProvider.claimJob!(jobId, 'worker', now, now + 60000);
        const context = {
            body, apiKey: 'fixture-key', userId: 'owner', workspaceId: 'workspace',
            threadId: 'thread', messageId: 'assistant', referer: 'http://localhost',
            execution, leaseOwner: 'worker',
        };
        return { jobId, context, body };
    }
    function response(prompt: number | undefined, tool = false) {
        const usage = prompt === undefined ? [] : [
            { id: tool ? 'request-1' : 'request-2', model: 'test-model', choices: [], usage: { prompt_tokens: prompt, completion_tokens: 12 } },
            { id: tool ? 'request-1' : 'request-2', model: 'test-model', choices: [], usage: { prompt_tokens: prompt, completion_tokens: 12 } },
            { choices: [], usage: { prompt_tokens: -1, completion_tokens: 12 } },
        ];
        return new Response(makeSseStream([
            { choices: [{ delta: tool ? {
                tool_calls: [{ index: 0, id: 'call-1', function: { name: 'server_echo', arguments: '{"value":"ok"}' } }],
            } : { content: 'answer' }, finish_reason: tool ? 'tool_calls' : 'stop' }] },
            ...usage,
        ]));
    }
    async function terminal(jobId: string) {
        const job = (await memoryJobProvider.getJob(jobId, 'owner'))!;
        expect(job.historyPhase).toBe('finalization_pending');
        expect(await reconcileBackgroundJobHistory(memoryJobProvider, job)).toBe('committed');
        const reloaded = (await memoryJobProvider.getJob(jobId, 'owner'))!;
        expect(await reconcileBackgroundJobHistory(memoryJobProvider, reloaded)).toBe('unchanged');
        expect(finalize).toHaveBeenCalledOnce();
        expect(delivered[0]?.status).toBe(job.status);
        return { job: reloaded, snapshot: delivered[0]! };
    }

    it.each([false, true])('refuses resumed inference after ownership changes (tools: %s)', async withTools => {
        const { jobId, context } = await admitted(withTools);
        registerSyncGatewayAdapter({ id: 'usage-boundary', create: () => ({
            capabilities: { backgroundGenerationHistory: 'v1', canonicalChatHistory: 'v1' },
            readChatHistory: async () => ({ status: 'ok', project_ownership: 'resolved', thread: { id: 'thread', clock: 2, project_id: 'project' } }),
            admitChatGeneration: async () => ({ status: 'admitted', replayed: false, serverVersion: 1 }),
            finalizeChatGeneration: finalize,
        }) as unknown as SyncGatewayAdapter });
        vi.stubGlobal('fetch', vi.fn(async () => response(100)));
        await expect(executeBackgroundJob(jobId, context, memoryJobProvider)).rejects.toThrow(/project/i);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('rechecks ownership between tool-loop model requests', async () => {
        let projectId: string | null = null;
        registerSyncGatewayAdapter({ id: 'usage-boundary', create: () => ({
            capabilities: { backgroundGenerationHistory: 'v1', canonicalChatHistory: 'v1' },
            readChatHistory: async () => ({ status: 'ok', project_ownership: 'resolved', thread: { id: 'thread', clock: 1, project_id: projectId } }),
            admitChatGeneration: async () => ({ status: 'admitted', replayed: false, serverVersion: 1 }),
            finalizeChatGeneration: finalize,
        }) as unknown as SyncGatewayAdapter });
        const { jobId, context } = await admitted(true);
        registerServerTool(toolDef, () => { projectId = 'project'; return 'accepted result'; }, { override: true });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(100, true)).mockResolvedValueOnce(response(200)));
        await expect(executeBackgroundJob(jobId, context, memoryJobProvider)).rejects.toThrow(/project/i);
        expect(fetch).toHaveBeenCalledOnce();
    });

    it('rejects a restored oversized captured maximum before reopening the provider', async () => {
        const { jobId, context } = await admitted(false, { version: 1, user_max_context_tokens: 20, requested_completion_tokens: null });
        vi.stubGlobal('fetch', vi.fn(async () => response(100)));
        await expect(executeBackgroundJob(jobId, context, memoryJobProvider)).rejects.toMatchObject({ code: 'context_full' });
        expect(fetch).not.toHaveBeenCalled(); expect(contextCatalog.calls).toBe(1);
    });

    it('retains one accepted oversized tool result and stops before the next request or replay', async () => {
        const { jobId, context } = await admitted(true, { version: 1, user_max_context_tokens: 500, requested_completion_tokens: null });
        const result = 'durable result '.repeat(500);
        const tool = vi.fn(() => {
            context.body._context!.user_max_context_tokens = 1_000_000;
            return result;
        });
        registerServerTool(toolDef, tool, { override: true });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(150, true)).mockResolvedValueOnce(response(250)));
        await expect(executeBackgroundJob(jobId, context, memoryJobProvider)).rejects.toMatchObject({ code: 'context_full' });
        expect(fetch).toHaveBeenCalledOnce(); expect(tool).toHaveBeenCalledOnce();
        const job = (await memoryJobProvider.getJob(jobId, 'owner'))!;
        if (!job.execution || !('body' in job.execution)) throw new Error('Expected native chat checkpoint');
        expect(job.tool_calls?.[0]).toMatchObject({ id: 'call-1', status: 'complete', result });
        expect(job.execution?.body._context).toEqual({ version: 1, user_max_context_tokens: 500, requested_completion_tokens: null });
        const restored = { ...context, body: job.execution!.body, execution: job.execution! };
        await expect(executeBackgroundJob(jobId, restored, memoryJobProvider)).rejects.toMatchObject({ name: 'BackgroundJobLeaseLostError' });
        expect(fetch).toHaveBeenCalledOnce(); expect(tool).toHaveBeenCalledOnce();
        expect(job.error).toContain('ERR_CONTEXT_FULL');
        const finalized = await terminal(jobId);
        expect(finalized.snapshot.toolCalls?.[0]).toMatchObject({ id: 'call-1', status: 'complete', result });
        expect(finalized.snapshot.error).toContain('ERR_CONTEXT_FULL');
    });

    it('rechecks the persisted maximum after a failed terminal write and worker lease recovery without replaying the accepted tool', async () => {
        const { jobId, context } = await admitted(true, { version: 1, user_max_context_tokens: 500, requested_completion_tokens: null });
        const tool = vi.fn(() => 'accepted result '.repeat(500));
        registerServerTool(toolDef, tool, { override: true });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(150, true)).mockResolvedValueOnce(response(250)));
        vi.spyOn(memoryJobProvider, 'saveTerminalSnapshot').mockRejectedValueOnce(new Error('fixture terminal write interrupted'));
        await expect(executeBackgroundJob(jobId, context, memoryJobProvider)).rejects.toThrow('fixture terminal write interrupted');
        const checkpointed = (await memoryJobProvider.getJob(jobId, 'owner'))!;
        expect(checkpointed.status).toBe('streaming');
        expect(checkpointed.tool_calls?.[0]?.status).toBe('complete');
        const recoveredAt = Date.now() + 60_001;
        expect(await memoryJobProvider.claimJob!(jobId, 'recovered-worker', recoveredAt, recoveredAt + 60_000)).toBeTruthy();
        const recovered = (await memoryJobProvider.getJob(jobId, 'owner'))!;
        if (!recovered.execution || !('body' in recovered.execution)) throw new Error('Expected native chat checkpoint');
        await expect(executeBackgroundJob(jobId, { ...context, body: recovered.execution!.body,
            execution: recovered.execution!, leaseOwner: 'recovered-worker' }, memoryJobProvider))
            .rejects.toMatchObject({ code: 'context_full' });
        expect(fetch).toHaveBeenCalledOnce(); expect(tool).toHaveBeenCalledOnce();
        expect((await memoryJobProvider.getJob(jobId, 'owner'))!.error).toContain('ERR_CONTEXT_FULL');
    });
    it.each([400, undefined])('retains the last measured tool request (%s), with immutable submitted provenance', async (lastPrompt) => {
        const { jobId, context, body } = await admitted();
        const sent: Record<string, unknown>[] = [];
        vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
            sent.push(JSON.parse(init.body));
            return sent.length === 1 ? response(150, true) : response(lastPrompt);
        }));
        const running = executeBackgroundJob(jobId, context, memoryJobProvider);
        body.messages[0]!.content = 'mutated after start';
        await running;
        expect(sent).toHaveLength(2);
        expect(sent[0]!.messages).toEqual([{ role: 'user', content: 'immutable original' }]);
        const { job, snapshot } = await terminal(jobId);
        const usage = readRequestUsage((job as unknown as Record<string, unknown>).usage);
        expect(usage).toMatchObject({
            prompt_tokens: lastPrompt ?? 150, completion_tokens: 12,
            request_id: lastPrompt === undefined ? 'request-1' : 'request-2',
            iteration: lastPrompt === undefined ? 1 : 2, model: 'test-model',
        });
        const measuredBody = sent[lastPrompt === undefined ? 0 : 1]!;
        const { messages, ...configuration } = measuredBody;
        const prefix = await captureUsagePrefix({
            model: 'test-model', messages: messages as [], tools: measuredBody.tools as [],
            configuration, countText: countTokensApprox,
        });
        expect(usage).toMatchObject(prefix);
        expect((snapshot as unknown as Record<string, unknown>).usage).toEqual(usage);
        expect(snapshot.toolCalls).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'call-1', status: 'complete', result: 'ok' })]));
    });
    it.each(['error', 'aborted'] as const)('preserves a completed measured iteration when a later request is %s', async (status) => {
        const { jobId, context } = await admitted();
        let calls = 0;
        vi.stubGlobal('fetch', vi.fn(async () => {
            if (++calls === 1) return response(150, true);
            if (status === 'aborted') {
                await memoryJobProvider.abortJob(jobId, 'owner');
                throw Object.assign(new Error('stopped'), { name: 'AbortError' });
            }
            throw new Error('fixture transport failed');
        }));
        const running = executeBackgroundJob(jobId, context, memoryJobProvider);
        if (status === 'error') await expect(running).rejects.toThrow('fixture transport failed');
        else await running;
        const { job, snapshot } = await terminal(jobId);
        expect(job.status).toBe(status);
        expect((job as unknown as Record<string, unknown>).usage).toMatchObject({ prompt_tokens: 150, request_id: 'request-1', iteration: 1 });
        expect((snapshot as unknown as Record<string, unknown>).usage).toEqual((job as unknown as Record<string, unknown>).usage);
    });
    it.each([150, undefined])('persists text-only final usage (%s) without fabricating an absent measurement', async (prompt) => {
        const { jobId, context, body } = await admitted(false);
        const sent: Record<string, unknown>[] = [];
        vi.stubGlobal('fetch', vi.fn(async (_url, init) => { sent.push(JSON.parse(init.body)); return response(prompt); }));
        const running = executeBackgroundJob(jobId, context, memoryJobProvider);
        body.messages[0]!.content = 'mutated after start';
        await running;
        const { job, snapshot } = await terminal(jobId);
        expect(sent[0]!.messages).toEqual([{ role: 'user', content: 'immutable original' }]);
        expect(snapshot.content).toBe('answer');
        if (prompt === undefined) {
            expect((job as unknown as Record<string, unknown>).usage).toBeUndefined();
            expect((snapshot as unknown as Record<string, unknown>).usage).toBeUndefined();
        } else {
            expect((job as unknown as Record<string, unknown>).usage).toMatchObject({ prompt_tokens: 150, iteration: 1, prefix_message_count: 1 });
            expect((snapshot as unknown as Record<string, unknown>).usage).toEqual((job as unknown as Record<string, unknown>).usage);
        }
    });
    it('cannot publish terminal usage after losing the actual memory-provider lease at the snapshot boundary', async () => {
        const { jobId, context } = await admitted(false);
        const statuses: string[] = [];
        registerJobStream(jobId, (event) => { if (event.type === 'status') statuses.push(event.status); });
        vi.stubGlobal('fetch', vi.fn(async () => response(150)));
        const save = memoryJobProvider.saveTerminalSnapshot!.bind(memoryJobProvider);
        vi.spyOn(memoryJobProvider, 'saveTerminalSnapshot').mockImplementation(async (...args) => {
            const now = Date.now();
            await memoryJobProvider.claimJob!(jobId, 'new-worker', now + 60001, now + 120000);
            return save(...args);
        });
        await expect(executeBackgroundJob(jobId, context, memoryJobProvider))
            .rejects.toMatchObject({ name: 'BackgroundJobLeaseLostError' });
        expect(await memoryJobProvider.getJob(jobId, 'owner')).toMatchObject({ status: 'streaming', attempts: 2, leaseOwner: 'new-worker' });
        expect((await memoryJobProvider.getJob(jobId, 'owner'))?.usage).toBeUndefined();
        expect(statuses).not.toContain('complete');
        expect(finalize).not.toHaveBeenCalled();
    });
    it('does not publish completion when its terminal snapshot was never saved', async () => {
        const { jobId, context } = await admitted(false);
        const statuses: string[] = [];
        registerJobStream(jobId, (event) => { if (event.type === 'status') statuses.push(event.status); });
        vi.stubGlobal('fetch', vi.fn(async () => response(150)));
        vi.spyOn(memoryJobProvider, 'saveTerminalSnapshot').mockRejectedValue(new Error('fixture storage unavailable'));
        await expect(executeBackgroundJob(jobId, context, memoryJobProvider)).rejects.toThrow('fixture storage unavailable');
        expect((await memoryJobProvider.getJob(jobId, 'owner'))?.status).toBe('streaming');
        expect(statuses).not.toContain('complete');
        expect(finalize).not.toHaveBeenCalled();
    });
    it('fences an old worker live projection after a new attempt has restored its checkpoint', async () => {
        const { jobId, context } = await admitted();
        let calls = 0;
        vi.stubGlobal('fetch', vi.fn(async () => {
            if (++calls === 1) return response(150, true);
            const now = Date.now();
            const current = await memoryJobProvider.claimJob!(jobId, 'new-worker', now + 60001, now + 120000);
            emitJobStatus(jobId, 'streaming', {
                content: 'new worker checkpoint', contentLength: 21, chunksReceived: 0,
                usage: current?.usage, attempt: current?.attempts, content_reset: true,
            });
            return response(400);
        }));
        await expect(executeBackgroundJob(jobId, context, memoryJobProvider))
            .rejects.toMatchObject({ name: 'BackgroundJobLeaseLostError' });
        expect(getJobLiveState(jobId)).toMatchObject({
            content: 'new worker checkpoint', attempt: 2, usage: { prompt_tokens: 150 },
        });
    });
});
