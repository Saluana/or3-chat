import { describe, expect, it } from 'vitest';
import { isPortAvailable } from '../dev-server';

describe('wizard dev-server helpers', () => {
    it('rejects invalid ports', async () => {
        await expect(isPortAvailable(0)).resolves.toBe(false);
        await expect(isPortAvailable(65_536)).resolves.toBe(false);
    });

    it('skips an unsupported optional IPv6 loopback probe', async () => {
        const probe = async (_port: number, host: string) =>
            host === '::1' ? 'unsupported' as const : 'available' as const;

        await expect(isPortAvailable(3_000, '127.0.0.1', probe)).resolves.toBe(true);
    });

    it('reports a port occupied on the requested host', async () => {
        const probe = async () => 'unavailable' as const;

        await expect(isPortAvailable(3_000, '127.0.0.1', probe)).resolves.toBe(false);
    });
});
