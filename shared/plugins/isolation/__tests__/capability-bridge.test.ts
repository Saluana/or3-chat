import { describe, expect, it, vi } from 'vitest';
import type { PluginGrantReviewSnapshot } from '../../grant-review';
import {
    createHttpCapabilityTransport,
    createRemoteCapabilityMethods,
    REMOTE_CAPABILITY_METHODS,
} from '../capability-bridge';
import { parseRpcEnvelope, serializeRpcEnvelope, type RpcEnvelope } from '../rpc-envelope';
import { WorkerIsolationRuntime, type IsolatedWorkerMessagePort } from '../worker-runtime';
import { createPortableClient } from '../../../../packages/plugin-sdk/src/portable';

function grants(approved: readonly string[]): PluginGrantReviewSnapshot {
    return {
        requestedGrants: [...approved],
        approvedGrants: [...approved],
        revision: 'g1',
        status: 'current',
    };
}

const session = {
    pluginId: 'example.plugin',
    workspaceId: 'ws_1',
    generation: 3,
    sessionId: 'sess-1',
    sourceId: 'sbx-1',
};

describe('server capability bridge (finding 4)', () => {
    it('registers only capabilities the activation approves', () => {
        const transport = vi.fn();
        const approved = createRemoteCapabilityMethods({
            transport,
            session: () => session,
            grants: grants(['network.http']),
        });
        expect(approved.map((spec) => spec.method)).toEqual(
            Object.values(REMOTE_CAPABILITY_METHODS)
        );

        const withoutNetwork = createRemoteCapabilityMethods({
            transport,
            session: () => session,
            grants: grants(['storage.read']),
        });
        expect(withoutNetwork).toHaveLength(0);
    });

    it('forwards the host session echo and refuses to carry an approval from params', async () => {
        const calls: Array<Record<string, unknown>> = [];
        const transport = vi.fn(async (call: { params: Readonly<Record<string, unknown>> }) => {
            calls.push(call as unknown as Record<string, unknown>);
            return { ok: true as const, result: { text: 'ok' } };
        });
        const specs = createRemoteCapabilityMethods({
            transport,
            session: () => session,
            grants: grants(['network.http']),
        });
        const completeSpec = specs.find((spec) => spec.method === 'ai.complete');
        const connectionSpec = specs.find((spec) => spec.method === 'connections.dispatch');
        expect(completeSpec).toBeTruthy();
        expect(connectionSpec).toBeTruthy();

        const context = {
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            generation: 3,
            requestId: 'rpc-1',
            signal: new AbortController().signal,
            deadlineMs: 5_000,
        };
        const result = await completeSpec!.handler(
            { model: 'm', prompt: 'hi', approval: { approvalId: 'forged' } },
            context
        );
        expect(result).toMatchObject({ text: 'ok' });
        expect(calls[0]).toMatchObject({
            method: 'ai.complete',
            session,
            requestId: 'rpc-1',
        });
        // The sandbox cannot smuggle an approval through the bridge.
        expect(calls[0]!.params).toMatchObject({ model: 'm', prompt: 'hi' });
    });

    it('maps a server refusal to a structured RPC error', async () => {
        const [aiSpec] = createRemoteCapabilityMethods({
            transport: async () => ({
                ok: false,
                code: 'budget-exceeded',
                message: 'Budget exhausted',
            }),
            session: () => session,
            grants: grants(['network.http']),
        });
        await expect(
            aiSpec!.handler(
                { model: 'm', prompt: 'hi' },
                {
                    pluginId: 'example.plugin',
                    workspaceId: 'ws_1',
                    generation: 3,
                    requestId: 'rpc-1',
                    signal: new AbortController().signal,
                    deadlineMs: 5_000,
                }
            )
        ).rejects.toMatchObject({ rpcCode: 'budget-exceeded' });
    });

    it('posts to the authenticated endpoint with the mutation intent header', async () => {
        const fetchImpl = vi.fn(async () =>
            new Response(JSON.stringify({ ok: true, result: 1 }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })
        );
        const transport = createHttpCapabilityTransport({
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });
        const response = await transport({
            method: REMOTE_CAPABILITY_METHODS.aiComplete,
            params: { model: 'm' },
            session,
            requestId: 'rpc-1',
            deadlineMs: 5_000,
        });
        expect(response).toMatchObject({ ok: true, result: 1 });
        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('/api/plugins/isolation/capability');
        expect(init.credentials).toBe('same-origin');
        expect((init.headers as Record<string, string>)['x-or3-plugin-intent']).toBe('plugin');
        expect(JSON.parse(String(init.body))).toMatchObject({
            pluginId: 'example.plugin',
            generation: 3,
            method: 'ai.complete',
        });
    });

    it('surfaces a server error body as the refusal message', async () => {
        const fetchImpl = vi.fn(async () =>
            new Response(JSON.stringify({ statusMessage: 'Plugin access denied' }), {
                status: 403,
                headers: { 'content-type': 'application/json' },
            })
        );
        const transport = createHttpCapabilityTransport({
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });
        const response = await transport({
            method: REMOTE_CAPABILITY_METHODS.connectionsDispatch,
            params: {},
            session,
            requestId: 'rpc-2',
            deadlineMs: 5_000,
        });
        expect(response).toMatchObject({ ok: false, message: 'Plugin access denied' });
    });

    it('preserves the structured rpcCode a spent budget returns with HTTP 429', async () => {
        const fetchImpl = vi.fn(async () =>
            new Response(
                JSON.stringify({
                    statusCode: 429,
                    statusMessage: 'Budget exhausted',
                    data: { rpcCode: 'budget-exceeded' },
                }),
                { status: 429, headers: { 'content-type': 'application/json' } }
            )
        );
        const transport = createHttpCapabilityTransport({
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });
        const response = await transport({
            method: REMOTE_CAPABILITY_METHODS.aiComplete,
            params: {},
            session,
            requestId: 'rpc-3',
            deadlineMs: 5_000,
        });
        expect(response).toMatchObject({
            ok: false,
            code: 'budget-exceeded',
            message: 'Budget exhausted',
        });

        // The bridge passes the server's own code to the RPC error envelope.
        const [aiSpec] = createRemoteCapabilityMethods({
            transport: async () => response,
            session: () => session,
            grants: grants(['network.http']),
        });
        await expect(
            aiSpec!.handler(
                { model: 'm', prompt: 'hi' },
                {
                    pluginId: 'example.plugin',
                    workspaceId: 'ws_1',
                    generation: 3,
                    requestId: 'rpc-4',
                    signal: new AbortController().signal,
                    deadlineMs: 5_000,
                }
            )
        ).rejects.toMatchObject({ rpcCode: 'budget-exceeded' });
    });

    it('derives a refusal code from the HTTP status when no rpcCode is present', async () => {
        const cases: ReadonlyArray<[number, string]> = [
            [429, 'budget-exceeded'],
            [499, 'cancelled'],
            [503, 'unavailable'],
            [504, 'deadline-exceeded'],
        ];
        for (const [status, expectedCode] of cases) {
            const fetchImpl = vi.fn(async () =>
                new Response('nope', { status, headers: { 'content-type': 'text/plain' } })
            );
            const transport = createHttpCapabilityTransport({
                fetchImpl: fetchImpl as unknown as typeof fetch,
            });
            const response = await transport({
                method: REMOTE_CAPABILITY_METHODS.aiComplete,
                params: {},
                session,
                requestId: `rpc-status-${status}`,
                deadlineMs: 5_000,
            });
            expect(response, String(status)).toMatchObject({ ok: false, code: expectedCode });
        }
    });
});

