import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginGrantReviewSnapshot } from '~~/shared/plugins/grant-review';
import { HostRpcBroker, SDK_LOGIC_RPC_METHODS, type HostRpcHandlerContext } from '~~/shared/plugins/isolation/host-rpc-broker';
import type { RpcEnvelope } from '~~/shared/plugins/isolation/rpc-envelope';
import type { PluginResult } from '../../../../packages/plugin-sdk/src/results';
import { createPortableClient, type PortableClient } from '../../../../packages/plugin-sdk/src/portable';
import {
    createPortablePlugin,
    type PortablePluginContext,
} from '../../../../packages/plugin-sdk/src/portable-runtime';
import { defineOr3Plugin } from '../../../../packages/plugin-sdk/src/contracts';
import type { PluginManifestV2 } from '../../../../packages/plugin-sdk/src/manifest';
import { createPortableTestHost } from '../../../../packages/plugin-sdk/src/testing';

/**
 * Portable storage conformance: the same fixtures run against the production
 * dispatch path (real RPC envelope validators, real grant evaluation, real
 * broker error codec, real `createPortableSettingsServices` handlers on top
 * of the real `app/db/kv` CAS/tombstone/quota logic) and against the
 * lightweight `createPortableTestHost()` fake. Outcomes are compared at the
 * plugin-visible `PluginResult` level: `{ ok, code }` must agree.
 *
 * INTENTIONAL DIFFERENCES (explicit, not covered here):
 * - `client.emit()` on the fake echoes into local listeners; production
 *   emits travel to the host and only host-origin events arrive via `onEvent`.
 * - Transport budgets, per-call deadlines and cancellation timing are
 *   production-only; the fake answers synchronously.
 * - Activation lifecycle/generation staleness is production-only (covered by
 *   the handoff tests); the fake has no generations.
 * - `updatedAt`/id allocation are synthetic on both sides and not compared.
 * - Split grant layers (facade allows, broker refuses) exist only in
 *   production; the fake is single-layer. The mapping is pinned by dedicated
 *   prod-only assertions below.
 */

import { Or3DB } from '~/db/client';
const kvState = vi.hoisted(() => ({ db: undefined as Or3DB | undefined }));

vi.mock('~~/shared/plugins/isolation/portable-bootstrap', () => ({
    PORTABLE_CLIENT_FEATURE: 'or3-portable-client-v1',
    PORTABLE_PROFILE_NAME: 'or3-portable-client-v1',
    defaultHostAbi: () => ({ abiVersion: 1, features: [], methods: [] }),
    detectBrowserEngine: () => 'chromium',
    startPortableWorker: vi.fn(),
}));

vi.mock('~/utils/errors', () => ({
    reportError: vi.fn(),
    err: vi.fn((_code: string, _message: string, meta: unknown) => meta),
}));

vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => ({
        applyFilters: async (_name: string, value: unknown) => value,
        doAction: async () => {},
    }),
}));

vi.mock('~/db/client', async (original) => ({
    ...await original<typeof import('~/db/client')>(),
    getDb: () => kvState.db!,
}));

vi.mock('../bundled-v1-manager-runtime', () => ({
    requestWorkspacePluginReconcile: vi.fn(),
}));

vi.stubGlobal(
    '$fetch',
    vi.fn(async () => ({ settings: { values: {} } }))
);

import { createPortableSettingsServices } from '../portable-client-runtime';

function grantsSnapshot(approved: readonly string[]): PluginGrantReviewSnapshot {
    return {
        requestedGrants: [...approved, 'storage.read', 'storage.write'],
        approvedGrants: [...approved],
        revision: 'grants-1',
        status: 'current',
        authoritySha256: null,
        packageDigest: null,
    };
}

