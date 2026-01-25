import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    openRouterStream,
    startBackgroundStream,
    isBackgroundStreamingEnabled,
    waitForJobCompletion,
} from '../openrouterStream';

const runtimeConfigMock = {
    public: {
        backgroundStreaming: { enabled: true },
    },
};

const parseMock = vi.fn(async function* () {
    yield { type: 'text', text: 'hello' };
});

vi.mock('~~/shared/openrouter/parseOpenRouterSSE', () => ({
    parseOpenRouterSSE: (..._args: unknown[]) => parseMock(),
}));

vi.mock('#imports', () => ({
    useRuntimeConfig: () => runtimeConfigMock,
}));

function createStreamResponse(headers?: Record<string, string>) {
    return new Response('data: test', {
        status: 200,
        headers,
    });
}

function createJsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

describe('openrouterStream', () => {
    beforeEach(() => {
        parseMock.mockClear();
        localStorage.clear();
        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('uses server route for streaming when available', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValue(createStreamResponse());
        (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock;

        const events: Array<{ type: string; text?: string }> = [];

        for await (const event of openRouterStream({
            apiKey: 'key-1',
            model: 'model-1',
            orMessages: [{ role: 'user', content: 'hi' }],
            modalities: ['text'],
        })) {
            events.push(event);
        }

        expect(fetchMock).toHaveBeenCalledWith(
            '/api/openrouter/stream',
            expect.objectContaining({ method: 'POST' })
        );
        expect(events).toHaveLength(1);
        expect(parseMock).toHaveBeenCalledTimes(1);
    });

    it('falls back to direct OpenRouter on 404 and caches unavailability', async () => {
        const fetchMock = vi.fn((url: RequestInfo | URL) => {
            if (url === '/api/openrouter/stream') {
                return Promise.resolve(createJsonResponse({ error: 'missing' }, 404));
            }
            return Promise.resolve(createStreamResponse());
        });
        (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock;

        const events: Array<{ type: string; text?: string }> = [];
        for await (const event of openRouterStream({
            apiKey: 'key-1',
            model: 'model-1',
            orMessages: [{ role: 'user', content: 'hi' }],
            modalities: ['text'],
        })) {
            events.push(event);
        }

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock).toHaveBeenCalledWith(
            'https://openrouter.ai/api/v1/chat/completions',
            expect.objectContaining({ method: 'POST' })
        );
        const cached = localStorage.getItem('or3:server-route-available');
        expect(cached).toBeTruthy();
        const parsed = cached ? JSON.parse(cached) : null;
        expect(parsed?.available).toBe(false);
        expect(events).toHaveLength(1);
    });

    it('exposes background streaming availability cache', () => {
        localStorage.setItem('or3:background-streaming-available', 'true');
        const enabled = isBackgroundStreamingEnabled();
        expect(enabled).toBe(true);
    });
});

describe('background streaming helpers', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('startBackgroundStream sets availability cache', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            createJsonResponse({ jobId: 'job-1', status: 'streaming' })
        );
        (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock;

        const result = await startBackgroundStream({
            apiKey: 'key-1',
            model: 'model-1',
            orMessages: [{ role: 'user', content: 'hi' }],
            modalities: ['text'],
            threadId: 't1',
            messageId: 'm1',
        });

        expect(result.jobId).toBe('job-1');
        expect(localStorage.getItem('or3:background-streaming-available')).toBe(
            'true'
        );
    });

    it('startBackgroundStream caches unavailability on 404', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValue(createJsonResponse({ error: 'nope' }, 404));
        (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock;

        await expect(
            startBackgroundStream({
                apiKey: 'key-1',
                model: 'model-1',
                orMessages: [{ role: 'user', content: 'hi' }],
                modalities: ['text'],
                threadId: 't1',
                messageId: 'm1',
            })
        ).rejects.toThrow('nope');

        expect(localStorage.getItem('or3:background-streaming-available')).toBe(
            'false'
        );
        const cached = localStorage.getItem('or3:server-route-available');
        const parsed = cached ? JSON.parse(cached) : null;
        expect(parsed?.available).toBe(false);
    });

    it('waitForJobCompletion resolves when job completes', async () => {
        const statuses = [
            {
                id: 'job-1',
                status: 'streaming',
                threadId: 't1',
                messageId: 'm1',
                model: 'm',
                chunksReceived: 1,
                startedAt: 1,
            },
            {
                id: 'job-1',
                status: 'complete',
                threadId: 't1',
                messageId: 'm1',
                model: 'm',
                chunksReceived: 2,
                startedAt: 1,
                completedAt: 2,
            },
        ];
        const fetchMock = vi.fn(() =>
            Promise.resolve(createJsonResponse(statuses.shift()))
        );
        (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock;

        vi.useFakeTimers();
        const promise = waitForJobCompletion('job-1', undefined, 10, 100);
        await vi.runAllTimersAsync();
        const result = await promise;

        expect(result.status).toBe('complete');
        expect(fetchMock).toHaveBeenCalled();
    });
});
