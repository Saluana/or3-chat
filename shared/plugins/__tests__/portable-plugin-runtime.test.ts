import { describe, expect, it } from 'vitest';
import {
    PORTABLE_BOOTSTRAP_FAILED_EVENT,
    PORTABLE_BOOTSTRAP_READY_EVENT,
    createPortablePlugin,
} from '@or3/plugin-sdk/portable-runtime';
import type { PortableClient, PortableHostResult } from '@or3/plugin-sdk/portable';
import type { PortableUiView } from '@or3/plugin-sdk/ui';

/**
 * The sandbox host is the SDK side of the portable contract: it must answer the
 * host's bootstrap (so "started" means setup ran), and it must build its context
 * from the identity, features and grants the host sent rather than inventing
 * them.
 */
function fakeClient() {
    const requests: { method: string; params: Readonly<Record<string, unknown>> }[] = [];
    const events: { name: string; payload: Readonly<Record<string, unknown>> }[] = [];
    const contributions: { slot: string; id: string; view: PortableUiView }[] = [];
    let ready: ((event: { name: string; payload: Record<string, unknown> }) => void) | null =
        null;
    const settings = new Map<string, unknown>([['greeting', 'Hi']]);
    const client: PortableClient = {
        emit(name, payload) {
            events.push({ name, payload: payload ?? {} });
        },
        render() {},
        contribute(slot, id, view) {
            contributions.push({ slot, id, view });
        },
        withdraw() {},
        async call<T>(
            method: string,
            params: Readonly<Record<string, unknown>> = {}
        ): Promise<PortableHostResult<T>> {
            requests.push({ method, params });
            if (method === 'settings.get') {
                return { ok: true, result: { value: settings.get(String(params.key)) ?? null } as T };
            }
            if (method === 'settings.set') {
                settings.set(String(params.key), params.value);
                return { ok: true, result: undefined as T };
            }
            if (method === 'settings.list') {
                return { ok: true, result: { values: Object.fromEntries(settings) } as T };
            }
            return { ok: false, code: 'policy-denied', message: `No host method ${method}` };
        },
        onEvent(listener) {
            ready = listener as typeof ready;
            return () => {
                ready = null;
            };
        },
        onRequest() {
            return () => undefined;
        },
    };
    return {
        client,
        requests,
        events,
        contributions,
        deliverBootstrap(payload: Record<string, unknown>) {
            ready?.({ name: 'runtime.bootstrap', payload });
        },
    };
}

const manifest = {
    manifestVersion: 2,
    kind: 'plugin',
    id: 'or3.sample-utility',
    name: 'Sample Utility',
    version: '1.0.0',
    engines: { or3: '^0.3.0', pluginApi: '^2.0.0' },
    runtime: { client: { entry: 'client.mjs', format: 'esm', isolation: 'worker' } },
    requestedGrants: ['settings.read', 'ui.dashboard.register'],
    features: { required: ['or3-portable-client-v1'], optional: [] },
    dependencies: { required: [], optional: [] },
    trust: 'isolated-client',
    settings: { version: 1 },
    stateCompatibility: { version: 1, reads: { minimum: 1, maximum: 1 }, rollback: 'safe' },
} as const;

function bootstrap(grants: readonly string[] = ['settings.read', 'ui.dashboard.register']) {
    return {
        pluginId: 'or3.sample-utility',
        abiVersion: 1,
        features: ['or3-portable-client-v1'],
        grants: [...grants],
        session: { sessionId: 's1', sourceId: 'sbx-1', generation: 3 },
    };
}

