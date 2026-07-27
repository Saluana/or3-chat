/* @vitest-environment node */
import type { LookupAddress, LookupOptions } from 'node:dns';
import { describe, expect, it } from 'vitest';
import { createSsrfSafeLookup } from '../ssrf-safe-agent';
import { validateWebhookUrl } from '../url-validator';

type LookupResult = {
    address: string | LookupAddress[];
    family?: number;
};

function createMockLookup(addresses: LookupAddress[]) {
    return (
        hostname: string,
        options: LookupOptions & { all?: boolean },
        callback: (
            error: NodeJS.ErrnoException | null,
            address: string | LookupAddress[],
            family?: number
        ) => void
    ) => {
        if (options.all) {
            callback(null, addresses);
            return;
        }

        const firstAddress = addresses[0];
        if (!firstAddress) {
            callback(new Error(`No addresses for ${hostname}`), '', 0);
            return;
        }

        callback(null, firstAddress.address, firstAddress.family);
    };
}

function runLookup(
    options: {
        addresses: LookupAddress[];
        hostname?: string;
        lookupOptions?: LookupOptions;
    }
): Promise<LookupResult> {
    const lookup = createSsrfSafeLookup({
        blockPrivateIps: true,
        lookup: createMockLookup(options.addresses),
    });

    return new Promise((resolve, reject) => {
        lookup(
            options.hostname ?? 'example.com',
            options.lookupOptions ?? {},
            (error, address, family) => {
                if (error) {
                    reject(error);
                    return;
                }

                resolve({ address, family });
            }
        );
    });
}

describe('ssrf-safe webhook lookup', () => {
    it('allows public IPs', async () => {
        const result = await runLookup({
            addresses: [{ address: '8.8.8.8', family: 4 }],
            lookupOptions: { all: true },
        });

        expect(result.address).toEqual([{ address: '8.8.8.8', family: 4 }]);
    });

    it('blocks private IPv4 addresses before connect', async () => {
        await expect(
            runLookup({
                addresses: [{ address: '10.0.0.5', family: 4 }],
            })
        ).rejects.toMatchObject({
            code: 'EPRIVATEIP',
        });
    });

    it('blocks IPv6 loopback', async () => {
        await expect(
            runLookup({
                addresses: [{ address: '::1', family: 6 }],
            })
        ).rejects.toMatchObject({
            code: 'EPRIVATEIP',
        });
    });

    it('blocks IPv6 link-local addresses', async () => {
        await expect(
            runLookup({
                addresses: [{ address: 'fe80::1', family: 6 }],
            })
        ).rejects.toMatchObject({
            code: 'EPRIVATEIP',
        });
    });

    it('blocks IPv4-mapped IPv6 loopback addresses', async () => {
        await expect(
            runLookup({
                addresses: [{ address: '::ffff:127.0.0.1', family: 6 }],
            })
        ).rejects.toMatchObject({
            code: 'EPRIVATEIP',
        });
    });

    it('blocks a hostname that resolves to a private IP at connect time', async () => {
        await expect(
            runLookup({
                hostname: 'rebind.example',
                addresses: [{ address: '192.168.1.22', family: 4 }],
            })
        ).rejects.toMatchObject({
            code: 'EPRIVATEIP',
        });
    });

    it('blocks DNS rebinding between URL validation and connection lookup', async () => {
        const hostname = 'rebind.example';
        const parsed = await validateWebhookUrl(
            `https://${hostname}/webhook`,
            {
                blockPrivateIps: true,
                resolver: async () => [
                    { address: '8.8.8.8', family: 4 },
                ],
            }
        );
        expect(parsed.hostname).toBe(hostname);

        await expect(
            runLookup({
                hostname,
                addresses: [
                    { address: '169.254.169.254', family: 4 },
                ],
            })
        ).rejects.toMatchObject({
            code: 'EPRIVATEIP',
        });
    });
});
