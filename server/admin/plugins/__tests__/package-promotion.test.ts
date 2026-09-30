import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
    PluginPackageCandidateCanaryService,
} from '../package-candidate-canary';
import { PluginPackagePromotionService } from '../package-promotion';
import { PluginPackagePointerStore, type PluginPackagePointer } from '../package-pointer-store';
import { ImmutablePluginPackageStore } from '../package-store';
import type { WorkspaceSettingsStore } from '../../stores/types';
import {
    clearHostActivationsForTests,
    registerHostActivation,
    resolveHostActivation,
} from '../../../utils/plugins/isolation/activation-registry';
import { tryAdmitActivationCall } from '../../../utils/plugins/isolation/activation-admission';
import {
    promoteScopedSetupValues,
    readSetupValuesFor,
    writeScopedSetupValues,
} from '../../../utils/plugins/setup/settings-store';

const currentGrantReview = () => ({
    status: 'current' as const,
    revision: 'grant-review-1',
});

function source(version: string): string {
    const root = mkdtempSync(resolve(tmpdir(), 'or3-promote-source-'));
    writeFileSync(
        resolve(root, 'or3.manifest.json'),
        JSON.stringify({
            manifestVersion: 2,
            kind: 'plugin',
            id: 'alpha',
            version,
        })
    );
    writeFileSync(resolve(root, 'client.mjs'), `export default ${JSON.stringify(version)};\n`);
    return root;
}

async function setup(stateCompatibility: {
    version: number;
    reads: { minimum: number; maximum: number };
    rollback: 'safe' | 'migration-required' | 'unsupported';
} = {
    version: 1,
    reads: { minimum: 1, maximum: 1 },
    rollback: 'safe',
}) {
    const root = mkdtempSync(resolve(tmpdir(), 'or3-promote-store-'));
    const packages = new ImmutablePluginPackageStore(root);
    const pointers = new PluginPackagePointerStore(root, packages);
    const current = await packages.installPackage('alpha', source('1.0.0'));
    const candidate = await packages.installPackage('alpha', source('2.0.0'));
    const target = (stored: typeof current, recordedAt: number) => ({
        packageDigest: stored.digest,
        manifestDigest: stored.verification.manifestDigest,
        recordedAt,
        stateCompatibility,
    });
    const pointer: PluginPackagePointer = {
        schemaVersion: 1,
        pluginId: 'alpha',
        revision: 1,
        current: target(current, 1),
        candidate: target(candidate, 2),
        previous: null,
    };
    await pointers.writePointer('alpha', pointer);
    const canary = new PluginPackageCandidateCanaryService(packages, pointers, root);
    await canary.run({
        pluginId: 'alpha',
        workspaceId: 'workspace-1',
        packageDigest: candidate.digest,
        clientId: 'designated-client-1',
        snapshotState: () => ({ settings: { count: 1 } }),
        readGrantReview: currentGrantReview,
        serverDryRun: () => ({ status: 'passed' }),
        clientHiddenPrepare: () => ({ status: 'passed' }),
        now: () => 100,
    });
    const service = new PluginPackagePromotionService(packages, pointers, canary);
    return { root, packages, pointers, canary, service, current, candidate };
}

