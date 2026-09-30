import { describe, expect, it } from 'vitest';
import { TrustedV2ClientManager } from '../trusted-v2-manager';
import type { PluginRuntimeManifestResponse } from '~~/shared/plugins/runtime-manifest';
import type { PackageV2PluginDescriptor } from '~~/shared/plugins/runtime-descriptor';

function descriptor(id: string, key: string): PackageV2PluginDescriptor {
    return {
        id, version: '0.1.0', pluginApiVersion: '2.0.0', workspaceId: 'one',
        policyRevision: 'p', grantsRevision: 'g', resolvedDependencyKeys: [],
        descriptorKey: key as PackageV2PluginDescriptor['descriptorKey'],
        manifestVersion: 2, source: 'package', trust: 'trusted-host', name: id,
        effectiveGrants: [],
        artifact: {
            kind: 'package-v2', packageDigest: 'sha256-package',
            clientEntry: 'dist/client.mjs',
            client: { entry: 'dist/client.mjs', isolation: 'host', digest: 'sha256-client' },
            serverRoutes: [],
        },
    };
}

function manifest(...descriptors: PackageV2PluginDescriptor[]): PluginRuntimeManifestResponse {
    return {
        workspaceId: 'one', revision: String(descriptors.length),
        installedPluginIds: descriptors.map((item) => item.id),
        enabledPluginIds: descriptors.map((item) => item.id),
        runtime: Object.fromEntries(descriptors.map((item) => [item.id, {
            descriptorStatus: 'ready', descriptor: item, lifecycleCoverage: 'managed-v2',
            hasServerRoutes: false, loadAllowed: true,
        }])),
    };
}

describe('trusted V2 client lifecycle', () => {
    it('activates verified host entries once and disposes on disable, replacement, and workspace exit', async () => {
        const events: string[] = [];
        const manager = new TrustedV2ClientManager({
            async activate(item) {
                events.push(`start:${item.descriptorKey}`);
                return { dispose: async () => { events.push(`stop:${item.descriptorKey}`); } };
            },
        });
        await manager.reconcile(manifest(descriptor('or3-workflows', 'sha256-a')), 'one');
        await manager.reconcile(manifest(descriptor('or3-workflows', 'sha256-a')), 'one');
        await manager.reconcile(manifest(descriptor('or3-workflows', 'sha256-b')), 'one');
        await manager.reconcile(manifest(), 'one');
        expect(events).toEqual(['start:sha256-a', 'stop:sha256-a', 'start:sha256-b', 'stop:sha256-b']);
    });

    it('rejects stale activation after a workspace switch and never publishes it', async () => {
        const events: string[] = [];
        let release!: () => void;
        let started!: () => void;
        const blocked = new Promise<void>((resolve) => { release = resolve; });
        const activating = new Promise<void>((resolve) => { started = resolve; });
        const manager = new TrustedV2ClientManager({
            async activate() {
                started();
                await blocked;
                events.push('loaded');
                return { dispose: async () => { events.push('disposed'); } };
            },
        });
        const pending = manager.reconcile(manifest(descriptor('or3-workflows', 'sha256-a')), 'one');
        await activating;
        const leaving = manager.stopAll();
        release();
        await Promise.all([pending, leaving]);
        expect(events).toEqual(['loaded', 'disposed']);
    });

    it('disposes other plugins and retains a failed teardown for retry', async () => {
        const disposed: string[] = [];
        let failOnce = true;
        const manager = new TrustedV2ClientManager({
            onError() { throw new Error('reporter failed'); },
            async activate(item) {
                return { dispose: async () => {
                    if (item.id === 'first' && failOnce) {
                        failOnce = false;
                        throw new Error('cleanup failed');
                    }
                    disposed.push(item.id);
                } };
            },
        });
        await manager.reconcile(manifest(descriptor('first', 'sha256-a'), descriptor('second', 'sha256-b')), 'one');
        await expect(manager.stopAll()).rejects.toThrow('cleanup failed');
        expect(disposed).toEqual(['second']);
        await manager.stopAll();
        expect(disposed).toEqual(['second', 'first']);
    });

    it('ignores entries that are not ready, approved, and host isolated', async () => {
        const events: string[] = [];
        const rejected = descriptor('or3-workflows', 'sha256-a');
        const response = manifest(rejected);
        response.runtime[rejected.id]!.loadAllowed = false;
        const manager = new TrustedV2ClientManager({
            async activate() {
                events.push('started');
                return { dispose: async () => {} };
            },
        });
        await manager.reconcile(response, 'one');
        expect(events).toEqual([]);
    });
});
