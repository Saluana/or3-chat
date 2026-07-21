import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { PluginGrantReviewSnapshot } from '../../../../shared/plugins/grant-review';
import {
    ModuleV2Loader,
    buildPluginPackageAssetUrl,
} from '../../../../shared/plugins/module-v2-loader';
import type { PackageV2PluginDescriptor } from '../../../../shared/plugins/runtime-descriptor';
import type { WorkspaceSettingsStore } from '../../stores/types';
import { PluginPackageCandidateService } from '../package-candidate';
import { PluginPackageCandidateCanaryService } from '../package-candidate-canary';
import { PluginPackageLifecycleService } from '../package-lifecycle';
import { PluginPackagePromotionService } from '../package-promotion';
import { PluginPackagePointerStore, type PluginPackagePointer } from '../package-pointer-store';
import { ImmutablePluginPackageStore } from '../package-store';
import { ServerModuleResolver } from '../server-module-resolver';
import { getEnabledPlugins } from '../workspace-plugin-store';

function memoryStore(): WorkspaceSettingsStore {
    const values = new Map<string, string>();
    return {
        async get(workspaceId, key) {
            return values.get(`${workspaceId}:${key}`) ?? null;
        },
        async set(workspaceId, key, value) {
            values.set(`${workspaceId}:${key}`, value);
        },
    };
}

function manifest(version: string) {
    return {
        manifestVersion: 2,
        kind: 'plugin',
        id: 'alpha',
        name: 'Alpha',
        version,
        capabilities: [],
        engines: { or3: '^0.3.0', pluginApi: '^2.0.0' },
        runtime: {
            client: { entry: 'client.mjs', format: 'esm', isolation: 'host' },
            server: {
                routes: [
                    {
                        method: 'GET',
                        path: 'health',
                        handler: 'server/health.get.mjs',
                    },
                ],
            },
        },
        requestedGrants: ['documents.read'],
        features: { required: ['host.storage'], optional: [] },
        dependencies: { required: [], optional: [] },
        trust: 'trusted-host',
        settings: { version: 1 },
        stateCompatibility: {
            version: 1,
            reads: { minimum: 1, maximum: 1 },
            rollback: 'safe' as const,
        },
    };
}

function source(version: string, handlerBody: string): string {
    const root = mkdtempSync(resolve(tmpdir(), 'or3-e2e-source-'));
    mkdirSync(resolve(root, 'server'), { recursive: true });
    writeFileSync(resolve(root, 'or3.manifest.json'), JSON.stringify(manifest(version)));
    writeFileSync(resolve(root, 'client.mjs'), `export default { version: ${JSON.stringify(version)} };\n`);
    writeFileSync(resolve(root, 'server', 'health.get.mjs'), handlerBody);
    return root;
}

const grantReview: PluginGrantReviewSnapshot = {
    requestedGrants: ['documents.read'],
    approvedGrants: ['documents.read'],
    revision: `sha256-${'a'.repeat(64)}`,
    status: 'current',
};

