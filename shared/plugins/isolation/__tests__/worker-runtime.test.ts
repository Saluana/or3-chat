import { describe, expect, it, vi } from 'vitest';
import type { PluginGrantReviewSnapshot } from '../../grant-review';
import {
    createRpcEvent,
    createRpcRequest,
    createRpcResponse,
    parseRpcEnvelope,
    serializeRpcEnvelope,
    type RpcEnvelope,
} from '../rpc-envelope';
import {
    WORKER_FORBIDDEN_CAPABILITIES,
    WorkerIsolationRuntime,
    type IsolatedWorkerMessagePort,
} from '../worker-runtime';

function grants(
    approved: readonly string[] = ['storage.read', 'hooks.register', 'settings.read']
): PluginGrantReviewSnapshot {
    return {
        requestedGrants: [...approved],
        approvedGrants: [...approved],
        revision: 'g1',
        status: 'current',
        authoritySha256: null,
        packageDigest: null,
    };
}

function createFakeWorkerFactory(inbox: RpcEnvelope[]) {
    const listeners = new Map<
        string,
        Set<(event: { data?: unknown; message?: string }) => void>
    >();
    let terminated = false;
    const port: IsolatedWorkerMessagePort = {
        postMessage(message: unknown) {
            const parsed = parseRpcEnvelope(message);
            if (parsed.ok) inbox.push(parsed.envelope);
        },
        addEventListener(type, listener) {
            const set = listeners.get(type) ?? new Set();
            set.add(listener);
            listeners.set(type, set);
        },
        removeEventListener(type, listener) {
            listeners.get(type)?.delete(listener);
        },
        terminate() {
            terminated = true;
        },
    };
    return {
        terminated: () => terminated,
        emit(data: unknown) {
            for (const listener of listeners.get('message') ?? []) {
                listener({ data });
            }
        },
        emitError(message: string) {
            for (const listener of listeners.get('error') ?? []) {
                listener({ message });
            }
        },
        factory: () => port,
        resetTerminated() {
            terminated = false;
        },
    };
}

