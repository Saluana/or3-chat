import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    openRouterStream,
    openRouterStreamWithRetry,
    startBackgroundStream,
    isBackgroundStreamingEnabled,
    waitForJobCompletion,
    pollJobStatus,
    BackgroundJobPollError,
} from '../openrouterStream';
import { OpenRouterTimeoutError } from '~~/shared/openrouter/deadlines';

const runtimeConfigMock = {
    public: {
        ssrAuthEnabled: false,
        backgroundStreaming: { enabled: true },
    },
};

const parseMock = vi.fn(async function* (..._args: unknown[]) {
    yield { type: 'text', text: 'hello' };
});

vi.mock('~~/shared/openrouter/parseOpenRouterSSE', () => ({
    parseOpenRouterSSE: (...args: unknown[]) => parseMock(...args),
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
        runtimeConfigMock.public.ssrAuthEnabled = false;
        runtimeConfigMock.public.backgroundStreaming.enabled = true;
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('uses server route for streaming when available', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValue(createStreamResponse());
        (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

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

    it('omits optional output modalities when a provider does not accept them', async () => {
        const fetchMock = vi.fn().mockResolvedValue(createStreamResponse());
        (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

        for await (const _event of openRouterStream({
            apiKey: 'key-1',
            model: 'text-provider/model',
            orMessages: [{ role: 'user', content: 'hi' }],
        })) {
            // drain
        }

        const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
        const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
        expect(body).not.toHaveProperty('modalities');
    });

    it('hands the explicit streamed-field mode to the shared parser', async () => {
        const fetchMock = vi.fn().mockResolvedValue(createStreamResponse());
        (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

        for await (const _event of openRouterStream({
            apiKey: 'key-1',
            model: 'snapshot-provider/model',
            orMessages: [{ role: 'user', content: 'hi' }],
            modalities: ['text'],
            streamedFieldMode: 'cumulative-snapshot',
        })) {
            // drain
        }

        expect(parseMock).toHaveBeenCalledWith(expect.any(ReadableStream), {
            streamedFieldMode: 'cumulative-snapshot',
        });
    });

    it('sends reasoning effort and Anthropic cache control through the server route', async () => {
        const fetchMock = vi.fn().mockResolvedValue(createStreamResponse());
        (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

        for await (const _event of openRouterStream({
            apiKey: 'key-1',
            model: '~anthropic/claude-sonnet-latest',
            orMessages: [{ role: 'user', content: 'hi' }],
            modalities: ['text'],
            reasoning: { effort: 'high' },
        })) {
            // drain
        }

        const [, init] = fetchMock.mock.calls[0] as [
            string,
            RequestInit,
        ];
        const body = JSON.parse(String(init.body));
        expect(body.reasoning).toEqual({ effort: 'high' });
        expect(body.cache_control).toEqual({ type: 'ephemeral' });
    });

    it('does not send cache control for non-Anthropic models', async () => {
        const fetchMock = vi.fn().mockResolvedValue(createStreamResponse());
        (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

        for await (const _event of openRouterStream({
            apiKey: 'key-1',
            model: 'openai/gpt-oss-120b',
            orMessages: [{ role: 'user', content: 'hi' }],
            modalities: ['text'],
        })) {
            // drain
        }

        const [, init] = fetchMock.mock.calls[0] as [
            string,
            RequestInit,
        ];
        const body = JSON.parse(String(init.body));
        expect(body.cache_control).toBeUndefined();
    });

    it('falls back to direct OpenRouter on 404 and caches unavailability', async () => {
        const fetchMock = vi.fn((url: RequestInfo | URL) => {
            if (url === '/api/openrouter/stream') {
                return Promise.resolve(createJsonResponse({ error: 'missing' }, 404));
            }
            return Promise.resolve(createStreamResponse());
        });
        (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

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

    it('does not fall back on proxy 5xx; error propagates and cache is not poisoned', async () => {
        const fetchMock = vi.fn((url: RequestInfo | URL) => {
            if (url === '/api/openrouter/stream') {
                return Promise.resolve(createJsonResponse({ error: 'proxy-failed' }, 500));
            }
            return Promise.resolve(createStreamResponse());
        });
        (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

        await expect(
            (async () => {
                for await (const _event of openRouterStream({
                    apiKey: 'key-1',
                    model: 'model-1',
                    orMessages: [{ role: 'user', content: 'hi' }],
                    modalities: ['text'],
                })) {
                    // noop
                }
            })()
        ).rejects.toThrow('OpenRouter proxy error 500');

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).not.toHaveBeenCalledWith(
            'https://openrouter.ai/api/v1/chat/completions',
            expect.anything()
        );
        const cached = localStorage.getItem('or3:server-route-available');
        expect(cached).toBeFalsy();
    });

    it('requires server route in SSR mode when no client API key is available', async () => {
        runtimeConfigMock.public.ssrAuthEnabled = true;
        runtimeConfigMock.public.backgroundStreaming.enabled = false;

        const fetchMock = vi.fn((url: RequestInfo | URL) => {
            if (url === '/api/openrouter/stream') {
                return Promise.resolve(createJsonResponse({ error: 'missing' }, 404));
            }
            return Promise.resolve(createStreamResponse());
        });
        (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

        await expect(
            (async () => {
                for await (const _event of openRouterStream({
                    model: 'model-1',
                    orMessages: [{ role: 'user', content: 'hi' }],
                    modalities: ['text'],
                })) {
                    // noop
                }
            })()
        ).rejects.toThrow('OpenRouter server route unavailable in SSR mode');

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(
            '/api/openrouter/stream',
            expect.objectContaining({ method: 'POST' })
        );
    });

    it('preserves a pre-header abort and never falls back to another request', async () => {
        const controller = new AbortController();
        const fetchMock = vi.fn().mockImplementation(() => {
            controller.abort();
            return Promise.reject(new DOMException('Aborted', 'AbortError'));
        });
        (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

        const failure = await (async () => {
            try {
                for await (const _event of openRouterStream({
                    apiKey: 'key-1', model: 'model-1',
                    orMessages: [{ role: 'user', content: 'hi' }],
                    modalities: ['text'], signal: controller.signal,
                })) {
                    // drain
                }
            } catch (error) {
                return error;
            }
        })();

        expect(failure).toBeInstanceOf(Error);
        expect((failure as Error).name).toBe('AbortError');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('exposes background streaming availability cache', () => {
        localStorage.setItem('or3:background-streaming-available', 'true');
        const enabled = isBackgroundStreamingEnabled();
        expect(enabled).toBe(true);
    });

    it('prefers explicit enabled config over stale false cache', () => {
        runtimeConfigMock.public.backgroundStreaming.enabled = true;
        localStorage.setItem('or3:background-streaming-available', 'false');
        const enabled = isBackgroundStreamingEnabled();
        expect(enabled).toBe(true);
    });

    it('openRouterStreamWithRetry retries on 429 and yields events', async () => {
        let attempts = 0;
        const fetchMock = vi.fn((url: RequestInfo | URL) => {
            if (url !== '/api/openrouter/stream') {
                return Promise.resolve(createStreamResponse());
            }
            attempts++;
            if (attempts === 1) {
                return Promise.resolve(
                    new Response(JSON.stringify({ error: 'rate-limited' }), {
                        status: 429,
                        headers: { 'Retry-After': '0' },
                    })
                );
            }
            return Promise.resolve(createStreamResponse());
        });
        (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

        const events: Array<{ type: string; text?: string }> = [];
        for await (const event of openRouterStreamWithRetry({
            apiKey: 'key-1',
            model: 'model-1',
            orMessages: [{ role: 'user', content: 'hi' }],
            modalities: ['text'],
        })) {
            events.push(event);
        }

        expect(attempts).toBe(2);
        expect(events).toHaveLength(1);
    });

    it('openRouterStreamWithRetry gives up after maxRetries', async () => {
        const fetchMock = vi.fn((url: RequestInfo | URL) => {
            if (url !== '/api/openrouter/stream') {
                return Promise.resolve(createStreamResponse());
            }
            return Promise.resolve(
                new Response(JSON.stringify({ error: 'rate-limited' }), {
                    status: 429,
                    headers: { 'Retry-After': '0' },
                })
            );
        });
        (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

        await expect(
            (async () => {
                for await (const _event of openRouterStreamWithRetry({
                    apiKey: 'key-1',
                    model: 'model-1',
                    orMessages: [{ role: 'user', content: 'hi' }],
                    modalities: ['text'],
                    maxRetries: 1,
                })) {
                    // noop
                }
            })()
        ).rejects.toThrow('OpenRouter proxy error 429');

        expect(fetchMock).toHaveBeenCalledTimes(2); // initial + 1 retry
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
        (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

        const result = await startBackgroundStream({
            apiKey: 'key-1',
            model: 'model-1',
            orMessages: [{ role: 'user', content: 'hi' }],
            modalities: ['text'],
            threadId: 't1',
            messageId: 'm1',
            streamedFieldMode: 'cumulative-snapshot',
        });

        expect(result.jobId).toBe('job-1');
        expect(localStorage.getItem('or3:background-streaming-available')).toBe(
            'true'
        );
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(JSON.parse(String(init.body))._streamedFieldMode).toBe(
            'cumulative-snapshot'
        );
    });

    it('bounds the background-start wait before a job ID exists', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
        const start = startBackgroundStream({
            apiKey: 'key-1', model: 'model-1',
            orMessages: [{ role: 'user', content: 'hi' }], modalities: ['text'],
            threadId: 't1', messageId: 'm1', responseTimeoutMs: 20,
        });
        const assertion = expect(start).rejects.toBeInstanceOf(OpenRouterTimeoutError);

        await vi.advanceTimersByTimeAsync(20);

        await assertion;
    });

    it('lets caller abort cancel background admission before a job ID exists', async () => {
        vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
        const controller = new AbortController();
        const start = startBackgroundStream({
            apiKey: 'key-1', model: 'model-1',
            orMessages: [{ role: 'user', content: 'hi' }], modalities: ['text'],
            threadId: 't1', messageId: 'm1', signal: controller.signal,
        });
        const assertion = expect(start).rejects.toMatchObject({ name: 'AbortError' });

        controller.abort();

        await assertion;
    });

    it('startBackgroundStream sends Anthropic cache control', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            createJsonResponse({ jobId: 'job-1', status: 'streaming' })
        );
        (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

        await startBackgroundStream({
            apiKey: 'key-1',
            model: 'anthropic/claude-sonnet-latest',
            orMessages: [{ role: 'user', content: 'hi' }],
            modalities: ['text'],
            threadId: 't1',
            messageId: 'm1',
        });

        const [, init] = fetchMock.mock.calls[0] as [
            string,
            RequestInit,
        ];
        const body = JSON.parse(String(init.body));
        expect(body.cache_control).toEqual({ type: 'ephemeral' });
    });

    it('startBackgroundStream caches unavailability on 404', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValue(createJsonResponse({ error: 'nope' }, 404));
        (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

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

    it.each([
        [429, 'rate_limit', true],
        [503, 'server', true],
        [404, 'not_found', true],
        [401, 'auth', true],
        [400, 'protocol', false],
    ] as const)('classifies poll HTTP %s as %s', async (status, kind, retryable) => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ error: 'poll failed' }), {
                status,
                headers: { 'Content-Type': 'application/json', 'Retry-After': '2' },
            })
        );
        (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

        const failure = await pollJobStatus('job-1').catch((error) => error);

        expect(failure).toBeInstanceOf(BackgroundJobPollError);
        expect(failure).toMatchObject({ kind, retryable, statusCode: status });
        if (status === 429) expect(failure.retryAfterMs).toBe(2_000);
    });

    it('classifies a rejected poll fetch as retryable transport failure', async () => {
        (globalThis as unknown as { fetch: unknown }).fetch =
            vi.fn().mockRejectedValue(new TypeError('offline'));

        const failure = await pollJobStatus('job-1').catch((error) => error);

        expect(failure).toBeInstanceOf(BackgroundJobPollError);
        expect(failure).toMatchObject({ kind: 'transport', retryable: true });
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
        (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

        vi.useFakeTimers();
        const promise = waitForJobCompletion('job-1', undefined, 10, 100);
        await vi.runAllTimersAsync();
        const result = await promise;

        expect(result.status).toBe('complete');
        expect(fetchMock).toHaveBeenCalled();
    });
});