function manifest(): PluginManifestV2 {
    return {
        manifestVersion: 2,
        kind: 'plugin',
        id: 'sample.conformance',
        name: 'Conformance Sample',
        version: '1.0.0',
        engines: { or3: '^0.3.0', pluginApi: '^2.0.0' },
        runtime: {
            client: { entry: 'dist/client.mjs', format: 'esm', isolation: 'host' },
        },
        requestedGrants: ['storage.read', 'storage.write'],
        features: { required: [], optional: [] },
        dependencies: { required: [], optional: [] },
        trust: 'isolated-client',
        settings: { version: 1 },
        stateCompatibility: { version: 1, reads: { minimum: 1, maximum: 1 }, rollback: 'safe' },
    };
}

interface Side {
    context(): PortablePluginContext | null;
    rawCall(method: string, params?: Record<string, unknown>): Promise<{ ok: boolean; code?: string }>;
}

async function productionSide(facadeGrants: readonly string[], brokerGrants: readonly string[]): Promise<Side> {
    const services = createPortableSettingsServices('sample.plugin');
    type StorageServices = typeof services.storage;
    const methods = (Object.keys(SDK_LOGIC_RPC_METHODS) as Array<keyof typeof SDK_LOGIC_RPC_METHODS>)
        .filter((method) => method.startsWith('storage.'))
        .map((method) => ({
            method,
            grant: SDK_LOGIC_RPC_METHODS[method],
            handler: (params: Readonly<Record<string, unknown>>, context: HostRpcHandlerContext) => {
                const name = method.slice('storage.'.length) as keyof StorageServices;
                const service = services.storage[name] as (
                    params: Readonly<Record<string, unknown>>,
                    context?: unknown
                ) => unknown;
                return service(params, context);
            },
        }));
    let sandboxListener: ((event: { data?: unknown }) => void) | undefined;
    const broker = new HostRpcBroker({
        pluginId: 'sample.plugin',
        workspaceId: 'ws-1',
        generation: 1,
        grants: grantsSnapshot(brokerGrants),
        send: (envelope) => {
            sandboxListener?.({ data: envelope });
        },
        methods,
    });
    let counter = 0;
    const client: PortableClient = createPortableClient({
        postMessage: (message) => {
            void broker.receive(message as RpcEnvelope);
        },
        addEventListener: (_type, listener) => {
            sandboxListener = listener;
        },
        generateId: () => `req-${(counter += 1)}`,
    });
    const definition = defineOr3Plugin({ manifest: manifest(), setup: () => undefined });
    const handle = createPortablePlugin(definition, {
        client,
        bootstrap: {
            pluginId: 'sample.plugin',
            workspaceId: 'ws-1',
            abiVersion: 1,
            features: ['or3-portable-client-v1'],
            grants: [...facadeGrants],
            session: { sessionId: 'session-1', sourceId: 'source-1', generation: 1 },
        },
    });
    await handle.ready;
    return {
        context: () => handle.context(),
        async rawCall(method, params = {}) {
            const result = await client.call(method, params);
            return result.ok ? { ok: true } : { ok: false, code: result.code };
        },
    };
}

async function fakeSide(grants: readonly string[]): Promise<Side> {
    const host = createPortableTestHost({
        pluginId: 'sample.plugin',
        approvedGrants: [...grants] as never[],
    });
    const definition = defineOr3Plugin({ manifest: manifest(), setup: () => undefined });
    const handle = createPortablePlugin(definition, { client: host.client, bootstrap: host.bootstrap });
    await handle.ready;
    return {
        context: () => handle.context(),
        async rawCall(method, params = {}) {
            const result = await host.client.call(method, params);
            return result.ok ? { ok: true } : { ok: false, code: result.code };
        },
    };
}

function summarize(result: PluginResult<unknown>): { ok: boolean; code?: string } {
    return result.ok ? { ok: true } : { ok: false, code: result.error.code };
}

beforeEach(async () => {
    kvState.db = new Or3DB('portable-conformance-' + crypto.randomUUID());
    await kvState.db.open();
});
afterEach(async () => {
    await kvState.db?.delete();
});

