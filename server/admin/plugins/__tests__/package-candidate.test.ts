import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PluginGrantReviewSnapshot } from '../../../../shared/plugins/grant-review';
import type { PluginV2GraphNode } from '../../../../shared/plugins/v2-dependency-graph';
import type { AvailablePluginV2Dependency } from '../../../../shared/plugins/v2-compatibility';
import {
    PluginPackageCandidateService,
    type PreparePluginPackageCandidateInput,
} from '../package-candidate';
import { PluginPackagePointerStore, type PluginPackagePointer } from '../package-pointer-store';
import { ImmutablePluginPackageStore } from '../package-store';
import { verifyPackageTree } from '../package-tree';

function manifest(version: string, requiredDependencies: Array<{ id: string; range: string; features?: string[] }> = []) {
    return {
        manifestVersion: 2,
        kind: 'plugin',
        id: 'alpha',
        name: 'Alpha',
        version,
        capabilities: [],
        engines: { or3: '^0.3.0', pluginApi: '^2.0.0' },
        runtime: { client: { entry: 'client.mjs', format: 'esm', isolation: 'host' } },
        requestedGrants: ['documents.read'],
        features: { required: ['host.storage'], optional: [] },
        dependencies: { required: requiredDependencies, optional: [] },
        trust: 'trusted-host',
        settings: { version: 1 },
        stateCompatibility: {
            version: 1,
            reads: { minimum: 1, maximum: 1 },
            rollback: 'safe' as const,
        },
    };
}

function source(version: string, requiredDependencies: Array<{ id: string; range: string; features?: string[] }> = []): string {
    const root = mkdtempSync(resolve(tmpdir(), 'or3-candidate-source-'));
    writeFileSync(resolve(root, 'or3.manifest.json'), JSON.stringify(manifest(version, requiredDependencies)));
    writeFileSync(resolve(root, 'client.mjs'), `export default ${JSON.stringify(version)};\n`);
    return root;
}

const currentReview: PluginGrantReviewSnapshot = {
    requestedGrants: ['documents.read'],
    approvedGrants: ['documents.read'],
    revision: `sha256-${'a'.repeat(64)}`,
    status: 'current',
};

async function setup() {
    const root = mkdtempSync(resolve(tmpdir(), 'or3-candidate-store-'));
    const packages = new ImmutablePluginPackageStore(root);
    const pointers = new PluginPackagePointerStore(root, packages);
    const service = new PluginPackageCandidateService(packages, pointers);
    const currentStored = await packages.installPackage('alpha', source('1.0.0'));
    const current = {
        packageDigest: currentStored.digest,
        manifestDigest: currentStored.verification.manifestDigest,
        recordedAt: 1,
        stateCompatibility: manifest('1.0.0').stateCompatibility,
    };
    const pointer: PluginPackagePointer = {
        schemaVersion: 1,
        pluginId: 'alpha',
        revision: 1,
        current,
        candidate: null,
        previous: null,
    };
    await pointers.writePointer('alpha', pointer);
    return { root, packages, pointers, service, pointer };
}

function baseInput(candidateSource: string): PreparePluginPackageCandidateInput {
    return {
        pluginId: 'alpha',
        sourceRoot: candidateSource,
        host: {
            or3Version: '0.3.0',
            pluginApiVersion: '2.0.0',
            supportedTrustModes: ['trusted-host'] as const,
            supportedGrants: ['documents.read'],
            supportedFeatures: ['host.storage'],
        },
        availableDependencies: [] as AvailablePluginV2Dependency[],
        dependencyNodes: [] as PluginV2GraphNode[],
        grantReview: currentReview,
        storedStateVersion: 1,
        loaderPreflight: () => ({ status: 'eligible' as const, codes: [] }),
        now: () => 2,
    };
}

