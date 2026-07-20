import { describe, expect, it, vi } from 'vitest';

const openRouterStreamMock = vi.fn();
const appendMessageMock = vi.hoisted(() => vi.fn());

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((nextResolve) => {
        resolve = nextResolve;
    });
    return { promise, resolve };
}

vi.mock('~/utils/chat/openrouterStream', () => ({
    openRouterStream: (...args: unknown[]) => openRouterStreamMock(...args),
    openRouterStreamWithRetry: async function* (...args: unknown[]) {
        yield* openRouterStreamMock(...args);
    },
}));

vi.mock('~/db/files', () => ({
    createOrRefFile: vi.fn(),
}));

vi.mock('~/db', () => ({
    tx: {
        appendMessage: appendMessageMock,
    },
}));

vi.mock('~/utils/chat/files', () => ({
    dataUrlToBlob: vi.fn(),
}));

vi.mock('~/utils/chat/uiMessages', () => ({
    ensureUiMessage: (message: any) => ({
        ...message,
        text: typeof message.content === 'string' ? message.content : '',
        pending: Boolean(message.pending),
    }),
    recordRawMessage: vi.fn(),
}));

describe('runForegroundStreamLoop', () => {
    it('coalesces 500 text events and terminally persists all content', async () => {
        openRouterStreamMock.mockImplementation(async function* () {
            for (let index = 0; index < 500; index += 1) yield { type: 'text', text: 'x' };
        });
        const { runForegroundStreamLoop } = await import('~/utils/chat/useAi-internal/foregroundStream');
        const persistAssistant = vi.fn(async (_patch: Record<string, unknown>) => null);
        const ctx = {
            apiKey: 'key', modelId: 'model',
            orMessages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'go' }] }],
            modalities: ['text'], abortSignal: new AbortController().signal,
            assistantId: 'assistant-batch-text', streamId: 'stream-batch-text', threadId: 'thread-1',
            streamAcc: { append: vi.fn() }, hooks: { doAction: vi.fn(async () => {}) },
            toolRegistry: { executeTool: vi.fn() }, persistAssistant,
            assistantFileHashes: [], activeToolCalls: new Map(),
            tailAssistant: { value: null as any }, rawMessages: { value: [] as any[] },
        };

        await runForegroundStreamLoop(ctx);

        expect(persistAssistant.mock.calls.length).toBeLessThanOrEqual(10);
        expect(persistAssistant.mock.lastCall?.[0]).toMatchObject({ content: 'x'.repeat(500) });
    });

    it('coalesces reasoning-only events and terminally persists reasoning', async () => {
        openRouterStreamMock.mockImplementation(async function* () {
            for (let index = 0; index < 200; index += 1) yield { type: 'reasoning', text: 'r' };
        });
        const { runForegroundStreamLoop } = await import('~/utils/chat/useAi-internal/foregroundStream');
        const persistAssistant = vi.fn(async (_patch: Record<string, unknown>) => null);
        const ctx = {
            apiKey: 'key', modelId: 'model',
            orMessages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'go' }] }],
            modalities: ['text'], abortSignal: new AbortController().signal,
            assistantId: 'assistant-batch-reasoning', streamId: 'stream-batch-reasoning', threadId: 'thread-1',
            streamAcc: { append: vi.fn() }, hooks: { doAction: vi.fn(async () => {}) },
            toolRegistry: { executeTool: vi.fn() }, persistAssistant,
            assistantFileHashes: [], activeToolCalls: new Map(),
            tailAssistant: { value: null as any }, rawMessages: { value: [] as any[] },
        };

        await runForegroundStreamLoop(ctx);

        expect(persistAssistant.mock.calls.length).toBeLessThanOrEqual(4);
        expect(persistAssistant.mock.lastCall?.[0]).toMatchObject({ reasoning: 'r'.repeat(200) });
    });

    it('queues chunk hooks without blocking token ingestion', async () => {
        openRouterStreamMock.mockImplementation(async function* () {
            yield { type: 'reasoning', text: 'plan' };
            yield { type: 'text', text: 'Hello' };
            yield { type: 'text', text: ' world' };
        });
        const hookSteps = [
            deferred<void>(),
            deferred<void>(),
            deferred<void>(),
        ];
        const pendingSteps = [...hookSteps];

        const { runForegroundStreamLoop } = await import(
            '~/utils/chat/useAi-internal/foregroundStream'
        );

        const ctx = {
            apiKey: 'test-key',
            modelId: 'test-model',
            orMessages: [
                {
                    role: 'user' as const,
                    content: [{ type: 'text' as const, text: 'hi' }],
                },
            ],
            modalities: ['text'],
            abortSignal: new AbortController().signal,
            assistantId: 'assistant-1',
            streamId: 'stream-1',
            threadId: 'thread-1',
            streamAcc: {
                append: vi.fn(),
            },
            hooks: {
                doAction: vi.fn((_name: string) => {
                    const next = pendingSteps.shift();
                    if (!next) return Promise.resolve();
                    return next.promise;
                }),
            },
            toolRegistry: {
                executeTool: vi.fn(),
            },
            persistAssistant: vi.fn(async () => null),
            assistantFileHashes: [],
            activeToolCalls: new Map(),
            tailAssistant: { value: null as any },
            rawMessages: { value: [] as any[] },
        };

        const runPromise = runForegroundStreamLoop(ctx);
        let settled = false;
        void runPromise.then(() => {
            settled = true;
        });

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(ctx.streamAcc.append).toHaveBeenCalledTimes(3);
        expect(ctx.hooks.doAction).toHaveBeenCalledTimes(1);
        expect(settled).toBe(false);

        hookSteps[0]?.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(ctx.hooks.doAction).toHaveBeenCalledTimes(2);
        expect(settled).toBe(false);

        hookSteps[1]?.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(ctx.hooks.doAction).toHaveBeenCalledTimes(3);
        expect(settled).toBe(false);

        hookSteps[2]?.resolve();
        await runPromise;

        expect(ctx.persistAssistant).toHaveBeenCalled();
    });

    it('bounds a stuck stream-hook backlog and does not block terminal completion', async () => {
        vi.useFakeTimers();
        try {
            openRouterStreamMock.mockImplementation(async function* () {
                for (let index = 0; index < 100; index += 1) {
                    yield { type: 'text', text: 'x' };
                }
            });
            const never = new Promise<void>(() => {});
            const { runForegroundStreamLoop, STREAM_HOOK_FLUSH_TIMEOUT_MS } =
                await import('~/utils/chat/useAi-internal/foregroundStream');
            const ctx = {
                apiKey: 'test-key', modelId: 'test-model',
                orMessages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] }],
                modalities: ['text'], abortSignal: new AbortController().signal,
                assistantId: 'assistant-hooks', streamId: 'stream-hooks', threadId: 'thread-1',
                streamAcc: { append: vi.fn() },
                hooks: { doAction: vi.fn(() => never) },
                toolRegistry: { executeTool: vi.fn() },
                persistAssistant: vi.fn(async () => null), assistantFileHashes: [],
                activeToolCalls: new Map(), tailAssistant: { value: null as any },
                rawMessages: { value: [] as any[] },
            };

            const run = runForegroundStreamLoop(ctx);
            await vi.advanceTimersByTimeAsync(STREAM_HOOK_FLUSH_TIMEOUT_MS);
            await run;

            expect(ctx.streamAcc.append).toHaveBeenCalledTimes(100);
            expect(ctx.hooks.doAction).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not execute a model-returned tool outside the request snapshot', async () => {
        appendMessageMock.mockClear();
        let iteration = 0;
        openRouterStreamMock.mockImplementation(async function* () {
            iteration += 1;
            if (iteration === 1) {
                yield {
                    type: 'tool_call',
                    tool_call: {
                        id: 'call-unauthorized',
                        type: 'function',
                        function: { name: 'registered_but_hidden', arguments: '{}' },
                    },
                };
            } else {
                yield { type: 'text', text: 'safe response' };
            }
        });
        const executeTool = vi.fn();
        const { runForegroundStreamLoop } = await import(
            '~/utils/chat/useAi-internal/foregroundStream'
        );
        const ctx = {
            apiKey: 'test-key', modelId: 'test-model',
            orMessages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] }],
            modalities: ['text'],
            tools: [{
                type: 'function' as const,
                function: { name: 'advertised', description: 'safe', parameters: { type: 'object' as const, properties: {} } },
            }],
            abortSignal: new AbortController().signal,
            assistantId: 'assistant-2', streamId: 'stream-2', threadId: 'thread-1',
            streamAcc: { append: vi.fn() },
            hooks: { doAction: vi.fn(async () => {}) },
            toolRegistry: { executeTool },
            persistAssistant: vi.fn(async () => null),
            assistantFileHashes: [], activeToolCalls: new Map(),
            tailAssistant: { value: null as any }, rawMessages: { value: [] as any[] },
        };

        await runForegroundStreamLoop(ctx);

        expect(executeTool).not.toHaveBeenCalled();
        expect(ctx.activeToolCalls.get('call-unauthorized')).toMatchObject({ status: 'error' });
        expect(appendMessageMock).toHaveBeenCalledWith(expect.objectContaining({
            role: 'tool',
            data: expect.objectContaining({
                transcript_kind: 'tool_result',
                tool_call_id: 'call-unauthorized',
                tool_status: 'error',
            }),
        }));
        expect(ctx.persistAssistant).toHaveBeenCalledWith(expect.objectContaining({
            toolCalls: [expect.objectContaining({
                id: 'call-unauthorized', status: 'error',
            })],
        }));
    });

    it('executes an exact duplicate foreground call ID only once and reuses its result', async () => {
        let iteration = 0;
        openRouterStreamMock.mockImplementation(async function* () {
            iteration += 1;
            if (iteration === 1) {
                const event = {
                    type: 'tool_call',
                    tool_call: {
                        id: 'call-duplicate', type: 'function',
                        function: { name: 'echo', arguments: '{"value":"ok"}' },
                    },
                };
                yield event;
                yield structuredClone(event);
            } else yield { type: 'text', text: 'done' };
        });
        const executeTool = vi.fn(async () => ({
            result: 'side-effect-result', toolName: 'echo', timedOut: false,
        }));
        const { runForegroundStreamLoop } = await import('~/utils/chat/useAi-internal/foregroundStream');
        const ctx = {
            apiKey: 'key', modelId: 'model',
            orMessages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'go' }] }],
            modalities: ['text'],
            tools: [{ type: 'function' as const, function: {
                name: 'echo', description: 'echo',
                parameters: { type: 'object' as const, properties: { value: { type: 'string' } } },
            } }],
            abortSignal: new AbortController().signal,
            assistantId: 'assistant-3', streamId: 'stream-3', threadId: 'thread-1',
            streamAcc: { append: vi.fn() }, hooks: { doAction: vi.fn(async () => {}) },
            toolRegistry: { executeTool }, persistAssistant: vi.fn(async () => null),
            assistantFileHashes: [], activeToolCalls: new Map(),
            tailAssistant: { value: null as any }, rawMessages: { value: [] as any[] },
        };
        await runForegroundStreamLoop(ctx);
        expect(executeTool).toHaveBeenCalledTimes(1);
    });

    it('keeps cumulative UI text but sends only the current iteration preamble', async () => {
        let iteration = 0;
        openRouterStreamMock.mockImplementation(async function* () {
            iteration += 1;
            if (iteration <= 2) {
                yield { type: 'text', text: iteration === 1 ? 'first' : 'second' };
                yield {
                    type: 'tool_call',
                    tool_call: {
                        id: `call-${iteration}`,
                        type: 'function',
                        function: { name: 'echo', arguments: '{}' },
                    },
                };
            } else {
                yield { type: 'text', text: 'final' };
            }
        });
        const { runForegroundStreamLoop } = await import(
            '~/utils/chat/useAi-internal/foregroundStream'
        );
        const orMessages: any[] = [
            { role: 'user', content: [{ type: 'text', text: 'go' }] },
        ];
        const ctx = {
            apiKey: 'key', modelId: 'model', orMessages, modalities: ['text'],
            tools: [{ type: 'function' as const, function: {
                name: 'echo', description: 'echo',
                parameters: { type: 'object' as const, properties: {} },
            } }],
            abortSignal: new AbortController().signal,
            assistantId: 'assistant-iterations', streamId: 'stream-iterations',
            threadId: 'thread-1', streamAcc: { append: vi.fn() },
            hooks: { doAction: vi.fn(async () => {}) },
            toolRegistry: { executeTool: vi.fn(async () => ({
                result: 'ok', toolName: 'echo', timedOut: false,
            })) },
            persistAssistant: vi.fn(async () => null), assistantFileHashes: [],
            activeToolCalls: new Map(), tailAssistant: { value: null as any },
            rawMessages: { value: [] as any[] },
        };

        await runForegroundStreamLoop(ctx);

        expect(ctx.tailAssistant.value.text).toBe('firstsecondfinal');
        expect(
            orMessages
                .filter((message) => message.role === 'assistant')
                .map((message) => message.content[0].text)
        ).toEqual(['first', 'second']);
    });

    it('fails with a typed terminal error when the final iteration requests another tool', async () => {
        let iteration = 0;
        openRouterStreamMock.mockImplementation(async function* () {
            iteration += 1;
            yield {
                type: 'tool_call',
                tool_call: {
                    id: `limit-${iteration}`,
                    type: 'function',
                    function: { name: 'echo', arguments: '{}' },
                },
            };
        });
        const { runForegroundStreamLoop } = await import(
            '~/utils/chat/useAi-internal/foregroundStream'
        );
        const { ToolIterationLimitError } = await import(
            '~~/shared/chat/stream-errors'
        );
        const ctx = {
            apiKey: 'key', modelId: 'model',
            orMessages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'go' }] }],
            modalities: ['text'],
            tools: [{ type: 'function' as const, function: {
                name: 'echo', description: 'echo',
                parameters: { type: 'object' as const, properties: {} },
            } }],
            abortSignal: new AbortController().signal,
            assistantId: 'assistant-limit', streamId: 'stream-limit', threadId: 'thread-1',
            streamAcc: { append: vi.fn() }, hooks: { doAction: vi.fn(async () => {}) },
            toolRegistry: { executeTool: vi.fn(async () => ({
                result: 'ok', toolName: 'echo', timedOut: false,
            })) },
            persistAssistant: vi.fn(async () => null), assistantFileHashes: [],
            activeToolCalls: new Map(), tailAssistant: { value: null as any },
            rawMessages: { value: [] as any[] },
        };

        await expect(runForegroundStreamLoop(ctx)).rejects.toBeInstanceOf(
            ToolIterationLimitError
        );
        expect(iteration).toBe(10);
    });

    it('does not issue the follow-up request until completed tool state is durable', async () => {
        appendMessageMock.mockClear();
        let iteration = 0;
        openRouterStreamMock.mockImplementation(async function* () {
            iteration += 1;
            if (iteration === 1) {
                yield {
                    type: 'tool_call',
                    tool_call: {
                        id: 'crash-call',
                        type: 'function',
                        function: { name: 'echo', arguments: '{}' },
                    },
                };
            } else {
                yield { type: 'text', text: 'must not run' };
            }
        });
        const { runForegroundStreamLoop } = await import(
            '~/utils/chat/useAi-internal/foregroundStream'
        );
        const persistAssistant = vi.fn(async (patch: { toolCalls?: Array<{ status: string }> | null }) => {
            if (patch.toolCalls?.some((call) => call.status === 'complete')) {
                throw new Error('simulated persistence crash');
            }
            return null;
        });

        await expect(runForegroundStreamLoop({
            apiKey: 'key', modelId: 'model',
            orMessages: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
            modalities: ['text'], tools: [{ type: 'function', function: {
                name: 'echo', description: 'echo',
                parameters: { type: 'object', properties: {} },
            } }],
            abortSignal: new AbortController().signal,
            assistantId: 'assistant-crash', parentTurnId: 'user-crash',
            streamId: 'stream-crash', threadId: 'thread-1',
            streamAcc: { append: vi.fn() }, hooks: { doAction: vi.fn(async () => {}) },
            toolRegistry: { executeTool: vi.fn(async () => ({
                result: 'durable result', toolName: 'echo', timedOut: false,
            })) },
            persistAssistant: persistAssistant as any,
            assistantFileHashes: [], activeToolCalls: new Map(),
            tailAssistant: { value: null }, rawMessages: { value: [] },
        })).rejects.toThrow('simulated persistence crash');

        expect(appendMessageMock).toHaveBeenCalledWith(expect.objectContaining({
            role: 'tool',
            data: expect.objectContaining({
                transcript_kind: 'tool_result',
                parent_assistant_id: 'assistant-crash',
                tool_call_id: 'crash-call',
                tool_status: 'complete',
                content: 'durable result',
            }),
        }));
        expect(iteration).toBe(1);
    });
});
