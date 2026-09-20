import { describe, expect, it, vi } from 'vitest';
import { createFetchConnectionTransport } from '../transport';

/**
 * The fetch transport must honor the caller signal (revocation or disconnect),
 * including a signal that is already aborted when the request starts.
 */
describe('fetch connection transport cancellation', () => {
    it('aborts an in-flight provider request when the caller cancels', async () => {
        let observedSignal: AbortSignal | undefined;
        const fetchImpl = vi.fn(
            async (_url: string, init: { signal?: AbortSignal }) => {
                observedSignal = init.signal;
                // Mimic a slow provider: settle only when the signal aborts.
                await new Promise<never>((_resolve, reject) => {
                    init.signal?.addEventListener('abort', () =>
                        reject(new Error('This operation was aborted'))
                    );
                });
                return new Response('{}', { status: 200 });
            }
        );
        const transport = createFetchConnectionTransport(
            fetchImpl as unknown as typeof fetch
        );
        const controller = new AbortController();
        const pending = transport({
            url: 'https://fake.provider.test/v1/items',
            method: 'GET',
            headers: {},
            timeoutMs: 30_000,
            maxResponseBytes: 1024,
            redirect: 'manual',
            signal: controller.signal,
        });

        await new Promise((resolve) => setTimeout(resolve, 0));
        controller.abort('revoked');
        await expect(pending).rejects.toThrow('aborted');
        expect(observedSignal).toBeInstanceOf(AbortSignal);
        expect(observedSignal?.aborted).toBe(true);
    });

    it('fails fast when the signal is already aborted', async () => {
        const fetchImpl = vi.fn(async (_url: string, init: { signal?: AbortSignal }) => {
            // Mimic fetch: an aborted signal rejects without network I/O.
            if (init.signal?.aborted) throw new Error('This operation was aborted');
            return new Response('{}', { status: 200 });
        });
        const transport = createFetchConnectionTransport(
            fetchImpl as unknown as typeof fetch
        );
        const controller = new AbortController();
        controller.abort('revoked');

        await expect(
            transport({
                url: 'https://fake.provider.test/v1/items',
                method: 'GET',
                headers: {},
                timeoutMs: 30_000,
                maxResponseBytes: 1024,
                redirect: 'manual',
                signal: controller.signal,
            })
        ).rejects.toThrow('aborted');
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
});