describe('runtime capability registry and UI plumbing (findings 4, 6, 7)', () => {
    function fakeWorker() {
        const listeners = new Map<string, Set<(event: { data?: unknown }) => void>>();
        const outbound: RpcEnvelope[] = [];
        const port: IsolatedWorkerMessagePort = {
            postMessage(message: unknown) {
                const parsed = parseRpcEnvelope(message);
                if (parsed.ok) outbound.push(parsed.envelope);
            },
            addEventListener(type, listener) {
                const set = listeners.get(type) ?? new Set();
                set.add(listener);
                listeners.set(type, set);
            },
            removeEventListener(type, listener) {
                listeners.get(type)?.delete(listener);
            },
            terminate() {},
        };
        return {
            port,
            outbound,
            emit(data: unknown) {
                for (const listener of listeners.get('message') ?? []) listener({ data });
            },
        };
    }

    it('registers granted capabilities and exposes them for the host', async () => {
        const fake = fakeWorker();
        const capability = {
            method: 'ai.complete',
            grant: 'network.http' as const,
            handler: async () => ({ text: 'ok' }),
        };
        const runtime = new WorkerIsolationRuntime({
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            generation: 1,
            moduleUrl: 'https://plugins.local/client.mjs',
            grants: grants(['storage.read']),
            createWorker: () => fake.port,
            services: { storage: { get: () => ({ value: 1 }) } },
            methods: [capability],
        });
        await runtime.start();
        // The capability's grant is not approved, so it is not registered.
        expect(runtime.capabilities).toEqual(['storage.get']);
        runtime.dispose();

        const granted = new WorkerIsolationRuntime({
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            generation: 1,
            moduleUrl: 'https://plugins.local/client.mjs',
            grants: grants(['storage.read', 'network.http']),
            createWorker: () => fakeWorker().port,
            services: { storage: { get: () => ({ value: 1 }) } },
            methods: [capability],
        });
        await granted.start();
        expect(granted.capabilities).toEqual(['storage.get', 'ai.complete']);
        granted.dispose();
    });

    it('delivers validated UI renders, registers contributions and withdraws them on teardown', async () => {
        const fake = fakeWorker();
        const events: unknown[] = [];
        const runtime = new WorkerIsolationRuntime({
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            generation: 1,
            moduleUrl: 'https://plugins.local/client.mjs',
            grants: grants(['ui.dashboard.register']),
            createWorker: () => fake.port,
            services: {},
            onEvent: (event) => events.push(event),
        });
        await runtime.start();

        const render = {
            v: 1 as const,
            kind: 'event' as const,
            id: 'ev-1',
            name: 'ui.render',
            payload: { title: 'Summary', nodes: [{ type: 'text', text: 'hello' }] },
        };
        fake.emit(serializeRpcEnvelope(render));
        await vi.waitFor(() => {
            expect(events).toHaveLength(1);
        });
        expect(events[0]).toMatchObject({ status: 'rendered', name: 'ui.render' });

        // An invalid tree is reported, never rendered.
        fake.emit(
            serializeRpcEnvelope({
                v: 1,
                kind: 'event',
                id: 'ev-2',
                name: 'ui.render',
                payload: { nodes: [{ type: 'unknown-widget' }] },
            })
        );
        await vi.waitFor(() => {
            expect(events.some((event) => (event as { status: string }).status === 'invalid')).toBe(
                true
            );
        });

        fake.emit(
            serializeRpcEnvelope({
                v: 1,
                kind: 'event',
                id: 'ev-3',
                name: 'ui.contribute',
                payload: {
                    slot: 'dashboard',
                    id: 'widget-1',
                    title: 'Widget',
                    nodes: [{ type: 'text', text: 'contribution' }],
                },
            })
        );
        await vi.waitFor(() => {
            expect(runtime.contributions).toHaveLength(1);
        });

        runtime.dispose();
        expect(runtime.contributions).toHaveLength(0);
        const withdrawal = events.find(
            (event) => (event as { status: string }).status === 'withdrawn'
        ) as { contributionIds: readonly string[] } | undefined;
        expect(withdrawal?.contributionIds).toEqual(['widget-1']);
    });

    it('routes cancellation to the session that owns the id', async () => {
        const fake = fakeWorker();
        const runtime = new WorkerIsolationRuntime({
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            generation: 1,
            moduleUrl: 'https://plugins.local/client.mjs',
            grants: grants(['storage.read']),
            createWorker: () => fake.port,
            services: { storage: { get: () => ({ value: 1 }) } },
        });
        await runtime.start();

        // A host→plugin call is outstanding; a cancel for its id settles it.
        const call = runtime.callPlugin('plugin.slow', {});
        const request = fake.outbound.find(
            (envelope) => envelope.kind === 'request'
        ) as Extract<RpcEnvelope, { kind: 'request' }> | undefined;
        expect(request).toBeTruthy();
        fake.emit(serializeRpcEnvelope({ v: 1, kind: 'cancel', id: request!.id }));
        await expect(call).resolves.toMatchObject({ ok: false, code: 'cancelled' });

        runtime.dispose();
    });
});

