import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchImageBlob } from '../files';
import { buildOpenRouterMessages } from '~/core/auth/openrouter-build';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe.each(['input', 'generated'] as const)('%s media download bounds', kind => {
    const run = (url: string, signal?: AbortSignal) => kind === 'generated' ? fetchImageBlob(url, signal)
        : buildOpenRouterMessages([{ role: 'user', content: [{ type: 'image', image: url, mediaType: 'image/png' }] }], { signal });
    const limit = (kind === 'generated' ? 20 : 5) * 1024 * 1024;

    it.each(['abort', 'deadline'] as const)('cancels a stalled body on %s after headers have arrived', async reason => {
        vi.useFakeTimers();
        const controller = new AbortController();
        let body!: ReadableStreamDefaultController<Uint8Array>;
        let entered!: () => void;
        const reached = new Promise<void>(resolve => { entered = resolve; });
        let cancelled = false;
        const response = new Response(new ReadableStream<Uint8Array>({
            start(value) { body = value; }, pull() { entered(); }, cancel() { cancelled = true; },
        }, { highWaterMark: 0 }), { headers: { 'content-type': 'image/png' } });
        // Response is Node's transport implementation; FileReader is jsdom's.
        vi.spyOn(response, 'blob').mockImplementation(async () => new Blob([await response.arrayBuffer()], { type: 'image/png' }));
        vi.stubGlobal('fetch', vi.fn(async () => response));
        const pending = run(`https://media.example.test/${crypto.randomUUID()}.png`, controller.signal).catch(error => error);
        await reached;
        if (reason === 'abort') controller.abort(new DOMException('Stopped', 'AbortError'));
        else await vi.advanceTimersByTimeAsync(8001);
        // Let an implementation that ignores cancellation finish, so this
        // regression fails on observable behavior rather than test timeout.
        if (!cancelled) { body.enqueue(new Uint8Array([1])); body.close(); }
        await vi.runAllTimersAsync();
        expect(await pending).toMatchObject({ name: reason === 'abort' ? 'AbortError'
            : kind === 'input' ? 'AttachmentHydrationError' : 'TimeoutError' });
        expect(cancelled).toBe(true);
    });

    it('stops reading an unknown-length body as soon as its byte limit is exceeded', async () => {
        let pulls = 0; let cancelled = false;
        const response = new Response(new ReadableStream<Uint8Array>({
            pull(controller) {
                pulls++;
                if (pulls === 1) controller.enqueue(new Uint8Array(limit + 1));
                else controller.close();
            }, cancel() { cancelled = true; },
        }, { highWaterMark: 0 }), { headers: { 'content-type': 'image/png' } });
        vi.spyOn(response, 'blob').mockImplementation(async () => new Blob([await response.arrayBuffer()], { type: 'image/png' }));
        vi.stubGlobal('fetch', vi.fn(async () => response));
        await run(`https://media.example.test/${crypto.randomUUID()}.png`).catch(() => {});
        expect(cancelled).toBe(true);
        expect(pulls).toBe(1);
    });
});
