import { describe, expect, it } from 'vitest';
import { TrustedV2ClientManager } from '../trusted-v2-manager';
import { createTrustedHostContext } from '../trusted-host-context';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine } from '~/core/hooks/useHooks';
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
    // Reconciliation must preserve the live signal and SDK authority of retained
    // activations, including an identical refresh and adding another plugin.
    it.each(['identical', 'add', 'replace', 'remove'] as const)('keeps a retained trusted context live across a %s manifest refresh', async (change) => {
        setHookEngine(createTypedHookEngine(createHookEngine()));
        const contexts = new Map<string, ReturnType<typeof createTrustedHostContext>>();
        const manager = new TrustedV2ClientManager({
            async activate(item, generation, signal) {
                const trusted = createTrustedHostContext({
                    pluginId: item.id, version: item.version,
                    workspaceId: item.workspaceId, generation, signal, grants: ['settings.read'],
                });
                contexts.set(item.id, trusted);
                return { dispose: async () => { await trusted.dispose(); } };
            },
        });
        const first = descriptor('fixture.retained', 'sha256-retained');
        const other = descriptor('fixture.other', 'sha256-other');
        try {
            await manager.reconcile(manifest(first, other), 'one');
            const trusted = contexts.get(first.id)!;
            expect(trusted.context.signal.aborted).toBe(false);
            expect(await trusted.context.settings.get('missing')).toEqual({ ok: true, value: null });
            const next = change === 'add' ? manifest(first, other, descriptor('fixture.added', 'sha256-added'))
                : change === 'replace' ? manifest(first, descriptor(other.id, 'sha256-updated'))
                : change === 'remove' ? manifest(first) : manifest(first, other);
            await manager.reconcile(next, 'one');
            expect(contexts.get(first.id)).toBe(trusted);
            expect(await trusted.context.settings.get('missing')).toEqual({ ok: true, value: null });
            expect(trusted.context.signal.aborted).toBe(false);
            expect(manager.observedActivations.has(first.id)).toBe(true);
        } finally {
            await manager.stopAll();
            setHookEngine(null);
        }
    });

    it('reactivates a revoked descriptor when disable is immediately superseded by enable', async () => {
        const signals: AbortSignal[] = [];
        let disposed = 0;
        const manager = new TrustedV2ClientManager({
            async activate(_item, _generation, signal) {
                signals.push(signal);
                return { dispose: async () => { disposed += 1; } };
            },
        });
        const wanted = manifest(descriptor('fixture.burst', 'sha256-same'));
        await manager.reconcile(wanted, 'one');
        const disabling = manager.reconcile(manifest(), 'one');
        const enabling = manager.reconcile(wanted, 'one');
        expect(signals[0]!.aborted).toBe(true);
        await Promise.all([disabling, enabling]);
        expect(signals).toHaveLength(2);
        expect(signals[1]!.aborted).toBe(false);
        expect(disposed).toBe(1);
        await manager.stopAll();
        expect(signals[1]!.aborted).toBe(true);
        expect(disposed).toBe(2);
    });

    it.each(['replace', 'disable', 'workspace', 'stop'] as const)('revokes an active context immediately on %s', async (change) => {
        let activeSignal!: AbortSignal;
        const manager = new TrustedV2ClientManager({
            async activate(_item, _generation, signal) {
                activeSignal = signal;
                return { dispose: async () => {} };
            },
        });
        const first = descriptor('fixture.revoked', 'sha256-before');
        await manager.reconcile(manifest(first), 'one');
        const previous = activeSignal;
        const nextWorkspace = manifest({ ...first, workspaceId: 'two' });
        nextWorkspace.workspaceId = 'two';
        const pending = change === 'replace' ? manager.reconcile(manifest(descriptor(first.id, 'sha256-after')), 'one')
            : change === 'disable' ? manager.reconcile(manifest(), 'one')
            : change === 'workspace' ? manager.reconcile(nextWorkspace, 'two') : manager.stopAll();
        expect(previous.aborted).toBe(true);
        await pending;
        await manager.stopAll();
    });

    it('aborts pending setup on a changed manifest and never publishes the stale activation', async () => {
        let activeSignal!: AbortSignal;
        let release!: () => void;
        let started!: () => void;
        const blocked = new Promise<void>((resolve) => { release = resolve; });
        const activating = new Promise<void>((resolve) => { started = resolve; });
        const disposed: string[] = [];
        const manager = new TrustedV2ClientManager({
            async activate(item, _generation, signal) {
                if (item.descriptorKey === 'sha256-before') {
                    activeSignal = signal;
                    started();
                    await blocked;
                }
                return { dispose: async () => { disposed.push(item.descriptorKey); } };
            },
        });
        const pending = manager.reconcile(manifest(descriptor('fixture.pending', 'sha256-before')), 'one');
        await activating;
        const refreshed = manager.reconcile(manifest(descriptor('fixture.pending', 'sha256-after')), 'one');
        expect(activeSignal.aborted).toBe(true);
        release();
        await Promise.all([pending, refreshed]);
        expect(disposed).toEqual(['sha256-before']);
        expect(manager.observedActivations.get('fixture.pending')?.packageDigest).toBe('sha256-package');
        await manager.stopAll();
        expect(disposed).toEqual(['sha256-before', 'sha256-after']);
    });

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
        let activeSignal!: AbortSignal;
        let release!: () => void;
        let started!: () => void;
        const blocked = new Promise<void>((resolve) => { release = resolve; });
        const activating = new Promise<void>((resolve) => { started = resolve; });
        const manager = new TrustedV2ClientManager({
            async activate(_item, _generation, signal) {
                activeSignal = signal;
                started();
                await blocked;
                events.push('loaded');
                return { dispose: async () => { events.push('disposed'); } };
            },
        });
        const pending = manager.reconcile(manifest(descriptor('or3-workflows', 'sha256-a')), 'one');
        await activating;
        const leaving = manager.stopAll();
        expect(activeSignal.aborted).toBe(true);
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