describe('PluginPackagePromotionService', () => {
    it('refuses promotion when site approval was removed before the pointer commit', async () => {
        const { service, pointers, current, candidate } = await setup();
        const migrateState = vi.fn();
        const result = await service.promote({
            pluginId: 'alpha', workspaceId: 'workspace-1',
            expectedCandidateDigest: candidate.digest,
            storedStateVersion: 1,
            verifySiteApproval: async () => false,
            snapshotState: () => ({ settings: { count: 1 } }),
            readGrantReview: currentGrantReview,
            restoreState: vi.fn(),
            migrateState,
        });
        expect(result).toMatchObject({ status: 'blocked', stage: 'policy', code: 'site-approval-required' });
        expect((await pointers.readPointer('alpha'))?.current?.packageDigest).toBe(current.digest);
        expect(migrateState).not.toHaveBeenCalled();
    });

    it('rechecks affected workspaces inside the commit lock before changing the shared version', async () => {
        const { service, pointers, current, candidate } = await setup();
        const preflightWorkspaces = vi.fn().mockResolvedValue({
            blocking: [{ workspaceId: 'workspace-2', code: 'setup-required' }],
        });
        const result = await service.promote({
            pluginId: 'alpha', workspaceId: 'workspace-1',
            expectedCandidateDigest: candidate.digest,
            storedStateVersion: 1,
            snapshotState: () => ({ settings: { count: 1 } }),
            readGrantReview: currentGrantReview,
            restoreState: vi.fn(),
            preflightWorkspaces,
        });
        expect(preflightWorkspaces).toHaveBeenCalledOnce();
        expect(result).toMatchObject({ status: 'blocked', stage: 'workspaces', code: 'workspace-preflight-blocked' });
        expect((await pointers.readPointer('alpha'))?.current?.packageDigest).toBe(current.digest);
    });

    it('preserves a live settings edit when an eligible promotion is blocked by workspace preflight', async () => {
        const { service, candidate } = await setup();
        let liveSettings = { count: 1 };
        const result = await service.promote({
            pluginId: 'alpha', workspaceId: 'workspace-1',
            expectedCandidateDigest: candidate.digest,
            storedStateVersion: 1,
            snapshotState: () => ({ settings: { ...liveSettings } }),
            readGrantReview: currentGrantReview,
            restoreState: async (snapshot) => { liveSettings = { ...(snapshot as { settings: { count: number } }).settings }; },
            preflightWorkspaces: async () => {
                liveSettings = { count: 2 };
                return { blocking: [{ workspaceId: 'workspace-2', code: 'setup-required' }] };
            },
        });
        expect(result).toMatchObject({ status: 'blocked', stage: 'workspaces' });
        expect(liveSettings).toEqual({ count: 2 });
    });

    it('promotes a canary-backed candidate and keeps previous for rollback', async () => {
        const { service, pointers, current, candidate } = await setup();
        const result = await service.promote({
            pluginId: 'alpha',
            workspaceId: 'workspace-1',
            expectedCandidateDigest: candidate.digest,
            storedStateVersion: 1,
            snapshotState: () => ({ settings: { count: 1 } }),
            readGrantReview: currentGrantReview,
            restoreState: vi.fn(),
            now: () => 200,
        });
        expect(result.status).toBe('promoted');
        if (result.status !== 'promoted') throw new Error('expected promoted');
        expect(result.pointer.current?.packageDigest).toBe(candidate.digest);
        expect(result.pointer.previous?.packageDigest).toBe(current.digest);
        expect(result.pointer.candidate).toBeNull();

        const rolled = await service.rollback({
            pluginId: 'alpha',
            storedStateVersion: 1,
            snapshotState: () => ({ settings: { count: 1 } }),
            restoreState: vi.fn(),
            now: () => 300,
        });
        expect(rolled.status).toBe('rolled-back');
        if (rolled.status !== 'rolled-back') throw new Error('expected rolled-back');
        expect(rolled.pointer.current?.packageDigest).toBe(current.digest);
        const selection = await pointers.readStartupSelection('alpha');
        expect(selection.selected?.packageDigest).toBe(current.digest);
    });

    it('revokes live activations and aborts outstanding calls when promotion or rollback commits', async () => {
        clearHostActivationsForTests();
        const { service, candidate } = await setup();
        const grants = {
            requestedGrants: [],
            approvedGrants: [],
            revision: 'g1',
            status: 'current' as const,
            authoritySha256: null,
            packageDigest: null,
        };

        const beforePromote = registerHostActivation({
            pluginId: 'alpha',
            workspaceId: 'workspace-1',
            userId: 'user-1',
            packageDigest: candidate.digest,
            grants,
        });
        const inFlight = tryAdmitActivationCall(beforePromote.activationId, {
            requestId: 'rpc-promote-race',
            method: 'ai.complete',
            params: {},
        });
        expect(inFlight.ok).toBe(true);
        let aborted = 0;
        if (inFlight.ok) {
            inFlight.controller.signal.addEventListener('abort', () => {
                aborted += 1;
            });
        }

        const promoted = await service.promote({
            pluginId: 'alpha',
            workspaceId: 'workspace-1',
            expectedCandidateDigest: candidate.digest,
            storedStateVersion: 1,
            snapshotState: () => ({ settings: { count: 1 } }),
            readGrantReview: currentGrantReview,
            restoreState: vi.fn(),
            now: () => 200,
        });
        expect(promoted.status).toBe('promoted');
        expect(resolveHostActivation(beforePromote.activationId)).toMatchObject({
            ok: false,
            code: 'activation-revoked',
        });
        expect(aborted).toBe(1);

        const beforeRollback = registerHostActivation({
            pluginId: 'alpha',
            workspaceId: 'workspace-1',
            userId: 'user-1',
            packageDigest: candidate.digest,
            grants,
        });
        const rollingBack = tryAdmitActivationCall(beforeRollback.activationId, {
            requestId: 'rpc-rollback-race',
            method: 'connections.dispatch',
            params: {},
        });
        expect(rollingBack.ok).toBe(true);
        if (rollingBack.ok) {
            rollingBack.controller.signal.addEventListener('abort', () => {
                aborted += 1;
            });
        }

        const rolled = await service.rollback({
            pluginId: 'alpha',
            storedStateVersion: 1,
            snapshotState: () => ({ settings: { count: 1 } }),
            restoreState: vi.fn(),
            now: () => 300,
        });
        expect(rolled.status).toBe('rolled-back');
        expect(resolveHostActivation(beforeRollback.activationId)).toMatchObject({
            ok: false,
            code: 'activation-revoked',
        });
        expect(aborted).toBe(2);
        clearHostActivationsForTests();
    });

    it('leaves untouched state and current selection unchanged when promotion fails before pointer swap', async () => {
        const { service, pointers, current, candidate } = await setup();
        const restoreState = vi.fn(async () => undefined);
        const result = await service.promote({
            pluginId: 'alpha',
            workspaceId: 'workspace-1',
            expectedCandidateDigest: candidate.digest,
            storedStateVersion: 1,
            snapshotState: () => ({ settings: { count: 1 } }),
            readGrantReview: currentGrantReview,
            restoreState,
            faultBeforePointerSwap: async () => {
                throw new Error('forced-pre-swap-failure');
            },
        });
        expect(result).toMatchObject({
            status: 'blocked',
            stage: 'migration',
            currentPointerUnchanged: true,
        });
        expect(restoreState).not.toHaveBeenCalled();
        const pointer = await pointers.readPointer('alpha');
        expect(pointer?.current?.packageDigest).toBe(current.digest);
        expect(pointer?.candidate?.packageDigest).toBe(candidate.digest);
    });

    it('rolls back the setup transfer before a failed pointer swap', async () => {
        const { service, current, candidate } = await setup();
        const values = new Map<string, string>();
        const settings: WorkspaceSettingsStore = {
            get: async (workspaceId, key) => values.get(`${workspaceId}:${key}`) ?? null,
            set: async (workspaceId, key, value) => {
                values.set(`${workspaceId}:${key}`, value);
            },
        };
        await writeScopedSetupValues(
            settings,
            'workspace-1',
            'alpha',
            { packageDigest: current.digest },
            { token: 'running' }
        );
        await writeScopedSetupValues(
            settings,
            'workspace-1',
            'alpha',
            { packageDigest: candidate.digest, operationId: 'acq_retry_old' },
            { token: 'old-attempt' }
        );
        const result = await service.promote({
            pluginId: 'alpha',
            workspaceId: 'workspace-1',
            expectedCandidateDigest: candidate.digest,
            storedStateVersion: 1,
            snapshotState: () => ({ settings: { count: 1 } }),
            readGrantReview: currentGrantReview,
            restoreState: vi.fn(),
            prepareSetupPromotion: async () =>
                await promoteScopedSetupValues(
                    settings,
                    'workspace-1',
                    'alpha',
                    candidate.digest,
                    'acq_retry_old',
                    current.digest
                ),
            faultBeforePointerSwap: async () => {
                throw new Error('forced-pre-swap-failure');
            },
        });
        expect(result).toMatchObject({ status: 'blocked', stage: 'migration' });
        await expect(
            readSetupValuesFor(settings, 'workspace-1', 'alpha', {
                packageDigest: candidate.digest,
                operationId: 'acq_retry_new',
                basePackageDigest: current.digest,
            })
        ).resolves.toEqual({ token: 'running' });
        await expect(
            writeScopedSetupValues(
                settings,
                'workspace-1',
                'alpha',
                { packageDigest: candidate.digest, operationId: 'acq_retry_new' },
                { token: 'new-attempt' }
            )
        ).resolves.toBe(1);
    });

    it('rejects stale canary evidence when the workspace state changes', async () => {
        const { service, pointers, current, candidate } = await setup();
        const result = await service.promote({
            pluginId: 'alpha',
            workspaceId: 'workspace-1',
            expectedCandidateDigest: candidate.digest,
            storedStateVersion: 1,
            snapshotState: () => ({ settings: { count: 2 } }),
            readGrantReview: currentGrantReview,
            restoreState: vi.fn(),
        });

        expect(result).toMatchObject({
            status: 'blocked',
            stage: 'canary-evidence',
            code: 'canary-evidence-invalid',
        });
        expect((await pointers.readPointer('alpha'))?.current?.packageDigest).toBe(current.digest);
    });

    it('rejects canary evidence when the reviewed grants revision changes', async () => {
        const { service, pointers, current, candidate } = await setup();
        const result = await service.promote({
            pluginId: 'alpha',
            workspaceId: 'workspace-1',
            expectedCandidateDigest: candidate.digest,
            storedStateVersion: 1,
            snapshotState: () => ({ settings: { count: 1 } }),
            readGrantReview: () => ({
                status: 'current',
                revision: 'grant-review-2',
            }),
            restoreState: vi.fn(),
        });

        expect(result).toMatchObject({
            status: 'blocked',
            stage: 'canary-evidence',
            code: 'canary-evidence-invalid',
        });
        expect((await pointers.readPointer('alpha'))?.current?.packageDigest).toBe(current.digest);
    });

    it('blocks malformed canary evidence instead of throwing during promotion', async () => {
        const { service, pointers, canary, current, candidate } = await setup();
        writeFileSync(
            canary.evidencePath('alpha', candidate.digest, 'workspace-1'),
            JSON.stringify({ schemaVersion: 2, pluginId: 'alpha' })
        );

        await expect(
            service.promote({
                pluginId: 'alpha',
                workspaceId: 'workspace-1',
                expectedCandidateDigest: candidate.digest,
                storedStateVersion: 1,
                snapshotState: () => ({ settings: { count: 1 } }),
                readGrantReview: currentGrantReview,
                restoreState: vi.fn(),
            })
        ).resolves.toMatchObject({
            status: 'blocked',
            stage: 'canary-evidence',
            code: 'canary-evidence-invalid',
        });
        expect((await pointers.readPointer('alpha'))?.current?.packageDigest).toBe(
            current.digest
        );
    });

    it('keeps migrated state when a pointer write reports after rename', async () => {
        const { service, pointers, candidate } = await setup();
        const restoreState = vi.fn(async () => undefined);
        const result = await service.promote({
            pluginId: 'alpha',
            workspaceId: 'workspace-1',
            expectedCandidateDigest: candidate.digest,
            storedStateVersion: 1,
            snapshotState: () => ({ settings: { count: 1 } }),
            readGrantReview: currentGrantReview,
            restoreState,
            pointerWriteOptions: {
                fault: (step) => {
                    if (step === 'after-rename') throw new Error('forced-after-rename-failure');
                },
            },
        });

        expect(result).toMatchObject({ status: 'promoted' });
        expect(restoreState).not.toHaveBeenCalled();
        expect((await pointers.readPointer('alpha'))?.current?.packageDigest).toBe(candidate.digest);
    });

    it('preserves a live settings edit when a safe rollback pointer write fails', async () => {
        const { service, candidate } = await setup();
        await service.promote({
            pluginId: 'alpha', workspaceId: 'workspace-1',
            expectedCandidateDigest: candidate.digest, storedStateVersion: 1,
            snapshotState: () => ({ settings: { count: 1 } }),
            readGrantReview: currentGrantReview, restoreState: vi.fn(),
        });
        let liveSettings = { count: 1 };
        const result = await service.rollback({
            pluginId: 'alpha', storedStateVersion: 1,
            snapshotState: () => ({ settings: { ...liveSettings } }),
            restoreState: async (snapshot) => { liveSettings = { ...(snapshot as { settings: { count: number } }).settings }; },
            pointerWriteOptions: { fault: (step) => {
                if (step === 'before-temp-write') {
                    liveSettings = { count: 2 };
                    throw new Error('forced-pointer-write-failure');
                }
            } },
        });
        expect(result).toMatchObject({ status: 'blocked', stage: 'pointer-write' });
        expect(liveSettings).toEqual({ count: 2 });
    });

    it('recovers from a corrupt current by committing the verified previous target', async () => {
        const { packages, pointers, service, current, candidate } = await setup();
        await service.promote({
            pluginId: 'alpha',
            workspaceId: 'workspace-1',
            expectedCandidateDigest: candidate.digest,
            storedStateVersion: 1,
            snapshotState: () => ({ settings: { count: 1 } }),
            readGrantReview: currentGrantReview,
            restoreState: vi.fn(),
            now: () => 200,
        });
        // The promoted current package is now corrupt.
        const file = resolve(packages.packagePath('alpha', candidate.digest), 'client.mjs');
        chmodSync(file, 0o644);
        writeFileSync(file, 'corrupt');

        const rolled = await service.rollback({
            pluginId: 'alpha',
            storedStateVersion: 1,
            snapshotState: () => ({ settings: { count: 1 } }),
            restoreState: vi.fn(),
            now: () => 300,
        });
        expect(rolled).toMatchObject({ status: 'rolled-back' });
        if (rolled.status !== 'rolled-back') throw new Error('expected rolled-back');
        expect(rolled.pointer.current?.packageDigest).toBe(current.digest);
        // The broken reference is removed instead of being retained as previous.
        expect(rolled.pointer.previous).toBeNull();
        const selection = await pointers.readStartupSelection('alpha');
        expect(selection.status).toBe('ready');
        expect(selection.selected?.packageDigest).toBe(current.digest);
    });

    it('qualifies a candidate while the current slot is recovered', async () => {
        const { root, packages, pointers, current, candidate } = await setup();
        const third = await packages.installPackage('alpha', source('3.0.0'));
        const compatibility = {
            version: 1,
            reads: { minimum: 1, maximum: 1 },
            rollback: 'safe' as const,
        };
        await pointers.writePointer('alpha', {
            schemaVersion: 1,
            pluginId: 'alpha',
            revision: 2,
            current: {
                packageDigest: candidate.digest,
                manifestDigest: candidate.verification.manifestDigest,
                recordedAt: 3,
                stateCompatibility: compatibility,
            },
            candidate: {
                packageDigest: third.digest,
                manifestDigest: third.verification.manifestDigest,
                recordedAt: 4,
                stateCompatibility: compatibility,
            },
            previous: {
                packageDigest: current.digest,
                manifestDigest: current.verification.manifestDigest,
                recordedAt: 1,
                stateCompatibility: compatibility,
            },
        });
        const file = resolve(packages.packagePath('alpha', candidate.digest), 'client.mjs');
        chmodSync(file, 0o644);
        writeFileSync(file, 'corrupt');

        const canary = new PluginPackageCandidateCanaryService(packages, pointers, root);
        const result = await canary.run({
            pluginId: 'alpha',
            workspaceId: 'workspace-1',
            packageDigest: third.digest,
            clientId: 'designated-client-1',
            snapshotState: () => ({ settings: { count: 1 } }),
            readGrantReview: currentGrantReview,
            serverDryRun: () => ({ status: 'passed' }),
            clientHiddenPrepare: () => ({ status: 'passed' }),
            now: () => 100,
        });
        expect(result.status).toBe('passed');
    });

    it('promotes a fresh install with no previous and reports it as not previously installed', async () => {
        const root = mkdtempSync(resolve(tmpdir(), 'or3-promote-fresh-'));
        const packages = new ImmutablePluginPackageStore(root);
        const pointers = new PluginPackagePointerStore(root, packages);
        const candidate = await packages.installPackage('alpha', source('1.0.0'));
        const compatibility = {
            version: 1,
            reads: { minimum: 1, maximum: 1 },
            rollback: 'safe' as const,
        };
        await pointers.writePointer('alpha', {
            schemaVersion: 1,
            pluginId: 'alpha',
            revision: 1,
            current: null,
            candidate: {
                packageDigest: candidate.digest,
                manifestDigest: candidate.verification.manifestDigest,
                recordedAt: 2,
                stateCompatibility: compatibility,
            },
            previous: null,
        });
        const canary = new PluginPackageCandidateCanaryService(packages, pointers, root);
        await canary.run({
            pluginId: 'alpha',
            workspaceId: 'workspace-1',
            packageDigest: candidate.digest,
            clientId: 'designated-client-1',
            snapshotState: () => ({ settings: { count: 1 } }),
            readGrantReview: currentGrantReview,
            serverDryRun: () => ({ status: 'passed' }),
            clientHiddenPrepare: () => ({ status: 'passed' }),
            now: () => 100,
        });
        const service = new PluginPackagePromotionService(packages, pointers, canary);
        let runningDigest: string | null | undefined;
        const result = await service.promote({
            pluginId: 'alpha',
            workspaceId: 'workspace-1',
            expectedCandidateDigest: candidate.digest,
            storedStateVersion: null,
            snapshotState: () => ({ settings: { count: 1 } }),
            readGrantReview: currentGrantReview,
            restoreState: vi.fn(),
            prepareSetupPromotion: async ({ running }) => {
                runningDigest = running?.packageDigest ?? null;
            },
        });
        expect(result).toMatchObject({ status: 'promoted', wasInstalled: false });
        if (result.status !== 'promoted') throw new Error('expected promoted');
        expect(result.pointer.previous).toBeNull();
        expect(runningDigest).toBeNull();
    });

    it('promotes over a recovered previous and retains it as the verified running target', async () => {
        const { root, packages, pointers, current, candidate } = await setup();
        const third = await packages.installPackage('alpha', source('3.0.0'));
        const compatibility = {
            version: 1,
            reads: { minimum: 1, maximum: 1 },
            rollback: 'safe' as const,
        };
        // The runtime runs the previous (v1) while current (v2) is unreadable.
        // A raw pointer read would drop the rollback target and inherit v2.
        await pointers.writePointer('alpha', {
            schemaVersion: 1,
            pluginId: 'alpha',
            revision: 2,
            current: {
                packageDigest: candidate.digest,
                manifestDigest: candidate.verification.manifestDigest,
                recordedAt: 3,
                stateCompatibility: compatibility,
            },
            candidate: {
                packageDigest: third.digest,
                manifestDigest: third.verification.manifestDigest,
                recordedAt: 4,
                stateCompatibility: compatibility,
            },
            previous: {
                packageDigest: current.digest,
                manifestDigest: current.verification.manifestDigest,
                recordedAt: 1,
                stateCompatibility: compatibility,
            },
        });
        const file = resolve(packages.packagePath('alpha', candidate.digest), 'client.mjs');
        chmodSync(file, 0o644);
        writeFileSync(file, 'corrupt');

        const canary = new PluginPackageCandidateCanaryService(packages, pointers, root);
        await canary.run({
            pluginId: 'alpha',
            workspaceId: 'workspace-1',
            packageDigest: third.digest,
            clientId: 'designated-client-1',
            snapshotState: () => ({ settings: { count: 1 } }),
            readGrantReview: currentGrantReview,
            serverDryRun: () => ({ status: 'passed' }),
            clientHiddenPrepare: () => ({ status: 'passed' }),
            now: () => 100,
        });
        const service = new PluginPackagePromotionService(packages, pointers, canary);
        let runningDigest: string | null | undefined;
        const result = await service.promote({
            pluginId: 'alpha',
            workspaceId: 'workspace-1',
            expectedCandidateDigest: third.digest,
            storedStateVersion: 1,
            snapshotState: () => ({ settings: { count: 1 } }),
            readGrantReview: currentGrantReview,
            restoreState: vi.fn(),
            prepareSetupPromotion: async ({ running }) => {
                runningDigest = running?.packageDigest ?? null;
            },
            now: () => 200,
        });

        expect(result).toMatchObject({ status: 'promoted', wasInstalled: true });
        if (result.status !== 'promoted') throw new Error('expected promoted');
        expect(result.pointer.current?.packageDigest).toBe(third.digest);
        expect(result.pointer.previous?.packageDigest).toBe(current.digest);
        expect(runningDigest).toBe(current.digest);
    });

    it('blocks incompatible rollback before mutating the pointer', async () => {
        const { service, pointers, candidate } = await setup({
            version: 2,
            reads: { minimum: 2, maximum: 2 },
            rollback: 'unsupported',
        });
        await service.promote({
            pluginId: 'alpha',
            workspaceId: 'workspace-1',
            expectedCandidateDigest: candidate.digest,
            storedStateVersion: 2,
            snapshotState: () => ({ settings: { count: 1 } }),
            readGrantReview: currentGrantReview,
            restoreState: vi.fn(),
            now: () => 200,
        });
        const before = await pointers.readPointer('alpha');
        const rolled = await service.rollback({
            pluginId: 'alpha',
            storedStateVersion: 2,
            snapshotState: () => ({ settings: {} }),
            restoreState: vi.fn(),
        });
        expect(rolled).toMatchObject({
            status: 'blocked',
            stage: 'state',
            code: 'rollback-unsupported',
            currentPointerUnchanged: true,
        });
        const globallyReviewed = await service.rollback({
            pluginId: 'alpha', preflightWorkspaces: async () => ({ checked: 0, blocking: [] }),
            storedStateVersion: null, snapshotState: () => ({ settings: {} }), restoreState: vi.fn(),
        });
        expect(globallyReviewed).toMatchObject({ status: 'blocked', stage: 'state', code: 'rollback-unsupported' });
        expect(await pointers.readPointer('alpha')).toEqual(before);
    });

    it('refuses rollback when another enabled workspace cannot read the previous release', async () => {
        const { service, pointers, current, candidate } = await setup();
        await service.promote({
            pluginId: 'alpha', workspaceId: 'workspace-1', expectedCandidateDigest: candidate.digest,
            storedStateVersion: 1, snapshotState: () => ({ settings: { count: 1 } }),
            readGrantReview: currentGrantReview, restoreState: vi.fn(), now: () => 200,
        });
        const before = await pointers.readPointer('alpha');
        const preflightWorkspaces = vi.fn(async () => ({ checked: 2, blocking: [{ workspaceId: 'workspace-2', code: 'state-incompatible' }] }));
        const rolled = await service.rollback({
            pluginId: 'alpha', expectedCurrentDigest: candidate.digest, expectedPreviousDigest: current.digest,
            expectedPointerRevision: before!.revision, preflightWorkspaces,
            storedStateVersion: 1, snapshotState: () => ({ settings: {} }), restoreState: vi.fn(),
        });
        expect(rolled).toMatchObject({ status: 'blocked', stage: 'workspaces', code: 'workspace-preflight-blocked' });
        expect(preflightWorkspaces).toHaveBeenCalled();
        expect(await pointers.readPointer('alpha')).toEqual(before);
    });

    it('uses the reviewed enabled-workspace preflight instead of disabled admin workspace state', async () => {
        const { service, pointers, current, candidate } = await setup();
        await service.promote({
            pluginId: 'alpha', workspaceId: 'workspace-1', expectedCandidateDigest: candidate.digest,
            storedStateVersion: 1, snapshotState: () => ({ settings: { count: 1 } }),
            readGrantReview: currentGrantReview, restoreState: vi.fn(), now: () => 200,
        });
        const before = await pointers.readPointer('alpha');
        const snapshotState = vi.fn(() => ({ settings: {} }));
        const rolled = await service.rollback({
            pluginId: 'alpha', expectedCurrentDigest: candidate.digest, expectedPreviousDigest: current.digest,
            expectedPointerRevision: before!.revision,
            preflightWorkspaces: async () => ({ checked: 1, blocking: [] }),
            storedStateVersion: 999, snapshotState, restoreState: vi.fn(),
        });
        expect(rolled.status).toBe('rolled-back');
        expect(snapshotState).not.toHaveBeenCalled();
    });

    it('refuses a stale expected current version before changing workspace state', async () => {
        const { service, pointers, current, candidate } = await setup();
        await service.promote({
            pluginId: 'alpha', workspaceId: 'workspace-1', expectedCandidateDigest: candidate.digest,
            storedStateVersion: 1, snapshotState: () => ({ settings: { count: 1 } }),
            readGrantReview: currentGrantReview, restoreState: vi.fn(), now: () => 200,
        });
        const before = await pointers.readPointer('alpha');
        const snapshotState = vi.fn(() => ({ settings: {} }));
        const rolled = await service.rollback({
            pluginId: 'alpha', expectedCurrentDigest: current.digest, expectedPreviousDigest: candidate.digest,
            expectedPointerRevision: before!.revision, storedStateVersion: 1,
            snapshotState, restoreState: vi.fn(),
        });
        expect(rolled).toMatchObject({ status: 'blocked', stage: 'pointer', code: 'pointer-changed' });
        expect(snapshotState).not.toHaveBeenCalled();
        expect(await pointers.readPointer('alpha')).toEqual(before);
    });
});
