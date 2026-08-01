import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
    PluginPackageCandidateCanaryService,
    type CandidateStateValue,
    type RunPluginCandidateCanaryInput,
} from '../package-candidate-canary';
import { PluginPackagePointerStore, type PluginPackagePointer } from '../package-pointer-store';
import { ImmutablePluginPackageStore } from '../package-store';

function source(version: string): string {
    const root = mkdtempSync(resolve(tmpdir(), 'or3-canary-source-'));
    writeFileSync(resolve(root, 'or3.manifest.json'), JSON.stringify({
        manifestVersion: 2,
        kind: 'plugin',
        id: 'alpha',
        version,
    }));
    writeFileSync(resolve(root, 'client.mjs'), `export default ${JSON.stringify(version)};\n`);
    return root;
}

async function setup() {
    const root = mkdtempSync(resolve(tmpdir(), 'or3-canary-store-'));
    const packages = new ImmutablePluginPackageStore(root);
    const pointers = new PluginPackagePointerStore(root, packages);
    const current = await packages.installPackage('alpha', source('1.0.0'));
    const candidate = await packages.installPackage('alpha', source('2.0.0'));
    const target = (stored: typeof current, recordedAt: number) => ({
        packageDigest: stored.digest,
        manifestDigest: stored.verification.manifestDigest,
        recordedAt,
        stateCompatibility: {
            version: 1,
            reads: { minimum: 1, maximum: 1 },
            rollback: 'safe' as const,
        },
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
    const service = new PluginPackageCandidateCanaryService(packages, pointers, root);
    return { root, packages, pointers, service, current, candidate };
}

function input(
    candidate: Awaited<ReturnType<ImmutablePluginPackageStore['installPackage']>>,
    state: CandidateStateValue
): RunPluginCandidateCanaryInput {
    return {
        pluginId: 'alpha',
        workspaceId: 'workspace-1',
        packageDigest: candidate.digest,
        clientId: 'designated-client-1',
        snapshotState: () => state,
        readGrantReview: () => ({ status: 'current', revision: 'grant-review-1' }),
        serverDryRun: () => ({ status: 'passed' }),
        clientHiddenPrepare: () => ({ status: 'passed' }),
        now: () => 100,
    };
}

describe('candidate server/client canary', () => {
    it('uses copied read-only state and records digest-bound hidden-client evidence', async () => {
        const { service, candidate } = await setup();
        const original = { settings: { count: 1 }, items: ['a'] };
        const serverDryRun = vi.fn((context) => {
            expect(context.dryRun).toBe(true);
            expect(Object.isFrozen(context.state)).toBe(true);
            expect(context.state).not.toBe(original);
            expect(() => {
                (context.state as { settings: { count: number } }).settings.count = 2;
            }).toThrow();
            return { status: 'passed' as const };
        });
        const clientHiddenPrepare = vi.fn((context) => {
            expect(context).toMatchObject({
                visibility: 'hidden',
                canPublish: false,
                clientId: 'designated-client-1',
                packageDigest: candidate.digest,
                workspaceId: 'workspace-1',
            });
            return { status: 'passed' as const };
        });

        const result = await service.run({
            ...input(candidate, original),
            serverDryRun,
            clientHiddenPrepare,
        });

        expect(original).toEqual({ settings: { count: 1 }, items: ['a'] });
        expect(result).toMatchObject({
            status: 'passed',
            evidence: {
                packageDigest: candidate.digest,
                manifestDigest: candidate.verification.manifestDigest,
                pointerRevision: 1,
                clientId: 'designated-client-1',
                grantReviewRevision: 'grant-review-1',
                completedAt: 100,
            },
        });
        const evidence = JSON.parse(readFileSync(
            service.evidencePath('alpha', candidate.digest, 'workspace-1'),
            'utf8'
        ));
        expect(evidence.packageDigest).toBe(candidate.digest);
        expect(evidence.stateSnapshotDigest).toMatch(/^sha256-[a-f0-9]{64}$/);
    });

    it.each(['server', 'client'] as const)(
        'leaves current pointer/state untouched after %s failure',
        async (failure) => {
            const { root, service, candidate } = await setup();
            const state = { count: 1 };
            const pointerPath = resolve(root, '.active', 'alpha.json');
            const before = readFileSync(pointerPath, 'utf8');
            const canaryInput: RunPluginCandidateCanaryInput = {
                ...input(candidate, state),
                serverDryRun: () => failure === 'server'
                    ? { status: 'blocked', code: 'server-failed' }
                    : { status: 'passed' },
                clientHiddenPrepare: () => failure === 'client'
                    ? { status: 'blocked', code: 'client-failed' }
                    : { status: 'passed' },
            };

            expect(await service.run(canaryInput)).toMatchObject({
                status: 'blocked',
                stage: failure === 'server' ? 'server-dry-run' : 'client-canary',
                currentPointerUnchanged: true,
            });
            expect(readFileSync(pointerPath, 'utf8')).toBe(before);
            expect(state).toEqual({ count: 1 });
            expect(() => readFileSync(
                service.evidencePath('alpha', candidate.digest, 'workspace-1')
            )).toThrow();
        }
    );

    it('rejects canary evidence for anything except the exact candidate digest', async () => {
        const { service, current, candidate } = await setup();
        expect(await service.run(input(current, {}))).toMatchObject({
            status: 'blocked',
            stage: 'pointer',
            code: 'candidate-pointer-mismatch',
        });
        expect(await service.run(input(candidate, { invalid: Number.NaN }))).toMatchObject({
            status: 'blocked',
            stage: 'state',
        });
    });
});
