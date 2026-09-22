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

const kvRows = new Map<string, { name: string; value: string | null; updated_at: number; clock: number; deleted?: boolean }>();
const getKvByNameMock = vi.fn(async (name: string) => kvRows.get(name));
const setKvByNameMock = vi.fn(async (
    name: string,
    value: string | null,
    _db?: unknown,
    options?: { readonly ifClock?: number | null }
) => {
    const current = kvRows.get(name);
    const live = current && !current.deleted ? current : undefined;
    const currentClock = current?.clock ?? 0;
    if (
        options?.ifClock !== undefined &&
        (options.ifClock === null ? live !== undefined : options.ifClock !== currentClock)
    ) {
        throw Object.assign(new Error('KV revision is stale'), { rpcCode: 'conflict' });
    }
    const row = { name, value, updated_at: 1, clock: currentClock + 1 };
    kvRows.set(name, row);
    return { id: `kv:${name}`, ...row };
});
const hardDeleteKvByNameMock = vi.fn(async (name: string) => {
    kvRows.delete(name);
});
const tombstoneKvByNameMock = vi.fn(async (name: string) => {
    const current = kvRows.get(name);
    if (!current || current.deleted) return;
    kvRows.set(name, { ...current, value: null, updated_at: 1, clock: current.clock + 1, deleted: true });
});

vi.mock('~/db/kv', () => ({
    getKvByName: (...args: unknown[]) => getKvByNameMock(...(args as [string])),
    getKvRecordByName: async (name: string) => ({ row: kvRows.get(name), revision: kvRows.get(name)?.clock ?? 0 }),
    setKvByName: (...args: unknown[]) => setKvByNameMock(...(args as [string, string | null])),
    hardDeleteKvByName: (...args: unknown[]) => hardDeleteKvByNameMock(...(args as [string])),
    tombstoneKvByName: (...args: unknown[]) => tombstoneKvByNameMock(...(args as [string])),
}));

