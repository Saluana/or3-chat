import { describe, expect, it } from 'vitest';
import {
    isAdminRoute,
    resolveLockPageRuntimeConfig,
    resolvePostAuthRedirectTarget,
    sanitizeLockPageRedirectTarget,
} from '../../app/core/lock-page/runtime';

describe('lock page runtime helpers', () => {
    it('normalizes public runtime config with defaults', () => {
        const config = resolveLockPageRuntimeConfig({
            ssrAuthEnabled: true,
            authProvider: 'basic-auth',
            guestAccessEnabled: true,
            admin: {
                basePath: 'admin/',
            },
            lockPage: {
                enabled: true,
                adapter: 'marketing',
                route: 'welcome/',
            },
        });

        expect(config.ssrAuthEnabled).toBe(true);
        expect(config.enabled).toBe(true);
        expect(config.adapter).toBe('marketing');
        expect(config.route).toBe('/welcome');
        expect(config.adminBasePath).toBe('/admin');
        expect(config.guestAccessEnabled).toBe(true);
        expect(config.authProvider).toBe('basic-auth');
    });

    it('treats the configured admin base path as a bypass', () => {
        expect(isAdminRoute('/admin', '/admin')).toBe(true);
        expect(isAdminRoute('/admin/login', '/admin')).toBe(true);
        expect(isAdminRoute('/secure-admin/system', '/secure-admin')).toBe(true);
        expect(isAdminRoute('/chat', '/admin')).toBe(false);
    });

    it('sanitizes redirect targets and blocks open redirects', () => {
        expect(sanitizeLockPageRedirectTarget('/chat/123?tab=files')).toBe(
            '/chat/123?tab=files'
        );
        expect(sanitizeLockPageRedirectTarget('https://evil.example')).toBe('/');
        expect(sanitizeLockPageRedirectTarget('//evil.example')).toBe('/');
        expect(sanitizeLockPageRedirectTarget('chat/123')).toBe('/');
    });

    it('avoids redirect loops back to the lock page route', () => {
        expect(resolvePostAuthRedirectTarget('/welcome', '/welcome')).toBe('/');
        expect(resolvePostAuthRedirectTarget('/chat/123', '/welcome')).toBe('/chat/123');
    });
});
