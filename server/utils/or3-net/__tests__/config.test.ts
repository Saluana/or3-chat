import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeConfigMock = vi.fn();

vi.mock('#imports', () => ({
    useRuntimeConfig: runtimeConfigMock,
}));

describe('getOr3NetServerConfig', () => {
    beforeEach(() => {
        vi.resetModules();
        runtimeConfigMock.mockReturnValue({
            or3Net: {
                hostUrl: 'https://net.test/',
                exchangeSecret: 'secret',
                exchangeIssuer: 'or3-chat',
                exchangeAudience: 'or3-net',
                exchangeTtlMs: 60_000,
                exchangeTimeoutMs: 15_000,
            },
        });
    });

    it('normalizes the host URL and exposes the configured exchange timeout', async () => {
        const { getOr3NetServerConfig } = await import('../config');

        expect(getOr3NetServerConfig()).toMatchObject({
            enabled: true,
            hostUrl: 'https://net.test',
            exchangeTimeoutMs: 15_000,
        });
    });

    it('falls back to the default exchange timeout when the runtime value is invalid', async () => {
        runtimeConfigMock.mockReturnValue({
            or3Net: {
                hostUrl: 'https://net.test',
                exchangeSecret: 'secret',
                exchangeTimeoutMs: 0,
            },
        });

        const { getOr3NetServerConfig } = await import('../config');

        expect(getOr3NetServerConfig().exchangeTimeoutMs).toBe(10_000);
    });
});
