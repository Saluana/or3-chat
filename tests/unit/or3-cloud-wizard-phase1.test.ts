import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultAnswers } from '../../shared/cloud/wizard/catalog';
import { Or3CloudWizardApi } from '../../shared/cloud/wizard/api';

describe('or3 cloud wizard phase 1 enhancements', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('prefills defaults from existing env map', () => {
        const answers = createDefaultAnswers({
            instanceDir: '/tmp/or3',
            existingEnv: {
                AUTH_PROVIDER: 'clerk',
                OR3_SYNC_PROVIDER: 'convex',
                NUXT_PUBLIC_STORAGE_PROVIDER: 'convex',
                NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_test',
                NUXT_CLERK_SECRET_KEY: 'sk_live_test',
                VITE_CONVEX_URL: 'https://demo.convex.cloud',
            },
        });

        expect(answers.authProvider).toBe('clerk');
        expect(answers.syncProvider).toBe('convex');
        expect(answers.storageProvider).toBe('convex');
        expect(answers.clerkPublishableKey).toBe('pk_live_test');
        expect(answers.clerkSecretKey).toBe('sk_live_test');
        expect(answers.convexUrl).toBe('https://demo.convex.cloud');
        expect(answers.wizardMode).toBe('preset-clerk-convex');
    });

    it('createSession supports env prefill opt-in and opt-out', async () => {
        const api = new Or3CloudWizardApi();

        const prefills = await api.createSession({
            instanceDir: '/tmp/or3',
            existingEnvMap: {
                AUTH_PROVIDER: 'clerk',
                OR3_SYNC_PROVIDER: 'convex',
                NUXT_PUBLIC_STORAGE_PROVIDER: 'convex',
            },
            prefillFromEnv: true,
        });
        expect(prefills.answers.authProvider).toBe('clerk');
        expect(prefills.answers.syncProvider).toBe('convex');

        const fresh = await api.createSession({
            instanceDir: '/tmp/or3',
            existingEnvMap: {
                AUTH_PROVIDER: 'clerk',
            },
            prefillFromEnv: false,
        });
        expect(fresh.answers.authProvider).toBe('basic-auth');
    });

    it('generates cryptographically secure secrets at requested length', () => {
        const api = new Or3CloudWizardApi();
        const first = api.generateSecureSecret(48);
        const second = api.generateSecureSecret(48);

        expect(first).toHaveLength(48);
        expect(second).toHaveLength(48);
        expect(first).not.toBe(second);
    });

    it('validates and optionally creates missing directories', async () => {
        const api = new Or3CloudWizardApi();
        const sandbox = await mkdtemp(resolve(tmpdir(), 'or3-wizard-path-'));
        const missingDbPath = resolve(sandbox, 'nested', 'or3-sync.sqlite');

        const existsBefore = await api.validatePath(missingDbPath, false);
        expect(existsBefore).toBe(false);

        const created = await api.validatePath(missingDbPath, true);
        expect(created).toBe(true);

        const existsAfter = await api.validatePath(missingDbPath, false);
        expect(existsAfter).toBe(true);
    });

    it('runs provider connection tests', async () => {
        const api = new Or3CloudWizardApi();

        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('{}', { status: 200 }))
        );

        const clerk = await api.testProviderConnection('clerk', {
            clerkSecretKey: 'sk_test_123',
        });
        expect(clerk.success).toBe(true);

        const convex = await api.testProviderConnection('convex', {
            convexUrl: 'https://demo.convex.cloud',
        });
        expect(convex.success).toBe(true);

        const s3Failure = await api.testProviderConnection('s3', {
            s3Bucket: '',
            s3AccessKeyId: '',
            s3SecretAccessKey: '',
        });
        expect(s3Failure.success).toBe(false);
    });
});
