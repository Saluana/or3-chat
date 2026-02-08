import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDefaultAnswers } from '../../shared/cloud/wizard/catalog';
import { applyAnswers } from '../../shared/cloud/wizard/apply';
import { buildDeployPlan } from '../../shared/cloud/wizard/deploy';
import { deriveEnvFromAnswers } from '../../shared/cloud/wizard/derive';
import {
    createDependencyInstallPlan,
    executeDependencyInstallPlan,
    parseInstallPackageManager,
} from '../../shared/cloud/wizard/install-plan';
import { buildRedactedSummary, validateAnswers } from '../../shared/cloud/wizard/validation';
import { writeEnvFileDetailed } from '../../server/admin/config/env-file';

function validRecommendedAnswers() {
    const answers = createDefaultAnswers({
        instanceDir: '/tmp/or3-chat',
    });
    return {
        ...answers,
        basicAuthJwtSecret: 'jwt-secret-jwt-secret-jwt-secret-1234',
        basicAuthBootstrapEmail: 'admin@example.com',
        basicAuthBootstrapPassword: 'super-secure-password',
        fsTokenSecret: 'fs-token-secret-fs-token-secret-fs-token',
        fsRoot: '/tmp/or3-storage',
    };
}

describe('or3 cloud wizard validation', () => {
    it('validates recommended stack with required secrets', () => {
        const result = validateAnswers(validRecommendedAnswers(), { strict: true });
        expect(result.ok).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it('fails when fs root is not absolute', () => {
        const result = validateAnswers({
            ...validRecommendedAnswers(),
            fsRoot: './relative-path',
        });
        expect(result.ok).toBe(false);
        expect(result.errors.join('\n')).toContain('OR3_STORAGE_FS_ROOT must be an absolute path');
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
});

describe('or3 cloud wizard apply', () => {
    it('supports dry-run apply without writing files', async () => {
        const dir = await mkdtemp(resolve(tmpdir(), 'or3-wizard-dry-run-'));
        const result = await applyAnswers(
            {
                ...validRecommendedAnswers(),
                instanceDir: dir,
                envFile: '.env',
                dryRun: true,
            },
            { dryRun: true }
        );

        expect(result.dryRun).toBe(true);
        expect(result.writtenFiles).toEqual([]);
        expect(result.providerModules).toContain('or3-provider-sqlite/nuxt');
    });

    it('does not include convex dev command in deploy plan', () => {
        const plan = buildDeployPlan({
            ...validRecommendedAnswers(),
            deploymentTarget: 'local-dev',
            syncEnabled: true,
            syncProvider: 'convex',
        });
        const commands = plan.map(
            (command) => `${command.command} ${command.args.join(' ')}`
        );
        expect(commands).toContain('bun run dev:ssr');
        expect(commands).not.toContain('bunx convex dev');
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
    });
});
