import { describe, it, expect } from 'vitest';
import { formatStartupBanner } from '../../shared/dev/startup-banner';
import { DOCTOR_COMMAND, WIZARD_INIT_COMMAND } from '../../shared/cloud/wizard/next-steps';

describe('startup banner', () => {
    it('shows LOCAL mode next steps for static/local', () => {
        const text = formatStartupBanner({
            ssrAuthEnabled: false,
            appUrl: 'http://127.0.0.1:3100/',
        });
        expect(text).toContain('LOCAL (static)');
        expect(text).toContain('http://127.0.0.1:3100');
        expect(text).toContain(WIZARD_INIT_COMMAND);
        expect(text).not.toContain('Admin:');
    });

    it('shows CLOUD mode with doctor health check', () => {
        const text = formatStartupBanner({
            ssrAuthEnabled: true,
            appUrl: 'http://127.0.0.1:3000',
            authProvider: 'basic-auth',
            syncEnabled: true,
            syncProvider: 'sqlite',
            storageEnabled: true,
            storageProvider: 'fs',
        });
        expect(text).toContain('CLOUD (SSR)');
        expect(text).toContain('auth: basic-auth');
        expect(text).toContain(DOCTOR_COMMAND);
        expect(text).toContain('/admin');
    });
});
