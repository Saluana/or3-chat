import { describe, expect, it, vi } from 'vitest';
import type { BundledV1PluginDescriptor } from '../runtime-descriptor';
import type { LegacyCleanupReport } from '../legacy-plugin-scope';
import {
    BundledV1PluginManager,
    type BundledV1ManagerDesiredState,
    type ManagedBundledV1Instance,
} from '../bundled-v1-manager';

function descriptor(id: string, key = 'a', build = 'build-1'): BundledV1PluginDescriptor {
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
            hostBuildId: build,
            moduleKey: `module-${id}`,
            rebuildRequired: true,
        },
        descriptorKey: `sha256-${key.repeat(64)}`,
    };
}

function report(timedOut = false): LegacyCleanupReport {
    return {
        status: timedOut ? 'degraded' : 'clean',
        timedOut,
        invokedCount: 0,
        settledThenableCount: 0,
        errors: [],
        durationMs: 0,
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

function instance(options: {
    register?: () => void | Promise<void>;
    stop?: () => Promise<LegacyCleanupReport>;
} = {}): ManagedBundledV1Instance {
    return {
        register: options.register ?? vi.fn(),
        stop: options.stop ?? vi.fn(async () => report()),
    };
}

describe('BundledV1PluginManager', () => {
    it('starts healthy plugins independently when one plugin fails', async () => {
        let desired: BundledV1ManagerDesiredState = {
            descriptors: [descriptor('bad'), descriptor('good', 'b')],
            revision: '1',
        };
        const manager = new BundledV1PluginManager({
            fetchDesired: async () => desired,
            load: async (entry) => {
                if (entry.id === 'bad') throw new Error('broken import');
                return instance();
            },
            retryBaseMs: 100,
        });

        await manager.schedule('boot');

        expect(manager.listActivePluginIds()).toEqual(['good']);
        expect(manager.listRecords().map(({ descriptor: value, status }) => [value.id, status])).toEqual([
            ['bad', 'failed'],
            ['good', 'active'],
        ]);
        desired = { ...desired, revision: '2' };
    });

    it('stops the old generation before importing and registering its replacement', async () => {
        const trace: string[] = [];
        let desired: BundledV1ManagerDesiredState = {
            descriptors: [descriptor('alpha')],
            revision: '1',
        };
        const manager = new BundledV1PluginManager({
            fetchDesired: async () => desired,
            load: async (entry) => {
                trace.push(`import:${entry.artifact.hostBuildId}`);
                return instance({
                    register: () => {
                        trace.push(`register:${entry.artifact.hostBuildId}`);
                    },
                    stop: async () => {
                        trace.push(`stop:${entry.artifact.hostBuildId}`);
                        return report();
                    },
                });
            },
        });
        await manager.schedule('boot');
        desired = {
            descriptors: [descriptor('alpha', 'b', 'build-2')],
            revision: '2',
        };

        await manager.schedule('replace');

        expect(trace).toEqual([
            'import:build-1',
            'register:build-1',
            'stop:build-1',
            'import:build-2',
            'register:build-2',
        ]);
    });

    it('refuses unsafe hot replacement when conservative V1 cleanup times out', async () => {
        let desired: BundledV1ManagerDesiredState = {
            descriptors: [descriptor('alpha')],
            revision: '1',
        };
        const load = vi.fn(async (entry: BundledV1PluginDescriptor) =>
            instance({ stop: async () => report(entry.artifact.hostBuildId === 'build-1') })
        );
        const manager = new BundledV1PluginManager({ fetchDesired: async () => desired, load });
        await manager.schedule('boot');
        desired = {
            descriptors: [descriptor('alpha', 'b', 'build-2')],
            revision: '2',
        };

        await manager.schedule('replace');

        expect(load).toHaveBeenCalledTimes(1);
        expect(manager.listActivePluginIds()).toEqual([]);
        expect(manager.listRecords()[0]).toMatchObject({
            status: 'failed',
            lastError: { code: 'unsafe-v1-replacement', retryable: false },
        });
    });

    it('coalesces workspace, admin, focus, and manifest triggers into the newest fetch', async () => {
        const alpha = descriptor('alpha');
        const fetchGate = deferred<BundledV1ManagerDesiredState>();
        const fetchDesired = vi
            .fn<() => Promise<BundledV1ManagerDesiredState>>()
            .mockImplementationOnce(() => fetchGate.promise)
            .mockResolvedValue({ descriptors: [alpha], revision: 'newest' });
        const load = vi.fn(async () => instance());
        const manager = new BundledV1PluginManager({ fetchDesired, load });

        const fetchRun = manager.schedule('workspace-session-change');
        await vi.waitFor(() => expect(fetchDesired).toHaveBeenCalledTimes(1));
        manager.schedule('local-admin-change');
        manager.schedule('focus-refresh');
        manager.schedule('manifest-revision-change');
        fetchGate.resolve({ descriptors: [alpha], revision: 'stale-fetch' });
        await fetchRun;

        expect(fetchDesired).toHaveBeenCalledTimes(2);
        expect(load).toHaveBeenCalledTimes(1);
        expect(manager.listActivePluginIds()).toEqual(['alpha']);
    });

    it('checks generation after import and discards the stale instance', async () => {
        const alpha = descriptor('alpha');
        const importGate = deferred<ManagedBundledV1Instance>();
        let revision = 0;
        const fetchDesired = vi.fn(async () => ({
            descriptors: [alpha],
            revision: String(++revision),
        }));
        const stale = instance();
        const load = vi
            .fn<() => Promise<ManagedBundledV1Instance>>()
            .mockImplementationOnce(() => importGate.promise)
            .mockResolvedValue(instance());
        const manager = new BundledV1PluginManager({ fetchDesired, load });

        const importRun = manager.schedule('import-1');
        await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
        manager.schedule('import-2');
        importGate.resolve(stale);
        await importRun;

        expect(stale.register).not.toHaveBeenCalled();
        expect(stale.stop).toHaveBeenCalledTimes(1);
        expect(load).toHaveBeenCalledTimes(2);
        expect(manager.listActivePluginIds()).toEqual(['alpha']);
    });

    it('checks generation after register and cleans up the stale instance', async () => {
        const alpha = descriptor('alpha');
        const registerGate = deferred<void>();
        let revision = 0;
        const fetchDesired = vi.fn(async () => ({
            descriptors: [alpha],
            revision: String(++revision),
        }));
        const staleRegister = vi.fn(() => registerGate.promise);
        const stale = instance({ register: staleRegister });
        const load = vi
            .fn<() => Promise<ManagedBundledV1Instance>>()
            .mockResolvedValueOnce(stale)
            .mockResolvedValue(instance());
        const manager = new BundledV1PluginManager({ fetchDesired, load });

        const registerRun = manager.schedule('register-1');
        await vi.waitFor(() => expect(staleRegister).toHaveBeenCalledTimes(1));
        manager.schedule('register-2');
        registerGate.resolve();
        await registerRun;

        expect(stale.stop).toHaveBeenCalledTimes(1);
        expect(load).toHaveBeenCalledTimes(2);
        expect(manager.listActivePluginIds()).toEqual(['alpha']);
        expect(manager.listRecords()[0]).toMatchObject({ status: 'active' });
    });

    it('checks generation after stop and prevents stale publication', async () => {
        const stopGate = deferred<LegacyCleanupReport>();
        let desired: BundledV1ManagerDesiredState = {
            descriptors: [descriptor('alpha')],
            revision: '1',
        };
        let first = true;
        const manager = new BundledV1PluginManager({
            fetchDesired: async () => desired,
            load: async () =>
                instance({
                    stop: first
                        ? async () => {
                              first = false;
                              return stopGate.promise;
                          }
                        : async () => report(),
                }),
        });
        await manager.schedule('boot');
        desired = { descriptors: [], revision: '2' };
        const stopping = manager.schedule('disable');
        desired = {
            descriptors: [descriptor('alpha', 'b', 'build-2')],
            revision: '3',
        };
        manager.schedule('replacement');
        stopGate.resolve(report());
        await stopping;

        expect(manager.listActivePluginIds()).toEqual(['alpha']);
        expect(manager.listRecords()[0]).toMatchObject({
            status: 'active',
            descriptor: { artifact: { hostBuildId: 'build-2' } },
        });
    });

    it('stops every active generation before a workspace context changes', async () => {
        const stopped: string[] = [];
        const manager = new BundledV1PluginManager({
            fetchDesired: async () => ({
                descriptors: [descriptor('alpha'), descriptor('beta', 'b')],
                revision: 'workspace-1',
            }),
            load: async (entry) =>
                instance({
                    stop: async () => {
                        stopped.push(entry.id);
                        return report();
                    },
                }),
        });
        await manager.schedule('boot');

        await manager.stopAll('workspace-session-change');

        expect(stopped.sort()).toEqual(['alpha', 'beta']);
        expect(manager.listActivePluginIds()).toEqual([]);
        expect(manager.listRecords()).toEqual([]);
    });

    it('quarantines by descriptor key and lets a new descriptor retry independently', async () => {
        let desired: BundledV1ManagerDesiredState = {
            descriptors: [descriptor('alpha')],
            revision: '1',
        };
        const load = vi.fn(async (entry: BundledV1PluginDescriptor) => {
            if (entry.descriptorKey.endsWith('a'.repeat(64))) throw new Error('broken');
            return instance();
        });
        const manager = new BundledV1PluginManager({
            fetchDesired: async () => desired,
            load,
            quarantineThreshold: 3,
            retryBaseMs: 0,
        });

        for (let attempt = 1; attempt <= 3; attempt++) {
            desired = { ...desired, revision: String(attempt) };
            await manager.schedule(`attempt-${attempt}`);
        }
        expect(manager.listRecords()[0]).toMatchObject({
            status: 'quarantined',
            failureCount: 3,
            quarantinedDescriptorKey: descriptor('alpha').descriptorKey,
        });

        desired = {
            descriptors: [descriptor('alpha', 'b', 'build-2')],
            revision: 'new-key',
        };
        await manager.schedule('new-key');
        expect(manager.listActivePluginIds()).toEqual(['alpha']);
    });
});