describe('worker-runtime (8.4-8.6)', () => {
    it('bootstraps, stops repeatedly, and leaves no pending RPC', async () => {
        for (let i = 0; i < 3; i += 1) {
            const inbox: RpcEnvelope[] = [];
            const fake = createFakeWorkerFactory(inbox);
            const onCrash = vi.fn();
            const runtime = new WorkerIsolationRuntime({
                pluginId: 'iso.worker',
                workspaceId: 'ws-1',
                generation: i + 1,
                moduleUrl: 'https://plugins.local/worker.mjs',
                grants: grants(),
                createWorker: fake.factory,
                onCrash,
                services: {
                    storage: {
                        get: () => ({ value: i }),
                    },
                },
            });
            await runtime.start();
            expect(runtime.active).toBe(true);
            expect(
                inbox.some((e) => e.kind === 'event' && e.name === 'runtime.bootstrap')
            ).toBe(true);
            runtime.dispose();
            expect(runtime.active).toBe(false);
            expect(runtime.pendingRpcCount).toBe(0);
            expect(fake.terminated()).toBe(true);
            expect(onCrash).not.toHaveBeenCalled();
        }
    });

    it('bridges granted storage/settings/hooks without host object graphs', async () => {
        const inbox: RpcEnvelope[] = [];
        const fake = createFakeWorkerFactory(inbox);
        const storage = new Map<string, unknown>([['k', 'v']]);
        const runtime = new WorkerIsolationRuntime({
            pluginId: 'iso.worker',
            workspaceId: 'ws-1',
            generation: 1,
            moduleUrl: 'https://plugins.local/worker.mjs',
            grants: grants(['storage.read', 'settings.read', 'hooks.register']),
            createWorker: fake.factory,
            services: {
                storage: {
                    get: (params) => {
                        expect(typeof params.key).toBe('string');
                        return {
                            value: storage.get(String(params.key)) ?? null,
                        };
                    },
                },
                settings: {
                    get: () => ({ theme: 'retro' }),
                    list: (_params, context) => {
                        context.emitEvent?.('settings.changed', {
                            key: 'theme',
                            revision: 2,
                            deleted: false,
                        });
                        return { values: { theme: 'retro' } };
                    },
                },
                hooks: {
                    onAction: () => ({ registered: true }),
                },
            },
        });
        await runtime.start();

        fake.emit(
            serializeRpcEnvelope(
                createRpcRequest({
                    id: 'w-1',
                    method: 'storage.get',
                    params: { key: 'k' },
                })
            )
        );
        await vi.waitFor(() => {
            expect(inbox.some((e) => e.kind === 'response' && e.id === 'w-1')).toBe(
                true
            );
        });

        const response = inbox.find((e) => e.kind === 'response' && e.id === 'w-1');
        expect(response).toMatchObject({
            kind: 'response',
            result: { value: 'v' },
        });
        expect(response && 'result' in response ? response.result : null).not.toBe(
            storage
        );

        fake.emit(
            serializeRpcEnvelope(
                createRpcRequest({
                    id: 'w-settings-list',
                    method: 'settings.list',
                    params: {},
                })
            )
        );
        await vi.waitFor(() => {
            expect(inbox.some((e) => e.kind === 'response' && e.id === 'w-settings-list')).toBe(true);
        });
        expect(inbox.find((e) => e.kind === 'response' && e.id === 'w-settings-list')).toMatchObject({
            result: { values: { theme: 'retro' } },
        });
        expect(inbox.some((e) => e.kind === 'event' && e.name === 'settings.changed')).toBe(true);

        runtime.dispose();
    });

    it('reports crashes and clears the worker', async () => {
        const fake = createFakeWorkerFactory([]);
        const runtime = new WorkerIsolationRuntime({
            pluginId: 'iso.worker',
            workspaceId: 'ws-1',
            generation: 1,
            moduleUrl: 'https://plugins.local/worker.mjs',
            grants: grants(),
            createWorker: fake.factory,
            services: {},
        });
        await runtime.start();
        fake.emitError('boom');
        expect(runtime.crashReports[0]).toMatchObject({
            reason: 'boom',
            fatal: true,
        });
        expect(runtime.crashReports).toHaveLength(1);
        expect(runtime.active).toBe(false);
        expect(fake.terminated()).toBe(true);
    });

    it('completes a host→plugin call when the worker responds', async () => {
        const listeners = new Map<string, Set<(event: { data?: unknown }) => void>>();
        let lastRequestId: string | null = null;
        const port: IsolatedWorkerMessagePort = {
            postMessage(message: unknown) {
                const parsed = parseRpcEnvelope(message);
                if (parsed.ok && parsed.envelope.kind === 'request') {
                    lastRequestId = parsed.envelope.id;
                    queueMicrotask(() => {
                        for (const listener of listeners.get('message') ?? []) {
                            listener({
                                data: serializeRpcEnvelope(
                                    createRpcResponse({
                                        id: parsed.envelope.id,
                                        result: { pong: true },
                                    })
                                ),
                            });
                        }
                    });
                }
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

        const runtime = new WorkerIsolationRuntime({
            pluginId: 'iso.worker',
            workspaceId: 'ws-1',
            generation: 1,
            moduleUrl: 'https://plugins.local/worker.mjs',
            grants: grants(),
            createWorker: () => port,
            services: {},
        });
        await runtime.start();
        await expect(runtime.callPlugin('plugin.ping', {})).resolves.toEqual({
            ok: true,
            result: { pong: true },
        });
        expect(lastRequestId).toEqual(expect.any(String));
        runtime.dispose();
    });

    it('charges the activation ledger and stops on a terminal breach (finding 2)', async () => {
        const inbox: RpcEnvelope[] = [];
        const fake = createFakeWorkerFactory(inbox);
        const crashes: string[] = [];
        const runtime = new WorkerIsolationRuntime({
            pluginId: 'iso.worker',
            workspaceId: 'ws-1',
            generation: 1,
            moduleUrl: 'https://plugins.local/worker.mjs',
            grants: grants(['storage.read']),
            createWorker: fake.factory,
            services: { storage: { get: () => ({ value: 1 }) } },
            budgets: {
                maxCallsPerActivation: 1,
                maxMessageBytes: 256 * 1024,
                maxActivationMs: 60_000,
            },
            onCrash: (report) => crashes.push(report.reason),
        });
        await runtime.start();

        fake.emit(
            serializeRpcEnvelope(
                createRpcRequest({ id: 'call-1', method: 'storage.get', params: {} })
            )
        );
        await vi.waitFor(() => {
            expect(inbox.some((e) => e.kind === 'response' && e.id === 'call-1')).toBe(true);
        });
        expect(runtime.budgetSnapshot.calls).toBe(1);

        // The second call exceeds the activation call budget and stops the plugin.
        fake.emit(
            serializeRpcEnvelope(
                createRpcRequest({ id: 'call-2', method: 'storage.get', params: {} })
            )
        );
        await vi.waitFor(() => {
            expect(
                inbox.some(
                    (e) => e.kind === 'error' && e.id === 'call-2' && e.code === 'budget-exceeded'
                )
            ).toBe(true);
        });
        expect(runtime.active).toBe(false);
        expect(runtime.budgetTerminationReason).toContain('calls');
        expect(crashes.some((reason) => reason.startsWith('budget-exceeded'))).toBe(true);
    });

    it('refuses an oversized inbound object before it reaches a handler (finding 3)', async () => {
        const inbox: RpcEnvelope[] = [];
        const fake = createFakeWorkerFactory(inbox);
        const handler = vi.fn(() => ({ value: 1 }));
        const runtime = new WorkerIsolationRuntime({
            pluginId: 'iso.worker',
            workspaceId: 'ws-1',
            generation: 1,
            moduleUrl: 'https://plugins.local/worker.mjs',
            grants: grants(['storage.read']),
            createWorker: fake.factory,
            services: { storage: { get: handler } },
            budgets: { maxMessageBytes: 512, maxActivationMs: 60_000 },
        });
        await runtime.start();

        // A structured-clone object, not a pre-serialized string: the size check
        // must measure the object itself.
        fake.emit(
            createRpcRequest({
                id: 'huge-1',
                method: 'storage.get',
                params: { key: 'x'.repeat(4096) },
            })
        );
        await vi.waitFor(() => {
            expect(runtime.active).toBe(false);
        });
        expect(handler).not.toHaveBeenCalled();
        expect(runtime.budgetTerminationReason).toContain('message-bytes');
    });

    it('stops a quiet sandbox when the activation wall-clock budget is spent', async () => {
        const fake = createFakeWorkerFactory([]);
        const crashes: string[] = [];
        const runtime = new WorkerIsolationRuntime({
            pluginId: 'iso.worker',
            workspaceId: 'ws-1',
            generation: 1,
            moduleUrl: 'https://plugins.local/worker.mjs',
            grants: grants(),
            createWorker: fake.factory,
            services: {},
            budgets: { maxActivationMs: 30 },
            onCrash: (report) => crashes.push(report.reason),
        });
        await runtime.start();
        await vi.waitFor(() => {
            expect(runtime.active).toBe(false);
        });
        expect(runtime.budgetTerminationReason).toContain('activation-ms');
        expect(crashes).toEqual(['budget-exceeded:activation-ms']);
        expect(fake.terminated()).toBe(true);
    });

    it('enforces slot grants on raw ui.contribute events and prunes on revocation', async () => {
        const inbox: RpcEnvelope[] = [];
        const fake = createFakeWorkerFactory(inbox);
        const events: Array<{ status: string; name: string; reason?: string; contributionIds?: readonly string[] }> = [];
        const runtime = new WorkerIsolationRuntime({
            pluginId: 'iso.worker',
            workspaceId: 'ws-1',
            generation: 1,
            moduleUrl: 'https://plugins.local/worker.mjs',
            grants: grants(['ui.dashboard.register']),
            createWorker: fake.factory,
            services: {},
            onEvent: (event) => {
                events.push(event as { status: string; name: string; reason?: string; contributionIds?: readonly string[] });
            },
        });
        await runtime.start();

        const contribute = (id: string, slot: string) =>
            fake.emit(
                serializeRpcEnvelope(
                    createRpcEvent({
                        id: `ev-${id}`,
                        name: 'ui.contribute',
                        payload: {
                            slot,
                            id,
                            title: 'Widget',
                            nodes: [{ type: 'text', text: 'hello' }],
                        },
                    })
                )
            );
        // Bypass the SDK register() guard with a raw wire event for a slot
        // whose grant was not approved: the host boundary must refuse it.
        contribute('palette-1', 'command-palette');
        await vi.waitFor(() => {
            expect(events.some((event) => event.status === 'invalid')).toBe(true);
        });
        expect(runtime.contributions).toHaveLength(0);
        expect(events.at(-1)?.reason).toContain('ui.command-palette.register');

        // The approved slot is accepted.
        contribute('dash-1', 'dashboard');
        await vi.waitFor(() => {
            expect(runtime.contributions).toHaveLength(1);
        });
        expect(runtime.contributions[0]).toMatchObject({
            contributionId: 'dash-1',
            slot: 'dashboard',
        });

        // Revoking the grant removes the accepted registration.
        events.length = 0;
        runtime.setGrants(grants([]));
        expect(runtime.contributions).toHaveLength(0);
        expect(events).toContainEqual(
            expect.objectContaining({ status: 'withdrawn', contributionIds: ['dash-1'] })
        );
        runtime.dispose();
    });

    it('adversarial: forbids host globals/DOM/network, revoked grants, and enforces deadlines', async () => {
        expect(WORKER_FORBIDDEN_CAPABILITIES).toEqual(
            expect.arrayContaining([
                'window',
                'document',
                'fetch',
                'XMLHttpRequest',
                'WebSocket',
            ])
        );

        const inbox: RpcEnvelope[] = [];
        const fake = createFakeWorkerFactory(inbox);
        const handler = vi.fn(() => ({ value: 1 }));
        const runtime = new WorkerIsolationRuntime({
            pluginId: 'iso.worker',
            workspaceId: 'ws-1',
            generation: 1,
            moduleUrl: 'https://plugins.local/worker.mjs',
            grants: grants(['storage.read']),
            createWorker: fake.factory,
            services: { storage: { get: handler } },
        });
        await runtime.start();

        runtime.setGrants(grants([]));
        fake.emit(
            serializeRpcEnvelope(
                createRpcRequest({
                    id: 'revoked-1',
                    method: 'storage.get',
                    params: { key: 'secret' },
                })
            )
        );
        await vi.waitFor(() => {
            expect(
                inbox.some(
                    (e) =>
                        e.kind === 'error' &&
                        e.id === 'revoked-1' &&
                        e.code === 'grant-denied'
                )
            ).toBe(true);
        });
        expect(handler).not.toHaveBeenCalled();

        vi.useFakeTimers();
        try {
            const pending = runtime.callPlugin('plugin.ping', {}, { deadlineMs: 10 });
            await vi.advanceTimersByTimeAsync(10);
            await expect(pending).resolves.toMatchObject({
                ok: false,
                code: 'deadline-exceeded',
            });
        } finally {
            vi.useRealTimers();
        }

        fake.emit(
            serializeRpcEnvelope(
                createRpcRequest({
                    id: 'net-1',
                    method: 'network.fetch',
                    params: { url: 'https://evil.test' },
                })
            )
        );
        await vi.waitFor(() => {
            expect(
                inbox.some(
                    (e) =>
                        e.kind === 'error' &&
                        e.id === 'net-1' &&
                        e.code === 'unknown-method'
                )
            ).toBe(true);
        });

        // Host remains responsive after adversarial traffic.
        expect(runtime.active).toBe(true);
        runtime.dispose();
    });
});
