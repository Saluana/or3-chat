import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Or3CloudWizardApi } from '../../shared/cloud/wizard/api';

describe('or3 cloud wizard dry-run flows', () => {
    const previousWizardHome = process.env.OR3_CLOUD_WIZARD_HOME;
    let wizardHome = '';

    beforeEach(async () => {
        wizardHome = await mkdtemp(resolve(tmpdir(), 'or3-wizard-home-'));
        process.env.OR3_CLOUD_WIZARD_HOME = wizardHome;
    });

    afterEach(() => {
        process.env.OR3_CLOUD_WIZARD_HOME = previousWizardHome;
    });

    it('validates and applies dry-run for recommended preset', async () => {
        const instanceDir = await mkdtemp(resolve(tmpdir(), 'or3-instance-recommended-'));
        const api = new Or3CloudWizardApi();
        const session = await api.createSession({
            presetName: 'recommended',
            instanceDir,
            envFile: '.env',
        });

        await api.submitAnswers(session.id, {
            basicAuthJwtSecret: 'jwt-secret-jwt-secret-jwt-secret-1234',
            basicAuthBootstrapEmail: 'admin@example.com',
            basicAuthBootstrapPassword: 'MyPassword123',
            fsTokenSecret: 'fs-secret-fs-secret-fs-secret-fs-secret',
            fsRoot: '/tmp/or3-storage',
        });

        const validation = await api.validate(session.id, { strict: true });
        expect(validation.ok).toBe(true);
        expect(validation.derived.env.AUTH_PROVIDER).toBe('basic-auth');
        expect(validation.derived.env.OR3_SYNC_ENABLED).toBe('true');
        expect(validation.derived.env.OR3_STORAGE_ENABLED).toBe('true');
        expect(validation.derived.env.NUXT_PUBLIC_STORAGE_PROVIDER).toBe('fs');
        expect(validation.derived.providerModules).toEqual([
            'or3-provider-basic-auth/nuxt',
            'or3-provider-fs/nuxt',
            'or3-provider-sqlite/nuxt',
        ]);

        const applyResult = await api.apply(session.id, { dryRun: true });
        expect(applyResult.dryRun).toBe(true);
        expect(applyResult.writtenFiles).toEqual([]);
    });

    it('validates and applies dry-run for legacy clerk+convex preset', async () => {
        const instanceDir = await mkdtemp(resolve(tmpdir(), 'or3-instance-legacy-'));
        const api = new Or3CloudWizardApi();
        const session = await api.createSession({
            presetName: 'legacy-clerk-convex',
            instanceDir,
            envFile: '.env',
        });

        await api.submitAnswers(session.id, {
            clerkPublishableKey: 'pk_test_123',
            clerkSecretKey: 'sk_test_123',
            convexUrl: 'https://test.convex.cloud',
            convexClerkIssuerUrl: 'https://clerk.example.com',
            convexAdminJwtSecret: 'convex-admin-secret',
            openrouterInstanceApiKey: 'or-instance-key',
        });

        const validation = await api.validate(session.id, { strict: true });
        expect(validation.ok).toBe(true);
        expect(validation.derived.env.AUTH_PROVIDER).toBe('clerk');
        expect(validation.derived.env.OR3_SYNC_PROVIDER).toBe('convex');
        expect(validation.derived.env.NUXT_PUBLIC_STORAGE_PROVIDER).toBe('convex');
        expect(validation.derived.env.VITE_CONVEX_URL).toBe(
            'https://test.convex.cloud'
        );
        expect(validation.derived.convexEnv.CLERK_ISSUER_URL).toBe(
            'https://clerk.example.com'
        );
        expect(validation.derived.providerModules).toEqual([
            'or3-provider-clerk/nuxt',
            'or3-provider-convex/nuxt',
        ]);

        const applyResult = await api.apply(session.id, { dryRun: true });
        expect(applyResult.dryRun).toBe(true);
        expect(applyResult.providerModules).toEqual([
            'or3-provider-clerk/nuxt',
            'or3-provider-convex/nuxt',
        ]);
    });

    it('does not persist secret answers to disk by default', async () => {
        const instanceDir = await mkdtemp(resolve(tmpdir(), 'or3-instance-secrets-'));
        const api = new Or3CloudWizardApi();
        const session = await api.createSession({
            presetName: 'recommended',
            instanceDir,
            envFile: '.env',
        });

        await api.submitAnswers(session.id, {
            basicAuthJwtSecret: 'jwt-secret-jwt-secret-jwt-secret-1234',
            basicAuthBootstrapPassword: 'super-secret-password',
            fsTokenSecret: 'fs-secret-fs-secret-fs-secret-fs-secret',
        });

        const sessionPath = resolve(
            wizardHome,
            '.or3-cloud',
            'sessions',
            `${session.id}.json`
        );
        const persisted = JSON.parse(await readFile(sessionPath, 'utf8')) as {
            answers: Record<string, unknown>;
        };

        expect(persisted.answers.basicAuthJwtSecret).toBeUndefined();
        expect(persisted.answers.basicAuthBootstrapPassword).toBeUndefined();
        expect(persisted.answers.fsTokenSecret).toBeUndefined();

        const hydrated = await api.getSession(session.id, { includeSecrets: true });
        expect(hydrated.answers.basicAuthJwtSecret).toBe(
            'jwt-secret-jwt-secret-jwt-secret-1234'
        );
    });

    it('applies presets before explicit patch overrides', async () => {
        const instanceDir = await mkdtemp(resolve(tmpdir(), 'or3-instance-overrides-'));
        const api = new Or3CloudWizardApi();
        const session = await api.createSession({
            presetName: 'recommended',
            instanceDir,
            envFile: '.env',
        });

        await api.submitAnswers(session.id, {
            presetName: 'legacy-clerk-convex',
            authProvider: 'basic-auth',
            syncProvider: 'sqlite',
        });

        const updated = await api.getSession(session.id, { includeSecrets: true });
        expect(updated.answers.presetName).toBe('legacy-clerk-convex');
        expect(updated.answers.authProvider).toBe('basic-auth');
        expect(updated.answers.syncProvider).toBe('sqlite');
        expect(updated.answers.storageProvider).toBe('convex');
    });
});