describe('portable storage conformance (fake vs production dispatch)', () => {
    async function both(grants: readonly string[] = ['storage.read', 'storage.write']) {
        return { prod: await productionSide(grants, grants), fake: await fakeSide(grants) };
    }

    it('agrees on set/get round-trips, refusals and CAS conflicts', async () => {
        const { prod, fake } = await both();
        const prodStorage = prod.context()?.storage;
        const fakeStorage = fake.context()?.storage;
        expect(prodStorage).toBeDefined();
        expect(fakeStorage).toBeDefined();
        if (!prodStorage || !fakeStorage) return;

        const pairs: Array<{
            prod: () => Promise<PluginResult<unknown>>;
            fake: () => Promise<PluginResult<unknown>>;
        }> = [
            { prod: () => prodStorage.set('k', { n: 1 }), fake: () => fakeStorage.set('k', { n: 1 }) },
            { prod: () => prodStorage.get('k'), fake: () => fakeStorage.get('k') },
            { prod: () => prodStorage.set('', 'bad'), fake: () => fakeStorage.set('', 'bad') },
            {
                prod: () => prodStorage.set('big', 'x'.repeat(40 * 1024)),
                fake: () => fakeStorage.set('big', 'x'.repeat(40 * 1024)),
            },
            {
                prod: () => prodStorage.set('guarded', 'x', { ifRevision: '1' as unknown as number }),
                fake: () => fakeStorage.set('guarded', 'x', { ifRevision: '1' as unknown as number }),
            },
            {
                prod: () => prodStorage.set('guarded', 'x', { ifRevision: 1.5 }),
                fake: () => fakeStorage.set('guarded', 'x', { ifRevision: 1.5 }),
            },
            {
                prod: () => prodStorage.set('fresh', 'v', { ifRevision: null }),
                fake: () => fakeStorage.set('fresh', 'v', { ifRevision: null }),
            },
            {
                prod: () => prodStorage.set('fresh', 'again', { ifRevision: null }),
                fake: () => fakeStorage.set('fresh', 'again', { ifRevision: null }),
            },
            {
                prod: () => prodStorage.set('k', 'stale', { ifRevision: 999 }),
                fake: () => fakeStorage.set('k', 'stale', { ifRevision: 999 }),
            },
            { prod: () => prodStorage.delete('missing'), fake: () => fakeStorage.delete('missing') },
        ];
        for (const step of pairs) {
            expect(summarize(await step.prod())).toEqual(summarize(await step.fake()));
        }
        // Spot-check the exact codes the table agreed on.
        expect(summarize(await prodStorage.set('', 'bad'))).toEqual({ ok: false, code: 'invalid-input' });
        expect(summarize(await prodStorage.set('fresh', 'again', { ifRevision: null }))).toEqual({
            ok: false,
            code: 'conflict',
        });
    });

    it('agrees on delete/recreate revision continuity', async () => {
        const { prod, fake } = await both();
        const prodStorage = prod.context()?.storage;
        const fakeStorage = fake.context()?.storage;
        if (!prodStorage || !fakeStorage) return;

        await prodStorage.set('cycle', 'v1');
        await fakeStorage.set('cycle', 'v1');
        const prodFirst = await prodStorage.getRecord('cycle');
        const fakeFirst = await fakeStorage.getRecord('cycle');
        expect(summarize(prodFirst)).toEqual(summarize(fakeFirst));
        expect(prodFirst).toMatchObject({ ok: true });

        await prodStorage.delete('cycle');
        await fakeStorage.delete('cycle');
        expect(summarize(await prodStorage.get('cycle'))).toEqual(summarize(await fakeStorage.get('cycle')));
        expect(summarize(await prodStorage.list())).toEqual(summarize(await fakeStorage.list()));

        await prodStorage.set('cycle', 'v2');
        await fakeStorage.set('cycle', 'v2');
        const prodSecond = await prodStorage.getRecord('cycle');
        const fakeSecond = await fakeStorage.getRecord('cycle');
        if (!prodSecond.ok || !fakeSecond.ok) throw new Error('recreate failed');
        // Both continue past the delete; neither restarts at 1.
        expect(prodSecond.value.revision).toBeGreaterThan(1);
        expect(fakeSecond.value.revision).toBe(prodSecond.value.revision);

        const staleRevision = prodFirst.ok ? prodFirst.value.revision : -1;
        const prodStale = summarize(await prodStorage.set('cycle', 'stale', { ifRevision: staleRevision }));
        const fakeStale = summarize(await fakeStorage.set('cycle', 'stale', { ifRevision: staleRevision }));
        expect(prodStale).toEqual(fakeStale);
        expect(prodStale).toEqual({ ok: false, code: 'conflict' });
    });

    it('agrees on paged walks', async () => {
        const { prod, fake } = await both();
        const prodStorage = prod.context()?.storage;
        const fakeStorage = fake.context()?.storage;
        if (!prodStorage || !fakeStorage) return;

        for (let index = 0; index < 5; index += 1) {
            await prodStorage.set(`k${index}`, index);
            await fakeStorage.set(`k${index}`, index);
        }
        async function walk(
            storage: NonNullable<ReturnType<Side['context']>>['storage']
        ): Promise<{ keys: string[]; cursors: number }> {
            const keys: string[] = [];
            let cursors = 0;
            let cursor: string | undefined;
            for (;;) {
                const page = await storage.listPage({ limit: 2, ...(cursor === undefined ? {} : { cursor }) });
                if (!page.ok) throw new Error(`listPage failed: ${page.error.code}`);
                keys.push(...page.value.entries.map((entry) => entry.key));
                if (page.value.nextCursor === undefined) break;
                cursor = page.value.nextCursor;
                cursors += 1;
            }
            return { keys, cursors };
        }
        expect(await walk(prodStorage)).toEqual(await walk(fakeStorage));
        expect(await walk(prodStorage)).toEqual({ keys: ['k0', 'k1', 'k2', 'k3', 'k4'], cursors: 2 });
    });

    it('agrees on ungranted storage writes', async () => {
        const { prod, fake } = await both(['storage.read']);
        const prodStorage = prod.context()?.storage;
        const fakeStorage = fake.context()?.storage;
        if (!prodStorage || !fakeStorage) return;
        // The facade refuses before the host on both sides.
        expect(summarize(await prodStorage.set('k', 'v'))).toEqual(summarize(await fakeStorage.set('k', 'v')));
        expect(summarize(await prodStorage.set('k', 'v'))).toEqual({ ok: false, code: 'permission-denied' });
    });

    it('agrees on unknown methods at the transport level', async () => {
        const { prod, fake } = await both();
        expect(await prod.rawCall('storage.nope', {})).toEqual(await fake.rawCall('storage.nope', {}));
        expect(await prod.rawCall('storage.nope', {})).toEqual({ ok: false, code: 'unknown-method' });
    });

    it('maps a broker grant refusal to permission-denied (stale bootstrap)', async () => {
        // Facade allows (bootstrap carries the grant) but the broker refuses:
        // the SDK codec must surface permission-denied, never internal. The
        // fake is single-layer and cannot represent this split (see header).
        const storage = (await productionSide(['storage.read', 'storage.write'], ['storage.read'])).context()?.storage;
        expect(storage).toBeDefined();
        expect(summarize(await storage!.set('k', 'v'))).toEqual({ ok: false, code: 'permission-denied' });
    });

    it('enforces quotas on both sides', async () => {
        const { prod, fake } = await both();
        const prodStorage = prod.context()?.storage;
        const fakeStorage = fake.context()?.storage;
        if (!prodStorage || !fakeStorage) return;
        for (let index = 0; index < 1000; index += 1) {
            expect(summarize(await prodStorage.set(`q${index}`, 0))).toEqual({ ok: true });
            expect(summarize(await fakeStorage.set(`q${index}`, 0))).toEqual({ ok: true });
        }
        expect(summarize(await prodStorage.set('overflow', 0))).toEqual(
            summarize(await fakeStorage.set('overflow', 0))
        );
        expect(summarize(await prodStorage.set('overflow', 0))).toEqual({ ok: false, code: 'quota-exceeded' });
    }, 120000);
});

