import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PackageV2PluginDescriptor } from '~~/shared/plugins/runtime-descriptor';

/**
 * Two contract bugs this pins down:
 * - saved settings come from `/setup-plan`'s `{ settings: { values } }`, not a
 *   top-level `values`, so a plugin must see what the setup page saved;
 * - activations overlap (a workspace switch starts a replacement while the old
 *   start is still pending), so completion, callbacks and disposal are bound to
 *   an activation identity instead of a plugin id alone.
 */

const { startPortableWorkerMock } = vi.hoisted(() => ({ startPortableWorkerMock: vi.fn() }));

vi.mock('~~/shared/plugins/isolation/portable-bootstrap', () => ({
    PORTABLE_CLIENT_FEATURE: 'or3-portable-client-v1',
    PORTABLE_PROFILE_NAME: 'or3-portable-client-v1',
    defaultHostAbi: () => ({ abiVersion: 1, features: [], methods: [] }),
    startPortableWorker: startPortableWorkerMock,
}));

const fetchMock = vi.fn();
vi.stubGlobal('$fetch', fetchMock);

const kvRows = new Map<string, { name: string; value: string | null; updated_at: number }>();
const getKvByNameMock = vi.fn(async (name: string) => kvRows.get(name));
const setKvByNameMock = vi.fn(async (name: string, value: string | null) => {
    kvRows.set(name, { name, value, updated_at: 1 });
    return { id: `kv:${name}`, name, value, updated_at: 1 };
});
const hardDeleteKvByNameMock = vi.fn(async (name: string) => {
    kvRows.delete(name);
});

vi.mock('~/db/kv', () => ({
    getKvByName: (...args: unknown[]) => getKvByNameMock(...(args as [string])),
    setKvByName: (...args: unknown[]) => setKvByNameMock(...(args as [string, string | null])),
    hardDeleteKvByName: (...args: unknown[]) => hardDeleteKvByNameMock(...(args as [string])),
}));

const kvTable = {
    where: () => ({
        startsWith: (prefix: string) => ({
            toArray: async () => [...kvRows.values()].filter((row) => row.name.startsWith(prefix)),
        }),
    }),
};

vi.mock('~/db/client', () => ({
    getDb: () => ({ kv: kvTable }),
}));

import {
    activatePortableClient,
    clearPortableClientSources,
    createPortableSettingsServices,
    deactivatePortableClient,
    ensurePortableClientActivation,
    getPortableActivation,
    setPortableClientSource,
} from '../portable-client-runtime';

