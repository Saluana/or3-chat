import { describe, expect, it } from 'vitest';
import type { BundledV1PluginDescriptor } from '../runtime-descriptor';
import { diffBundledV1Descriptors } from '../bundled-v1-diff';

function descriptor(
    overrides: Partial<BundledV1PluginDescriptor> = {}
): BundledV1PluginDescriptor {
    return {
        id: 'alpha',
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
            hostBuildId: 'build-1',
            moduleKey: 'module-1',
            rebuildRequired: true,
        },
        descriptorKey: `sha256-${'a'.repeat(64)}`,
        ...overrides,
    };
}

describe('bundled V1 descriptor diff', () => {
    it('classifies empty, start, stop, and identical states', () => {
        const active = descriptor();
        expect(diffBundledV1Descriptors({})).toEqual({ action: 'none', changes: [] });
        expect(diffBundledV1Descriptors({ desired: active })).toEqual({
            action: 'start',
            changes: [],
        });
        expect(diffBundledV1Descriptors({ active })).toEqual({ action: 'stop', changes: [] });
        expect(diffBundledV1Descriptors({ active, desired: active })).toEqual({
            action: 'none',
            changes: [],
        });
    });

    it.each([
        ['workspace', { workspaceId: 'workspace-2' }],
        ['policy', { policyRevision: 'policy-2' }],
        ['grants', { grantsRevision: 'grants-2' }],
        ['source', { source: 'builtin' as const }],
        ['dependencies', { resolvedDependencyKeys: ['dependency-2'] }],
    ] as const)('classifies %s context replacement', (change, overrides) => {
        const active = descriptor();
        const desired = descriptor({
            ...overrides,
            descriptorKey: `sha256-${'b'.repeat(64)}`,
        });
        expect(diffBundledV1Descriptors({ active, desired })).toEqual({
            action: 'replace',
            changes: [change],
        });
    });

    it.each([
        ['host-build', { hostBuildId: 'build-2', moduleKey: 'module-1', rebuildRequired: true }],
        ['module', { hostBuildId: 'build-1', moduleKey: 'module-2', rebuildRequired: true }],
    ] as const)('classifies %s executable replacement', (change, artifact) => {
        const active = descriptor();
        const desired = descriptor({
            artifact,
            descriptorKey: `sha256-${'b'.repeat(64)}`,
        });
        expect(diffBundledV1Descriptors({ active, desired })).toEqual({
            action: 'replace',
            changes: [change],
        });
    });

    it('requires a rebuild for metadata changes without a new host artifact', () => {
        const active = descriptor();
        const desired = descriptor({
            version: '2.0.0',
            descriptorKey: `sha256-${'b'.repeat(64)}`,
        });
        expect(diffBundledV1Descriptors({ active, desired })).toEqual({
            action: 'rebuild-required',
            reason: 'metadata-without-new-host-build',
            changes: ['version-metadata'],
        });
    });

    it('never claims disk-only bytes are hot-reloadable', () => {
        const active = descriptor();
        expect(
            diffBundledV1Descriptors({
                active,
                desired: descriptor({ descriptorKey: `sha256-${'b'.repeat(64)}` }),
                diskOnlyChangeDetected: true,
            })
        ).toEqual({
            action: 'rebuild-required',
            reason: 'disk-only-change',
            changes: [],
        });
    });
});

