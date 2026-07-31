import { describe, expect, it, vi } from 'vitest';
import type { PluginGrantReviewSnapshot } from '~~/shared/plugins/grant-review';
import {
    createRpcEvent,
    createRpcRequest,
    createRpcResponse,
    parseRpcEnvelope,
    serializeRpcEnvelope,
    type RpcEnvelope,
} from '~~/shared/plugins/isolation/rpc-envelope';
import {
    checkEnvPolicy,
    checkFsReadPolicy,
    checkNetworkPolicy,
    DENY_ALL_SERVER_POLICIES,
    IsolatedServerRuntime,
    type IsolatedChildProcess,
    type IsolatedServerSpawnRequest,
} from '../isolated-server-runtime';

function grants(
    approved: readonly string[] = [
        'storage.read',
        'settings.read',
        'documents.read',
        'documents.write',
        'network.http',
    ]
): PluginGrantReviewSnapshot {
    return {
        requestedGrants: [...approved],
        approvedGrants: [...approved],
        revision: 'g1',
        status: 'current',
    };
}

function createFakeSpawn(options?: {
    readonly autoHandshake?: boolean;
    readonly onSpawn?: (request: IsolatedServerSpawnRequest) => void;
}) {
    const inbox: RpcEnvelope[] = [];
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    let killed = false;
    let current: IsolatedChildProcess | null = null;

    const child: IsolatedChildProcess = {
        pid: 4242,
        send(message: unknown) {
            const parsed = parseRpcEnvelope(message);
            if (parsed.ok) {
                inbox.push(parsed.envelope);
                if (
                    parsed.envelope.kind === 'event' &&
                    parsed.envelope.name === 'runtime.handshake' &&
                    options?.autoHandshake !== false
                ) {
                    queueMicrotask(() => {
                        for (const listener of listeners.get('message') ?? []) {
                            listener(
                                serializeRpcEnvelope(
                                    createRpcEvent({
                                        id: 'ack-1',
                                        name: 'runtime.handshake.ack',
                                        payload: {},
                                    })
                                )
                            );
                        }
                    });
                }
                if (parsed.envelope.kind === 'request') {
                    const request = parsed.envelope;
                    queueMicrotask(() => {
                        for (const listener of listeners.get('message') ?? []) {
                            listener(
                                serializeRpcEnvelope(
                                    createRpcResponse({
                                        id: request.id,
                                        result: { pong: true, method: request.method },
                                    })
                                )
                            );
                        }
                    });
                }
            }
            return true;
        },
        kill() {
            killed = true;
            current = null;
        },
        on(event, listener) {
            const set = listeners.get(event) ?? new Set();
            set.add(listener);
            listeners.set(event, set);
        },
        off(event, listener) {
            listeners.get(event)?.delete(listener);
        },
    };

    return {
        inbox,
        killed: () => killed,
        emit(raw: unknown) {
            for (const listener of listeners.get('message') ?? []) {
                listener(raw);
            }
        },
        emitExit(code: number) {
            for (const listener of listeners.get('exit') ?? []) {
                listener(code);
            }
        },
        spawn: (request: IsolatedServerSpawnRequest) => {
            options?.onSpawn?.(request);
            killed = false;
            current = child;
            return child;
        },
        current: () => current,
    };
}

