import { describe, expect, it, vi } from 'vitest';
import { decideTrustedHostUi } from '../host-esm-facade';
import {
    buildPluginPackageAssetUrl,
    ModuleV2Loader,
} from '../module-v2-loader';
import type { PackageV2PluginDescriptor } from '../runtime-descriptor';

function descriptor(
    overrides: Omit<Partial<PackageV2PluginDescriptor>, 'artifact'> & {
        artifact?: Partial<PackageV2PluginDescriptor['artifact']>;
    } = {}
): PackageV2PluginDescriptor {
    const packageDigest =
        overrides.artifact?.packageDigest ??
        ('sha256-' + 'a'.repeat(64) as `sha256-${string}`);
    return {
        id: 'sample.plugin',
        version: '1.0.0',
        pluginApiVersion: '2.0.0',
        workspaceId: 'ws-1',
        policyRevision: 'policy-1',
        grantsRevision: 'grants-1',
        resolvedDependencyKeys: [],
        descriptorKey: ('sha256-' + 'b'.repeat(64)) as `sha256-${string}`,
        manifestVersion: 2,
        source: 'package',
        trust: 'trusted-host',
        ...overrides,
        artifact: {
            kind: 'package-v2',
            packageDigest,
            clientEntry: 'client.mjs',
            serverRoutes: [],
            ...overrides.artifact,
        },
    };
}

