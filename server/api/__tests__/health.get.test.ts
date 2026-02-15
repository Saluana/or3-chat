import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockH3Event } from '../../../tests/utils/mock-h3';
import type { H3Event } from 'h3';

type RuntimeConfigMock = {
    sync: { enabled: boolean; provider: string };
    storage: {
        enabled: boolean;
        provider: string;
        allowedMimeTypes?: string[];
        workspaceQuotaBytes?: number;
        gcRetentionSeconds?: number;
        gcCooldownMs?: number;
    };
    auth: { enabled: boolean; provider: string };
};

const runtimeConfigMock: RuntimeConfigMock = {
    sync: { enabled: true, provider: 'convex' },
    storage: {
        enabled: true,
        provider: 'convex',
        allowedMimeTypes: undefined,
        workspaceQuotaBytes: undefined,
        gcRetentionSeconds: 2592000,
        gcCooldownMs: 60000,
    },
    auth: { enabled: true, provider: 'clerk' },
};

vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    getQuery: (event: H3Event & { node?: { req?: { url?: string } } }) => {
        const rawUrl = event.node?.req?.url ?? '';
        const search = rawUrl.includes('?') ? rawUrl.split('?')[1] ?? '' : '';
        return Object.fromEntries(new URLSearchParams(search).entries());
    },
}));

vi.mock('#imports', () => ({
    useRuntimeConfig: () => runtimeConfigMock,
}));

describe('Health check endpoint', () => {
    let handler: any;

    beforeEach(async () => {
        vi.resetModules();
        runtimeConfigMock.sync = { enabled: true, provider: 'convex' };
        runtimeConfigMock.storage = { enabled: true, provider: 'convex' };
        runtimeConfigMock.auth = { enabled: true, provider: 'clerk' };

        const module = await import('../health.get');
        handler = module.default;
    });

    it('returns basic health status', async () => {
        const event = createMockH3Event({
            method: 'GET',
            path: '/api/health',
        });

        const response = await handler(event);

        expect(response.status).toBe('ok');
        expect(response.timestamp).toBeDefined();
        expect(typeof response.uptime).toBe('number');
        expect(response.providers).toBeUndefined();
    });

    it('includes provider status when deep=true', async () => {
        const event = createMockH3Event({
            method: 'GET',
            path: '/api/health?deep=true',
            query: { deep: 'true' },
        });

        const response = await handler(event);

        expect(response.status).toBe('ok');
        expect(response.providers).toBeDefined();
        expect(response.providers?.sync).toEqual({
            available: true,
            provider: 'convex',
        });
        expect(response.providers?.storage).toEqual({
            available: true,
            provider: 'convex',
        });
        expect(response.providers?.auth).toEqual({
            available: true,
            provider: 'clerk',
        });
    });

    it('marks as degraded when provider is enabled but not configured', async () => {
        runtimeConfigMock.sync = { enabled: true, provider: '' };
        runtimeConfigMock.storage = { enabled: false, provider: '' };
        runtimeConfigMock.auth = { enabled: true, provider: 'clerk' };

        const event = createMockH3Event({
            method: 'GET',
            path: '/api/health?deep=true',
            query: { deep: 'true' },
        });

        const response = await handler(event);

        expect(response.status).toBe('degraded');
    });
});