describe('V2 package candidate preparation', () => {
    it('prepares a first install as an inactive candidate and is idempotent', async () => {
        const root = mkdtempSync(resolve(tmpdir(), 'or3-candidate-store-'));
        const packages = new ImmutablePluginPackageStore(root);
        const pointers = new PluginPackagePointerStore(root, packages);
        const service = new PluginPackageCandidateService(packages, pointers);
        const candidateSource = source('1.0.0');
        const input = { ...baseInput(candidateSource), storedStateVersion: null };

        const first = await service.prepare(input);
        const second = await service.prepare(input);

        expect(first).toMatchObject({
            status: 'candidate-stored',
            pointerUnchanged: false,
            pointer: { revision: 1, current: null, candidate: {} },
        });
        expect(second).toMatchObject({
            status: 'candidate-stored',
            pointerUnchanged: true,
            pointer: { revision: 1, current: null, candidate: {} },
        });
        expect(await pointers.readStartupSelection('alpha')).toMatchObject({
            status: 'inactive',
            selected: null,
        });
    });

    it('stores an immutable candidate without changing current', async () => {
        const { service, pointers, pointer: prior } = await setup();
        const result = await service.prepare(baseInput(source('2.0.0')));

        expect(result).toMatchObject({
            status: 'candidate-stored',
            pointer: {
                revision: 2,
                current: { packageDigest: prior.current?.packageDigest },
                candidate: { recordedAt: 2 },
                previous: null,
            },
        });
        expect(await pointers.readStartupSelection('alpha')).toMatchObject({
            status: 'ready',
            selected: { packageDigest: prior.current?.packageDigest },
        });
    });

    it.each([
        'digest',
        'compatibility',
        'grants',
        'dependencies',
        'loader',
        'state',
    ] as const)('leaves the prior pointer byte-identical after a %s failure', async (failure) => {
        const { root, service } = await setup();
        const required = failure === 'dependencies'
            ? [{ id: 'core', range: '^1.0.0', features: [] }]
            : [];
        const candidateSource = source('2.0.0', required);
        let input = baseInput(candidateSource);
        if (failure === 'digest') {
            input = { ...input, expectedDigest: `sha256-${'0'.repeat(64)}` };
        } else if (failure === 'compatibility') {
            input = { ...input, host: { ...input.host, or3Version: '9.0.0' } };
        } else if (failure === 'grants') {
            input = { ...input, grantReview: { ...currentReview, status: 'stale' } };
        } else if (failure === 'dependencies') {
            input = {
                ...input,
                availableDependencies: [{ id: 'core', version: '1.0.0', features: [] }],
            };
        } else if (failure === 'loader') {
            input = {
                ...input,
                loaderPreflight: () => ({ status: 'blocked', codes: ['loader-ineligible'] }),
            };
        } else if (failure === 'state') {
            input = { ...input, storedStateVersion: 99 };
        }
        const pointerPath = resolve(root, '.active', 'alpha.json');
        const before = readFileSync(pointerPath, 'utf8');
        const candidateDigest = (await verifyPackageTree(candidateSource)).digest;

        const result = await service.prepare(input);

        expect(result).toMatchObject({ status: 'blocked', pointerUnchanged: true });
        expect(readFileSync(pointerPath, 'utf8')).toBe(before);
        expect(() => readFileSync(resolve(root, '.store', 'alpha', candidateDigest, 'client.mjs'))).toThrow();
    });

    it('does not publish a candidate if source bytes change after loader preflight', async () => {
        const { root, service } = await setup();
        const candidateSource = source('2.0.0');
        const pointerPath = resolve(root, '.active', 'alpha.json');
        const before = readFileSync(pointerPath, 'utf8');
        const input = {
            ...baseInput(candidateSource),
            loaderPreflight: () => {
                writeFileSync(resolve(candidateSource, 'client.mjs'), 'export default "changed";\n');
                return { status: 'eligible' as const, codes: [] };
            },
        };

        expect(await service.prepare(input)).toMatchObject({
            status: 'blocked',
            stage: 'verification',
            codes: ['package-changed-after-preflight'],
        });
        expect(readFileSync(pointerPath, 'utf8')).toBe(before);
    });
});
