import { describe, expect, it, vi } from 'vitest';

const openRouterStreamMock = vi.fn();

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((nextResolve) => {
        resolve = nextResolve;
    });
    return { promise, resolve };
}

vi.mock('~/utils/chat/openrouterStream', () => ({
    openRouterStream: (...args: unknown[]) => openRouterStreamMock(...args),
}));

vi.mock('~/db/files', () => ({
    createOrRefFile: vi.fn(),
}));

vi.mock('~/db', () => ({
    tx: {
        appendMessage: vi.fn(),
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
});
