import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { H3Event } from 'h3';
import { testRuntimeConfig } from '../../../tests/setup';
import adminGate from '../admin-gate';

vi.mock('../../admin/context', () => ({
    resolveAdminRequestContext: vi.fn().mockResolvedValue(null),
}));

function makeEvent(input: {
    path: string;
    method: string;
    headers: Record<string, string>;
}): H3Event {
    return {
        path: input.path,
        method: input.method,
        node: {
            req: {
                headers: input.headers,
            },
        },
        context: {},
    } as unknown as H3Event;
}

describe('admin-gate proxy host allowlist', () => {
    beforeEach(() => {
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
});
