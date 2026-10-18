import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PackageV2PluginDescriptor, Sha256 } from '~~/shared/plugins/runtime-descriptor';
import { invokePortableUiEvent } from '../portable-client-runtime';

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
let mintedDigest = `sha256-${'a'.repeat(64)}`;
let mintedGrants: string[] = [];

vi.mock('~/db/kv', () => ({}));
vi.mock('~/db/client', () => ({ getDb: () => ({}) }));

const reconcileMock = vi.fn();
vi.mock('../workspace-plugin-coordinator', () => ({
    requestWorkspacePluginReconcile: (...args: unknown[]) =>
        reconcileMock(...(args as [])),
}));

import {
    activatePortableClient,
    restartPortableClient,
    claimPortableRecoveryAttempt,
    clearPortableClientSources,
    clearPortableSurfaceRegistrations,
    createPortableSettingsServices,
    deactivatePortableClient,
    ensurePortableClientActivation,
    getPortableActivation,
    getPortableClientDraft,
    removePortableClientSource,
    isPortableActivationReady,
    isRecoverablePortableStop,
    reportPortableContributionReadiness,
    schedulePortableClientRecovery,
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
    mintedDigest = `sha256-${'a'.repeat(64)}`;
    mintedGrants = [];
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
                            packageDigest: mintedDigest,
                            approvedGrants: mintedGrants,
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
    clearPortableSurfaceRegistrations('sample.plugin');
});

