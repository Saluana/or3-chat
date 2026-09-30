import { WorkspacePluginCoordinator } from '../workspace-plugin-coordinator';
import type { PluginRuntimeManifestResponse } from '../runtime-manifest';
import { describe, expect, it, vi } from 'vitest';
import {
    PerPluginLifecycleMutex,
    PluginGenerationClock,
    SerializedReconcileCoordinator,
    StalePluginGenerationError,
    type PluginLifecycleBoundary,
} from '../lifecycle-coordinator';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

describe('plugin lifecycle coordination', () => {
    it.each([
        'fetch',
        'import',
        'register',
        'stop',
        'validation',
        'activation',
    ] as const)('rejects superseded work after the awaited %s boundary', async (boundary) => {
        const clock = new PluginGenerationClock();
        const first = clock.supersede('alpha');
        const operation = deferred<string>();
        const result = first.after(boundary as PluginLifecycleBoundary, operation.promise);

        const second = clock.supersede('alpha');
        expect(first.signal.aborted).toBe(true);
        expect(second.generation).toBe(2);
        operation.resolve('stale');

        await expect(result).rejects.toBeInstanceOf(StalePluginGenerationError);
    });

    it('serializes same-ID operations while unrelated IDs progress', async () => {
        const mutex = new PerPluginLifecycleMutex();
        const alphaGate = deferred<void>();
        const trace: string[] = [];
        const alphaFirst = mutex.runExclusive('alpha', async () => {
            trace.push('alpha-1:start');
            await alphaGate.promise;
            trace.push('alpha-1:end');
        });
        const alphaSecond = mutex.runExclusive('alpha', () => {
            trace.push('alpha-2');
        });
        const beta = mutex.runExclusive('beta', () => {
            trace.push('beta');
        });

        await beta;
        expect(trace).toEqual(['alpha-1:start', 'beta']);
        alphaGate.resolve();
        await Promise.all([alphaFirst, alphaSecond]);
        expect(trace).toEqual(['alpha-1:start', 'beta', 'alpha-1:end', 'alpha-2']);
    });

    it('coalesces concurrent reconcile triggers so the latest pending state wins', async () => {
        const firstGate = deferred<void>();
        const seen: Array<{ revision: number; value: string }> = [];
        const reconcile = vi.fn(async (request: { revision: number; value: string }) => {
            seen.push(request);
            if (request.revision === 1) await firstGate.promise;
        });
        const coordinator = new SerializedReconcileCoordinator(reconcile);

        const first = coordinator.request('workspace-1');
        coordinator.request('focus-refresh');
        coordinator.request('workspace-2');
        firstGate.resolve();
        await first;

        expect(seen).toEqual([
            { revision: 1, value: 'workspace-1' },
            { revision: 3, value: 'workspace-2' },
        ]);
        expect(reconcile).toHaveBeenCalledTimes(2);
    });
});



function snapshot(workspaceId: string): PluginRuntimeManifestResponse {
    return { workspaceId, revision: workspaceId, enabledPluginIds: [], installedPluginIds: [], runtime: {} };
}

