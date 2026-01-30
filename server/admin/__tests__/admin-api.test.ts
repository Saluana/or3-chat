import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { H3Event } from 'h3';
import { requireAdminApi } from '../api';

const resolveSessionContextMock = vi.hoisted(() => vi.fn());

vi.mock('../../auth/session', () => ({
    resolveSessionContext: resolveSessionContextMock,
}));

const mocks = vi.hoisted(() => {
    const base = {
        auth: { enabled: true, provider: 'clerk' },
        sync: { enabled: true, provider: 'convex', convexUrl: 'https://convex.test' },
        storage: { enabled: true, provider: 'convex' },
        backgroundJobs: { enabled: false, storageProvider: 'memory' },
        admin: { allowedHosts: [] },
        public: { ssrAuthEnabled: true },
        clerkSecretKey: 'secret',
        publicRuntimeConfig: {},
    };
    return {
        baseConfig: base,
        configMock: vi.fn(),
    };
});

vi.mock('#imports', () => ({
    useRuntimeConfig: mocks.configMock,
}));

function makeEvent(headers: Record<string, string>, method = 'GET'): H3Event {
    return {
        method,
        node: { req: { headers } },
    } as unknown as H3Event;
}

describe('requireAdminApi', () => {
    beforeEach(() => {
        resolveSessionContextMock.mockReset();
        mocks.configMock.mockReturnValue(mocks.baseConfig);
    });

    it('returns 404 when SSR auth disabled', async () => {
        mocks.configMock.mockReturnValue({ ...mocks.baseConfig, auth: { ...mocks.baseConfig.auth, enabled: false } });
        resolveSessionContextMock.mockResolvedValue({ authenticated: true, role: 'owner' });

        await expect(requireAdminApi(makeEvent({ host: 'admin.test' }))).rejects.toMatchObject({
            statusCode: 404,
        });
    });

    it('returns 401 when unauthenticated', async () => {
        resolveSessionContextMock.mockResolvedValue({ authenticated: false });

        await expect(requireAdminApi(makeEvent({ host: 'admin.test' }))).rejects.toMatchObject({
            statusCode: 401,
        });
    });

    it('returns 403 for viewer', async () => {
        resolveSessionContextMock.mockResolvedValue({
            authenticated: true,
            role: 'viewer',
            user: { id: 'u1' },
            workspace: { id: 'w1', name: 'W1' },
        });

        await expect(requireAdminApi(makeEvent({ host: 'admin.test' }))).rejects.toMatchObject({
            statusCode: 403,
        });
    });

    it('allows editor for read access', async () => {
        resolveSessionContextMock.mockResolvedValue({
            authenticated: true,
            role: 'editor',
            user: { id: 'u1' },
            workspace: { id: 'w1', name: 'W1' },
        });

        await expect(requireAdminApi(makeEvent({ host: 'admin.test' }))).resolves.toBeTruthy();
    });

    it('blocks non-owners on mutations', async () => {
        resolveSessionContextMock.mockResolvedValue({
            authenticated: true,
            role: 'editor',
            user: { id: 'u1' },
            workspace: { id: 'w1', name: 'W1' },
        });

        const event = makeEvent(
            { host: 'admin.test', origin: 'https://admin.test', 'x-or3-admin-intent': 'admin' },
            'POST'
        );

        await expect(
            requireAdminApi(event, { ownerOnly: true, mutation: true })
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('rejects mutation without intent header', async () => {
        resolveSessionContextMock.mockResolvedValue({
            authenticated: true,
            role: 'owner',
            user: { id: 'u1' },
            workspace: { id: 'w1', name: 'W1' },
        });

        const event = makeEvent(
            { host: 'admin.test', origin: 'https://admin.test' },
            'POST'
        );

        await expect(
            requireAdminApi(event, { ownerOnly: true, mutation: true })
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('allows owners with CSRF intent header', async () => {
        resolveSessionContextMock.mockResolvedValue({
            authenticated: true,
            role: 'owner',
            user: { id: 'u1' },
            workspace: { id: 'w1', name: 'W1' },
        });

        const event = makeEvent(
            { host: 'admin.test', origin: 'https://admin.test', 'x-or3-admin-intent': 'admin' },
            'POST'
        );

        await expect(
            requireAdminApi(event, { ownerOnly: true, mutation: true })
        ).resolves.toBeTruthy();
    });
});