function descriptor(): PackageV2PluginDescriptor {
    return {
        id: 'sample.plugin',
        version: '1.0.0',
        name: 'Sample Plugin',
        pluginApiVersion: '2.0.0',
        workspaceId: 'ws-1',
        policyRevision: 'policy-1',
        grantsRevision: 'grants-1',
        resolvedDependencyKeys: [],
        descriptorKey: `sha256-${'b'.repeat(64)}`,
        manifestVersion: 2,
        source: 'package',
        trust: 'isolated-client',
        effectiveGrants: [],
        artifact: {
            kind: 'package-v2',
            packageDigest: `sha256-${'a'.repeat(64)}`,
            client: {
                entry: 'client.mjs',
                isolation: 'worker',
                digest: `sha256-${'c'.repeat(64)}`,
            },
            serverRoutes: [],
        },
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((innerResolve) => {
        resolve = innerResolve;
    });
    return { promise, resolve };
}

function startedRuntime(label: string) {
    const dispose = vi.fn();
    return {
        status: 'started' as const,
        session: { sessionId: `session-${label}`, sourceId: `source-${label}` },
        runtime: { capabilities: [`cap-${label}`], dispose },
        dispose,
    };
}

beforeEach(async () => {
    startPortableWorkerMock.mockReset();
    fetchMock.mockReset();
    kvRows.clear();
    getKvByNameMock.mockClear();
    setKvByNameMock.mockClear();
    hardDeleteKvByNameMock.mockClear();
    await deactivatePortableClient('sample.plugin');
    clearPortableClientSources();
});

describe('portable settings services', () => {
    it('reads the values the setup plan actually returns', async () => {
        fetchMock.mockResolvedValue({ settings: { values: { greeting: 'Hi' } } });
        const services = createPortableSettingsServices('sample.plugin');

        await expect(services.settings.get({ key: 'greeting' })).resolves.toEqual({
            value: 'Hi',
        });
        await expect(services.settings.list()).resolves.toEqual({
            values: { greeting: 'Hi' },
        });
        expect(fetchMock).toHaveBeenCalledWith('/api/plugins/sample.plugin/setup-plan');
    });

    it('reports an unset key as null rather than inventing a value', async () => {
        fetchMock.mockResolvedValue({ settings: { values: {} } });
        const services = createPortableSettingsServices('sample.plugin');
        await expect(services.settings.get({ key: 'missing' })).resolves.toEqual({
            value: null,
        });
    });
});

describe('demand-driven activation', () => {
    it('starts a recorded source on demand and reuses a running activation', async () => {
        startPortableWorkerMock.mockResolvedValue(startedRuntime('demand'));
        setPortableClientSource({
            descriptor: descriptor(),
            workspaceId: 'ws-1',
            runtimeEntry: undefined,
        });

        const activated = await ensurePortableClientActivation('sample.plugin');
        expect(activated?.status).toBe('active');
        // The activation records the grants the workspace approved, so the
        // surface can check write authority without asking the plugin.
        expect(activated?.approvedGrants).toEqual([]);

        await ensurePortableClientActivation('sample.plugin');
        expect(startPortableWorkerMock).toHaveBeenCalledTimes(1);
    });

    it('restarts a stopped activation when the surface asks again', async () => {
        startPortableWorkerMock
            .mockResolvedValueOnce(startedRuntime('first'))
            .mockResolvedValueOnce(startedRuntime('second'));
        setPortableClientSource({
            descriptor: descriptor(),
            workspaceId: 'ws-1',
            runtimeEntry: undefined,
        });

        await ensurePortableClientActivation('sample.plugin');
        await deactivatePortableClient('sample.plugin');
        const restarted = await ensurePortableClientActivation('sample.plugin');

        expect(startPortableWorkerMock).toHaveBeenCalledTimes(2);
        expect(restarted?.status).toBe('active');
    });
});

describe('portable storage services', () => {
    it('persists workspace/plugin-scoped JSON values through the kv table', async () => {
        const services = createPortableSettingsServices('sample.plugin');
        await services.storage.set({ key: 'presets', value: { version: 1, presets: [] } });
        expect(setKvByNameMock).toHaveBeenCalledWith(
            'plugin-storage:sample.plugin:presets',
            JSON.stringify({ version: 1, presets: [] })
        );
        await expect(services.storage.get({ key: 'presets' })).resolves.toEqual({
            value: { version: 1, presets: [] },
        });
    });

    it('reports an unset key as null rather than inventing a value', async () => {
        const services = createPortableSettingsServices('sample.plugin');
        await expect(services.storage.get({ key: 'missing' })).resolves.toEqual({ value: null });
    });

    it('lists and deletes only this plugin’s namespaced keys', async () => {
        kvRows.set('plugin-storage:sample.plugin:presets', {
            name: 'plugin-storage:sample.plugin:presets',
            value: JSON.stringify({ version: 1 }),
            updated_at: 3,
        });
        kvRows.set('plugin-storage:other.plugin:presets', {
            name: 'plugin-storage:other.plugin:presets',
            value: JSON.stringify({ version: 9 }),
            updated_at: 4,
        });
        const services = createPortableSettingsServices('sample.plugin');
        await expect(services.storage.list({})).resolves.toEqual({
            entries: [{ key: 'presets', sizeBytes: JSON.stringify({ version: 1 }).length, updatedAt: 3000 }],
        });
        await services.storage.delete({ key: 'presets' });
        expect(hardDeleteKvByNameMock).toHaveBeenCalledWith('plugin-storage:sample.plugin:presets');
        expect(kvRows.has('plugin-storage:other.plugin:presets')).toBe(true);
    });

    it('refuses an invalid key or an oversized value as invalid input', async () => {
        const services = createPortableSettingsServices('sample.plugin');
        await expect(services.storage.get({ key: '' })).rejects.toMatchObject({
            rpcCode: 'invalid-input',
        });
        await expect(
            services.storage.set({ key: 'big', value: 'x'.repeat(40 * 1024) })
        ).rejects.toMatchObject({ rpcCode: 'invalid-input' });
        expect(setKvByNameMock).not.toHaveBeenCalled();
    });
});

describe('overlapping activations', () => {
    it('lets the replacement win and disposes the superseded start', async () => {
        const first = deferred<ReturnType<typeof startedRuntime>>();
        const second = deferred<ReturnType<typeof startedRuntime>>();
        startPortableWorkerMock
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);

        const stale = activatePortableClient({
            descriptor: descriptor(),
            workspaceId: 'ws-1',
        });
        const replacement = activatePortableClient({
            descriptor: descriptor(),
            workspaceId: 'ws-2',
        });

        // The replacement reports first; the stale start then completes.
        const secondRuntime = startedRuntime('second');
        second.resolve(secondRuntime);
        await replacement;
        expect(getPortableActivation('sample.plugin')?.workspaceId).toBe('ws-2');

        const firstRuntime = startedRuntime('first');
        first.resolve(firstRuntime);
        await stale;

        // The late completion may not clobber the replacement, and its own
        // sandbox must be disposed rather than leaked.
        expect(getPortableActivation('sample.plugin')?.workspaceId).toBe('ws-2');
        expect(firstRuntime.dispose).toHaveBeenCalledTimes(1);
        expect(secondRuntime.dispose).not.toHaveBeenCalled();
    });

    it('cancels a pending start instead of letting it publish after a stop', async () => {
        const pending = deferred<ReturnType<typeof startedRuntime>>();
        startPortableWorkerMock.mockReturnValueOnce(pending.promise);
        const activation = activatePortableClient({
            descriptor: descriptor(),
            workspaceId: 'ws-1',
        });

        await deactivatePortableClient('sample.plugin');
        const runtime = startedRuntime('late');
        pending.resolve(runtime);
        await activation;

        // The stop wins: the activation stays stopped and the sandbox it would
        // have published is disposed rather than left running.
        expect(getPortableActivation('sample.plugin')?.status).toBe('stopped');
        expect(runtime.dispose).toHaveBeenCalledTimes(1);
    });

    it('ignores events from a superseded sandbox', async () => {
        const first = deferred<ReturnType<typeof startedRuntime>>();
        startPortableWorkerMock.mockReturnValueOnce(first.promise);
        const activation = activatePortableClient({
            descriptor: descriptor(),
            workspaceId: 'ws-1',
        });

        const call = startPortableWorkerMock.mock.calls[0]?.[0] as {
            onEvent: (event: unknown) => void;
        } | undefined;
        if (!call) throw new Error('Expected the sandbox start to be attempted');
        await deactivatePortableClient('sample.plugin');
        call.onEvent({ status: 'rendered', title: 'Late', nodes: [] });

        first.resolve(startedRuntime('first'));
        await activation;
        expect(getPortableActivation('sample.plugin')?.view).toBeNull();
    });
});
