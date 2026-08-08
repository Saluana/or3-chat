import { describe, expect, it } from 'vitest';
import { createDefaultAnswers } from '../catalog';
import { deriveEnvFromAnswers } from '../derive';

describe('wizard: managed docker deployment defaults', () => {
    it('emits closed registration and extension defaults for docker deployments', () => {
        const answers = {
            ...createDefaultAnswers({ instanceDir: '/tmp/or3' }),
            deploymentTarget: 'docker' as const,
            dockerExposure: 'public' as const,
            publicDomain: 'chat.example.com',
            ssrAuthEnabled: true,
            authProvider: 'basic-auth' as const,
            syncProvider: 'sqlite' as const,
            storageProvider: 'fs' as const,
            basicAuthInviteTokenSecret: 'invite-secret-abc',
        };

        const { env } = deriveEnvFromAnswers(answers);

        expect(env.OR3_AUTH_REGISTRATION_MODE).toBe('invite_only');
        expect(env.OR3_AUTH_AUTO_PROVISION).toBe('false');
        expect(env.OR3_PLUGIN_ZIP_INSTALL_ENABLED).toBe('false');
        expect(env.OR3_ADMIN_ALLOW_REBUILD).toBe('false');
        expect(env.OR3_AUTH_INVITE_TOKEN_SECRET).toBe('invite-secret-abc');
    });

    it('leaves source targets configurable', () => {
        const answers = {
            ...createDefaultAnswers({ instanceDir: '/tmp/or3' }),
            deploymentTarget: 'local-dev' as const,
            ssrAuthEnabled: true,
        };

        const { env } = deriveEnvFromAnswers(answers);

        expect(env.OR3_AUTH_REGISTRATION_MODE).toBeUndefined();
        expect(env.OR3_AUTH_AUTO_PROVISION).toBeUndefined();
        expect(env.OR3_PLUGIN_ZIP_INSTALL_ENABLED).toBeUndefined();
        expect(env.OR3_ADMIN_ALLOW_REBUILD).toBeUndefined();
    });
});