describe('isolated-server-runtime (8.11-8.15)', () => {
    it('spawns, handshakes, health-checks, and terminates cleanly', async () => {
        const fake = createFakeSpawn();
        const runtime = new IsolatedServerRuntime({
            pluginId: 'iso.server',
            workspaceId: 'ws-1',
            generation: 1,
            modulePath: '/tmp/plugin/server.mjs',
            grants: grants(),
            spawn: fake.spawn,
            services: {
                storage: { get: () => ({ value: 1 }) },
            },
        });

        await runtime.start();
        expect(runtime.active).toBe(true);
        expect(runtime.health.alive).toBe(true);
        await expect(runtime.healthCheck()).resolves.toBe(true);

        runtime.dispose();
        expect(runtime.active).toBe(false);
        expect(fake.killed()).toBe(true);
        expect(fake.current()).toBeNull();
    });

    it('failed handshake and crash leave no child runtime', async () => {
        const fake = createFakeSpawn({ autoHandshake: false });
        const runtime = new IsolatedServerRuntime({
            pluginId: 'iso.server',
            workspaceId: 'ws-1',
            generation: 1,
            modulePath: '/tmp/plugin/server.mjs',
            grants: grants(),
            spawn: fake.spawn,
            services: {},
            handshakeTimeoutMs: 20,
        });

        await expect(runtime.start()).rejects.toThrow(/handshake failed/i);
        expect(runtime.active).toBe(false);
        expect(fake.killed()).toBe(true);

        const fake2 = createFakeSpawn();
        const runtime2 = new IsolatedServerRuntime({
            pluginId: 'iso.server',
            workspaceId: 'ws-1',
            generation: 2,
            modulePath: '/tmp/plugin/server.mjs',
            grants: grants(),
            spawn: fake2.spawn,
            services: {},
        });
        await runtime2.start();
        fake2.emitExit(1);
        expect(runtime2.crashReports[0]).toMatchObject({ fatal: true });
        expect(runtime2.active).toBe(false);
    });

    it('repeated start/stop leaves no child', async () => {
        for (let i = 0; i < 3; i += 1) {
            const fake = createFakeSpawn();
            const runtime = new IsolatedServerRuntime({
                pluginId: 'iso.server',
                workspaceId: 'ws-1',
                generation: i + 1,
                modulePath: '/tmp/plugin/server.mjs',
                grants: grants(),
                spawn: fake.spawn,
                services: {},
            });
            await runtime.start();
            runtime.terminate();
            expect(runtime.active).toBe(false);
            expect(fake.killed()).toBe(true);
        }
    });

    it('enforces CPU/wall/memory and request/response budgets', async () => {
        const fake = createFakeSpawn();
        const runtime = new IsolatedServerRuntime({
            pluginId: 'iso.server',
            workspaceId: 'ws-1',
            generation: 1,
            modulePath: '/tmp/plugin/server.mjs',
            grants: grants(['settings.read']),
            spawn: fake.spawn,
            services: {},
            budgets: {
                cpuMs: 10,
                wallMs: 50,
                memoryBytes: 1024,
                maxRequestBytes: 200,
                maxResponseBytes: 200,
            },
        });
        await runtime.start();

        fake.emit(
            serializeRpcEnvelope(
                createRpcRequest({
                    id: 'budget-cpu',
                    method: 'runtime.account',
                    params: { cpuMs: 999 },
                })
            )
        );
        await vi.waitFor(() => {
            expect(
                fake.inbox.some(
                    (e) =>
                        e.kind === 'error' &&
                        e.id === 'budget-cpu' &&
                        e.code === 'budget-exceeded'
                )
            ).toBe(true);
        });

        await expect(
            runtime.callPlugin('plugin.ping', {
                pad: 'x'.repeat(500),
            })
        ).resolves.toMatchObject({
            ok: false,
            code: 'budget-exceeded',
        });

        vi.useFakeTimers();
        try {
            // Swap spawn responder off by using a runtime that does not auto-answer calls.
            const silentListeners = new Map<string, Set<(...args: unknown[]) => void>>();
            const silentChild: IsolatedChildProcess = {
                pid: 1,
                send() {
                    return true;
                },
                kill() {},
                on(event, listener) {
                    const set = silentListeners.get(event) ?? new Set();
                    set.add(listener);
                    silentListeners.set(event, set);
                },
                off(event, listener) {
                    silentListeners.get(event)?.delete(listener);
                },
            };
            const wallRuntime = new IsolatedServerRuntime({
                pluginId: 'iso.server',
                workspaceId: 'ws-1',
                generation: 9,
                modulePath: '/tmp/plugin/server.mjs',
                grants: grants(),
                spawn: () => silentChild,
                services: {},
                budgets: { wallMs: 15 },
                handshakeTimeoutMs: 5,
            });
            // Force handshake via helper after start begins.
            const startPromise = wallRuntime.start();
            queueMicrotask(() => {
                for (const listener of silentListeners.get('message') ?? []) {
                    // start posts handshake event; acknowledge manually
                }
                wallRuntime.acknowledgeHandshake();
            });
            await startPromise;
            const pending = wallRuntime.callPlugin('plugin.ping', {}, { deadlineMs: 15 });
            await vi.advanceTimersByTimeAsync(15);
            await expect(pending).resolves.toMatchObject({
                ok: false,
                code: 'deadline-exceeded',
            });
            wallRuntime.dispose();
        } finally {
            vi.useRealTimers();
        }

        runtime.dispose();
    });

    it('deny-by-default fs/env/network policies block adversarial access', async () => {
        expect(checkFsReadPolicy(DENY_ALL_SERVER_POLICIES, '/etc/passwd')).toMatchObject({
            allowed: false,
        });
        expect(checkEnvPolicy(DENY_ALL_SERVER_POLICIES, 'OR3_BASIC_AUTH_JWT_SECRET')).toMatchObject(
            {
                allowed: false,
            }
        );
        expect(
            checkNetworkPolicy(DENY_ALL_SERVER_POLICIES, 'https://evil.test/x')
        ).toMatchObject({ allowed: false });

        const fake = createFakeSpawn();
        const runtime = new IsolatedServerRuntime({
            pluginId: 'iso.server',
            workspaceId: 'ws-1',
            generation: 1,
            modulePath: '/tmp/plugin/server.mjs',
            grants: grants(),
            spawn: fake.spawn,
            services: {},
            policies: DENY_ALL_SERVER_POLICIES,
        });
        await runtime.start();

        for (const [id, method, params] of [
            ['fs-1', 'policy.fs.read', { path: '/etc/passwd' }],
            ['env-1', 'policy.env.get', { key: 'OR3_BASIC_AUTH_JWT_SECRET' }],
            ['net-1', 'policy.network.fetch', { url: 'https://evil.test' }],
        ] as const) {
            fake.emit(
                serializeRpcEnvelope(
                    createRpcRequest({
                        id,
                        method,
                        params,
                    })
                )
            );
            await vi.waitFor(() => {
                expect(
                    fake.inbox.some(
                        (e) =>
                            e.kind === 'error' &&
                            e.id === id &&
                            (e.code === 'policy-denied' || e.code === 'grant-denied' || e.code === 'internal')
                    )
                ).toBe(true);
            });
        }

        runtime.dispose();
    });

    it('bridges approved server SDK services with host-bound workspace identity', async () => {
        const fake = createFakeSpawn();
        let seenWorkspace: string | undefined;
        let seenPlugin: string | undefined;
        const runtime = new IsolatedServerRuntime({
            pluginId: 'iso.server',
            workspaceId: 'ws-host',
            generation: 3,
            modulePath: '/tmp/plugin/server.mjs',
            grants: grants(['storage.read']),
            spawn: fake.spawn,
            services: {
                storage: {
                    get: (_params, context) => {
                        seenWorkspace = context.workspaceId;
                        seenPlugin = context.pluginId;
                        return { value: 'ok' };
                    },
                },
            },
        });
        await runtime.start();

        fake.emit(
            serializeRpcEnvelope(
                createRpcRequest({
                    id: 'sdk-1',
                    method: 'storage.get',
                    params: { key: 'a' },
                    pluginId: 'spoofed',
                })
            )
        );
        await vi.waitFor(() => {
            expect(seenWorkspace).toBe('ws-host');
            expect(seenPlugin).toBe('iso.server');
        });

        runtime.setGrants(grants([]));
        fake.emit(
            serializeRpcEnvelope(
                createRpcRequest({
                    id: 'sdk-2',
                    method: 'storage.get',
                    params: { key: 'a' },
                })
            )
        );
        await vi.waitFor(() => {
            expect(
                fake.inbox.some(
                    (e) =>
                        e.kind === 'error' &&
                        e.id === 'sdk-2' &&
                        e.code === 'grant-denied'
                )
            ).toBe(true);
        });

        runtime.dispose();
    });

    it('escape/resource suite covers threat-model controls', async () => {
        const fake = createFakeSpawn();
        const runtime = new IsolatedServerRuntime({
            pluginId: 'iso.server',
            workspaceId: 'ws-1',
            generation: 1,
            modulePath: '/tmp/plugin/server.mjs',
            grants: grants(),
            spawn: fake.spawn,
            services: {},
            policies: {
                fs: { allowedReadPaths: ['/tmp/plugin-data'], allowedWritePaths: [] },
                env: { allowedKeys: ['PLUGIN_PUBLIC_FLAG'] },
                network: {
                    allowedHosts: ['api.example.com'],
                    allowedProtocols: ['https:'],
                },
            },
        });
        await runtime.start();

        expect(
            checkFsReadPolicy(runtime.policies, '/tmp/plugin-data/x.json')
        ).toEqual({ allowed: true });
        expect(checkFsReadPolicy(runtime.policies, '/etc/passwd')).toMatchObject({
            allowed: false,
        });
        expect(checkEnvPolicy(runtime.policies, 'PLUGIN_PUBLIC_FLAG')).toEqual({
            allowed: true,
        });
        expect(checkEnvPolicy(runtime.policies, 'OR3_ADMIN_PASSWORD')).toMatchObject({
            allowed: false,
        });
        expect(
            checkNetworkPolicy(runtime.policies, 'https://api.example.com/v1')
        ).toEqual({ allowed: true });
        expect(
            checkNetworkPolicy(runtime.policies, 'http://api.example.com/v1')
        ).toMatchObject({ allowed: false });

        fake.emit(
            serializeRpcEnvelope(
                createRpcRequest({
                    id: 'mem-1',
                    method: 'runtime.account',
                    params: { memoryBytes: runtime.budgets.memoryBytes + 1 },
                })
            )
        );
        await vi.waitFor(() => {
            expect(
                fake.inbox.some(
                    (e) =>
                        e.kind === 'error' &&
                        e.id === 'mem-1' &&
                        e.code === 'budget-exceeded'
                )
            ).toBe(true);
        });

        expect(runtime.active).toBe(true);
        runtime.dispose();
    });
});
