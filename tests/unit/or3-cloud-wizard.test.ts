import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateAdminPassword } from '../../shared/cloud/wizard/admin-dashboard';
import { createDefaultAnswers } from '../../shared/cloud/wizard/catalog';
import { applyAnswers } from '../../shared/cloud/wizard/apply';
import { buildDeployPlan } from '../../shared/cloud/wizard/deploy';
import {
    deriveEnvFromAnswers,
    deriveWizardOwnedEnvUpdates,
} from '../../shared/cloud/wizard/derive';
import { getWizardSteps } from '../../shared/cloud/wizard/steps';
import {
    createDependencyInstallPlan,
    executeDependencyInstallPlan,
    parseInstallPackageManager,
} from '../../shared/cloud/wizard/install-plan';
import {
    captureWizardRollbackSnapshots,
    restoreWizardRollbackSnapshots,
} from '../../shared/cloud/wizard/deploy-rollback';
import { createCleanWizardDeployEnv } from '../../shared/cloud/wizard/runtime-env';
import { buildRedactedSummary, validateAnswers } from '../../shared/cloud/wizard/validation';
import type { WizardAnswers, WizardStep } from '../../shared/cloud/wizard/types';
import { writeEnvFileDetailed } from '../../server/admin/config/env-file';

function validRecommendedAnswers() {
    const answers = createDefaultAnswers({
        instanceDir: '/tmp/or3-chat',
    });
    return {
        ...answers,
        basicAuthJwtSecret: 'jwt-secret-jwt-secret-jwt-secret-1234',
        basicAuthBootstrapEmail: 'admin@example.com',
        basicAuthBootstrapPassword: 'SuperSecurePassword123',
        fsTokenSecret: 'fs-token-secret-fs-token-secret-fs-token',
        fsRoot: '/tmp/or3-storage',
        adminUsername: 'admin',
        adminPassword: 'AdminPassword123',
    };
}

function getStepById(steps: WizardStep[], id: string): WizardStep {
    const step = steps.find((candidate) => candidate.id === id);
    expect(step).toBeDefined();
    return step as WizardStep;
}

function visibleFieldKeys(step: WizardStep, answers: WizardAnswers): string[] {
    return step.fields
        .filter((field) =>
            typeof field.visibleWhen === 'function'
                ? field.visibleWhen(answers)
                : true
        )
        .map((field) => String(field.key));
}

