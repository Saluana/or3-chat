import { describe, expect, it } from 'vitest';
import { resolveModuleLoaderV2Status } from '../module-loader-v2-status';
import { ModuleV2Loader, buildPluginPackageAssetUrl } from '../module-v2-loader';
import type { PackageV2PluginDescriptor } from '../runtime-descriptor';

function descriptor(): PackageV2PluginDescriptor {
    return {
        id: 'alpha',
        version: '1.0.0',
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
            packageDigest: `sha256-${'a'.repeat(64)}`,
            clientEntry: 'client.mjs',
            serverRoutes: [],
        },
    };
}

describe('module loader V2 status and flag-off behavior', () => {
    it('reports static builds as unsupported even when the flag is on', () => {
        expect(
            resolveModuleLoaderV2Status({ enabled: true, mode: 'static' })
        ).toMatchObject({
            packagesSupported: false,
            reason: 'static-build-unsupported',
        });
    });

    it('keeps bundled V1 available semantics when the module loader flag is off', () => {
        const status = resolveModuleLoaderV2Status({ enabled: false, mode: 'ssr' });
        expect(status).toMatchObject({
            packagesSupported: false,
            reason: 'flag-off',
        });
        expect(status.message).toContain('BundledV1Loader');

        const loader = new ModuleV2Loader({
            assetUrl: buildPluginPackageAssetUrl,
            hostExternals: { '@or3/plugin-sdk': {} },
            enabled: false,
        });
        expect(
            loader.resolve({
                descriptor: descriptor(),
                generation: 1,
                signal: new AbortController().signal,
                isGenerationCurrent: () => true,
            })
        ).toMatchObject({ status: 'blocked', code: 'loader-disabled' });
    });
});
