import { describe, expect, it } from 'vitest';
import {
    applyWizardModeDefaults,
    createDefaultAnswers,
    mapEnvToWizardAnswers,
} from '../catalog';
import { deriveEnvFromAnswers } from '../derive';
import { resolveEffectiveConnectProvider } from '../connect-provider';
import { getWizardSteps } from '../steps';
import {
    buildRedactedSummary,
    sanitizeAnswersForSession,
    validateAnswers,
} from '../validation';

function connectAnswers() {
    return {
        ...createDefaultAnswers({ instanceDir: '/tmp/or3' }),
        connectEnabled: true,
        connectPublicUrl: 'https://chat.example.com',
        connectHostnameSuffix: 'connect.example.com',
        connectCloudflareApiToken: 'cloudflare-secret-token',
        connectEncryptionKey: 'x'.repeat(48),
    };
}

describe('wizard: OR3 Connect', () => {
    it('provides a true local-only mode with accounts and remote access disabled', () => {
        const answers = applyWizardModeDefaults(
            createDefaultAnswers({ instanceDir: '/tmp/or3' }),
            'personal-local'
        );

        expect(answers.ssrAuthEnabled).toBe(false);
        expect(answers.syncEnabled).toBe(false);
        expect(answers.storageEnabled).toBe(false);
        expect(answers.connectEnabled).toBe(false);
        expect(getWizardSteps(answers).find((step) => step.id === 'connect')?.canSkip?.(answers)).toBe(true);
    });

    it('derives provider-neutral Connect settings and inherits the sync provider', () => {
        const answers = {
            ...connectAnswers(),
            syncProvider: 'sqlite' as const,
            connectProvider: 'convex' as const,
            connectAdvancedEnabled: false,
        };

        const { env, providerModules } = deriveEnvFromAnswers(answers);

        expect(env.OR3_CONNECT_ENABLED).toBe('true');
        expect(env.OR3_CONNECT_PROVIDER).toBe('sqlite');
        expect(env.OR3_CONNECT_RELAY_PROVIDER).toBe('cloudflare');
        expect(env.OR3_CONNECT_PUBLIC_URL).toBe('https://chat.example.com');
        expect(env.OR3_CONNECT_MAX_COMPUTERS).toBe('3');
        expect(env.OR3_CONNECT_CLOUDFLARE_API_TOKEN).toBe(
            'cloudflare-secret-token'
        );
        expect(providerModules).toContain('or3-provider-sqlite/nuxt');
    });

    it('supports an advanced persistence-provider override', () => {
        const answers = {
            ...connectAnswers(),
            connectAdvancedEnabled: true,
            connectProvider: 'convex' as const,
        };

        const { env, providerModules } = deriveEnvFromAnswers(answers);

        expect(env.OR3_CONNECT_PROVIDER).toBe('convex');
        expect(providerModules).toContain('or3-provider-convex/nuxt');
    });

    it('uses one effective Connect provider rule across normal and advanced modes', () => {
        const answers = connectAnswers();

        expect(
            resolveEffectiveConnectProvider({
                ...answers,
                syncProvider: 'convex',
                connectProvider: 'sqlite',
                allAdvancedEnabled: false,
                connectAdvancedEnabled: false,
            })
        ).toBe('convex');
        expect(
            resolveEffectiveConnectProvider({
                ...answers,
                syncProvider: 'convex',
                connectProvider: 'sqlite',
                allAdvancedEnabled: true,
                connectAdvancedEnabled: false,
            })
        ).toBe('sqlite');
        expect(
            resolveEffectiveConnectProvider({
                ...answers,
                syncProvider: 'sqlite',
                connectProvider: 'convex',
                allAdvancedEnabled: false,
                connectAdvancedEnabled: true,
            })
        ).toBe('convex');
    });

    it('redacts Connect credentials from reviews and persisted sessions', () => {
        const answers = {
            ...connectAnswers(),
            connectCloudflareValidationAttestation: 'opaque-attestation',
        };
        const summary = buildRedactedSummary(answers);
        const persisted = sanitizeAnswersForSession(answers, false);

        expect(summary).toContain('OR3_CONNECT_ENCRYPTION_KEY=<redacted>');
        expect(summary).toContain(
            'OR3_CONNECT_CLOUDFLARE_API_TOKEN=<redacted>'
        );
        expect(summary).not.toContain('cloudflare-secret-token');
        expect(summary).not.toContain('opaque-attestation');
        expect(persisted.connectEncryptionKey).toBeUndefined();
        expect(persisted.connectCloudflareApiToken).toBeUndefined();
        expect(
            persisted.connectCloudflareValidationAttestation
        ).toBeUndefined();
    });

    it('loads existing Connect values from env without exposing them as defaults', () => {
        const mapped = mapEnvToWizardAnswers({
            OR3_CONNECT_ENABLED: 'true',
            OR3_CONNECT_PROVIDER: 'sqlite',
            OR3_CONNECT_RELAY_PROVIDER: 'cloudflare',
            OR3_CONNECT_PUBLIC_URL: 'https://chat.example.com',
            OR3_CONNECT_MAX_COMPUTERS: '5',
            OR3_CONNECT_HOSTNAME_SUFFIX: 'connect.example.com',
        });

        expect(mapped).toMatchObject({
            connectEnabled: true,
            connectProvider: 'sqlite',
            connectRelayProvider: 'cloudflare',
            connectPublicUrl: 'https://chat.example.com',
            connectMaxComputers: 5,
            connectHostnameSuffix: 'connect.example.com',
        });
    });

    it('requires HTTPS in production and validates Cloudflare setup', () => {
        const result = validateAnswers({
            ...connectAnswers(),
            deploymentTarget: 'prod-build',
            connectPublicUrl: 'http://chat.example.com',
            connectCloudflareApiToken: '',
            connectHostnameSuffix: 'https://connect.example.com/path',
        });
        const connectErrors = result.errors.filter((error) =>
            error.includes('OR3_CONNECT_')
        );

        expect(connectErrors).toContain(
            'OR3_CONNECT_PUBLIC_URL must use HTTPS for remote access.'
        );
        expect(connectErrors).toContain(
            'OR3_CONNECT_CLOUDFLARE_API_TOKEN is required for the Cloudflare relay.'
        );
        expect(connectErrors).toContain(
            'OR3_CONNECT_HOSTNAME_SUFFIX must be a hostname such as connect.example.com.'
        );
    });
});
