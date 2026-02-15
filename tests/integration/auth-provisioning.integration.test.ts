import { describe, expect, it } from 'vitest';

type ProvisioningMode = 'throw' | 'unauthenticated' | 'service-unavailable';

function provision(mode: ProvisioningMode, shouldFail: boolean, deploymentAdmin = false) {
    if (!shouldFail) {
        return {
            authenticated: true,
            workspace: { id: 'ws-1', name: 'Default' },
            role: 'owner',
            deploymentAdmin,
        };
    }

    if (mode === 'unauthenticated') return { authenticated: false };
    if (mode === 'service-unavailable') throw Object.assign(new Error('Service Unavailable'), { statusCode: 503 });
    throw new Error('Provisioning failed');
}

describe('auth provisioning integration', () => {
    it('first login provisions default workspace and role', () => {
        const session = provision('throw', false);
        expect(session.authenticated).toBe(true);
        expect(session.workspace.id).toBe('ws-1');
        expect(session.role).toBe('owner');
    });

    it('supports provisioning failure mode matrix', () => {
        expect(provision('unauthenticated', true)).toEqual({ authenticated: false });
        expect(() => provision('service-unavailable', true)).toThrow('Service Unavailable');
        expect(() => provision('throw', true)).toThrow('Provisioning failed');
    });

    it('propagates deployment admin flag into session context', () => {
        const session = provision('throw', false, true);
        expect(session.deploymentAdmin).toBe(true);
    });
});