describe('package install→promote→disable→rollback E2E', () => {
    it('updates client and server code by digest without process restart', async () => {
        const root = mkdtempSync(resolve(tmpdir(), 'or3-e2e-store-'));
        const packages = new ImmutablePluginPackageStore(root);
        const pointers = new PluginPackagePointerStore(root, packages);
        const settings = memoryStore();
        await settings.set('ws-1', 'plugins.enabled', JSON.stringify(['alpha']));

        const installedV1 = await packages.installPackage(
            'alpha',
            source('1.0.0', 'export default async () => ({ version: 1 });\n')
        );
        const pointer: PluginPackagePointer = {
            schemaVersion: 1,
            pluginId: 'alpha',
            revision: 1,
            current: {
                packageDigest: installedV1.digest,
                manifestDigest: installedV1.verification.manifestDigest,
                recordedAt: 1,
                stateCompatibility: manifest('1.0.0').stateCompatibility,
            },
            candidate: null,
            previous: null,
        };
        await pointers.writePointer('alpha', pointer);

        const candidates = new PluginPackageCandidateService(packages, pointers);
        const prepared = await candidates.prepare({
            pluginId: 'alpha',
            sourceRoot: source('2.0.0', 'export default async () => ({ version: 2 });\n'),
            host: {
                or3Version: '0.3.0',
                pluginApiVersion: '2.0.0',
                supportedTrustModes: ['trusted-host'],
                supportedGrants: ['documents.read'],
                supportedFeatures: ['host.storage'],
            },
            availableDependencies: [],
            dependencyNodes: [],
            grantReview,
            storedStateVersion: 1,
            loaderPreflight: () => ({ status: 'eligible', codes: [] }),
            now: () => 10,
        });
        expect(prepared.status).toBe('candidate-stored');
        if (prepared.status !== 'candidate-stored') throw new Error('expected candidate');

        const canary = new PluginPackageCandidateCanaryService(packages, pointers, root);
        const canaryResult = await canary.run({
            pluginId: 'alpha',
            packageDigest: prepared.stored.digest,
            clientId: 'client-a',
            snapshotState: () => ({ settings: { count: 1 } }),
            serverDryRun: () => ({ status: 'passed' }),
            clientHiddenPrepare: () => ({ status: 'passed' }),
            now: () => 20,
        });
        expect(canaryResult.status).toBe('passed');

        const promotion = new PluginPackagePromotionService(packages, pointers, canary);
        const promoted = await promotion.promote({
            pluginId: 'alpha',
            expectedCandidateDigest: prepared.stored.digest,
            storedStateVersion: 1,
            snapshotState: () => ({ settings: { count: 1 } }),
            restoreState: vi.fn(),
            now: () => 30,
        });
        expect(promoted.status).toBe('promoted');

        const importModule = vi.fn(async () => ({ default: { version: '2.0.0' } }));
        const loader = new ModuleV2Loader({
            assetUrl: buildPluginPackageAssetUrl,
            hostExternals: { '@or3/plugin-sdk': {} },
            importModule,
            enabled: true,
        });
        const descriptor: PackageV2PluginDescriptor = {
            id: 'alpha',
            version: '2.0.0',
            pluginApiVersion: '2.0.0',
            workspaceId: 'ws-1',
            policyRevision: 'p1',
            grantsRevision: 'g1',
            resolvedDependencyKeys: [],
            descriptorKey: `sha256-${'d'.repeat(64)}`,
            manifestVersion: 2,
            source: 'package',
            trust: 'trusted-host',
            artifact: {
                kind: 'package-v2',
                packageDigest: prepared.stored.digest,
                clientEntry: 'client.mjs',
                serverRoutes: [
                    { method: 'GET', path: 'health', handler: 'server/health.get.mjs' },
                ],
            },
        };
        const resolution = loader.resolve({
            descriptor,
            generation: 1,
            signal: new AbortController().signal,
            isGenerationCurrent: () => true,
        });
        expect(resolution.status).toBe('ready');
        if (resolution.status !== 'ready') throw new Error('expected ready');
        await expect(resolution.load()).resolves.toMatchObject({ status: 'loaded' });
        expect(importModule).toHaveBeenCalledWith(
            expect.stringContaining(prepared.stored.digest)
        );

        const resolver = new ServerModuleResolver({
            packages,
            pointers,
            importModule: async () => ({ default: async () => ({ version: 2 }) }),
            enabled: true,
        });
        const handler = await resolver.resolveHandler({
            pluginId: 'alpha',
            packageDigest: prepared.stored.digest,
            handlerPath: 'server/health.get.mjs',
        });
        await expect(handler.handler({} as never)).resolves.toEqual({ version: 2 });

        const lifecycle = new PluginPackageLifecycleService(packages, pointers, settings);
        await lifecycle.disable('ws-1', 'alpha');
        expect(await getEnabledPlugins(settings, 'ws-1')).toEqual([]);

        await settings.set('ws-1', 'plugins.enabled', JSON.stringify(['alpha']));
        const rolled = await promotion.rollback({
            pluginId: 'alpha',
            storedStateVersion: 1,
            snapshotState: () => ({ settings: { count: 1 } }),
            restoreState: vi.fn(),
            now: () => 40,
        });
        expect(rolled.status).toBe('rolled-back');
        if (rolled.status !== 'rolled-back') throw new Error('expected rollback');
        expect(rolled.pointer.current?.packageDigest).toBe(installedV1.digest);

        const stale = loader.resolve({
            descriptor,
            generation: 1,
            signal: new AbortController().signal,
            isGenerationCurrent: () => false,
        });
        if (stale.status !== 'ready') throw new Error('expected ready');
        await expect(stale.load()).resolves.toMatchObject({
            status: 'cancelled',
            reason: 'generation-stale',
        });
    });
});
