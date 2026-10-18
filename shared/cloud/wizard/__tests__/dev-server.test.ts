import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPortAvailable, waitForHttpReady } from '../dev-server';
afterEach(() => vi.unstubAllGlobals());

describe('wizard dev-server helpers', () => {
    it.each([500, 200])('rejects failed HTTP responses and non-OR3 services', async status => {
        vi.stubGlobal('fetch', async () => new Response('not OR3 health', { status }));
        await expect(waitForHttpReady('http://localhost/api/health', 20)).rejects.toThrow(/Timed out/);
    });
    it('aborts a pending readiness request at its deadline', async () => {
        let aborted = false;
        vi.stubGlobal('fetch', (_url: string, options: RequestInit) => new Promise((_resolve, reject) => options.signal?.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); })));
        const result = waitForHttpReady('http://localhost/api/health', 20);
        const outcome = await Promise.race([result.catch(() => 'timed out'), new Promise(resolve => setTimeout(() => resolve('hung'), 200))]);
        expect(outcome).toBe('timed out');
        expect(aborted).toBe(true);
    });
    it('rejects invalid ports', async () => {
        await expect(isPortAvailable(0)).resolves.toBe(false);
        await expect(isPortAvailable(65_536)).resolves.toBe(false);
    });

    it('skips an unsupported optional IPv6 loopback probe', async () => {
        const probe = async (_port: number, host: string) =>
            host === '::1' ? 'unsupported' as const : 'available' as const;

        await expect(isPortAvailable(3_000, '127.0.0.1', probe)).resolves.toBe(true);
    });
});