describe('portable successful result conformance', () => {
    async function stores() {
        const grants = ['storage.read', 'storage.write'];
        const prod = (await productionSide(grants, grants)).context()!.storage;
        const fake = (await fakeSide(grants)).context()!.storage;
        return [prod, fake] as const;
    }

    it('walks live rows beyond tombstones and includes the exact prefix key', async () => {
        for (const storage of await stores()) {
            for (const key of ['a', 'b', 'c', 'ca']) await storage.set(key, key);
            await storage.delete('a'); await storage.delete('b');
            const first = await storage.listPage({ limit: 1 });
            expect(first).toMatchObject({ ok: true, value: { entries: [{ key: 'c' }], nextCursor: 'cursor:c' } });
            expect(await storage.listPage({ prefix: 'c' })).toMatchObject({ ok: true, value: { entries: [{ key: 'c' }, { key: 'ca' }] } });
            expect(await storage.listPage({ prefix: 'c', cursor: 'cursor:a' })).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
        }
    });

    it('returns a usable revision for deleted records and counts stored null bytes', async () => {
        for (const storage of await stores()) {
            await storage.set('k', null);
            expect(await storage.getRecord('k')).toMatchObject({ ok: true, value: { value: null, revision: 1, sizeBytes: 4 } });
            await storage.delete('k');
            const record = await storage.getRecord('k');
            expect(record).toMatchObject({ ok: true, value: { value: null, revision: 2, sizeBytes: 0 } });
            if (!record.ok) throw new Error('read failed');
            expect(await storage.set('k', 'new', { ifRevision: record.value.revision })).toMatchObject({ ok: true });
        }
    });

    it('sorts and caps legacy listings after skipping deleted rows', async () => {
        for (const storage of await stores()) {
            for (let index = 202; index >= 0; index -= 1) await storage.set(`k${String(index).padStart(3, '0')}`, index);
            await storage.delete('k000');
            const list = await storage.list();
            expect(list.ok).toBe(true);
            if (!list.ok) throw new Error('list failed');
            expect(list.value).toHaveLength(200);
            expect(list.value[0]?.key).toBe('k001');
            expect(list.value.at(-1)?.key).toBe('k200');
        }
    });

    it('agrees at the byte quota boundary with stored null values', async () => {
        for (const storage of await stores()) {
            // Leave two bytes below 1 MiB; JSON null requires four.
            for (let index = 0; index < 31; index += 1) await storage.set(`large${index}`, 'x'.repeat(32766));
            await storage.set('last', 'x'.repeat(32764));
            expect(await storage.set('null', null)).toMatchObject({ ok: false, error: { code: 'quota-exceeded' } });
            await storage.delete('last');
            expect(await storage.set('null', null)).toMatchObject({ ok: true });
        }
    });
});

it('enforces the production retained-name cap in both hosts', async () => {
    const names = Array.from({ length: 10_000 }, (_, index) => `old${index}`);
    await kvState.db!.kv.bulkPut(names.map((key) => ({
        id: `kv:plugin-storage:sample.plugin:${key}`, name: `plugin-storage:sample.plugin:${key}`,
        value: null, deleted: true, created_at: 1, updated_at: 1, clock: 2,
    })));
    const services = createPortableSettingsServices('sample.plugin');
    const fake = createPortableTestHost({ approvedGrants: ['storage.write'], initialStorage: Object.fromEntries(names.map((key) => [key, null])) });
    for (const key of names) await fake.client.call('storage.delete', { key });
    await expect(services.storage.set({ key: 'overflow', value: 1 })).rejects.toMatchObject({ rpcCode: 'quota-exceeded' });
    expect(await fake.client.call('storage.set', { key: 'overflow', value: 1 })).toMatchObject({ ok: false, code: 'quota-exceeded' });
    expect(await services.storage.set({ key: names[0], value: 1 })).toEqual({ ok: true });
    expect(await fake.client.call('storage.set', { key: names[0], value: 1 })).toMatchObject({ ok: true });
});
