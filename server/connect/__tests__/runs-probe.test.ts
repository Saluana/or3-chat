import { describe, expect, it, vi } from 'vitest';
import { probeRunsCapabilities } from '../runs-probe';

describe('Runs capability probe', () => {
    it('checks the declared base path with a bearer credential', async () => {
        const requests: Array<{ url: string; init?: RequestInit }> = [];
        const result = await probeRunsCapabilities('https://agent.example/or3/', 'secret', {
            fetch: async (input, init) => {
                requests.push({ url: String(input), init });
                return new Response(
                    JSON.stringify({
                        features: { session_resources: true, run_events_sse: true },
                    }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                );
            },
        });

        expect(result).toEqual({ sessions: true, events: true });
        expect(requests[0]?.url).toBe('https://agent.example/or3/v1/capabilities');
        expect(requests[0]?.init?.headers).toEqual({
            Accept: 'application/json',
            Authorization: 'Bearer secret',
        });
    });

    it('does not accept a public HTTP runtime URL or an unexpected path', async () => {
        await expect(
            probeRunsCapabilities('http://agent.example/', 'secret'),
        ).rejects.toMatchObject({ statusCode: 400 });
        await expect(
            probeRunsCapabilities('https://agent.example/private/', 'secret'),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it.each([
        { sessions: null, run_events: null },
        { sessions: false, run_events: false },
        { sessions: {}, run_events: {} },
        { sessions: { path: 'v1/sessions' }, run_events: { path: '' } },
    ])('rejects malformed endpoint declarations: %o', async (endpoints) => {
        const result = await probeRunsCapabilities('https://agent.example/or3/', 'secret', {
            fetch: async () =>
                new Response(JSON.stringify({ endpoints }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                }),
        });

        expect(result).toEqual({ sessions: false, events: false });
    });

    it('accepts documented endpoint objects when feature flags are absent', async () => {
        const result = await probeRunsCapabilities('https://agent.example/or3/', 'secret', {
            fetch: async () =>
                new Response(
                    JSON.stringify({
                        endpoints: {
                            sessions: { method: 'GET', path: '/api/sessions' },
                            run_events: { method: 'GET', path: '/v1/runs/{run_id}/events' },
                        },
                    }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                ),
        });

        expect(result).toEqual({ sessions: true, events: true });
    });

    it.each([
        ['non-2xx response', async () => new Response('nope', { status: 503 })],
        ['invalid JSON', async () => new Response('{', { status: 200 })],
        ['thrown fetch', async () => Promise.reject(new Error('offline'))],
    ])('returns no capabilities on %s', async (_name, fetch) => {
        await expect(
            probeRunsCapabilities('https://agent.example/or3/', 'secret', { fetch }),
        ).resolves.toEqual({ sessions: false, events: false });
    });

    it('aborts a stalled request and clears its timer', async () => {
        vi.useFakeTimers();
        try {
            let signal: AbortSignal | undefined;
            const pending = probeRunsCapabilities('https://agent.example/or3/', 'secret', {
                timeoutMs: 100,
                fetch: async (_input, init) => {
                    signal = init?.signal ?? undefined;
                    return await new Promise<Response>((_resolve, reject) => {
                        signal?.addEventListener('abort', () => reject(signal?.reason));
                    });
                },
            });
            await vi.advanceTimersByTimeAsync(100);
            await expect(pending).resolves.toEqual({ sessions: false, events: false });
            expect(signal?.aborted).toBe(true);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });
});
