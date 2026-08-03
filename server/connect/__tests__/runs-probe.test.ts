import { describe, expect, it } from 'vitest';
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
});
