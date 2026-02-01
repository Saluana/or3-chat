import { beforeEach, describe, expect, it } from 'vitest';
import type { H3Event } from 'h3';
import { requireAdminRequest, requireAdminMutation } from '../guard';
import { testRuntimeConfig } from '../../../tests/setup';

describe('admin guard proxy host allowlist', () => {
    function makeEvent(input: {
        method?: string;
        headers: Record<string, string>;
    }): H3Event {
        return {
            method: input.method,
            node: {
                req: {
                    headers: input.headers,
                },
            },
        } as unknown as H3Event;
    }

    beforeEach(() => {
        testRuntimeConfig.value = {
            ...testRuntimeConfig.value,
            auth: { ...testRuntimeConfig.value.auth, enabled: true },
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

    it('allows forwarded host when trustProxy is enabled', () => {
        const event = makeEvent({
            headers: {
                host: 'internal.local',
                'x-forwarded-host': 'admin.example.com',
            },
        });

        expect(() => requireAdminRequest(event)).not.toThrow();
    });

    it('rejects missing forwarded host when trustProxy is enabled', () => {
        const event = makeEvent({
            headers: {
                host: 'admin.example.com',
            },
        });

        try {
            requireAdminRequest(event);
            expect(false).toBe(true);
        } catch (error) {
            expect(error).toMatchObject({ statusCode: 404 });
        }
    });

    it('uses host header when trustProxy is disabled', () => {
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
            headers: {
                host: 'admin.example.com',
                'x-forwarded-host': 'evil.example.com',
            },
        });

        expect(() => requireAdminRequest(event)).not.toThrow();
    });

    it('compares origin to forwarded host for mutations when trustProxy is enabled', () => {
        const event = makeEvent({
            method: 'POST',
            headers: {
                host: 'internal.local',
                origin: 'https://admin.example.com',
                'x-forwarded-host': 'admin.example.com',
                'x-or3-admin-intent': 'admin',
            },
        });

        expect(() => requireAdminMutation(event)).not.toThrow();
    });
});
