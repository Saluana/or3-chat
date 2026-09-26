import { describe, expect, it, vi } from 'vitest';
import {
    combineWithDeadline,
    readBoundedBody,
} from '../bounded-body';
import { createFetchConnectionTransport } from '../transport';

function streamedResponse(chunks: readonly string[], headers: Record<string, string> = {}) {
    const encoder = new TextEncoder();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
            controller.close();
        },
        cancel() {
            cancelled = true;
        },
    });
    return {
        response: new Response(stream, { status: 200, headers }),
        wasCancelled: () => cancelled,
    };
}

describe('bounded response reading (finding 15)', () => {
    it('reads a small response fully', async () => {
        const { response } = streamedResponse(['{"a":', '1}']);
        const result = await readBoundedBody(response, { maxBytes: 1024 });
        expect(result).toMatchObject({ ok: true, text: '{"a":1}' });
    });

    it('stops reading and cancels once the ceiling is crossed', async () => {
        const { response, wasCancelled } = streamedResponse([
            'x'.repeat(512),
            'y'.repeat(512),
            'z'.repeat(512),
        ]);
        const result = await readBoundedBody(response, { maxBytes: 600 });
        expect(result).toMatchObject({ ok: false, code: 'response-too-large' });
        expect(wasCancelled()).toBe(true);
    });

    it('rejects early on a declared content-length over the ceiling', async () => {
        const { response, wasCancelled } = streamedResponse(['small'], {
            'content-length': '10000000',
        });
        const result = await readBoundedBody(response, { maxBytes: 1024 });
        expect(result).toMatchObject({ ok: false, code: 'response-too-large' });
        expect(wasCancelled()).toBe(true);
    });
});

describe('combined cancellation and deadline (finding 14)', () => {
    it('keeps the deadline active when the caller supplies a signal', async () => {
        const parent = new AbortController();
        const deadline = combineWithDeadline({ signal: parent.signal, timeoutMs: 30 });
        expect(deadline.signal.aborted).toBe(false);
        await new Promise((resolve) => setTimeout(resolve, 60));
        expect(deadline.signal.aborted).toBe(true);
        expect(deadline.timedOut()).toBe(true);
        deadline.dispose();
    });

    it('reports caller cancellation as cancellation, not a timeout', () => {
        const parent = new AbortController();
        const deadline = combineWithDeadline({ signal: parent.signal, timeoutMs: 10_000 });
        parent.abort('user-cancelled');
        expect(deadline.signal.aborted).toBe(true);
        expect(deadline.timedOut()).toBe(false);
        deadline.dispose();
    });
});

describe('connection transport', () => {
    it('enforces the response ceiling while streaming', async () => {
        const fetchImpl = vi.fn(async () =>
            streamedResponse(['a'.repeat(4000)]).response
        );
        const transport = createFetchConnectionTransport(fetchImpl as unknown as typeof fetch);
        await expect(
            transport({
                url: 'https://fake.provider.test/v1/items',
                method: 'GET',
                headers: {},
                timeoutMs: 1000,
                maxResponseBytes: 1024,
                redirect: 'manual',
            })
        ).rejects.toMatchObject({ code: 'response-too-large' });
    });

    it('aborts a stalled body read at the deadline', async () => {
        const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
            const signal = init?.signal as AbortSignal;
            const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode('{"partial":'));
                    signal.addEventListener('abort', () => {
                        try {
                            controller.error(new Error('aborted'));
                        } catch {
                            // Controller already errored.
                        }
                    });
                },
            });
            return new Response(stream, { status: 200 });
        });
        const transport = createFetchConnectionTransport(fetchImpl as unknown as typeof fetch);
        await expect(
            transport({
                url: 'https://fake.provider.test/v1/items',
                method: 'GET',
                headers: {},
                timeoutMs: 30,
                maxResponseBytes: 1024 * 1024,
                redirect: 'manual',
            })
        ).rejects.toThrow(/deadline/i);
    });
});
