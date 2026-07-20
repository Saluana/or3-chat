import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    abortableDelay,
    fetchWithResponseDeadline,
    withIdleWatchdog,
} from '../deadlines';

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('OpenRouter upstream deadlines', () => {
    it('terminates a request whose headers never resolve', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
        const request = fetchWithResponseDeadline('/never', {}, { timeoutMs: 25 });
        const assertion = expect(request).rejects.toMatchObject({
            name: 'OpenRouterTimeoutError', phase: 'response', timeoutMs: 25,
        });

        await vi.advanceTimersByTimeAsync(25);

        await assertion;
    });

    it('terminates a response body that goes silent', async () => {
        vi.useFakeTimers();
        const silent = new ReadableStream<Uint8Array>({ pull() {} });
        const reader = withIdleWatchdog(silent, { timeoutMs: 40 }).getReader();
        const read = reader.read();
        const assertion = expect(read).rejects.toMatchObject({
            name: 'OpenRouterTimeoutError', phase: 'idle', timeoutMs: 40,
        });

        await vi.advanceTimersByTimeAsync(40);

        await assertion;
    });

    it('preserves caller abort and cancels an abortable retry sleep', async () => {
        vi.useFakeTimers();
        const controller = new AbortController();
        const wait = abortableDelay(30_000, controller.signal);
        controller.abort();

        await expect(wait).rejects.toMatchObject({ name: 'AbortError' });
        expect(vi.getTimerCount()).toBe(0);
    });
});
