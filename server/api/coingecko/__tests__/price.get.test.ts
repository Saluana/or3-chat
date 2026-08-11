import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';

const setResponseStatusMock = vi.hoisted(() => vi.fn());
const setHeaderMock = vi.hoisted(() => vi.fn());

vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    getQuery: (event: H3Event & { query?: Record<string, string> }) =>
        event.query ?? {},
    setResponseStatus: setResponseStatusMock,
    setHeader: setHeaderMock,
}));

function makeEvent(query: Record<string, string>): H3Event {
    return { query } as unknown as H3Event;
}

async function loadHandler() {
    return (await import('../price.get')).default as (
        event: H3Event
    ) => Promise<unknown>;
}

describe('GET /api/coingecko/price', () => {
    beforeEach(() => {
        vi.resetModules();
        setResponseStatusMock.mockReset();
        setHeaderMock.mockReset();
    });

    it('normalizes equivalent query lists into one bounded cache key', async () => {
        const fetchMock = vi.fn(
            async (url: string, _init?: RequestInit) =>
                new Response(JSON.stringify({ bitcoin: { usd: 1 } }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                })
        );
        vi.stubGlobal('fetch', fetchMock);
        const handler = await loadHandler();

        await handler(
            makeEvent({
                ids: 'ethereum, bitcoin,bitcoin',
                vs_currencies: 'usd, eur,usd',
            })
        );
        await handler(
            makeEvent({
                ids: 'bitcoin,ethereum',
                vs_currencies: 'eur,usd',
            })
        );

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
        expect(url.searchParams.get('ids')).toBe('bitcoin,ethereum');
        expect(url.searchParams.get('vs_currencies')).toBe('eur,usd');
        expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
            signal: expect.any(AbortSignal),
        });
    });

    it('rejects oversized lists without contacting the upstream API', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const handler = await loadHandler();

        const result = await handler(
            makeEvent({
                ids: Array.from(
                    { length: 51 },
                    (_, index) => `coin-${index}`
                ).join(','),
                vs_currencies: 'usd',
            })
        );

        expect(result).toMatchObject({
            error: expect.stringContaining('Invalid'),
        });
        expect(setResponseStatusMock).toHaveBeenCalledWith(
            expect.anything(),
            400
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('evicts the least-recently-used entry at the cache limit', async () => {
        const fetchMock = vi.fn(
            async () =>
                new Response(JSON.stringify({ coin: { usd: 1 } }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                })
        );
        vi.stubGlobal('fetch', fetchMock);
        const handler = await loadHandler();

        for (let index = 0; index < 129; index += 1) {
            await handler(
                makeEvent({ ids: `coin-${index}`, vs_currencies: 'usd' })
            );
        }
        await handler(makeEvent({ ids: 'coin-0', vs_currencies: 'usd' }));

        expect(fetchMock).toHaveBeenCalledTimes(130);
    });
});
