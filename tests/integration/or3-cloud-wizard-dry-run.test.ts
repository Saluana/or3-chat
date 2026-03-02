import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDefaultAnswers } from '../../shared/cloud/wizard/catalog';
import { getWizardSteps } from '../../shared/cloud/wizard/steps';
import type { WizardAnswers, WizardStep } from '../../shared/cloud/wizard/types';
import { Or3CloudWizardApi } from '../../shared/cloud/wizard/api';

function normalizeAnswers(sessionAnswers: Partial<WizardAnswers>): WizardAnswers {
    return {
        ...createDefaultAnswers({
            instanceDir: sessionAnswers.instanceDir ?? process.cwd(),
            envFile: sessionAnswers.envFile,
            presetName: sessionAnswers.presetName,
        }),
        ...sessionAnswers,
    };
}

function visibleFields(step: WizardStep, answers: WizardAnswers): string[] {
    return step.fields
        .filter((field) =>
            typeof field.visibleWhen === 'function'
                ? field.visibleWhen(answers)
                : true
        )
        .map((field) => String(field.key));
}

function visibleStepIds(answers: WizardAnswers): string[] {
    return getWizardSteps(answers)
        .filter((step) => {
            if (step.canSkip?.(answers)) return false;
            if (step.id === 'review') return true;
            return visibleFields(step, answers).length > 0;
        })
        .map((step) => step.id);
}

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
            adminUsername: 'admin',
            adminPassword: 'AdminPass1234!',
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
            adminUsername: 'admin',
            adminPassword: 'AdminPass1234!',
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

    it('covers visible-step progression for all template modes', async () => {
        const instanceDir = await mkdtemp(resolve(tmpdir(), 'or3-instance-modes-'));
        const api = new Or3CloudWizardApi();

        const localSession = await api.createSession({
            presetName: 'recommended',
            instanceDir,
            envFile: '.env',
        });
        const localAnswers = normalizeAnswers(
            (await api.getSession(localSession.id, { includeSecrets: true })).answers
        );
        expect(visibleStepIds(localAnswers)).not.toContain('providers');
        expect(localAnswers.wizardMode).toBe('preset-local');

        const clerkSession = await api.createSession({
            presetName: 'legacy-clerk-convex',
            instanceDir,
            envFile: '.env',
        });
        const clerkAnswers = normalizeAnswers(
            (await api.getSession(clerkSession.id, { includeSecrets: true })).answers
        );
        expect(visibleStepIds(clerkAnswers)).not.toContain('providers');
        expect(clerkAnswers.wizardMode).toBe('preset-clerk-convex');

        const customSession = await api.createSession({
            presetName: 'recommended',
            instanceDir,
            envFile: '.env',
        });
        await api.submitAnswers(customSession.id, {
            wizardMode: 'custom',
        });
        const customAnswers = normalizeAnswers(
            (await api.getSession(customSession.id, { includeSecrets: true })).answers
        );
        expect(visibleStepIds(customAnswers)).toContain('providers');
        expect(customAnswers.wizardMode).toBe('custom');
    });

    it('recomputes visible fields when limits and proxy visibility toggles change', () => {
        const answers = normalizeAnswers({
            instanceDir: '/tmp/or3-chat',
            allAdvancedEnabled: true,
            cloudAdvancedEnabled: true,
            limitsEnabled: true,
            trustProxy: true,
        });
        const cloudStep = getWizardSteps(answers).find(
            (step) => step.id === 'openrouter-limits-security'
        );
        expect(cloudStep).toBeDefined();
        const baseline = visibleFields(cloudStep as WizardStep, answers);
        expect(baseline).toContain('requestsPerMinute');
        expect(baseline).toContain('forwardedForHeader');

        const afterLimitsDisabled = {
            ...answers,
            limitsEnabled: false,
        };
        const hiddenLimits = visibleFields(
            cloudStep as WizardStep,
            afterLimitsDisabled
        );
        expect(hiddenLimits).not.toContain('requestsPerMinute');
        expect(hiddenLimits).toContain('forwardedForHeader');

        const afterProxyDisabled = {
            ...afterLimitsDisabled,
            trustProxy: false,
        };
        const hiddenProxy = visibleFields(cloudStep as WizardStep, afterProxyDisabled);
        expect(hiddenProxy).not.toContain('forwardedForHeader');
    });

    it('supports skipping and enabling advanced settings per section', async () => {
        const instanceDir = await mkdtemp(resolve(tmpdir(), 'or3-instance-advanced-'));
        const api = new Or3CloudWizardApi();
        const session = await api.createSession({
            presetName: 'recommended',
            instanceDir,
            envFile: '.env',
        });

        await api.submitAnswers(session.id, {
            allAdvancedEnabled: false,
            cloudAdvancedEnabled: false,
            requestsPerMinute: 999,
        });

        const skipped = await api.getSession(session.id, { includeSecrets: true });
        expect(skipped.answers.requestsPerMinute).toBe(20);

        await api.submitAnswers(session.id, {
            cloudAdvancedEnabled: true,
            requestsPerMinute: 55,
        });

        const enabled = await api.getSession(session.id, { includeSecrets: true });
        expect(enabled.answers.requestsPerMinute).toBe(55);

        await api.submitAnswers(session.id, {
            allAdvancedEnabled: true,
        });

        const expert = await api.getSession(session.id, { includeSecrets: true });
        expect(expert.answers.baseAdvancedEnabled).toBe(true);
        expect(expert.answers.authAdvancedEnabled).toBe(true);
        expect(expert.answers.syncAdvancedEnabled).toBe(true);
        expect(expert.answers.storageAdvancedEnabled).toBe(true);
        expect(expert.answers.cloudAdvancedEnabled).toBe(true);
    });
});