// This owns cross-adapter sequencing, transport cancellation, and shared refresh
// behavior. Existing manager suites own descriptor diffing and runner isolation.
describe('workspace plugin coordination', () => {
    it('shares workspace and approval eligibility while preserving execution modes', async () => {
        const response = snapshot('one');
        const base = { version: '1.0.0', pluginApiVersion: '1', policyRevision: 'p', grantsRevision: 'g', resolvedDependencyKeys: [], descriptorKey: 'sha256-a' as const };
        for (const [id, workspaceId, loadAllowed] of [['good', 'one', true], ['wrong-workspace', 'two', true], ['denied', 'one', false]] as const) {
            response.enabledPluginIds.push(id);
            response.runtime[id] = { descriptorStatus: 'ready', loadAllowed, hasServerRoutes: false, lifecycleCoverage: 'legacy-global-possible',
                descriptor: { ...base, id, workspaceId, manifestVersion: 1, source: 'extension', trust: 'trusted-host', artifact: { kind: 'bundled-v1', hostBuildId: 'build', moduleKey: id, rebuildRequired: true } } };
        }
        let accepted: PluginRuntimeManifestResponse | undefined;
        const coordinator = new WorkspacePluginCoordinator({ fetchManifest: async () => response, onError: vi.fn() });
        coordinator.register({ name: 'bundled', stop: async () => {}, reconcile: async (value) => { accepted = value; } });
        await coordinator.refresh({ workspaceId: 'one', sessionKey: 'alice' });
        expect(accepted?.enabledPluginIds).toEqual(['good']);
    });

    it('coalesces a refresh burst into one fetch and delivers one snapshot to all adapters', async () => {
        const fetchManifest = vi.fn(async () => snapshot('one'));
        const coordinator = new WorkspacePluginCoordinator({ fetchManifest, onError: vi.fn() });
        const received: unknown[] = [];
        for (const name of ['bundled', 'trusted', 'portable']) {
            coordinator.register({ name, stop: async () => {}, reconcile: async (manifest) => { received.push(manifest); } });
        }
        await Promise.all(Array.from({ length: 12 }, () => coordinator.refresh({ workspaceId: 'one', sessionKey: 'alice' })));
        expect(fetchManifest).toHaveBeenCalledTimes(1);
        expect(received).toHaveLength(3);
        expect(received.every((value) => value === received[0])).toBe(true);
    });

    it('aborts old fetches and awaits every teardown before destination activation', async () => {
        const first = deferred<PluginRuntimeManifestResponse>();
        const fetched = deferred<void>();
        let stopped = deferred<void>();
        const trace: string[] = [];
        let oldSignal: AbortSignal | undefined;
        const coordinator = new WorkspacePluginCoordinator({
            fetchManifest: async (signal) => {
                if (!oldSignal) { oldSignal = signal; fetched.resolve(); return first.promise; }
                return snapshot('two');
            }, onError: vi.fn(),
        });
        coordinator.register({ name: 'trusted', stop: async () => { trace.push('stop'); await stopped.promise; }, reconcile: async (manifest) => { trace.push(`start:${manifest.workspaceId}`); } });
        // Initial cleanup must settle before the first request can start.
        stopped.resolve();
        const initial = coordinator.refresh({ workspaceId: 'one', sessionKey: 'alice' });
        await fetched.promise;
        stopped = deferred<void>();
        const next = coordinator.refresh({ workspaceId: 'two', sessionKey: 'alice' });
        expect(oldSignal?.aborted).toBe(true);
        first.resolve(snapshot('one'));
        await Promise.resolve();
        expect(trace).not.toContain('start:two');
        stopped.resolve();
        await Promise.all([initial, next]);
        expect(trace).toEqual(['stop', 'stop', 'start:two']);
    });

    it('fails closed on cleanup errors and retries teardown before activating', async () => {
        let fail = true;
        const reconcile = vi.fn();
        const onError = vi.fn();
        const coordinator = new WorkspacePluginCoordinator({ fetchManifest: async () => snapshot('one'), onError });
        const stop = vi.fn(async () => { if (fail) throw new Error('cleanup failed'); });
        coordinator.register({ name: 'portable', stop, reconcile });
        await coordinator.refresh({ workspaceId: 'one', sessionKey: 'alice' });
        expect(reconcile).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledTimes(1);
        fail = false;
        await coordinator.refresh({ workspaceId: 'one', sessionKey: 'alice' });
        expect(stop).toHaveBeenCalledTimes(2);
        expect(reconcile).toHaveBeenCalledTimes(1);
    });

    it('tears down on account changes within one workspace and on logout without fetching', async () => {
        const fetchManifest = vi.fn(async () => snapshot('one'));
        const stop = vi.fn(async () => {});
        const coordinator = new WorkspacePluginCoordinator({ fetchManifest, onError: vi.fn() });
        coordinator.register({ name: 'bundled', stop, reconcile: async () => {} });
        await coordinator.refresh({ workspaceId: 'one', sessionKey: 'alice' });
        await coordinator.refresh({ workspaceId: 'one', sessionKey: 'bob' });
        await coordinator.refresh({ workspaceId: null, sessionKey: null });
        expect(stop).toHaveBeenCalledTimes(3);
        expect(fetchManifest).toHaveBeenCalledTimes(2);
    });

    it('preserves the current workspace on transport or wrong-workspace responses', async () => {
        let fail = false;
        const stop = vi.fn(async () => {});
        const reconcile = vi.fn();
        const coordinator = new WorkspacePluginCoordinator({
            fetchManifest: async () => { if (fail) throw new Error('offline'); return snapshot('two'); }, onError: vi.fn(),
        });
        coordinator.register({ name: 'bundled', stop, reconcile });
        await coordinator.refresh({ workspaceId: 'one', sessionKey: 'alice' });
        fail = true;
        await coordinator.refresh({ workspaceId: 'one', sessionKey: 'alice' });
        expect(stop).toHaveBeenCalledTimes(1);
        expect(reconcile).not.toHaveBeenCalled();
    });
});
