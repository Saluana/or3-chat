import { describe, expect, it } from 'vitest';
import type { BundledV1PluginDescriptor } from '~~/shared/plugins/runtime-descriptor';
import { ShadowPluginManager } from '../shadow-plugin-manager';

function descriptor(id: string, descriptorKey: `sha256-${string}`): BundledV1PluginDescriptor {
    return {
        id,
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
            moduleKey: `../../extensions/plugins/${id}/plugin.client.ts`,
            rebuildRequired: true,
        },
        descriptorKey,
    };
}

describe('ShadowPluginManager', () => {
    it('matches observed V1 managed IDs without registering contributions or hooks', () => {
        const manager = new ShadowPluginManager();
        manager.observeManagedActivation({
            descriptor: descriptor('beta', `sha256-${'b'.repeat(64)}`),
            lifecycleCoverage: 'legacy-global-possible',
            observedAt: 20,
        });
        manager.observeManagedActivation({
            descriptor: descriptor('alpha', `sha256-${'a'.repeat(64)}`),
            lifecycleCoverage: 'legacy-global-possible',
            observedAt: 10,
        });

        expect(manager.listManagedPluginIds()).toEqual(['alpha', 'beta']);
        expect(
            manager.listRecords().map((record) => ({
                id: record.descriptor.id,
                generation: record.generation,
                contributionCount: record.contributionCount,
                hookCount: record.hookCount,
            }))
        ).toEqual([
            { id: 'alpha', generation: 1, contributionCount: 0, hookCount: 0 },
            { id: 'beta', generation: 1, contributionCount: 0, hookCount: 0 },
        ]);
    });

    it('keeps duplicate observations idempotent and advances after observed replacement', () => {
        const manager = new ShadowPluginManager();
        const first = descriptor('alpha', `sha256-${'a'.repeat(64)}`);
        const replacement = descriptor('alpha', `sha256-${'b'.repeat(64)}`);

        expect(
            manager.observeManagedActivation({
                descriptor: first,
                lifecycleCoverage: 'legacy-global-possible',
                observedAt: 10,
            }).generation
        ).toBe(1);
        expect(
            manager.observeManagedActivation({
                descriptor: first,
                lifecycleCoverage: 'legacy-global-possible',
                observedAt: 20,
            }).generation
        ).toBe(1);
        expect(manager.observeManagedStop('alpha')).toBe(true);
        expect(manager.listManagedPluginIds()).toEqual([]);
        expect(
            manager.observeManagedActivation({
                descriptor: replacement,
                lifecycleCoverage: 'legacy-global-possible',
                observedAt: 30,
            }).generation
        ).toBe(2);
    });

    it('returns frozen diagnostic snapshots that cannot mutate manager state', () => {
        const manager = new ShadowPluginManager();
        manager.observeManagedActivation({
            descriptor: descriptor('alpha', `sha256-${'a'.repeat(64)}`),
            lifecycleCoverage: 'legacy-global-possible',
        });
        const records = manager.listRecords();
        expect(Object.isFrozen(records)).toBe(true);
        expect(Object.isFrozen(records[0])).toBe(true);
        expect(Object.isFrozen(records[0]?.descriptor)).toBe(true);
        expect(Object.isFrozen(records[0]?.descriptor.artifact)).toBe(true);
    });

    it('caps divergences and exposes only bounded allowlisted metadata', () => {
        const manager = new ShadowPluginManager(3);
        manager.recordDivergence({
            kind: 'desired-not-observed',
            desiredPluginId: 'alpha',
            desiredSource: 'extension',
            desiredWorkspaceId: 'workspace-1',
            observedAt: 10,
            secret: 'must-not-survive',
            payload: { token: 'must-not-survive' },
        } as never);
        manager.recordDivergence({
            kind: 'source-mismatch',
            desiredPluginId: 'beta',
            observedPluginId: 'beta',
            desiredSource: 'package',
            observedSource: 'extension',
            observedAt: 20,
        });
        manager.recordDivergence({
            kind: 'workspace-mismatch',
            desiredPluginId: 'gamma',
            observedPluginId: 'gamma',
            desiredWorkspaceId: 'workspace-2',
            observedWorkspaceId: 'workspace-1',
            observedAt: 30,
        });
        manager.recordDivergence({
            kind: 'rebuild-required',
            desiredPluginId: 'delta'.repeat(100),
            desiredSource: 'extension',
            rebuildRequiredReason: 'not-in-host-build',
            observedAt: 40,
        });

        const records = manager.listDivergences();
        expect(records).toHaveLength(3);
        expect(records.map((record) => record.sequence)).toEqual([2, 3, 4]);
        expect(records[0]).toMatchObject({
            kind: 'source-mismatch',
            desiredSource: 'package',
            observedSource: 'extension',
        });
        expect(records[1]).toMatchObject({
            kind: 'workspace-mismatch',
            desiredWorkspaceId: 'workspace-2',
            observedWorkspaceId: 'workspace-1',
        });
        expect(records[2]?.desiredPluginId).toHaveLength(256);
        expect(JSON.stringify(records)).not.toContain('must-not-survive');
        expect(Object.isFrozen(records)).toBe(true);
        expect(records.every(Object.isFrozen)).toBe(true);
    });

    it.each([0, 1.5, 1001])('rejects an unsafe divergence limit (%s)', (limit) => {
        expect(() => new ShadowPluginManager(limit)).toThrow(RangeError);
    });
});
