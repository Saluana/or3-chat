import { describe, expect, it, vi } from 'vitest';
import type { PluginGrantReviewSnapshot } from '../../grant-review';
import {
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
            const runtime = new WorkerIsolationRuntime({
                pluginId: 'iso.worker',
                workspaceId: 'ws-1',
                generation: i + 1,
                moduleUrl: 'https://plugins.local/worker.mjs',
                grants: grants(),
                createWorker: fake.factory,
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