afterEach(() => {
    vi.useRealTimers();
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

    it('rejects malformed setting keys before reading or writing the setup document', async () => {
        const services = createPortableSettingsServices('sample.plugin');
        await expect(services.settings.get({ key: '' })).rejects.toMatchObject({
            rpcCode: 'invalid-input',
        });
        await expect(services.settings.set({ key: `bad\u0000key`, value: 'x' })).rejects.toMatchObject({
            rpcCode: 'invalid-input',
        });
        expect(fetchMock).not.toHaveBeenCalled();
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

    it('deletes a setting through the host schema so its default can apply', async () => {
        fetchMock.mockResolvedValue({ ok: true });
        const services = createPortableSettingsServices('sample.plugin', null, 'act_test_1');
        await expect(services.settings.delete({ key: 'theme' })).resolves.toEqual({ ok: true });
        expect(fetchMock).toHaveBeenCalledWith(
            '/api/plugins/sample.plugin/setup-values?slot=current',
            expect.objectContaining({
                method: 'POST',
                body: expect.objectContaining({
                    values: { theme: null },
                    activationId: 'act_test_1',
                }),
            })
        );
    });

    it('recognizes the nested H3 lifecycle code on a settings write', async () => {
        const onActivationStale = vi.fn();
        const services = createPortableSettingsServices('sample.plugin', descriptor().artifact.packageDigest, 'act_test_1', { onActivationStale });
        fetchMock.mockRejectedValueOnce(Object.assign(new Error('Activation was revoked'), {
            statusCode: 409,
            data: { data: { code: 'activation-revoked' } },
        }));
        await expect(services.settings.set({ key: 'greeting', value: 'Hi' })).rejects.toMatchObject({ rpcCode: 'policy-denied' });
        expect(onActivationStale).toHaveBeenCalledWith('activation-revoked');
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
    it.each([
        ['package', `sha256-${'f'.repeat(64)}`, []],
        ['grants', `sha256-${'a'.repeat(64)}`, ['network.http']],
    ])('refuses a minted handle for different %s authority', async (_reason, digest, grants) => {
        mintedDigest = digest;
        mintedGrants = grants;
        setPortableClientSource({ descriptor: descriptor(), workspaceId: 'ws-1', runtimeEntry: undefined });
        const activation = await ensurePortableClientActivation('sample.plugin');
        expect(activation?.status).toBe('blocked');
        expect(activation?.blockCode).toBe('activation-identity-mismatch');
        expect(startPortableWorkerMock).not.toHaveBeenCalled();
        expect(revocationRequests).toEqual(['act_test_1']);
    });
    it('keeps private-field runtime instances unproxied for actions and teardown', async () => {
        class PrivateRuntime {
            #active = true;
            capabilities = [];
            async callPlugin() { return { ok: this.#active }; }
            dispose() { this.#active = false; }
        }
        const runtime = new PrivateRuntime();
        startPortableWorkerMock.mockResolvedValue({ ...startedRuntime('private'), runtime });
        setPortableClientSource({ descriptor: descriptor(), workspaceId: 'ws-1', runtimeEntry: undefined });
        await ensurePortableClientActivation('sample.plugin');
        await expect(invokePortableUiEvent('sample.plugin', { action: 'tasks.create-list' })).resolves.toEqual({ ok: true });
        await expect(deactivatePortableClient('sample.plugin')).resolves.not.toThrow();
    });

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

describe('content-bearing handoffs', () => {
    it('refuses to deliver authorized content into a replacement activation', async () => {
        const base = startedRuntime('handoff');
        startPortableWorkerMock.mockResolvedValue({
            ...base,
            runtime: {
                capabilities: [],
                dispose: vi.fn(),
                callPlugin: async () => ({ ok: true }),
            },
        });
        setPortableClientSource({
            descriptor: descriptor(),
            workspaceId: 'ws-1',
            runtimeEntry: undefined,
        });
        const activated = await ensurePortableClientActivation('sample.plugin');
        expect(activated?.status).toBe('active');
        const expected = {
            workspaceId: activated!.workspaceId,
            packageDigest: activated!.packageDigest,
            generation: activated!.generation,
        };
        // Same generation delivers.
        await expect(
            invokePortableUiEvent('sample.plugin', { action: 'host.first-action.run' }, expected)
        ).resolves.toEqual({ ok: true });
        // A replacement generation never receives the old content, and the
        // call is never retried automatically.
        await expect(
            invokePortableUiEvent(
                'sample.plugin',
                { action: 'host.first-action.run' },
                { ...expected, generation: expected.generation + 1 }
            )
        ).rejects.toThrow('activation changed');
        await expect(
            invokePortableUiEvent(
                'sample.plugin',
                { action: 'host.first-action.run' },
                { ...expected, workspaceId: 'ws-2' }
            )
        ).rejects.toThrow('activation changed');
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
        expect(getPortableActivation('sample.plugin')?.blockCode).toBe('worker-crashed');
        expect(revocationRequests).toEqual(['act_test_1']);
    });

    it('reconnects after the normal activation time limit without a manual restart', async () => {
        vi.useFakeTimers();
        startPortableWorkerMock.mockResolvedValue(startedRuntime('timed'));
        setPortableClientSource({ descriptor: descriptor(), workspaceId: 'ws-time-limit', runtimeEntry: undefined });
        await ensurePortableClientActivation('sample.plugin');
        const start = startPortableWorkerMock.mock.calls[0]?.[0] as {
            onCrash: (report: { fatal: boolean; reason: string }) => void;
        };

        start.onCrash({ fatal: true, reason: 'budget-exceeded:activation-ms' });
        expect(getPortableActivation('sample.plugin')).toMatchObject({
            status: 'stopped',
            blockCode: 'activation-time-limit',
            crashed: false,
        });
        expect(schedulePortableClientRecovery('sample.plugin')).toBe(true);
        await vi.advanceTimersByTimeAsync(300);
        expect(startPortableWorkerMock).toHaveBeenCalledTimes(2);
        expect(getPortableActivation('sample.plugin')?.status).toBe('active');
    });

    it('ends automatic recovery with a retryable stop when startup throws', async () => {
        vi.useFakeTimers();
        startPortableWorkerMock.mockResolvedValueOnce(startedRuntime('timed'));
        startPortableWorkerMock.mockRejectedValueOnce(new Error('Worker startup failed'));
        setPortableClientSource({ descriptor: descriptor(), workspaceId: 'ws-recovery-failure', runtimeEntry: undefined });
        await ensurePortableClientActivation('sample.plugin');
        const start = startPortableWorkerMock.mock.calls[0]?.[0] as {
            onCrash: (report: { fatal: boolean; reason: string }) => void;
        };

        start.onCrash({ fatal: true, reason: 'budget-exceeded:activation-ms' });
        expect(schedulePortableClientRecovery('sample.plugin')).toBe(true);
        await vi.advanceTimersByTimeAsync(300);
        expect(getPortableActivation('sample.plugin')).toMatchObject({
            status: 'stopped',
            blockCode: 'recovery-failed',
        });
        expect(schedulePortableClientRecovery('sample.plugin')).toBe(false);
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
        mintedGrants = ['network.http'];
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

describe('centralized recovery', () => {
    it('allows only transient stop codes to recover automatically', () => {
        for (const code of [
            'activation-unknown',
            'activation-expired',
            'activation-revoked',
            'activation-stale',
            'activation-time-limit',
        ]) {
            expect(isRecoverablePortableStop(code)).toBe(true);
        }
        for (const code of [
            'plugin-disabled',
            'plugin-uninstalled',
            'plugin-access-denied',
            'activation-session-mismatch',
            'grant-review-stale',
            'grant-review-unresolved',
            'containment-violation',
            'worker-crashed',
            null,
            undefined,
        ]) {
            expect(isRecoverablePortableStop(code)).toBe(false);
        }
    });

    it('bounds recovery with a rolling window that a successful restart does not reset', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const pluginId = 'recovery.plugin';
        const workspaceId = 'ws-recovery';
        expect(claimPortableRecoveryAttempt(pluginId, workspaceId)).toMatchObject({
            allowed: true,
            attempt: 1,
        });
        expect(claimPortableRecoveryAttempt(pluginId, workspaceId)).toMatchObject({
            allowed: true,
            attempt: 2,
        });
        expect(claimPortableRecoveryAttempt(pluginId, workspaceId)).toMatchObject({
            allowed: true,
            attempt: 3,
        });
        // A fourth attempt inside the window is refused even though the three
        // earlier activations all succeeded.
        expect(claimPortableRecoveryAttempt(pluginId, workspaceId).allowed).toBe(false);
        vi.setSystemTime(4 * 60 * 1000);
        expect(claimPortableRecoveryAttempt(pluginId, workspaceId).allowed).toBe(false);
        // The window rolls forward instead of being reset by success.
        vi.setSystemTime(10 * 60 * 1000);
        expect(claimPortableRecoveryAttempt(pluginId, workspaceId).allowed).toBe(true);
    });

    it('schedules one silent restart shared by every surface', async () => {
        vi.useFakeTimers();
        startPortableWorkerMock.mockResolvedValue(startedRuntime('recovered'));
        setPortableClientSource({
            descriptor: descriptor(),
            workspaceId: 'ws-1',
            runtimeEntry: undefined,
        });
        await ensurePortableClientActivation('sample.plugin');
        const call = startPortableWorkerMock.mock.calls[0]?.[0] as {
            services: {
                settings: { set: (params: Record<string, unknown>) => Promise<unknown> };
            };
        };
        fetchMock.mockRejectedValueOnce(
            Object.assign(new Error('Activation was revoked: plugin-disabled'), {
                statusCode: 409,
                data: { code: 'activation-revoked' },
            })
        );
        await expect(
            call.services.settings.set({ key: 'greeting', value: 'Hi' })
        ).rejects.toMatchObject({ rpcCode: 'policy-denied' });
        expect(getPortableActivation('sample.plugin')?.status).toBe('stopped');

        // The sidebar and the pane both observe the stop; only one restart is
        // scheduled and the shared budget is charged once.
        schedulePortableClientRecovery('sample.plugin');
        schedulePortableClientRecovery('sample.plugin');
        await vi.advanceTimersByTimeAsync(300);
        expect(startPortableWorkerMock).toHaveBeenCalledTimes(2);
        expect(getPortableActivation('sample.plugin')?.status).toBe('active');
    });

    it('does not let an old recovery timer restart a replacement generation', async () => {
        vi.useFakeTimers();
        startPortableWorkerMock.mockResolvedValue(startedRuntime('old'));
        const source = { descriptor: descriptor(), workspaceId: 'ws-1', runtimeEntry: undefined };
        setPortableClientSource(source);
        await activatePortableClient(source);
        const first = startPortableWorkerMock.mock.calls[0]![0] as { services: { settings: { set: (params: Record<string, unknown>) => Promise<unknown> } } };
        fetchMock.mockRejectedValueOnce(Object.assign(new Error('expired'), { statusCode: 409, data: { code: 'activation-expired' } }));
        await expect(first.services.settings.set({ key: 'greeting', value: 'Hi' })).rejects.toThrow();
        schedulePortableClientRecovery('sample.plugin');
        await activatePortableClient(source);
        const second = startPortableWorkerMock.mock.calls[1]![0] as typeof first;
        fetchMock.mockRejectedValueOnce(Object.assign(new Error('disabled'), { statusCode: 409, data: { code: 'plugin-disabled' } }));
        await expect(second.services.settings.set({ key: 'greeting', value: 'Hi' })).rejects.toThrow();
        await vi.advanceTimersByTimeAsync(1000);
        expect(startPortableWorkerMock).toHaveBeenCalledTimes(2);
    });

    it('never restarts an activation whose failure is not on the allowlist', async () => {
        vi.useFakeTimers();
        startPortableWorkerMock.mockResolvedValue(startedRuntime('terminal'));
        setPortableClientSource({
            descriptor: descriptor(),
            workspaceId: 'ws-1',
            runtimeEntry: undefined,
        });
        const activation = await activatePortableClient({
            descriptor: descriptor(),
            workspaceId: 'ws-1',
        });
        const start = startPortableWorkerMock.mock.calls[0]?.[0] as {
            onCrash: (report: { fatal: boolean; reason: string }) => void;
        };
        start.onCrash({ fatal: true, reason: 'worker-crashed' });
        expect(getPortableActivation('sample.plugin')?.status).toBe('stopped');
        expect(activation.generation).toBeGreaterThan(0);

        schedulePortableClientRecovery('sample.plugin');
        await vi.advanceTimersByTimeAsync(1000);
        expect(startPortableWorkerMock).toHaveBeenCalledTimes(1);
        expect(getPortableActivation('sample.plugin')?.status).toBe('stopped');
    });
});

describe('contribution readiness and replacement safeguards', () => {
    it('records the exact package digest and waits for required surfaces', async () => {
        startPortableWorkerMock.mockResolvedValue(startedRuntime('readiness'));
        const activation = await activatePortableClient({
            descriptor: descriptor(),
            workspaceId: 'ws-1',
        });
        expect(activation.status).toBe('active');
        expect(activation.packageDigest).toBe(`sha256-${'a'.repeat(64)}`);
        // Pane/sidebar have not settled yet, so this is not full readiness.
        expect(isPortableActivationReady(activation)).toBe(false);

        reportPortableContributionReadiness('sample.plugin', 'pane', 'ready', {
            descriptorKey: activation.descriptorKey,
            workspaceId: 'ws-1',
        });
        expect(isPortableActivationReady(getPortableActivation('sample.plugin')!)).toBe(false);
        reportPortableContributionReadiness('sample.plugin', 'sidebar', 'ready', {
            descriptorKey: activation.descriptorKey,
            workspaceId: 'ws-1',
        });
        // No tool grant: tools are not-required, so required surfaces suffice.
        expect(isPortableActivationReady(getPortableActivation('sample.plugin')!)).toBe(true);
    });

    it('degrades optional tool discovery without failing the activation', async () => {
        mintedGrants = ['tools.register.client'];
        const withTools = { ...descriptor(), effectiveGrants: ['tools.register.client'] as never[] };
        startPortableWorkerMock.mockResolvedValue(startedRuntime('tools'));
        const activation = await activatePortableClient({
            descriptor: withTools,
            workspaceId: 'ws-1',
        });
        for (const surface of ['pane', 'sidebar'] as const) {
            reportPortableContributionReadiness('sample.plugin', surface, 'ready', {
                descriptorKey: activation.descriptorKey,
                workspaceId: 'ws-1',
            });
        }
        expect(isPortableActivationReady(getPortableActivation('sample.plugin')!)).toBe(false);
        reportPortableContributionReadiness('sample.plugin', 'tools', 'failed', {
            descriptorKey: activation.descriptorKey,
            workspaceId: 'ws-1',
            code: 'catalog-too-large',
        });
        const degraded = getPortableActivation('sample.plugin')!;
        expect(degraded.status).toBe('active');
        expect(degraded.degradedContributions).toEqual(['tools:catalog-too-large']);
        expect(isPortableActivationReady(degraded)).toBe(true);
    });

    it('ignores surface reports for bytes the activation does not run', async () => {
        startPortableWorkerMock.mockResolvedValue(startedRuntime('stale-surface'));
        const activation = await activatePortableClient({
            descriptor: descriptor(),
            workspaceId: 'ws-1',
        });
        reportPortableContributionReadiness('sample.plugin', 'pane', 'ready', {
            descriptorKey: `sha256-${'f'.repeat(64)}`,
            workspaceId: 'ws-1',
        });
        const current = getPortableActivation('sample.plugin')!;
        expect(current.contributionReadiness.pane).toBe('pending');
        expect(isPortableActivationReady(current)).toBe(false);
        expect(activation.packageDigest).toBe(`sha256-${'a'.repeat(64)}`);
    });

    it('inherits surfaces already settled for the same descriptor', async () => {
        const first = descriptor();
        reportPortableContributionReadiness('sample.plugin', 'pane', 'ready', {
            descriptorKey: first.descriptorKey,
            workspaceId: 'ws-1',
        });
        reportPortableContributionReadiness('sample.plugin', 'sidebar', 'ready', {
            descriptorKey: first.descriptorKey,
            workspaceId: 'ws-1',
        });
        startPortableWorkerMock.mockResolvedValue(startedRuntime('inherited'));
        const activation = await activatePortableClient({
            descriptor: first,
            workspaceId: 'ws-1',
        });
        expect(isPortableActivationReady(activation)).toBe(true);
    });

    it('inherits tool discovery settled for the same descriptor across restarts', async () => {
        mintedGrants = ['tools.register.client'];
        const withTools = { ...descriptor(), effectiveGrants: ['tools.register.client'] as never[] };
        startPortableWorkerMock.mockResolvedValue(startedRuntime('tools-restart'));
        setPortableClientSource({ descriptor: withTools, workspaceId: 'ws-1', runtimeEntry: undefined });
        const first = await ensurePortableClientActivation('sample.plugin');
        for (const surface of ['pane', 'sidebar', 'tools'] as const) {
            reportPortableContributionReadiness('sample.plugin', surface, 'ready', {
                descriptorKey: first!.descriptorKey,
                workspaceId: 'ws-1',
            });
        }
        expect(isPortableActivationReady(getPortableActivation('sample.plugin')!)).toBe(true);
        // Restart without stopping the source: host tool registrations stay
        // alive, so the new activation inherits readiness instead of waiting
        // for a discovery run the sync path will not repeat.
        await deactivatePortableClient('sample.plugin');
        const restarted = await ensurePortableClientActivation('sample.plugin');
        expect(restarted?.contributionReadiness.tools).toBe('ready');
        expect(isPortableActivationReady(restarted!)).toBe(true);
    });

    it('retains a failed tool discovery with its code across restarts', async () => {
        mintedGrants = ['tools.register.client'];
        const withTools = { ...descriptor(), effectiveGrants: ['tools.register.client'] as never[] };
        startPortableWorkerMock.mockResolvedValue(startedRuntime('tools-failed-restart'));
        setPortableClientSource({ descriptor: withTools, workspaceId: 'ws-1', runtimeEntry: undefined });
        const first = await ensurePortableClientActivation('sample.plugin');
        for (const surface of ['pane', 'sidebar'] as const) {
            reportPortableContributionReadiness('sample.plugin', surface, 'ready', {
                descriptorKey: first!.descriptorKey,
                workspaceId: 'ws-1',
            });
        }
        reportPortableContributionReadiness('sample.plugin', 'tools', 'failed', {
            descriptorKey: first!.descriptorKey,
            workspaceId: 'ws-1',
            code: 'catalog-too-large',
        });
        await deactivatePortableClient('sample.plugin');
        const restarted = await ensurePortableClientActivation('sample.plugin');
        expect(restarted?.contributionReadiness.tools).toBe('failed');
        expect(restarted?.degradedContributions).toEqual(['tools:catalog-too-large']);
        expect(isPortableActivationReady(restarted!)).toBe(true);
    });

    it('does not inherit tool readiness for different bytes', async () => {
        mintedGrants = ['tools.register.client'];
        const withTools = { ...descriptor(), effectiveGrants: ['tools.register.client'] as never[] };
        startPortableWorkerMock.mockResolvedValue(startedRuntime('tools-bytes'));
        setPortableClientSource({ descriptor: withTools, workspaceId: 'ws-1', runtimeEntry: undefined });
        const first = await ensurePortableClientActivation('sample.plugin');
        reportPortableContributionReadiness('sample.plugin', 'tools', 'ready', {
            descriptorKey: first!.descriptorKey,
            workspaceId: 'ws-1',
        });
        await deactivatePortableClient('sample.plugin');
        const next: PackageV2PluginDescriptor = {
            ...withTools,
            descriptorKey: `sha256-${'f'.repeat(64)}` as Sha256,
        };
        setPortableClientSource({ descriptor: next, workspaceId: 'ws-1', runtimeEntry: undefined });
        const restarted = await activatePortableClient({ descriptor: next, workspaceId: 'ws-1' });
        expect(restarted?.contributionReadiness.tools).toBe('pending');
        expect(isPortableActivationReady(restarted!)).toBe(false);
    });

    it('leaves another plugin active while replacing this one', async () => {
        const first = startedRuntime('first');
        const other = startedRuntime('other');
        const replacement = startedRuntime('replacement');
        startPortableWorkerMock.mockResolvedValueOnce(first).mockResolvedValueOnce(other).mockResolvedValueOnce(replacement);
        await activatePortableClient({ descriptor: descriptor(), workspaceId: 'ws-1' });
        await activatePortableClient({ descriptor: { ...descriptor(), id: 'other.plugin' }, workspaceId: 'ws-1' });
        await activatePortableClient({ descriptor: {
            ...descriptor(),
            artifact: { ...descriptor().artifact, packageDigest: `sha256-${'d'.repeat(64)}` as Sha256 },
        }, workspaceId: 'ws-1' });
        expect(first.dispose).toHaveBeenCalledOnce();
        expect(other.dispose).not.toHaveBeenCalled();
        expect(getPortableActivation('other.plugin')?.status).toBe('active');
        await deactivatePortableClient('other.plugin');
    });
});

describe('portable draft lifecycle', () => {
    it('keeps a dirty field draft when the same workspace replaces a package', () => {
        setPortableClientSource({ descriptor: descriptor(), workspaceId: 'ws-1', runtimeEntry: undefined });
        const draft = getPortableClientDraft('sample.plugin', 'ws-1', 'pane');
        draft.values.notes = 'unfinished';
        draft.dirty.add('notes');
        removePortableClientSource('sample.plugin', true);
        setPortableClientSource({ descriptor: descriptor(), workspaceId: 'ws-1', runtimeEntry: undefined });
        expect(getPortableClientDraft('sample.plugin', 'ws-1', 'pane')).toBe(draft);
        expect(draft.values.notes).toBe('unfinished');
        expect(draft.dirty.has('notes')).toBe(true);
    });

    it('retains drafts across mounts and removes them with their source or workspace', () => {
        setPortableClientSource({ descriptor: descriptor(), workspaceId: 'ws-1', runtimeEntry: undefined });
        const draft = getPortableClientDraft('sample.plugin', 'ws-1', 'pane');
        draft.values.notes = 'private';
        draft.dirty.add('notes');
        expect(getPortableClientDraft('sample.plugin', 'ws-1', 'pane')).toBe(draft);
        expect(getPortableClientDraft('sample.plugin', 'ws-1', 'sidebar').values).toEqual({});
        removePortableClientSource('sample.plugin');
        expect(getPortableClientDraft('sample.plugin', 'ws-1', 'pane').values).toEqual({});
        getPortableClientDraft('sample.plugin', 'ws-1', 'pane').values.notes = 'private';
        setPortableClientSource({ descriptor: descriptor(), workspaceId: 'ws-2', runtimeEntry: undefined });
        expect(getPortableClientDraft('sample.plugin', 'ws-1', 'pane').values).toEqual({});
        clearPortableClientSources();
        expect(getPortableClientDraft('sample.plugin', 'ws-1', 'pane').values).toEqual({});
    });
});

describe('explicit startup recovery and draft identity', () => {
    it.each(['transport', '503'])('recovers a transient %s failure with fresh manifest and authorization', async (failure) => {
        const originalFetch = globalThis.fetch;
        let first = true;
        const {createDescriptorKey} = await import('~~/shared/plugins/descriptor-key');
        const {descriptorKey: ignored, ...identity} = descriptor();
        const fresh = {...identity, descriptorKey: await createDescriptorKey(identity)};
        const entry = {descriptorStatus: 'ready', descriptor: fresh, loadAllowed: true, hasServerRoutes: false, lifecycleCoverage: 'managed-v2'};
        vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
            if (url === '/api/plugins/runtime-manifest') return new Response(JSON.stringify({workspaceId: 'ws-1', enabledPluginIds: ['sample.plugin'], runtime: {'sample.plugin': entry}}));
            if (url === '/api/plugins/isolation/activation' && init?.method === 'POST' && first) {
                first = false;
                if (failure === 'transport') throw new Error('offline');
                return new Response('{}', {status: 503});
            }
            return originalFetch(url, init);
        }));
        startPortableWorkerMock.mockResolvedValue(startedRuntime('recovered'));
        setPortableClientSource({descriptor: fresh, workspaceId: 'ws-1', runtimeEntry: entry});
        expect((await ensurePortableClientActivation('sample.plugin'))?.blockCode).toBe('activation-unavailable');
        expect((await restartPortableClient('sample.plugin')).status).toBe('active');
        expect(startPortableWorkerMock).toHaveBeenCalledTimes(1);
    });
    it('keeps input through an absent restart view and clears it on logical navigation', async () => {
        startPortableWorkerMock.mockResolvedValue(startedRuntime('draft'));
        const source = {descriptor: descriptor(), workspaceId: 'ws-1', runtimeEntry: undefined};
        setPortableClientSource(source);
        await activatePortableClient(source);
        const emit = (index: number, key: string) => (startPortableWorkerMock.mock.calls[index]![0] as {onEvent: (value: unknown) => void}).onEvent({status: 'rendered', key, title: key, nodes: []});
        emit(0, 'editor');
        const draft = getPortableClientDraft('sample.plugin', 'ws-1', 'pane');
        draft.values.title = 'unsaved';
        await activatePortableClient(source);
        expect(draft.values.title).toBe('unsaved');
        emit(1, 'editor');
        expect(draft.values.title).toBe('unsaved');
        emit(1, 'other');
        expect(draft.values.title).toBeUndefined();
        expect(getPortableClientDraft('sample.plugin', 'ws-2', 'pane').values).toEqual({});
    });
});
