import { describe, expect, it } from 'vitest';
import { createDefaultAnswers } from '../catalog';
import { deriveEnvFromAnswers, deriveWizardOwnedEnvUpdates } from '../derive';
import { createDependencyInstallPlan } from '../install-plan';
import { getWizardSteps } from '../steps';
import { validateAnswers } from '../validation';

function answers() {
    return {
        ...createDefaultAnswers({ instanceDir: '/tmp/or3-workspace-store' }),
        wizardMode: 'custom' as const,
        targetAdvancedEnabled: true,
        allAdvancedEnabled: true,
        syncEnabled: false,
        connectEnabled: false,
        storageEnabled: false,
        adminUsername: 'review-owner',
        adminPassword: 'Review-fixture-12345',
        basicAuthJwtSecret: 'review-fixture-0123456789abcdef0123456789abcdef',
        basicAuthBootstrapEmail: 'review@example.invalid',
        basicAuthBootstrapPassword: 'Review-fixture-12345',
        clerkPublishableKey: 'pk_test_review_fixture',
        clerkSecretKey: 'sk_test_review_fixture',
        sqliteDbPath: './.data/selected-workspaces.sqlite',
    };
}

describe('wizard: auth workspace store with sync transfer disabled', () => {
    it.each([
        ['basic-auth', 'better-sqlite3'],
        ['clerk', 'bun'],
    ] as const)('retains %s workspace store using %s', (authProvider, sqliteDriver) => {
        const selected = { ...answers(), authProvider, sqliteDriver };
        const validation = validateAnswers(selected);
        expect(validation.errors).toEqual([]);
        expect(validation.derived.env).toMatchObject({
            OR3_SYNC_ENABLED: 'false',
            OR3_SQLITE_DRIVER: sqliteDriver,
            OR3_SQLITE_DB_PATH: selected.sqliteDbPath,
        });
        expect(deriveWizardOwnedEnvUpdates(validation.derived.env)).toMatchObject({
            OR3_SQLITE_DRIVER: sqliteDriver,
            OR3_SQLITE_DB_PATH: selected.sqliteDbPath,
        });
        expect(validation.derived.providerModules).toContain('or3-provider-sqlite/nuxt');
        const plan = createDependencyInstallPlan(selected);
        expect(plan.packages).toContain('or3-provider-sqlite');
        expect(plan.packages.includes('better-sqlite3')).toBe(sqliteDriver === 'better-sqlite3');

        const steps = getWizardSteps(selected);
        const syncProviderField = steps.flatMap((step) => step.fields)
            .find((field) => field.key === 'syncProvider');
        expect(syncProviderField?.visibleWhen?.(selected)).toBe(true);
        const sqliteStep = steps.find((step) => step.fields.some((field) => field.key === 'sqliteDriver'));
        expect(sqliteStep?.canSkip?.(selected)).toBe(false);
        const driverField = sqliteStep?.fields.find((field) => field.key === 'sqliteDriver');
        expect(driverField?.visibleWhen?.(selected)).toBe(true);
    });

    it('validates the workspace runtime even when sync transfer is disabled', () => {
        const validation = validateAnswers({ ...answers(), authProvider: 'clerk', sqliteDriver: 'turso' });
        expect(validation.errors).toContain('OR3_SQLITE_TURSO_URL is required for Turso.');
        expect(validation.errors).toContain('OR3_SQLITE_TURSO_AUTH_TOKEN is required for Turso.');
        expect(createDependencyInstallPlan({ ...answers(), sqliteDriver: 'turso' }).packages).toContain('libsql');
    });

    it('retains the Convex workspace connection without enabling sync transfer', () => {
        const selected = { ...answers(), syncProvider: 'convex' as const, convexUrl: 'https://review.convex.cloud' };
        const derived = deriveEnvFromAnswers(selected);
        expect(derived.env.VITE_CONVEX_URL).toBe(selected.convexUrl);
        expect(derived.providerModules).toContain('or3-provider-convex/nuxt');
        expect(createDependencyInstallPlan(selected).packages).toContain('or3-provider-convex');
    });

    it('leaves the workspace provider inactive when SSR auth and sync are disabled', () => {
        const selected = { ...answers(), ssrAuthEnabled: false };
        const derived = deriveEnvFromAnswers(selected);
        expect(derived.env.OR3_SQLITE_DRIVER).toBeUndefined();
        expect(derived.providerModules).toEqual([]);
        expect(createDependencyInstallPlan(selected).packages).toEqual([]);
    });
});
