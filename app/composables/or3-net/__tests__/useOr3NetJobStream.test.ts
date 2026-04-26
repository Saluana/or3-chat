import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed } from 'vue';

import { testRuntimeConfig } from '~~/tests/setup';

const getAccessTokenMock = vi.fn();
const invalidateMock = vi.fn();
const getJobMock = vi.fn();

vi.mock('../useOr3NetAuth', () => ({
    useOr3NetAuth: () => ({
        isConfigured: computed(() => true),
        getAccessToken: getAccessTokenMock,
        invalidate: invalidateMock,
    }),
}));

vi.mock('../useOr3NetClient', () => ({
    useOr3NetClient: () => ({
        getJob: getJobMock,
    }),
}));

function createSseResponse(chunks: string[]): Response {
    const encoder = new TextEncoder();
    return new Response(
        new ReadableStream<Uint8Array>({
            start(controller) {
                for (const chunk of chunks) {
                    controller.enqueue(encoder.encode(chunk));
                }
                controller.close();
            },
        }),
        {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
        }
    );
}

describe('useOr3NetJobStream', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.resetModules();
        getAccessTokenMock.mockReset().mockResolvedValue('token-a');
        invalidateMock.mockReset();
        getJobMock.mockReset();
        testRuntimeConfig.value = {
            ...testRuntimeConfig.value,
            public: {
                ...testRuntimeConfig.value.public,
                or3Net: {
                    enabled: true,
                    hostUrl: 'https://net.test',
                },
            },
        };
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('parses SSE events and accumulates output until terminal completion', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                createSseResponse([
                    'event: job.accepted\ndata: {"job_id":"job-1"}\n\n',
                    'event: job.started\ndata: {"job_id":"job-1"}\n\n',
                    'event: text.delta\ndata: {"text":"hello "}\n\n',
                    'event: tool.call\ndata: {"name":"shell"}\n\n',
                    'event: text.delta\ndata: {"text":"world"}\n\n',
                    'event: job.completed\ndata: {"job_id":"job-1","output":"done"}\n\n',
                ])
            )
        );

        const { useOr3NetJobStream } = await import('../useOr3NetJobStream');
        const stream = useOr3NetJobStream();
        await stream.attach('job-1');

        expect(stream.status.value).toBe('completed');
        expect(stream.content.value).toBe('hello world');
        expect(stream.isTerminal.value).toBe(true);
        expect(stream.events.value.map((event) => event.event)).toEqual([
            'job.accepted',
            'job.started',
            'text.delta',
            'tool.call',
            'text.delta',
            'job.completed',
        ]);
    });

    it('reconnects after a dropped stream and replays retained history without duplicating output', async () => {
        const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                createSseResponse([
                    'event: job.accepted\ndata: {"job_id":"job-1"}\n\n',
                    'event: text.delta\ndata: {"text":"hello"}\n\n',
                ])
            )
            .mockResolvedValueOnce(
                createSseResponse([
                    'event: job.accepted\ndata: {"job_id":"job-1"}\n\n',
                    'event: text.delta\ndata: {"text":"hello"}\n\n',
                    'event: job.completed\ndata: {"job_id":"job-1"}\n\n',
                ])
            );
        vi.stubGlobal('fetch', fetchMock);
        getJobMock.mockResolvedValue({
            job_id: 'job-1',
            workspace_id: 'ws-1',
            status: 'running',
            created_at: '2026-04-01T00:00:00.000Z',
        });

        const { useOr3NetJobStream } = await import('../useOr3NetJobStream');
        const stream = useOr3NetJobStream();
        await stream.attach('job-1');

        await vi.advanceTimersByTimeAsync(500);
        await Promise.resolve();
        await Promise.resolve();

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(stream.content.value).toBe('hello');
        expect(stream.status.value).toBe('completed');
        expect(stream.isTerminal.value).toBe(true);
        randomSpy.mockRestore();
    });

    it('backs off reconnect attempts exponentially', async () => {
        const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                createSseResponse([
                    'event: job.accepted\ndata: {"job_id":"job-1"}\n\n',
                ])
            )
            .mockResolvedValueOnce(
                createSseResponse([
                    'event: job.accepted\ndata: {"job_id":"job-1"}\n\n',
                ])
            )
            .mockResolvedValueOnce(
                createSseResponse([
                    'event: job.accepted\ndata: {"job_id":"job-1"}\n\n',
                    'event: job.completed\ndata: {"job_id":"job-1"}\n\n',
                ])
            );
        vi.stubGlobal('fetch', fetchMock);
        getJobMock.mockResolvedValue({
            job_id: 'job-1',
            workspace_id: 'ws-1',
            status: 'running',
            created_at: '2026-04-01T00:00:00.000Z',
        });

        const { useOr3NetJobStream } = await import('../useOr3NetJobStream');
        const stream = useOr3NetJobStream();
        await stream.attach('job-1');

        await vi.advanceTimersByTimeAsync(499);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();
        await Promise.resolve();
        expect(fetchMock).toHaveBeenCalledTimes(2);

        await vi.advanceTimersByTimeAsync(999);
        expect(fetchMock).toHaveBeenCalledTimes(2);

        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();
        await Promise.resolve();
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(stream.status.value).toBe('completed');

        randomSpy.mockRestore();
    });

    it('uses retry_after_ms from 429 stream errors instead of the default reconnect backoff', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        error: 'slow down',
                        code: 'rate.limit_exceeded',
                        retry_after_ms: 4_000,
                    }),
                    {
                        status: 429,
                        headers: { 'Content-Type': 'application/json' },
                    }
                )
            )
            .mockResolvedValueOnce(
                createSseResponse([
                    'event: job.accepted\ndata: {"job_id":"job-1"}\n\n',
                    'event: job.completed\ndata: {"job_id":"job-1"}\n\n',
                ])
            );
        vi.stubGlobal('fetch', fetchMock);
        getJobMock.mockResolvedValue({
            job_id: 'job-1',
            workspace_id: 'ws-1',
            status: 'running',
            created_at: '2026-04-01T00:00:00.000Z',
        });

        const { useOr3NetJobStream } = await import('../useOr3NetJobStream');
        const stream = useOr3NetJobStream();
        await stream.attach('job-1');

        await vi.advanceTimersByTimeAsync(3_999);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();
        await Promise.resolve();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(stream.status.value).toBe('completed');
    });

    it('caps the retained event log and clears terminal state on detach', async () => {
        const chunks = Array.from({ length: 105 }, (_, index) => {
            return `event: text.delta\ndata: {"text":"${index}"}\n\n`;
        });
        chunks.push('event: job.completed\ndata: {"job_id":"job-1"}\n\n');
        vi.stubGlobal('fetch', vi.fn(async () => createSseResponse(chunks)));

        const { useOr3NetJobStream } = await import('../useOr3NetJobStream');
        const stream = useOr3NetJobStream();
        await stream.attach('job-1');

        expect(stream.events.value).toHaveLength(100);
        expect(stream.events.value[0]?.event).toBe('text.delta');
        expect(stream.isTerminal.value).toBe(true);

        stream.detach();
        expect(stream.isTerminal.value).toBe(false);
    });
});