describe('ModuleV2Loader', () => {
    it('imports a digest-addressed package entry through the host asset URL', async () => {
        const imported = { default: { id: 'sample.plugin' } };
        const importModule = vi.fn(async () => imported);
        const loader = new ModuleV2Loader({
            assetUrl: buildPluginPackageAssetUrl,
            hostExternals: { '@or3/plugin-sdk': { defineOr3Plugin: vi.fn() } },
            importModule,
            trustedHostUi: decideTrustedHostUi({
                generatedFacade: false,
                importMap: false,
                vueSingletonIdentity: false,
                sdkSingletonIdentity: false,
                vueReactivity: false,
                vueComponentRendering: false,
                cspCompatible: false,
            }),
        });

        const controller = new AbortController();
        const resolution = loader.resolve({
            descriptor: descriptor(),
            generation: 3,
            signal: controller.signal,
            isGenerationCurrent: () => true,
        });
        expect(resolution.status).toBe('ready');
        if (resolution.status !== 'ready') throw new Error('expected ready');
        expect(resolution.url).toBe(
            `/api/plugins/packages/sample.plugin/sha256-${'a'.repeat(64)}/client.mjs`
        );

        await expect(resolution.load()).resolves.toEqual({
            status: 'loaded',
            module: imported,
            url: resolution.url,
            generation: 3,
            packageDigest: descriptor().artifact.packageDigest,
        });
        expect(importModule).toHaveBeenCalledWith(resolution.url);
    });

    it('resolves SDK host ABI externals without bundling a second copy', () => {
        const sdk = Object.freeze({ defineOr3Plugin: () => undefined });
        const loader = new ModuleV2Loader({
            assetUrl: buildPluginPackageAssetUrl,
            hostExternals: { '@or3/plugin-sdk': sdk },
        });
        expect(loader.resolveHostExternal('@or3/plugin-sdk')).toBe(sdk);
        expect(loader.resolveHostExternal('vue')).toBeUndefined();
    });

    it('blocks when the required SDK external is missing', () => {
        const loader = new ModuleV2Loader({
            assetUrl: buildPluginPackageAssetUrl,
            hostExternals: {},
        });
        expect(loader.resolve({
            descriptor: descriptor(),
            generation: 1,
            signal: new AbortController().signal,
            isGenerationCurrent: () => true,
        })).toMatchObject({
            status: 'blocked',
            code: 'host-external-missing',
            missingExternals: ['@or3/plugin-sdk'],
        });
    });

    it('keeps trusted-host UI rebuild-required until the facade proofs pass', () => {
        const loader = new ModuleV2Loader({
            assetUrl: buildPluginPackageAssetUrl,
            hostExternals: {
                '@or3/plugin-sdk': {},
                vue: {},
            },
            trustedHostUi: decideTrustedHostUi({
                generatedFacade: false,
                importMap: false,
                vueSingletonIdentity: false,
                sdkSingletonIdentity: false,
                vueReactivity: false,
                vueComponentRendering: false,
                cspCompatible: true,
            }),
        });
        expect(loader.resolve({
            descriptor: descriptor(),
            generation: 1,
            signal: new AbortController().signal,
            isGenerationCurrent: () => true,
            requiresTrustedHostUi: true,
        })).toMatchObject({
            status: 'rebuild-required',
            code: 'trusted-host-ui-abi-unproven',
            postBuildAlternative: 'isolated-client-or-declarative-ui',
        });
    });

    it('allows trusted-host UI only when every facade proof is present', async () => {
        const importModule = vi.fn(async () => ({ ok: true }));
        const loader = new ModuleV2Loader({
            assetUrl: buildPluginPackageAssetUrl,
            hostExternals: {
                '@or3/plugin-sdk': {},
                vue: {},
            },
            importModule,
            trustedHostUi: decideTrustedHostUi({
                generatedFacade: true,
                importMap: true,
                vueSingletonIdentity: true,
                sdkSingletonIdentity: true,
                vueReactivity: true,
                vueComponentRendering: true,
                cspCompatible: true,
            }),
        });
        const resolution = loader.resolve({
            descriptor: descriptor(),
            generation: 1,
            signal: new AbortController().signal,
            isGenerationCurrent: () => true,
            requiresTrustedHostUi: true,
        });
        expect(resolution.status).toBe('ready');
        if (resolution.status !== 'ready') throw new Error('expected ready');
        await expect(resolution.load()).resolves.toMatchObject({ status: 'loaded' });
    });

    it('cancels before import when the generation is already stale', async () => {
        const importModule = vi.fn(async () => ({ ok: true }));
        const loader = new ModuleV2Loader({
            assetUrl: buildPluginPackageAssetUrl,
            hostExternals: { '@or3/plugin-sdk': {} },
            importModule,
        });
        const resolution = loader.resolve({
            descriptor: descriptor(),
            generation: 4,
            signal: new AbortController().signal,
            isGenerationCurrent: () => false,
        });
        if (resolution.status !== 'ready') throw new Error('expected ready');
        await expect(resolution.load()).resolves.toEqual({
            status: 'cancelled',
            reason: 'generation-stale',
            generation: 4,
            packageDigest: descriptor().artifact.packageDigest,
        });
        expect(importModule).not.toHaveBeenCalled();
    });

    it('imports but refuses to publish when the generation flips during import', async () => {
        let current = true;
        let releaseImport: (() => void) | undefined;
        const importGate = new Promise<void>((resolve) => {
            releaseImport = resolve;
        });
        const importModule = vi.fn(async () => {
            await importGate;
            return { ok: true };
        });
        const loader = new ModuleV2Loader({
            assetUrl: buildPluginPackageAssetUrl,
            hostExternals: { '@or3/plugin-sdk': {} },
            importModule,
        });
        const resolution = loader.resolve({
            descriptor: descriptor(),
            generation: 7,
            signal: new AbortController().signal,
            isGenerationCurrent: () => current,
        });
        if (resolution.status !== 'ready') throw new Error('expected ready');
        const pending = resolution.load();
        current = false;
        releaseImport?.();
        await expect(pending).resolves.toEqual({
            status: 'cancelled',
            reason: 'generation-stale',
            generation: 7,
            packageDigest: descriptor().artifact.packageDigest,
        });
        expect(importModule).toHaveBeenCalledOnce();
    });

    it('cancels when the abort signal fires during import', async () => {
        const controller = new AbortController();
        let releaseImport: (() => void) | undefined;
        const importGate = new Promise<void>((resolve) => {
            releaseImport = resolve;
        });
        const loader = new ModuleV2Loader({
            assetUrl: buildPluginPackageAssetUrl,
            hostExternals: { '@or3/plugin-sdk': {} },
            importModule: async () => {
                await importGate;
                return { ok: true };
            },
        });
        const resolution = loader.resolve({
            descriptor: descriptor(),
            generation: 1,
            signal: controller.signal,
            isGenerationCurrent: () => true,
        });
        if (resolution.status !== 'ready') throw new Error('expected ready');
        const pending = resolution.load();
        controller.abort();
        releaseImport?.();
        await expect(pending).resolves.toMatchObject({
            status: 'cancelled',
            reason: 'aborted',
        });
    });

    it('blocks isolated trust modes before import', () => {
        const loader = new ModuleV2Loader({
            assetUrl: buildPluginPackageAssetUrl,
            hostExternals: { '@or3/plugin-sdk': {} },
        });
        expect(loader.resolve({
            descriptor: descriptor({ trust: 'isolated-client' }),
            generation: 1,
            signal: new AbortController().signal,
            isGenerationCurrent: () => true,
        })).toMatchObject({
            status: 'blocked',
            code: 'isolated-trust-not-supported',
        });
    });

    it('rejects path-traversal client entries', () => {
        const loader = new ModuleV2Loader({
            assetUrl: buildPluginPackageAssetUrl,
            hostExternals: { '@or3/plugin-sdk': {} },
        });
        expect(loader.resolve({
            descriptor: descriptor({
                artifact: { clientEntry: '../escape.mjs' },
            }),
            generation: 1,
            signal: new AbortController().signal,
            isGenerationCurrent: () => true,
        })).toMatchObject({
            status: 'blocked',
            code: 'invalid-asset-url',
        });
    });
});
