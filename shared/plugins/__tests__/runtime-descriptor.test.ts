import { describe, expect, expectTypeOf, it } from 'vitest';
import {
    isPostBuildReloadableArtifact,
    type BundledV1ArtifactIdentity,
    type PackageV2ArtifactIdentity,
    type PluginArtifactIdentity,
    type PluginDescriptor,
} from '../runtime-descriptor';

describe('plugin runtime artifact identity', () => {
    it('narrows bundled and package capabilities by the kind discriminator', () => {
        const bundled: PluginArtifactIdentity = {
            kind: 'bundled-v1',
            hostBuildId: 'host-build-1',
            moduleKey: '/extensions/plugins/example/plugin.client.ts',
            rebuildRequired: true,
        };
        const packaged: PluginArtifactIdentity = {
            kind: 'package-v2',
            packageDigest: 'sha256-deadbeef',
            clientEntry: 'client/main.js',
            serverRoutes: [],
        };

        expect(isPostBuildReloadableArtifact(bundled)).toBe(false);
        expect(isPostBuildReloadableArtifact(packaged)).toBe(true);
        if (bundled.kind === 'bundled-v1') {
            expectTypeOf(bundled).toEqualTypeOf<BundledV1ArtifactIdentity>();
            expect(bundled.rebuildRequired).toBe(true);
        }
        if (packaged.kind === 'package-v2') {
            expectTypeOf(packaged).toEqualTypeOf<PackageV2ArtifactIdentity>();
            expect(packaged.packageDigest).toBe('sha256-deadbeef');
        }
    });

    it('keeps descriptor source and manifest version correlated with artifact kind', () => {
        const bundled: PluginDescriptor = {
            id: 'example',
            version: '1.0.0',
            manifestVersion: 1,
            pluginApiVersion: '1',
            source: 'extension',
            trust: 'trusted-host',
            workspaceId: 'workspace-1',
            policyRevision: 'policy-1',
            grantsRevision: 'grants-1',
            resolvedDependencyKeys: [],
            artifact: {
                kind: 'bundled-v1',
                hostBuildId: 'host-build-1',
                moduleKey: '/extensions/plugins/example/plugin.client.ts',
                rebuildRequired: true,
            },
            descriptorKey: 'sha256-descriptor',
        };

        expect(bundled.source).toBe('extension');
        expect(bundled.artifact.kind).toBe('bundled-v1');
    });
});
