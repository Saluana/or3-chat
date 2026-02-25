import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { H3Event } from 'h3';
import { testRuntimeConfig } from '../../../tests/setup';
import adminGate from '../admin-gate';

const resolveAdminRequestContextMock = vi.hoisted(() =>
    vi.fn().mockResolvedValue(null)
);

vi.mock('../../admin/context', () => ({
    resolveAdminRequestContext: resolveAdminRequestContextMock,
}));

function makeEvent(input: {
    path: string;
    method: string;
    headers: Record<string, string>;
}): H3Event {
    const responseHeaders: Record<string, string> = {};
    return {
        path: input.path,
        method: input.method,
        node: {
            req: {
                headers: input.headers,
            },
            res: {
                statusCode: 200,
                setHeader(name: string, value: string) {
                    responseHeaders[name.toLowerCase()] = value;
                },
                getHeader(name: string) {
                    return responseHeaders[name.toLowerCase()];
                },
                end() {
                    return undefined;
                },
            },
        },
        context: {},
    } as unknown as H3Event;
}

describe('admin-gate proxy host allowlist', () => {
    beforeEach(() => {
        resolveAdminRequestContextMock.mockReset().mockResolvedValue(null);
        testRuntimeConfig.value = {
            ...testRuntimeConfig.value,
            admin: {
                ...testRuntimeConfig.value.admin,
                allowedHosts: ['admin.example.com'],
                auth: {
                    ...testRuntimeConfig.value.admin.auth,
                    username: 'admin',
                    password: 'password',
                },
            },
            security: {
                ...testRuntimeConfig.value.security,
                proxy: {
                    trustProxy: true,
                    forwardedForHeader: 'x-forwarded-for',
                    forwardedHostHeader: 'x-forwarded-host',
                },
            },
        };
    });

    it('allows forwarded host when trustProxy is enabled', async () => {
        const event = makeEvent({
            path: '/admin/login',
            method: 'GET',
            headers: {
                host: 'internal.local',
                'x-forwarded-host': 'admin.example.com',
            },
        });

        await expect(adminGate(event)).resolves.toBeUndefined();
    });

    it('rejects missing forwarded host when trustProxy is enabled', async () => {
        const event = makeEvent({
            path: '/admin/login',
            method: 'GET',
            headers: {
                host: 'admin.example.com',
            },
        });

        await expect(adminGate(event)).rejects.toMatchObject({ statusCode: 404 });
    });

    it('uses host header when trustProxy is disabled', async () => {
        testRuntimeConfig.value = {
            ...testRuntimeConfig.value,
            security: {
                ...testRuntimeConfig.value.security,
                proxy: {
                    trustProxy: false,
                    forwardedForHeader: 'x-forwarded-for',
                    forwardedHostHeader: 'x-forwarded-host',
                },
            },
        };

        const event = makeEvent({
            path: '/admin/login',
            method: 'GET',
            headers: {
                host: 'admin.example.com',
                'x-forwarded-host': 'evil.example.com',
            },
        });

        await expect(adminGate(event)).resolves.toBeUndefined();
    });

    it('redirects super admin login to workspaces', async () => {
        resolveAdminRequestContextMock.mockResolvedValue({
            principal: { kind: 'super_admin', username: 'root' },
        });

        const event = makeEvent({
            path: '/admin/login',
            method: 'GET',
            headers: {
                host: 'internal.local',
                'x-forwarded-host': 'admin.example.com',
            },
        });

        await expect(adminGate(event)).resolves.toBeUndefined();
        expect(event.node.res.statusCode).toBe(307);
        expect(event.node.res.getHeader('location')).toBe('/admin/workspaces');
    });

    it('keeps workspace admin on login page', async () => {
        resolveAdminRequestContextMock.mockResolvedValue({
            principal: {
                kind: 'workspace_admin',
                userId: 'u_1',
                session: {
                    authenticated: true,
                },
            },
            session: {
                authenticated: true,
            },
        });

        const event = makeEvent({
            path: '/admin/login',
            method: 'GET',
            headers: {
                host: 'internal.local',
                'x-forwarded-host': 'admin.example.com',
            },
        });

        await expect(adminGate(event)).resolves.toBeUndefined();
        expect(event.node.res.statusCode).toBe(200);
        expect(event.node.res.getHeader('location')).toBeUndefined();
    });

    it('redirects workspace admin away from protected admin UI routes', async () => {
        resolveAdminRequestContextMock.mockResolvedValue({
            principal: {
                kind: 'workspace_admin',
                userId: 'u_1',
                session: {
                    authenticated: true,
                },
            },
            session: {
                authenticated: true,
            },
        });

        const event = makeEvent({
            path: '/admin/system',
            method: 'GET',
            headers: {
                host: 'internal.local',
                'x-forwarded-host': 'admin.example.com',
            },
        });

        await expect(adminGate(event)).resolves.toBeUndefined();
        expect(event.node.res.statusCode).toBe(307);
        expect(event.node.res.getHeader('location')).toBe('/admin/login');
    });
});
