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
    detectBrowserEngine: () => 'chromium',
    startPortableWorker: startPortableWorkerMock,
}));

const fetchMock = vi.fn();
vi.stubGlobal('$fetch', fetchMock);
const revocationRequests: string[] = [];

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

const reconcileMock = vi.fn();
vi.mock('../bundled-v1-manager-runtime', () => ({
    requestWorkspacePluginReconcile: (...args: unknown[]) =>
        reconcileMock(...(args as [])),
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
    reconcileMock.mockReset();
    fetchMock.mockReset();
    kvRows.clear();
    getKvByNameMock.mockClear();
    setKvByNameMock.mockClear();
    hardDeleteKvByNameMock.mockClear();
    // The runtime mints a server-side activation handle before it starts any
    // sandbox; the host answers here with a fresh generation each time.
    let activationCounter = 0;
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
            if (String(url) === '/api/plugins/isolation/activation') {
                if (init?.method === 'DELETE') {
                    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
                    if (typeof body?.activationId === 'string') {
                        revocationRequests.push(body.activationId);
                    }
                    return new Response(JSON.stringify({ ok: true }), {
                        status: 200,
                        headers: { 'content-type': 'application/json' },
                    });
                }
                activationCounter += 1;
                return new Response(
                    JSON.stringify({
                        ok: true,
                        activation: {
                            activationId: `act_test_${activationCounter}`,
                            generation: activationCounter,
                        },
                    }),
                    { status: 200, headers: { 'content-type': 'application/json' } }
                );
            }
            throw new Error(`Unexpected fetch: ${String(url)}`);
        })
    );
    await deactivatePortableClient('sample.plugin');
    revocationRequests.length = 0;
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
        expect(fetchMock).toHaveBeenCalledWith(
            '/api/plugins/sample.plugin/setup-plan?slot=current'
        );
    });

    it('reports an unset key as null rather than inventing a value', async () => {
        fetchMock.mockResolvedValue({ settings: { values: {} } });
        const services = createPortableSettingsServices('sample.plugin');
        await expect(services.settings.get({ key: 'missing' })).resolves.toEqual({
            value: null,
        });
    });

    it('binds settings writes to the executing package digest and activation', async () => {
        fetchMock.mockResolvedValue({ ok: true });
        const digest = `sha256-${'d'.repeat(64)}`;
        const services = createPortableSettingsServices(
            'sample.plugin',
            digest,
            'act_test_1'
        );
        await services.settings.set({ key: 'greeting', value: 'Hi' });

        expect(fetchMock).toHaveBeenCalledWith(
            '/api/plugins/sample.plugin/setup-values?slot=current',
            {
                method: 'POST',
                headers: { 'x-or3-plugin-intent': 'plugin' },
                body: {
                    values: { greeting: 'Hi' },
                    expectedPackageDigest: digest,
                    activationId: 'act_test_1',
                },
            }
        );
    });

    it('reports a lifecycle-refused write to the stale handler without replaying it', async () => {
        const onActivationStale = vi.fn();
        const services = createPortableSettingsServices(
            'sample.plugin',
            `sha256-${'d'.repeat(64)}`,
            'act_test_1',
            { onActivationStale }
        );
        fetchMock.mockRejectedValueOnce(
            Object.assign(new Error('Activation was revoked: plugin-disabled'), {
                statusCode: 409,
                data: { code: 'activation-revoked' },
            })
        );

        await expect(
            services.settings.set({ key: 'greeting', value: 'Hi' })
        ).rejects.toMatchObject({ rpcCode: 'policy-denied' });
        expect(onActivationStale).toHaveBeenCalledWith('activation-revoked');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('leaves an ordinary settings failure to the plugin', async () => {
        const onActivationStale = vi.fn();
        const services = createPortableSettingsServices(
            'sample.plugin',
            `sha256-${'d'.repeat(64)}`,
            'act_test_1',
            { onActivationStale }
        );
        fetchMock.mockRejectedValueOnce(
            Object.assign(new Error('The settings changed'), {
                statusCode: 409,
                data: { code: 'setup-values-conflict' },
            })
        );

        await expect(
            services.settings.set({ key: 'greeting', value: 'Hi' })
        ).rejects.toThrow('The settings changed');
        expect(onActivationStale).not.toHaveBeenCalled();
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
        expect(restarted?.generation).toBe(2);
        expect(revocationRequests).toEqual(['act_test_1']);
    });

    it('revokes the server handle on explicit deactivation', async () => {
        startPortableWorkerMock.mockResolvedValue(startedRuntime('stop'));
        setPortableClientSource({
            descriptor: descriptor(),
            workspaceId: 'ws-1',
            runtimeEntry: undefined,
        });

        await ensurePortableClientActivation('sample.plugin');
        await deactivatePortableClient('sample.plugin');

        expect(revocationRequests).toEqual(['act_test_1']);
    });

    it('blocks the activation when the host refuses to mint a handle', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                new Response(
                    JSON.stringify({ statusMessage: 'This package has no current approved authority review.' }),
                    { status: 403, headers: { 'content-type': 'application/json' } }
                )
            )
        );
        setPortableClientSource({
            descriptor: descriptor(),
            workspaceId: 'ws-1',
            runtimeEntry: undefined,
        });

        const activation = await ensurePortableClientActivation('sample.plugin');
        expect(activation?.status).toBe('blocked');
        expect(activation?.blockCode).toBe('activation-refused');
        // No sandbox may start without a minted identity or without a handle.
        expect(startPortableWorkerMock).not.toHaveBeenCalled();
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
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

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
        // The host activation is minted before the sandbox starts; give the
        // first start a chance to reach the sandbox so the replacement really
        // overlaps a pending start.
        await flush();
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
        expect(revocationRequests).toContain('act_test_1');
    });

    it('keeps the handle for non-fatal reports and revokes it for fatal crashes', async () => {
        startPortableWorkerMock.mockResolvedValue(startedRuntime('crash'));
        const activation = await activatePortableClient({
            descriptor: descriptor(),
            workspaceId: 'ws-1',
        });
        expect(activation.status).toBe('active');

        const start = startPortableWorkerMock.mock.calls[0]?.[0] as {
            onCrash: (report: { fatal: boolean; reason: string }) => void;
        } | undefined;
        if (!start) throw new Error('Expected the sandbox start to be attempted');

        start.onCrash({ fatal: false, reason: 'nested-worker-attempt' });
        await flush();
        expect(getPortableActivation('sample.plugin')?.status).toBe('active');
        expect(revocationRequests).toEqual([]);

        start.onCrash({ fatal: true, reason: 'worker-crashed' });
        await flush();
        expect(getPortableActivation('sample.plugin')?.status).toBe('stopped');
        expect(revocationRequests).toEqual(['act_test_1']);
    });

    it('cancels a pending start instead of letting it publish after a stop', async () => {
        const pending = deferred<ReturnType<typeof startedRuntime>>();
        startPortableWorkerMock.mockReturnValueOnce(pending.promise);
        const activation = activatePortableClient({
            descriptor: descriptor(),
            workspaceId: 'ws-1',
        });
        await flush();

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
        await flush();

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

describe('stale handle lifecycle', () => {
    type StartedCall = {
        methods: Array<{
            method: string;
            handler: (
                params: Record<string, unknown>,
                context: {
                    pluginId: string;
                    workspaceId: string;
                    generation: number;
                    requestId: string;
                    signal: AbortSignal;
                    deadlineMs: number;
                }
            ) => Promise<unknown>;
        }>;
        onEvent: (event: unknown) => void;
    };

    function networkDescriptor(): PackageV2PluginDescriptor {
        return { ...descriptor(), effectiveGrants: ['network.http'] };
    }

    /** Serve a lifecycle refusal for capability calls; delegate the rest. */
    function refuseCapabilityWith(code: string, message: string): void {
        const previousFetch = globalThis.fetch;
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
                if (String(url) === '/api/plugins/isolation/capability') {
                    return new Response(
                        JSON.stringify({
                            statusCode: 409,
                            statusMessage: message,
                            data: { code },
                        }),
                        { status: 409, headers: { 'content-type': 'application/json' } }
                    );
                }
                return (previousFetch as typeof fetch)(url, init);
            })
        );
    }

    function startedCall(index: number): StartedCall {
        const call = startPortableWorkerMock.mock.calls[index]?.[0] as
            | StartedCall
            | undefined;
        if (!call) throw new Error('Expected the sandbox start to be attempted');
        return call;
    }

    it('stops the matching activation when the server reports a stale handle', async () => {
        // Installed before activation: the capability transport captures
        // `fetch` when it is created.
        refuseCapabilityWith('activation-expired', 'Activation has expired; start the plugin again');
        startPortableWorkerMock.mockResolvedValue(startedRuntime('stale'));
        const activation = await activatePortableClient({
            descriptor: networkDescriptor(),
            workspaceId: 'ws-1',
        });
        expect(activation.status).toBe('active');

        const call = startedCall(0);
        call.onEvent({
            status: 'rendered',
            title: 'Summary',
            nodes: [{ type: 'text', text: 'hello' }],
        });
        expect(getPortableActivation('sample.plugin')?.view?.nodes).toHaveLength(1);

        const complete = call.methods.find((spec) => spec.method === 'ai.complete');
        if (!complete) throw new Error('Expected the ai.complete capability to be registered');
        // The plugin sees the generic RPC vocabulary, not handle internals.
        await expect(
            complete.handler(
                { model: 'm', prompt: 'p' },
                {
                    pluginId: 'sample.plugin',
                    workspaceId: 'ws-1',
                    generation: activation.generation,
                    requestId: 'rpc-1',
                    signal: new AbortController().signal,
                    deadlineMs: 5_000,
                }
            )
        ).rejects.toMatchObject({ rpcCode: 'policy-denied' });

        // The host stops the matching activation, keeps the rendered state
        // for the restart surface, revokes the dead handle and refreshes the
        // package source — without replaying the failed operation.
        const stopped = getPortableActivation('sample.plugin');
        expect(stopped?.status).toBe('stopped');
        expect(stopped?.blockCode).toBe('activation-expired');
        expect(stopped?.blockMessage).toContain('expired');
        expect(stopped?.view?.nodes).toHaveLength(1);
        expect(revocationRequests).toEqual(['act_test_1']);
        expect(reconcileMock).toHaveBeenCalledWith('manifest-revision-change');
    });

    it('ignores a stale refusal for a superseded generation', async () => {
        refuseCapabilityWith('activation-revoked', 'Activation was revoked: plugin-disabled');
        startPortableWorkerMock.mockResolvedValue(startedRuntime('superseded'));
        const first = await activatePortableClient({
            descriptor: networkDescriptor(),
            workspaceId: 'ws-1',
        });
        const firstCall = startedCall(0);

        await deactivatePortableClient('sample.plugin');
        const second = await activatePortableClient({
            descriptor: networkDescriptor(),
            workspaceId: 'ws-1',
        });
        expect(second.status).toBe('active');
        expect(second.generation).not.toBe(first.generation);

        const complete = firstCall.methods.find((spec) => spec.method === 'ai.complete');
        if (!complete) throw new Error('Expected the ai.complete capability to be registered');
        await expect(
            complete.handler(
                { model: 'm', prompt: 'p' },
                {
                    pluginId: 'sample.plugin',
                    workspaceId: 'ws-1',
                    generation: first.generation,
                    requestId: 'rpc-late',
                    signal: new AbortController().signal,
                    deadlineMs: 5_000,
                }
            )
        ).rejects.toBeTruthy();

        // The replacement activation is untouched and its handle unrevoked.
        expect(getPortableActivation('sample.plugin')?.status).toBe('active');
        expect(getPortableActivation('sample.plugin')?.generation).toBe(second.generation);
        expect(revocationRequests).toEqual(['act_test_1']);
    });

    it('leaves the activation running for non-lifecycle refusals', async () => {
        refuseCapabilityWith('budget-exceeded', 'Budget exhausted');
        startPortableWorkerMock.mockResolvedValue(startedRuntime('budget'));
        const activation = await activatePortableClient({
            descriptor: networkDescriptor(),
            workspaceId: 'ws-1',
        });
        expect(activation.status).toBe('active');

        const call = startedCall(0);
        const complete = call.methods.find((spec) => spec.method === 'ai.complete');
        if (!complete) throw new Error('Expected the ai.complete capability to be registered');
        await expect(
            complete.handler(
                { model: 'm', prompt: 'p' },
                {
                    pluginId: 'sample.plugin',
                    workspaceId: 'ws-1',
                    generation: activation.generation,
                    requestId: 'rpc-budget',
                    signal: new AbortController().signal,
                    deadlineMs: 5_000,
                }
            )
        ).rejects.toMatchObject({ rpcCode: 'budget-exceeded' });

        expect(getPortableActivation('sample.plugin')?.status).toBe('active');
        expect(revocationRequests).toEqual([]);
    });

    it('stops the matching activation when a settings write reports a stale handle', async () => {
        startPortableWorkerMock.mockResolvedValue(startedRuntime('settings-stale'));
        const activation = await activatePortableClient({
            descriptor: descriptor(),
            workspaceId: 'ws-1',
        });
        expect(activation.status).toBe('active');
        const call = startPortableWorkerMock.mock.calls[0]?.[0] as {
            services: {
                settings: { set: (params: Record<string, unknown>) => Promise<unknown> };
            };
            onEvent: (event: unknown) => void;
        };
        call.onEvent({
            status: 'rendered',
            title: 'Summary',
            nodes: [{ type: 'text', text: 'hello' }],
        });

        fetchMock.mockRejectedValueOnce(
            Object.assign(new Error('Activation was revoked: plugin-disabled'), {
                statusCode: 409,
                data: { code: 'activation-revoked' },
            })
        );
        await expect(
            call.services.settings.set({ key: 'greeting', value: 'Hi' })
        ).rejects.toMatchObject({ rpcCode: 'policy-denied' });

        // A settings-only plugin gets the same handling as remote capabilities:
        // the surface stops, keeps the rendered state, revokes the handle and
        // does not replay the failed write.
        const stopped = getPortableActivation('sample.plugin');
        expect(stopped?.status).toBe('stopped');
        expect(stopped?.blockCode).toBe('activation-revoked');
        expect(stopped?.blockMessage).toContain('typed values are kept');
        expect(stopped?.view?.nodes).toHaveLength(1);
        expect(revocationRequests).toEqual(['act_test_1']);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
