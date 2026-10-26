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
    it('cancels an upstream body on abort while the watchdog has a full prefetched queue', async () => {
        const controller = new AbortController();
        let pulls = 0; let cancelled = false;
        const source = new ReadableStream<Uint8Array>({
            pull(stream) { pulls++; stream.enqueue(new Uint8Array([1])); },
            cancel() { cancelled = true; },
        }, { highWaterMark: 0 });
        const wrapped = withIdleWatchdog(source, { signal: controller.signal });
        await vi.waitFor(() => expect(pulls).toBe(1));
        controller.abort();
        expect(cancelled).toBe(true);
        await expect(wrapped.getReader().read()).rejects.toMatchObject({ name: 'AbortError' });
    });

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