type Row = NonNullable<ReturnType<typeof kvRows.get>>;
function collection(rows: Row[]) {
    return {
        filter: (predicate: (row: Row) => boolean) => collection(rows.filter(predicate)),
        until: (predicate: (row: Row) => boolean) => {
            const end = rows.findIndex(predicate);
            return collection(end < 0 ? rows : rows.slice(0, end));
        },
        limit: (n: number) => collection(rows.slice(0, n)),
        toArray: async () => rows,
    };
}
const kvTable = {
    where: () => {
        const rows = [...kvRows.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
        return {
            startsWith: (prefix: string) => collection(rows.filter((r) => r.name.startsWith(prefix))),
            above: (low: string) => collection(rows.filter((r) => r.name > low)),
            aboveOrEqual: (low: string) => collection(rows.filter((r) => r.name >= low)),
        };
    },
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
    kvRows.clear();
    getKvByNameMock.mockClear();
    setKvByNameMock.mockClear();
    hardDeleteKvByNameMock.mockClear();
    tombstoneKvByNameMock.mockClear();
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
            JSON.stringify({ version: 1, presets: [] }),
            expect.objectContaining({ kv: kvTable }),
            expect.objectContaining({
                quota: expect.objectContaining({
                    maxBytes: 1024 * 1024,
                    prefix: 'plugin-storage:sample.plugin:',
                }),
            })
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
            clock: 1,
        });
        kvRows.set('plugin-storage:other.plugin:presets', {
            name: 'plugin-storage:other.plugin:presets',
            value: JSON.stringify({ version: 9 }),
            updated_at: 4,
            clock: 1,
        });
        const services = createPortableSettingsServices('sample.plugin');
        await expect(services.storage.list({})).resolves.toEqual({
            entries: [{ key: 'presets', sizeBytes: JSON.stringify({ version: 1 }).length, updatedAt: 3000, revision: 1 }],
        });
        await services.storage.delete({ key: 'presets' });
        expect(tombstoneKvByNameMock).toHaveBeenCalledWith(
            'plugin-storage:sample.plugin:presets',
            expect.objectContaining({ kv: kvTable }),
            undefined
        );
        expect(kvRows.has('plugin-storage:other.plugin:presets')).toBe(true);
        // The tombstoned key reads as absent and is excluded from listings.
        await expect(services.storage.get({ key: 'presets' })).resolves.toEqual({ value: null });
        await expect(services.storage.list({})).resolves.toEqual({ entries: [] });
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

    it('passes create-if-absent storage CAS through to the transactional KV adapter', async () => {
        const services = createPortableSettingsServices('sample.plugin');
        await expect(services.storage.set({ key: 'new', value: 'created', ifRevision: null })).resolves.toEqual({ ok: true });
        expect(setKvByNameMock).toHaveBeenLastCalledWith(
            'plugin-storage:sample.plugin:new',
            JSON.stringify('created'),
            expect.objectContaining({ kv: kvTable }),
            expect.objectContaining({
                ifClock: null,
                quota: expect.objectContaining({
                    maxKeys: 1000,
                    prefix: 'plugin-storage:sample.plugin:',
                }),
            })
        );
        await expect(services.storage.set({ key: 'new', value: 'overwrite', ifRevision: null })).rejects.toMatchObject({
            rpcCode: 'conflict',
        });
    });

    it('refuses a revoked storage mutation before it can commit', async () => {
        const services = createPortableSettingsServices('sample.plugin');
        const controller = new AbortController();
        controller.abort('revoked');
        setKvByNameMock.mockClear();
        await expect(
            services.storage.set({ key: 'revoked', value: 1 }, { signal: controller.signal })
        ).rejects.toMatchObject({ rpcCode: 'cancelled' });
        expect(setKvByNameMock).not.toHaveBeenCalled();
        await expect(
            services.storage.delete({ key: 'revoked' }, { signal: controller.signal })
        ).rejects.toMatchObject({ rpcCode: 'cancelled' });
        expect(tombstoneKvByNameMock).not.toHaveBeenCalled();
    });

    it('rejects malformed revisions instead of writing unconditionally', async () => {
        const services = createPortableSettingsServices('sample.plugin');
        for (const ifRevision of ['1', 1.5, Number.NaN, -1, true, {}]) {
            setKvByNameMock.mockClear();
            await expect(
                services.storage.set({ key: 'guarded', value: 'x', ifRevision })
            ).rejects.toMatchObject({ rpcCode: 'invalid-input' });
            expect(setKvByNameMock).not.toHaveBeenCalled();
        }
        expect(kvRows.has('plugin-storage:sample.plugin:guarded')).toBe(false);
    });

    it('pages through an index seek without loading the whole keyspace', async () => {
        const services = createPortableSettingsServices('sample.plugin');
        for (let index = 0; index < 5; index += 1) {
            kvRows.set(`plugin-storage:sample.plugin:k${index}`, {
                name: `plugin-storage:sample.plugin:k${index}`,
                value: JSON.stringify(index),
                updated_at: 1,
                clock: 1,
            });
        }
        const first = (await services.storage.listPage({ limit: 2 })) as {
            entries: { key: string }[];
            nextCursor?: string;
        };
        expect(first.entries.map((entry) => entry.key)).toEqual(['k0', 'k1']);
        expect(first.nextCursor).toMatch(/^cursor:/);
        const second = (await services.storage.listPage({ limit: 2, cursor: first.nextCursor })) as {
            entries: { key: string }[];
            nextCursor?: string;
        };
        expect(second.entries.map((entry) => entry.key)).toEqual(['k2', 'k3']);
        expect(second.nextCursor).toMatch(/^cursor:/);
        const third = (await services.storage.listPage({ limit: 2, cursor: second.nextCursor })) as {
            entries: { key: string }[];
            nextCursor?: string;
        };
        expect(third.entries.map((entry) => entry.key)).toEqual(['k4']);
        expect(third.nextCursor).toBeUndefined();
    });

    it('a stale pre-delete revision cannot match a recreated incarnation', async () => {
        const services = createPortableSettingsServices('sample.plugin');
        await services.storage.set({ key: 'cycle', value: 'v1' });
        const first = (await services.storage.getRecord({ key: 'cycle' })) as { revision: number };
        expect(first.revision).toBe(1);
        await services.storage.delete({ key: 'cycle' });
        await services.storage.set({ key: 'cycle', value: 'v2' });
        const second = (await services.storage.getRecord({ key: 'cycle' })) as { revision: number };
        // Delete consumed revision 2, so the recreate landed on 3, not 1 again.
        expect(second.revision).toBe(3);
        await expect(
            services.storage.set({ key: 'cycle', value: 'stale', ifRevision: first.revision })
        ).rejects.toMatchObject({ rpcCode: 'conflict' });
        await expect(services.storage.get({ key: 'cycle' })).resolves.toEqual({ value: 'v2' });
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

describe('centralized recovery', () => {
    it('allows only transient stop codes to recover automatically', () => {
        for (const code of [
            'activation-unknown',
            'activation-expired',
            'activation-revoked',
            'activation-stale',
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

    it('preserves plugin storage across replacement and stops the old sandbox', async () => {
        const services = createPortableSettingsServices('sample.plugin');
        await services.storage.set({ key: 'preset', value: { theme: 'dark' } });
        startPortableWorkerMock.mockResolvedValue(startedRuntime('old'));
        await activatePortableClient({ descriptor: descriptor(), workspaceId: 'ws-1' });

        const replacement: PackageV2PluginDescriptor = {
            ...descriptor(),
            version: '1.1.0',
            artifact: {
                ...descriptor().artifact,
                packageDigest: `sha256-${'d'.repeat(64)}` as Sha256,
            },
        };
        startPortableWorkerMock.mockResolvedValue(startedRuntime('new'));
        const next = await activatePortableClient({ descriptor: replacement, workspaceId: 'ws-1' });
        expect(next.packageDigest).toBe(`sha256-${'d'.repeat(64)}`);
        // The old sandbox was disposed and its handle revoked; stored data kept.
        expect(startedRuntime('old') && revocationRequests.length).toBeGreaterThan(0);
        await expect(services.storage.get({ key: 'preset' })).resolves.toEqual({
            value: { theme: 'dark' },
        });
    });
});


describe('portable draft lifecycle', () => {
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