describe('or3 cloud wizard validation', () => {
    it('validates recommended stack with required secrets', () => {
        const result = validateAnswers(validRecommendedAnswers(), { strict: true });
        expect(result.errors, result.errors.join('\n')).toHaveLength(0);
        expect(result.ok).toBe(true);
    });

    it('fails when fs root is not absolute', () => {
        const result = validateAnswers({
            ...validRecommendedAnswers(),
            storageAdvancedEnabled: true,
            fsRoot: './relative-path',
        });
        expect(result.ok).toBe(false);
        expect(result.errors.join('\n')).toContain('OR3_STORAGE_FS_ROOT must be an absolute path');
    });

    it('validates and derives secure public Docker settings', () => {
        const missingDomain = validateAnswers({
            ...validRecommendedAnswers(),
            deploymentTarget: 'docker',
            dockerExposure: 'public',
            publicDomain: '',
        });
        expect(missingDomain.errors.join('\n')).toContain(
            'A public domain is required'
        );

        const result = validateAnswers({
            ...validRecommendedAnswers(),
            deploymentTarget: 'docker',
            dockerExposure: 'public',
            publicDomain: 'chat.example.com',
        });
        expect(result.errors, result.errors.join('\n')).toHaveLength(0);
        expect(result.derived.env.OR3_PUBLIC_DOMAIN).toBe('chat.example.com');
        expect(result.derived.env.OR3_ALLOWED_ORIGINS).toBe(
            'https://chat.example.com'
        );
        expect(result.derived.env.OR3_FORCE_HTTPS).toBe('true');
        expect(result.derived.env.OR3_TRUST_PROXY).toBe('true');

        for (const publicDomain of [
            'server',
            '1.2.3.4',
            'chat.123',
            'chat.local',
            'chat.internal',
            'router.home.arpa',
        ]) {
            const invalid = validateAnswers({
                ...validRecommendedAnswers(),
                deploymentTarget: 'docker',
                dockerExposure: 'public',
                publicDomain,
            });
            expect(invalid.errors.join('\n')).toContain(
                'Public domain must be a hostname'
            );
        }
    });

    it('requires convex url when storage provider is convex', () => {
        const result = validateAnswers({
            ...validRecommendedAnswers(),
            syncEnabled: false,
            syncProvider: 'sqlite',
            storageEnabled: true,
            storageProvider: 'convex',
            convexUrl: undefined,
        });
        expect(result.ok).toBe(false);
        expect(result.errors.join('\n')).toContain(
            'VITE_CONVEX_URL is required when Convex provider is selected.'
        );
    });

    it('allows basic-auth with convex providers when convex url is set', () => {
        const result = validateAnswers({
            ...validRecommendedAnswers(),
            authProvider: 'basic-auth',
            syncEnabled: true,
            syncProvider: 'convex',
            storageEnabled: false,
            storageProvider: 'fs',
            convexUrl: 'https://demo-123.convex.cloud',
            convexSelfHostedAdminKey: 'prod:demo-123|server-deployment-key',
        });
        expect(result.errors, result.errors.join('\n')).toHaveLength(0);
        expect(result.ok).toBe(true);
    });

    it('redacts secret values in review output', () => {
        const summary = buildRedactedSummary(validRecommendedAnswers());
        expect(summary).toContain('OR3_BASIC_AUTH_JWT_SECRET=<redacted>');
        expect(summary).toContain('OR3_STORAGE_FS_TOKEN_SECRET=<redacted>');
        expect(summary).not.toContain('jwt-secret-jwt-secret');
    });

    it('derives only selected provider modules', () => {
        const { providerModules } = deriveEnvFromAnswers(validRecommendedAnswers());
        expect(providerModules).toEqual([
            'or3-provider-basic-auth/nuxt',
            'or3-provider-fs/nuxt',
            'or3-provider-sqlite/nuxt',
        ]);
    });

    it('does not include convex backend-only admin jwt env in wizard-owned updates', () => {
        const answers = {
            ...validRecommendedAnswers(),
            authProvider: 'clerk' as const,
            clerkPublishableKey: 'pk_test_123',
            clerkSecretKey: 'sk_test_123',
            syncProvider: 'convex' as const,
            storageProvider: 'convex' as const,
            convexUrl: 'https://test.convex.cloud',
            convexClerkIssuerUrl: 'https://example.clerk.accounts.dev',
            convexAdminJwtSecret: 'convex-admin-secret-convex-admin-secret-123',
        };
        const { env } = deriveEnvFromAnswers(answers);
        const updates = deriveWizardOwnedEnvUpdates(env);

        expect(Object.keys(updates)).not.toContain('OR3_ADMIN_JWT_SECRET');
    });

    it('requires admin dashboard credentials when SSR auth is enabled', () => {
        const result = validateAnswers({
            ...validRecommendedAnswers(),
            adminUsername: undefined,
            adminPassword: undefined,
        });
        expect(result.ok).toBe(false);
        expect(result.errors.join('\n')).toContain(
            'OR3_ADMIN_USERNAME and OR3_ADMIN_PASSWORD are required when SSR auth is enabled.'
        );
    });

    it('warns instead of failing for legacy weak admin passwords', () => {
        const result = validateAnswers({
            ...validRecommendedAnswers(),
            adminUsername: 'admin',
            adminPassword: 'alllowercase123',
        });
        expect(result.ok).toBe(true);
        expect(result.warnings.join('\n')).toContain(
            'OR3_ADMIN_PASSWORD should contain at least one uppercase letter.'
        );
    });

    it('generates admin passwords that satisfy the shared policy', () => {
        const generated = generateAdminPassword(24);
        expect(generated).toHaveLength(24);
        expect(/[A-Z]/.test(generated)).toBe(true);
        expect(/[a-z]/.test(generated)).toBe(true);
        expect(/[0-9]/.test(generated)).toBe(true);
    });

    it('uses updated template wording and includes custom mode', () => {
        const steps = getWizardSteps(validRecommendedAnswers());
        const presetStep = steps.find((step) => step.id === 'preset');
        const providerStep = steps.find((step) => step.id === 'providers');

        expect(presetStep?.title).toBe('Starting Template');
        expect(presetStep?.description).toContain(
            'Preset templates auto-configure providers and skip manual provider selection'
        );

        const presetLabels = (presetStep?.fields[0]?.options ?? []).map(
            (option) => option.label
        );
        expect(presetLabels).toContain(
            'This device only — private, offline, and no account'
        );
        expect(presetLabels).toContain(
            'Self-hosted OR3 — accounts, SQLite, and filesystem storage'
        );
        expect(presetLabels).not.toContain(
            'Use recommended defaults — skip questions'
        );
        expect(presetLabels).toContain(
            'Clerk + Convex — managed authentication and data'
        );
        expect(presetLabels).toContain(
            'Custom — manually choose auth/sync/storage providers'
        );

        const authOptions = providerStep?.fields.find(
            (field) => field.key === 'authProvider'
        )?.options;
        expect(authOptions?.map((option) => option.label)).toEqual([
            'Basic Auth (Default)',
            'Clerk',
        ]);
        expect(authOptions?.[0]?.description).toContain('Pros:');
        expect(authOptions?.[0]?.description).toContain('Cons:');
        expect(authOptions?.[0]?.description).toContain('Best for:');
    });

    it('skips manual providers step for preset-local mode', () => {
        const steps = getWizardSteps({
            ...validRecommendedAnswers(),
            wizardMode: 'preset-local',
        });
        const providersStep = getStepById(steps, 'providers');
        expect(providersStep.canSkip?.(validRecommendedAnswers())).toBe(true);
    });

    it('reduces recommended self-host (local-dev) to setup, template, email, and review', () => {
        const answers = {
            ...validRecommendedAnswers(),
            wizardMode: 'preset-local' as const,
            deploymentTarget: 'local-dev' as const,
            targetAdvancedEnabled: false,
        };
        const visibleSteps = getWizardSteps(answers).filter(
            (step) => !step.canSkip?.(answers)
        );
        expect(visibleSteps.map((step) => step.id)).toEqual([
            'target',
            'preset',
            'provider-auth',
            'review',
        ]);
        expect(
            visibleFieldKeys(
                getStepById(visibleSteps, 'provider-auth'),
                answers
            )
        ).toEqual(['basicAuthBootstrapEmail']);
    });

    it('hides personal-local when cloudSetupEntry is set', () => {
        const answers = {
            ...validRecommendedAnswers(),
            cloudSetupEntry: true,
        };
        const presetStep = getStepById(getWizardSteps(answers), 'preset');
        const labels = (presetStep.fields[0]?.options ?? []).map(
            (option) => option.label
        );
        expect(labels).not.toContain(
            'This device only — private, offline, and no account'
        );
        expect(labels).toContain(
            'Self-hosted OR3 — accounts, SQLite, and filesystem storage'
        );
    });

    it('requires a real administrator identity for legacy fast defaults', () => {
        const answers = {
            ...validRecommendedAnswers(),
            wizardMode: 'preset-local-fast' as const,
            targetAdvancedEnabled: false,
        };
        const visibleSteps = getWizardSteps(answers).filter(
            (step) => !step.canSkip?.(answers)
        );
        expect(visibleSteps.map((step) => step.id)).toEqual([
            'target',
            'preset',
            'provider-auth',
            'review',
        ]);
    });

    it('defaults fs storage under the instance .data directory', () => {
        const answers = createDefaultAnswers({
            instanceDir: '/opt/or3-chat',
        });
        expect(answers.fsRoot).toBe('/opt/or3-chat/.data/or3-storage');
        expect(answers.fsRoot).not.toContain('/tmp/');
    });

    it('reduces the recommended Docker wizard to setup, template, email, and review', () => {
        const answers = {
            ...validRecommendedAnswers(),
            wizardMode: 'preset-local' as const,
            deploymentTarget: 'docker' as const,
            dockerExposure: 'private' as const,
            targetAdvancedEnabled: false,
        };
        const visibleSteps = getWizardSteps(answers).filter(
            (step) => !step.canSkip?.(answers)
        );
        expect(visibleSteps.map((step) => step.id)).toEqual([
            'target',
            'preset',
            'provider-auth',
            'review',
        ]);
        expect(
            visibleFieldKeys(
                getStepById(visibleSteps, 'provider-auth'),
                answers
            )
        ).toEqual(['basicAuthBootstrapEmail']);
    });

    it('skips manual providers step for preset-clerk-convex mode', () => {
        const answers = {
            ...validRecommendedAnswers(),
            wizardMode: 'preset-clerk-convex' as const,
            authProvider: 'clerk' as const,
            syncProvider: 'convex' as const,
            storageProvider: 'convex' as const,
            clerkPublishableKey: 'pk_test_123',
            clerkSecretKey: 'sk_test_123',
            convexUrl: 'https://test.convex.cloud',
        };
        const steps = getWizardSteps(answers);
        const providersStep = getStepById(steps, 'providers');
        expect(providersStep.canSkip?.(answers)).toBe(true);
    });

    it('shows manual providers step for custom mode', () => {
        const answers = {
            ...validRecommendedAnswers(),
            wizardMode: 'custom' as const,
        };
        const steps = getWizardSteps(answers);
        const providersStep = getStepById(steps, 'providers');
        expect(providersStep.canSkip?.(answers)).toBe(false);
    });

    it('hides limits details when limits are disabled', () => {
        const answers = {
            ...validRecommendedAnswers(),
            allAdvancedEnabled: true,
            cloudAdvancedEnabled: true,
            limitsEnabled: false,
        };
        const steps = getWizardSteps(answers);
        const cloudStep = getStepById(steps, 'openrouter-limits-security');
        const keys = visibleFieldKeys(cloudStep, answers);

        expect(keys).toContain('limitsEnabled');
        expect(keys).not.toContain('requestsPerMinute');
        expect(keys).not.toContain('maxConversations');
        expect(keys).not.toContain('maxMessagesPerDay');
        expect(keys).not.toContain('limitsStorageProvider');
    });

    it('hides themesToInstall unless install-selected is chosen', () => {
        const answers = {
            ...validRecommendedAnswers(),
            allAdvancedEnabled: true,
            baseAdvancedEnabled: true,
            themeInstallMode: 'use-existing' as const,
        };
        const themesStep = getStepById(getWizardSteps(answers), 'themes');
        expect(visibleFieldKeys(themesStep, answers)).not.toContain('themesToInstall');

        const installSelectedAnswers = {
            ...answers,
            themeInstallMode: 'install-selected' as const,
        };
        expect(visibleFieldKeys(themesStep, installSelectedAnswers)).toContain(
            'themesToInstall'
        );
    });

    it('hides forwardedForHeader when trustProxy is false', () => {
        const answers = {
            ...validRecommendedAnswers(),
            allAdvancedEnabled: true,
            cloudAdvancedEnabled: true,
            trustProxy: false,
        };
        const cloudStep = getStepById(getWizardSteps(answers), 'openrouter-limits-security');
        expect(visibleFieldKeys(cloudStep, answers)).not.toContain('forwardedForHeader');

        const proxiedAnswers = {
            ...answers,
            trustProxy: true,
        };
        expect(visibleFieldKeys(cloudStep, proxiedAnswers)).toContain(
            'forwardedForHeader'
        );
    });

    it('hides provider detail fields when provider features are disabled', () => {
        const answers = {
            ...validRecommendedAnswers(),
            targetAdvancedEnabled: true,
            syncEnabled: false,
        };
        const syncStep = getStepById(getWizardSteps(answers), 'provider-sync');
        expect(visibleFieldKeys(syncStep, answers)).toEqual([]);
    });

    it('places Clerk + Convex connection step before AI/limits/security', () => {
        const steps = getWizardSteps({
            ...validRecommendedAnswers(),
            authProvider: 'clerk',
            syncProvider: 'convex',
            storageProvider: 'convex',
        });

        const convexIndex = steps.findIndex((step) => step.id === 'convex-env');
        const openRouterIndex = steps.findIndex(
            (step) => step.id === 'openrouter-limits-security'
        );

        expect(convexIndex).toBeGreaterThan(-1);
        expect(openRouterIndex).toBeGreaterThan(-1);
        expect(convexIndex).toBeLessThan(openRouterIndex);
    });

    it('does not validate limits numeric bounds when limits are disabled', () => {
        const result = validateAnswers({
            ...validRecommendedAnswers(),
            limitsEnabled: false,
            requestsPerMinute: 0,
            maxConversations: -10,
            maxMessagesPerDay: -100,
        });
        expect(result.ok).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it('still validates limits numeric bounds when limits are enabled', () => {
        const result = validateAnswers({
            ...validRecommendedAnswers(),
            allAdvancedEnabled: true,
            cloudAdvancedEnabled: true,
            limitsEnabled: true,
            requestsPerMinute: 0,
        });
        expect(result.ok).toBe(false);
        expect(result.errors.join('\n')).toContain(
            'OR3_REQUESTS_PER_MINUTE must be >= 1.'
        );
    });

    it('uses per-section advanced toggles inside provider steps', () => {
        const answers = {
            ...validRecommendedAnswers(),
            targetAdvancedEnabled: true,
            authAdvancedEnabled: false,
        };
        const providerAuthStep = getStepById(getWizardSteps(answers), 'provider-auth');
        const hiddenAdvanced = visibleFieldKeys(providerAuthStep, answers);
        expect(hiddenAdvanced).toContain('authAdvancedEnabled');
        expect(hiddenAdvanced).toContain('basicAuthBootstrapEmail');
        expect(hiddenAdvanced).not.toContain('basicAuthJwtSecret');
        expect(hiddenAdvanced).not.toContain('basicAuthBootstrapPassword');
        expect(hiddenAdvanced).not.toContain('basicAuthAccessTtlSeconds');

        const enabledAdvanced = {
            ...answers,
            authAdvancedEnabled: true,
        };
        const shownAdvanced = visibleFieldKeys(providerAuthStep, enabledAdvanced);
        expect(shownAdvanced).toContain('basicAuthJwtSecret');
        expect(shownAdvanced).toContain('basicAuthBootstrapPassword');
        expect(shownAdvanced).toContain('basicAuthAccessTtlSeconds');

        const stepIds = getWizardSteps(enabledAdvanced).map((step) => step.id);
        expect(stepIds).not.toContain('advanced-gates');
    });

    it('shows effective defaults in review output when advanced fields are skipped', () => {
        const summary = buildRedactedSummary({
            ...validRecommendedAnswers(),
            cloudAdvancedEnabled: false,
            allAdvancedEnabled: false,
            requestsPerMinute: 999,
            limitsEnabled: true,
        });
        expect(summary).toContain('OR3_REQUESTS_PER_MINUTE=20');
        expect(summary).not.toContain('OR3_REQUESTS_PER_MINUTE=999');
    });
});

describe('or3 cloud wizard apply', () => {
    it('includes convex dev --once command in deploy plan when convex is selected', () => {
        const plan = buildDeployPlan({
            ...validRecommendedAnswers(),
            packageManager: 'bun',
            deploymentTarget: 'local-dev',
            syncEnabled: true,
            syncProvider: 'convex',
        });
        const commands = plan.map(
            (command) => `${command.command} ${command.args.join(' ')}`
        );
        expect(commands).toContain('bun run dev:ssr');
        expect(commands).toContain('bunx or3-provider-convex init');
        expect(commands).toContain('bunx convex dev --once');
    });

    it('skips convex dev --once for self-hosted convex setups', () => {
        const plan = buildDeployPlan({
            ...validRecommendedAnswers(),
            packageManager: 'bun',
            deploymentTarget: 'local-dev',
            syncEnabled: true,
            syncProvider: 'convex',
            storageEnabled: true,
            storageProvider: 'convex',
            convexUrl: 'http://self-hosted.convex.local',
            convexSelfHostedAdminKey: 'convex-local|test-admin-key',
        });
        const commands = plan.map(
            (command) => `${command.command} ${command.args.join(' ')}`
        );
        expect(commands).toContain('bunx or3-provider-convex init');
        expect(commands).not.toContain('bunx convex dev --once');
    });

    it('does not include convex scaffold/dev steps when convex is not selected', () => {
        const plan = buildDeployPlan({
            ...validRecommendedAnswers(),
            deploymentTarget: 'local-dev',
            syncEnabled: true,
            syncProvider: 'sqlite',
            storageEnabled: true,
            storageProvider: 'fs',
        });
        const commands = plan.map(
            (command) => `${command.command} ${command.args.join(' ')}`
        );
        expect(commands).not.toContain('bunx or3-provider-convex init');
        expect(commands).not.toContain('bunx convex dev --once');
    });

    it('builds npm-native local commands without Bun', () => {
        const plan = buildDeployPlan({
            ...validRecommendedAnswers(),
            packageManager: 'npm',
            deploymentTarget: 'local-dev',
        });
        const commands = plan.map(
            (command) => `${command.command} ${command.args.join(' ')}`
        );
        expect(commands).toContain('npm install');
        expect(commands).toContain('npm run dev:ssr');
        expect(commands.every((command) => !command.includes('bun'))).toBe(true);
    });

    it('builds private and public Docker Compose commands', () => {
        const privatePlan = buildDeployPlan({
            ...validRecommendedAnswers(),
            deploymentTarget: 'docker',
            dockerExposure: 'private',
        });
        expect(privatePlan[0]?.args).toEqual([
            'compose',
            '-f',
            'compose.yaml',
            'up',
            '--build',
            '-d',
            '--wait',
            '--wait-timeout',
            '120',
        ]);

        const publicPlan = buildDeployPlan({
            ...validRecommendedAnswers(),
            deploymentTarget: 'docker',
            dockerExposure: 'public',
            publicDomain: 'chat.example.com',
        });
        expect(publicPlan[0]?.args).toEqual([
            'compose',
            '-f',
            'compose.yaml',
            '-f',
            'compose.public.yaml',
            'up',
            '--build',
            '-d',
            '--wait',
            '--wait-timeout',
            '120',
        ]);
    });

    it('keeps Docker volumes scoped to each generated project', async () => {
        const compose = await readFile(resolve(process.cwd(), 'compose.yaml'), 'utf8');
        const publicCompose = await readFile(
            resolve(process.cwd(), 'compose.public.yaml'),
            'utf8'
        );

        expect(compose).not.toMatch(/^name:/m);
        expect(compose).not.toContain('name: or3-data');
        expect(publicCompose).not.toContain('name: or3-caddy');
    });

    it('rejects invalid package manager values', async () => {
        expect(() => parseInstallPackageManager('pnpm')).toThrow(
            'Invalid package manager'
        );

        const answers = validRecommendedAnswers();
        const plan = createDependencyInstallPlan(answers);
        await expect(
            executeDependencyInstallPlan(answers, plan, {
                enabled: true,
                dryRun: true,
                packageManager: 'pnpm' as never,
            })
        ).rejects.toThrow('Invalid package manager');
    });

    it('pins registry provider installs to release-qualified versions', async () => {
        const instanceDir = await mkdtemp(
            resolve(tmpdir(), 'or3-wizard-registry-provider-')
        );
        const plan = createDependencyInstallPlan({
            ...validRecommendedAnswers(),
            instanceDir,
        });
        expect(plan.commands.npm).toContain(
            'or3-provider-basic-auth@0.0.9'
        );
        expect(plan.commands.npm).toContain('or3-provider-fs@0.0.7');
        expect(plan.commands.npm).toContain('or3-provider-sqlite@0.0.9');
    });

    it('uses local provider package specs when sibling workspaces exist', async () => {
        const sandboxDir = await mkdtemp(resolve(tmpdir(), 'or3-wizard-local-provider-'));
        const chatDir = resolve(sandboxDir, 'or3-chat');
        await mkdir(chatDir, { recursive: true });

        for (const packageName of [
            'or3-provider-basic-auth',
            'or3-provider-fs',
            'or3-provider-sqlite',
        ]) {
            const providerDir = resolve(sandboxDir, packageName);
            await mkdir(providerDir, { recursive: true });
            await writeFile(
                resolve(providerDir, 'package.json'),
                JSON.stringify({ name: packageName, version: '0.0.0' }),
                'utf8'
            );
        }

        const answers = {
            ...validRecommendedAnswers(),
            instanceDir: chatDir,
        };
        const plan = createDependencyInstallPlan(answers);
        expect(plan.commands.bun).toContain('file:../or3-provider-basic-auth');
        expect(plan.commands.bun).toContain('file:../or3-provider-fs');
        expect(plan.commands.bun).toContain('file:../or3-provider-sqlite');
        expect(plan.commands.bun).toContain('better-sqlite3');
    });

    it('resolves local provider package specs from ancestor directories', async () => {
        const rootDir = await mkdtemp(resolve(tmpdir(), 'or3-wizard-ancestor-provider-'));
        const instanceDir = resolve(rootDir, 'sandbox', 'bcx', 'or3-chat');
        await mkdir(instanceDir, { recursive: true });

        for (const packageName of [
            'or3-provider-basic-auth',
            'or3-provider-convex',
        ]) {
            const providerDir = resolve(rootDir, packageName);
            await mkdir(providerDir, { recursive: true });
            await writeFile(
                resolve(providerDir, 'package.json'),
                JSON.stringify({ name: packageName, version: '0.0.0' }),
                'utf8'
            );
        }

        const answers = {
            ...validRecommendedAnswers(),
            instanceDir,
            syncProvider: 'convex',
            storageEnabled: false,
            storageProvider: 'fs',
            convexUrl: 'https://demo-123.convex.cloud',
        };
        const plan = createDependencyInstallPlan(answers);

        expect(plan.commands.bun).toContain('file:../../../or3-provider-basic-auth');
        expect(plan.commands.bun).toContain('file:../../../or3-provider-convex');
    });

    it('merges env updates and preserves unrelated keys/comments', async () => {
        const dir = await mkdtemp(resolve(tmpdir(), 'or3-wizard-env-'));
        const envPath = resolve(dir, '.env');
        await writeFile(
            envPath,
            '# Existing comment\nKEEP_ME=value\nOR3_SITE_NAME=Old Name\n',
            'utf8'
        );

        await writeEnvFileDetailed(
            {
                OR3_SITE_NAME: 'New Name',
                KEEP_ME: null,
                NEW_KEY: '123',
            },
            { instanceDir: dir, envFile: '.env' }
        );

        const content = await readFile(envPath, 'utf8');
        expect(content).toContain('# Existing comment');
        expect(content).toContain('OR3_SITE_NAME="New Name"');
        expect(content).not.toContain('KEEP_ME=value');
        expect(content).toContain('NEW_KEY=123');
        expect((await stat(envPath)).mode & 0o777).toBe(0o600);
    });

    it('tightens permissions when an unchanged env file already exists', async () => {
        const dir = await mkdtemp(resolve(tmpdir(), 'or3-wizard-env-permissions-'));
        const envPath = resolve(dir, '.env');
        await writeFile(envPath, 'OR3_SITE_NAME=OR3', 'utf8');
        await chmod(envPath, 0o644);

        const result = await writeEnvFileDetailed(
            { OR3_SITE_NAME: 'OR3' },
            { instanceDir: dir, envFile: '.env' }
        );

        expect(result.changed).toBe(false);
        expect((await stat(envPath)).mode & 0o777).toBe(0o600);
    });

    it('writes self-hosted convex runtime keys to .env.local for local-dev flows', async () => {
        const dir = await mkdtemp(resolve(tmpdir(), 'or3-wizard-env-local-convex-'));
        const result = await applyAnswers(
            {
                ...validRecommendedAnswers(),
                instanceDir: dir,
                envFile: '.env',
                deploymentTarget: 'local-dev',
                syncEnabled: true,
                syncProvider: 'convex',
                storageEnabled: true,
                storageProvider: 'convex',
                convexUrl: 'http://self-hosted.convex.local',
                convexSelfHostedAdminKey: 'convex-local|test-admin-key',
                convexSelfHostedSiteUrl: 'http://self-hosted.convex.local:3211',
            },
            { dryRun: false }
        );

        expect(result.writtenFiles).toContain(resolve(dir, '.env.local'));
        const envLocal = await readFile(resolve(dir, '.env.local'), 'utf8');
        expect(envLocal).toContain(
            'CONVEX_SELF_HOSTED_URL=http://self-hosted.convex.local'
        );
        expect(envLocal).toContain(
            'CONVEX_SELF_HOSTED_ADMIN_KEY=convex-local|test-admin-key'
        );
        expect(envLocal).toContain(
            'VITE_CONVEX_URL=http://self-hosted.convex.local'
        );
        expect(envLocal).toContain(
            'VITE_CONVEX_SITE_URL=http://self-hosted.convex.local:3211'
        );
        expect(envLocal).toContain(
            'OR3_CONVEX_ALLOW_INSECURE_HTTP=true'
        );
    });

    it('restores env and provider-module files after a failed post-apply install', async () => {
        const dir = await mkdtemp(resolve(tmpdir(), 'or3-wizard-rollback-'));
        const answers = {
            ...validRecommendedAnswers(),
            instanceDir: dir,
            deploymentTarget: 'local-dev' as const,
            authProvider: 'clerk' as const,
            syncProvider: 'convex' as const,
            storageProvider: 'convex' as const,
            clerkPublishableKey: 'pk_test_123',
            clerkSecretKey: 'sk_test_123',
            convexUrl: 'http://self-hosted.convex.local:3210',
            convexSelfHostedAdminKey: 'self-hosted-admin-key',
            convexSelfHostedSiteUrl: 'http://self-hosted.convex.local:3211',
        };

        const envPath = resolve(dir, '.env');
        const envLocalPath = resolve(dir, '.env.local');
        const providerModulesPath = resolve(dir, 'or3.providers.generated.ts');

        await writeFile(envPath, 'OR3_SITE_NAME=Before\n', 'utf8');
        await writeFile(
            providerModulesPath,
            'export const or3ProviderModules = [\'or3-provider-basic-auth/nuxt\'];\n',
            'utf8'
        );

        const snapshots = await captureWizardRollbackSnapshots(answers);

        await writeFile(envPath, 'OR3_SITE_NAME=After\n', 'utf8');
        await writeFile(envLocalPath, 'VITE_CONVEX_URL=http://changed.local\n', 'utf8');
        await writeFile(
            providerModulesPath,
            'export const or3ProviderModules = [\'or3-provider-convex/nuxt\'];\n',
            'utf8'
        );

        await restoreWizardRollbackSnapshots(snapshots);

        await expect(readFile(envPath, 'utf8')).resolves.toBe('OR3_SITE_NAME=Before\n');
        await expect(readFile(providerModulesPath, 'utf8')).resolves.toBe(
            'export const or3ProviderModules = [\'or3-provider-basic-auth/nuxt\'];\n'
        );
        await expect(readFile(envLocalPath, 'utf8')).rejects.toMatchObject({
            code: 'ENOENT',
        });
    });

    it('strips wizard-only env vars before starting local dev', () => {
        const env = createCleanWizardDeployEnv({
            SSR_AUTH_ENABLED: 'false',
            OR3_WIZARD_UI_ENABLED: 'true',
            OR3_WIZARD_UI_TOKEN: 'wizard-token',
            OR3_WIZARD_ENABLE_INSTALL: '1',
            AUTH_PROVIDER: 'clerk',
            OR3_SITE_NAME: 'OR3',
            PATH: process.env.PATH,
        });

        expect(env.SSR_AUTH_ENABLED).toBeUndefined();
        expect(env.AUTH_PROVIDER).toBeUndefined();
        expect(env.OR3_WIZARD_UI_ENABLED).toBeUndefined();
        expect(env.OR3_WIZARD_UI_TOKEN).toBeUndefined();
        expect(env.OR3_WIZARD_ENABLE_INSTALL).toBeUndefined();
        expect(env.OR3_SITE_NAME).toBeUndefined();
        expect(env.PATH).toBe(process.env.PATH);
    });
});
