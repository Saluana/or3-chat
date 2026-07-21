import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
    PluginPackageCandidateCanaryService,
} from '../package-candidate-canary';
import { PluginPackagePromotionService } from '../package-promotion';
import { PluginPackagePointerStore, type PluginPackagePointer } from '../package-pointer-store';
import { ImmutablePluginPackageStore } from '../package-store';

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

async function setup(stateCompatibility = {
    version: 1,
    reads: { minimum: 1, maximum: 1 },
    rollback: 'safe' as const,
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
        packageDigest: candidate.digest,
        clientId: 'designated-client-1',
        snapshotState: () => ({ settings: { count: 1 } }),
        serverDryRun: () => ({ status: 'passed' }),
        clientHiddenPrepare: () => ({ status: 'passed' }),
        now: () => 100,
    });
    const service = new PluginPackagePromotionService(packages, pointers, canary);
    return { packages, pointers, service, current, candidate };
}

describe('PluginPackagePromotionService', () => {
    it('promotes a canary-backed candidate and keeps previous for rollback', async () => {
        const { service, pointers, current, candidate } = await setup();
        const result = await service.promote({
            pluginId: 'alpha',
            expectedCandidateDigest: candidate.digest,
            storedStateVersion: 1,
            snapshotState: () => ({ settings: { count: 1 } }),
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

    it('restores state and leaves current unchanged when promotion fails before pointer swap', async () => {
        const { service, pointers, current, candidate } = await setup();
        const restoreState = vi.fn(async () => undefined);
        const result = await service.promote({
            pluginId: 'alpha',
            expectedCandidateDigest: candidate.digest,
            storedStateVersion: 1,
            snapshotState: () => ({ settings: { count: 1 } }),
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
        expect(restoreState).toHaveBeenCalledOnce();
        const pointer = await pointers.readPointer('alpha');
        expect(pointer?.current?.packageDigest).toBe(current.digest);
        expect(pointer?.candidate?.packageDigest).toBe(candidate.digest);
    });

    it('blocks incompatible rollback before mutating the pointer', async () => {
        const { service, pointers, candidate } = await setup({
            version: 2,
            reads: { minimum: 2, maximum: 2 },
            rollback: 'unsupported',
        });
        await service.promote({
            pluginId: 'alpha',
            expectedCandidateDigest: candidate.digest,
            storedStateVersion: 2,
            snapshotState: () => ({ settings: {} }),
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
        expect(await pointers.readPointer('alpha')).toEqual(before);
    });
});