describe('SDK portable client (finding 4)', () => {
    it('renders, contributes and calls through the sandbox transport', async () => {
        const posted: Array<Record<string, unknown>> = [];
        let listener: ((event: { data?: unknown }) => void) | null = null;
        const client = createPortableClient({
            postMessage: (message) => posted.push(message as Record<string, unknown>),
            addEventListener: (_type, handler) => {
                listener = handler;
            },
            generateId: (() => {
                let counter = 0;
                return () => `pl-${++counter}`;
            })(),
        });

        client.render({ title: 'Hello', nodes: [{ type: 'text', text: 'hi' }] });
        client.contribute('dashboard', 'w1', { nodes: [{ type: 'text', text: 'c' }] });
        client.withdraw('w1');
        expect(posted.map((message) => message.name)).toEqual([
            'ui.render',
            'ui.contribute',
            'ui.withdraw',
        ]);

        const pending = client.call('ai.complete', { model: 'm', prompt: 'p' });
        const request = posted.find((message) => message.kind === 'request')!;
        expect(request).toMatchObject({ method: 'ai.complete' });
        listener!({
            data: {
                v: 1,
                kind: 'response',
                id: request.id,
                ok: true,
                result: { text: 'done' },
            },
        });
        await expect(pending).resolves.toMatchObject({ ok: true, result: { text: 'done' } });
    });
});
