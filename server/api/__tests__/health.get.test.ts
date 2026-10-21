import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockH3Event } from '../../../tests/utils/mock-h3';
import type { H3Event } from 'h3';

const secretStore = vi.hoisted(() => ({ available: vi.fn(), enabled: false }));
vi.mock('../../secrets/registry', () => ({ getActiveSecretStore: () => secretStore.enabled ? secretStore : null }));
const getProviderAdminAdapterMock = vi.hoisted(() => vi.fn());
const createStubProviderAdapterMock = vi.hoisted(() =>
    vi.fn((kind: 'auth' | 'sync' | 'storage', provider: string) => ({
        getStatus: vi.fn(async () => ({
            details: {},
            warnings: provider
                ? []
                : [{ level: 'error' as const, message: `${kind} provider missing` }],
            actions: [],
        })),
    }))
);

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
    secrets?: { provider: string };
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

vi.mock('../../admin/providers/registry', () => ({
    getProviderAdminAdapter: getProviderAdminAdapterMock,
}));

vi.mock('../../admin/providers/adapters/stub', () => ({
    createStubProviderAdapter: createStubProviderAdapterMock,
}));

describe('Health check endpoint', () => {
    let handler: any;

    beforeEach(async () => {
        vi.resetModules();
        runtimeConfigMock.secrets = undefined; secretStore.enabled = false; secretStore.available.mockReset().mockResolvedValue(undefined);
        getProviderAdminAdapterMock.mockReset().mockReturnValue(null);
        createStubProviderAdapterMock.mockClear();
        runtimeConfigMock.sync = { enabled: true, provider: 'convex' };
        runtimeConfigMock.storage = { enabled: true, provider: 'convex' };
        runtimeConfigMock.auth = { enabled: true, provider: 'clerk' };

        const module = await import('../health.get');
        handler = module.default;
    });

    it('reports vault outage without disclosing its error or probing on liveness', async () => {
        runtimeConfigMock.secrets = { provider: 'or3-secrets' }; secretStore.enabled = true;
        secretStore.available.mockRejectedValue(new Error('synthetic-private-key'));
        const liveness = await handler(createMockH3Event({ method: 'GET', path: '/api/health' }));
        expect(liveness.status).toBe('ok'); expect(secretStore.available).not.toHaveBeenCalled();
        const readiness = await handler(createMockH3Event({ method: 'GET', path: '/api/ready' }));
        expect(readiness.status).toBe('degraded');
        expect(readiness.providers.secrets).toEqual({ available: false });
        expect(JSON.stringify(readiness)).not.toContain('synthetic-private-key');
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

    it('checks providers for readiness even without a deep query', async () => {
        runtimeConfigMock.sync = { enabled: true, provider: '' };
        const response = await handler(createMockH3Event({ method: 'GET', path: '/api/ready' }));
        expect(response.status).toBe('degraded');
    });

    it('bounds a hung provider probe and reports it unavailable', async () => {
        vi.useFakeTimers();
        try {
            getProviderAdminAdapterMock.mockReturnValue({ getStatus: () => new Promise(() => {}) });
            const pending = handler(createMockH3Event({ method: 'GET', path: '/api/health?deep=true' }));
            await vi.advanceTimersByTimeAsync(2_000);
            expect(await Promise.race([pending, Promise.resolve({ status: 'still_pending' })])).toMatchObject({ status: 'degraded' });
        } finally { vi.useRealTimers(); }
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
            checks: {
                warnings: [],
                errors: [],
            },
            details: {},
        });
        expect(response.providers?.storage).toEqual({
            available: true,
            provider: 'convex',
            checks: {
                warnings: [],
                errors: [],
            },
            details: {},
        });
        expect(response.providers?.auth).toEqual({
            available: true,
            provider: 'clerk',
            checks: {
                warnings: [],
                errors: [],
            },
            details: {},
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

    it('marks as degraded when provider adapter reports an error warning', async () => {
        getProviderAdminAdapterMock.mockImplementation(
            (kind: 'auth' | 'sync' | 'storage', provider: string) => {
                if (kind === 'sync' && provider === 'convex') {
                    return {
                        getStatus: vi.fn(async () => ({
                            details: {},
                            warnings: [{ level: 'error' as const, message: 'convex unreachable' }],
                            actions: [],
                        })),
                    };
                }

                return {
                    getStatus: vi.fn(async () => ({
                        details: {},
                        warnings: [],
                        actions: [],
                    })),
                };
            }
        );

        const event = createMockH3Event({
            method: 'GET',
            path: '/api/health?deep=true',
            query: { deep: 'true' },
        });

        const response = await handler(event);

        expect(response.status).toBe('degraded');
        expect(response.providers?.sync?.checks?.errors).toContain('PROVIDER_UNAVAILABLE');
    });

    it('redacts provider details and warnings while keeping liveness on maintenance failure', async () => {
        getProviderAdminAdapterMock.mockImplementation(
            (kind: 'auth' | 'sync' | 'storage', provider: string) => {
                if (kind === 'sync' && provider === 'convex') {
                    return {
                        getStatus: vi.fn(async () => ({
                            details: {
                                maintenance: {
                                    enabled: true,
                                    lastRun: '2025-01-01T00:00:00.000Z',
                                    backlog: 3,
                                    lastError: 'boom',
                                    state: 'failed' as const,
                                },
                            },
                            warnings: [
                                {
                                    level: 'warning' as const,
                                    message: 'Sync history maintenance failed: boom',
                                },
                            ],
                            actions: [],
                        })),
                    };
                }

                return {
                    getStatus: vi.fn(async () => ({
                        details: {},
                        warnings: [],
                        actions: [],
                    })),
                };
            }
        );

        const event = createMockH3Event({
            method: 'GET',
            path: '/api/health?deep=true',
            query: { deep: 'true' },
        });

        const response = await handler(event);

        expect(response.status).toBe('ok');
        expect(response.providers?.sync?.details).toEqual({});
        expect(response.providers?.sync?.available).toBe(true);
        expect(response.providers?.sync?.checks?.warnings).toContain(
            'PROVIDER_WARNING'
        );
    });
});