describe('createPortablePlugin', () => {
    it('acknowledges the bootstrap only after setup succeeds', async () => {
        const fake = fakeClient();
        const setupCalls: number[] = [];
        createPortablePlugin(
            {
                manifest,
                setup(context) {
                    setupCalls.push(context.generation);
                },
            },
            { client: fake.client, bootstrap: bootstrap() }
        );
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(setupCalls).toEqual([3]);
        expect(fake.events.map((event) => event.name)).toContain(PORTABLE_BOOTSTRAP_READY_EVENT);
        expect(fake.events.map((event) => event.name)).not.toContain(
            PORTABLE_BOOTSTRAP_FAILED_EVENT
        );
    });

    it('reports a failed activation instead of acknowledging readiness', async () => {
        const fake = fakeClient();
        let signal: AbortSignal | undefined;
        const handle = createPortablePlugin(
            {
                manifest,
                setup(context) {
                    signal = context.signal;
                    throw new Error('plugin refused to start');
                },
            },
            { client: fake.client, bootstrap: bootstrap() }
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        await expect(handle.ready).rejects.toThrow('plugin refused to start');
        expect(signal?.aborted).toBe(true);

        const failure = fake.events.find(
            (event) => event.name === PORTABLE_BOOTSTRAP_FAILED_EVENT
        );
        expect(failure?.payload).toMatchObject({
            code: 'activation-failed',
            message: 'plugin refused to start',
        });
        expect(fake.events.map((event) => event.name)).not.toContain(
            PORTABLE_BOOTSTRAP_READY_EVENT
        );
    });

    it('uses the grants and features the host sent, and denies what was not approved', async () => {
        const granted = fakeClient();
        createPortablePlugin(
            {
                manifest,
                async setup(context) {
                    expect([...context.grants]).toContain('settings.read');
                    expect(context.features.has('or3-portable-client-v1')).toBe(true);
                    const value = await context.settings.get('greeting');
                    expect(value).toMatchObject({ ok: true, value: 'Hi' });
                    context.contributions.register({
                        kind: 'ui.dashboard.card',
                        id: 'card',
                        definition: { nodes: [{ type: 'text', text: 'hello' }] },
                    });
                },
            },
            { client: granted.client, bootstrap: bootstrap() }
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(granted.requests.map((entry) => entry.method)).toContain('settings.get');
        expect(granted.contributions).toHaveLength(1);

        // Without the approved grants the same plugin is refused locally, before
        // any host call, and cannot publish a contribution.
        const denied = fakeClient();
        let deniedResult: unknown = null;
        await new Promise<void>((resolve) => {
            createPortablePlugin(
                {
                    manifest,
                    async setup(context) {
                        deniedResult = await context.settings.get('greeting');
                        expect(() =>
                            context.contributions.register({
                                kind: 'ui.dashboard.card',
                                id: 'card',
                                definition: { nodes: [] },
                            })
                        ).toThrow(/ui\.dashboard\.register/);
                        resolve();
                    },
                },
                { client: denied.client, bootstrap: bootstrap([]) }
            );
        });
        expect(deniedResult).toMatchObject({
            ok: false,
            error: { code: 'permission-denied' },
        });
        expect(denied.requests).toHaveLength(0);
        expect(denied.contributions).toHaveLength(0);
    });

    it('takes identity from the bootstrap payload, never from the definition', async () => {
        const fake = fakeClient();
        createPortablePlugin(
            {
                manifest,
                setup(context) {
                    expect(context.pluginId).toBe('or3.sample-utility');
                    expect(context.generation).toBe(3);
                    expect(context.trust).toBe('isolated-client');
                },
            },
            { client: fake.client, bootstrap: bootstrap() }
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(fake.events.map((event) => event.name)).toContain(PORTABLE_BOOTSTRAP_READY_EVENT);
    });

    it('requires workspace authority for workspace lifecycle subscriptions', async () => {
        const fake = fakeClient();
        createPortablePlugin(
            {
                manifest,
                setup(context) {
                    context.workspace.onChange(() => undefined);
                },
            },
            {
                client: fake.client,
                bootstrap: bootstrap(['events.register']),
            }
        );
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(fake.events.map((event) => event.name)).toContain(PORTABLE_BOOTSTRAP_FAILED_EVENT);
        expect(fake.events.map((event) => event.name)).not.toContain(PORTABLE_BOOTSTRAP_READY_EVENT);
    });
});
