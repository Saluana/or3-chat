import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import crossSpawn from 'cross-spawn';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultAnswers } from '../../../shared/cloud/wizard/catalog';
import { createDependencyInstallPlan, executeDependencyInstallPlan } from '../../../shared/cloud/wizard/install-plan';
import { runWizardDeploy, useWebWizardApi } from '../index';

// Exercise real planning, applying and deployment with process execution blocked.
vi.mock('cross-spawn', () => ({
    default: vi.fn(() => {
        const child = Object.assign(new EventEmitter(), {
            stdout: new EventEmitter(), stderr: new EventEmitter(),
        });
        queueMicrotask(() => child.emit('exit', 0));
        return child;
    }),
}));

describe('wizard deployment provider contracts', () => {
    let root: string;
    let instanceDir: string;

    beforeEach(async () => {
        root = await mkdtemp(resolve(tmpdir(), 'or3-wizard-provider-contract-'));
        instanceDir = resolve(root, 'chat');
        await mkdir(instanceDir);
        vi.stubEnv('OR3_CLOUD_WIZARD_HOME', resolve(root, 'wizard-home'));
        vi.mocked(crossSpawn).mockClear();
    });

    afterEach(async () => {
        vi.unstubAllEnvs();
        await rm(root, { recursive: true, force: true });
    });

    it.each([
        ['stale', '0.0.8', true],
        ['matching', '0.0.10', false],
    ] as const)('repairs a %s installed artifact under an exact manifest pin', async (_label, installedVersion, shouldInstall) => {
        const packageDir = resolve(instanceDir, 'node_modules/or3-provider-fs');
        await mkdir(packageDir, { recursive: true });
        await writeFile(resolve(instanceDir, 'package.json'), JSON.stringify({
            dependencies: { 'or3-provider-fs': '0.0.10' },
        }));
        await writeFile(resolve(packageDir, 'package.json'), JSON.stringify({
            name: 'or3-provider-fs', version: installedVersion,
        }));
        const answers = createDefaultAnswers({ instanceDir });
        const plan = { ...createDependencyInstallPlan(answers), packages: ['or3-provider-fs'] };
        await executeDependencyInstallPlan(answers, plan, { enabled: true, packageManager: 'bun' });
        if (shouldInstall) {
            expect(crossSpawn).toHaveBeenCalledWith('bun', ['add', 'or3-provider-fs@0.0.10'], expect.objectContaining({ cwd: instanceDir }));
        } else {
            expect(crossSpawn).not.toHaveBeenCalled();
        }
    });

    it('keeps an installed matching file dependency without imposing a registry version', async () => {
        const localProvider = resolve(root, 'or3-provider-fs');
        const installedProvider = resolve(instanceDir, 'node_modules/or3-provider-fs');
        await mkdir(localProvider);
        await mkdir(installedProvider, { recursive: true });
        const metadata = JSON.stringify({ name: 'or3-provider-fs', version: '0.0.0' });
        await writeFile(resolve(localProvider, 'package.json'), metadata);
        await writeFile(resolve(installedProvider, 'package.json'), metadata);
        await writeFile(resolve(instanceDir, 'package.json'), JSON.stringify({
            dependencies: { 'or3-provider-fs': 'file:../or3-provider-fs' },
        }));
        const answers = createDefaultAnswers({ instanceDir });
        const plan = { ...createDependencyInstallPlan(answers), packages: ['or3-provider-fs'] };
        await executeDependencyInstallPlan(answers, plan, { enabled: true, packageManager: 'bun' });
        expect(crossSpawn).not.toHaveBeenCalled();
    });

    it.each([
        ['deploy', true, false, true],
        ['save only', true, true, false],
        ['accounts disabled', false, false, false],
    ] as const)('preserves workspace-only Convex env handoff for %s', async (_label, ssrAuthEnabled, skipDeploy, shouldSetEnv) => {
        const api = useWebWizardApi();
        const session = await api.createSession({
            instanceDir, wizardMode: 'custom', deploymentTarget: 'configure-only', packageManager: 'bun',
        });
        await api.submitAnswers(session.id, {
            allAdvancedEnabled: true, ssrAuthEnabled, authProvider: 'clerk',
            syncProvider: 'convex', syncEnabled: false, storageEnabled: false, connectEnabled: false,
            convexUrl: 'https://review.convex.cloud',
            convexSelfHostedAdminKey: 'prod:review|local-fixture-key',
            convexClerkIssuerUrl: 'https://clerk.example.invalid',
            convexAdminJwtSecret: 'convex-local-fixture-secret-0123456789abcdef',
            clerkPublishableKey: 'pk_test_review_fixture', clerkSecretKey: 'sk_test_review_fixture',
            adminUsername: 'review-owner', adminPassword: 'Review-fixture-12345',
        });
        const result = await runWizardDeploy(session.id, { skipDeploy, installDependencies: false });
        expect(result.validation.errors).toEqual([]);
        expect(result.ok).toBe(true);
        const commands = vi.mocked(crossSpawn).mock.calls.map(([command, args]) => [command, args]);
        if (shouldSetEnv) {
            expect(commands).toContainEqual(['bun', ['x', 'convex', 'env', 'set', 'CLERK_ISSUER_URL=https://clerk.example.invalid']]);
            expect(commands).toContainEqual(['bun', ['x', 'convex', 'env', 'set', 'OR3_ADMIN_JWT_SECRET=convex-local-fixture-secret-0123456789abcdef']]);
        } else {
            expect(commands).toEqual([]);
        }
    });
});
