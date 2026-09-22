import { describe, expect, it, vi } from 'vitest';
import type { PluginGrantReviewSnapshot } from '../../grant-review';
import {
    createRpcRequest,
    type RpcEnvelope,
} from '../rpc-envelope';
import { HostRpcBroker } from '../host-rpc-broker';

function grants(
    approved: readonly string[] = ['storage.read']
): PluginGrantReviewSnapshot {
    return {
        requestedGrants: [...approved, 'storage.write'],
        approvedGrants: [...approved],
        revision: 'grants-1',
        status: 'current',
        authoritySha256: null,
        packageDigest: null,
    };
}

describe('host-rpc-broker (8.3)', () => {
    it('uses host-bound plugin identity and ignores plugin-supplied identity', async () => {
        const sent: RpcEnvelope[] = [];
        let seenPluginId: string | undefined;
        const broker = new HostRpcBroker({
            pluginId: 'host.plugin',
            workspaceId: 'ws-1',
            generation: 2,
            grants: grants(['storage.read']),
            send: (envelope) => {
                sent.push(envelope);
            },
            methods: [
                {
                    method: 'storage.get',
                    grant: 'storage.read',
                    handler: (_params, context) => {
                        seenPluginId = context.pluginId;
                        return { value: 'ok' };
                    },
                },
            ],
        });

        await broker.receive(
            createRpcRequest({
                id: 'req-1',
                method: 'storage.get',
                params: { key: 'a' },
                pluginId: 'spoofed.attacker',
            })
        );

        expect(seenPluginId).toBe('host.plugin');
        expect(sent).toEqual([
            expect.objectContaining({
                kind: 'response',
                id: 'req-1',
                ok: true,
                result: { value: 'ok' },
            }),
        ]);
    });

    it('fails ungranted methods before the handler runs', async () => {
        const sent: RpcEnvelope[] = [];
        const handler = vi.fn(() => ({ value: 'should-not-run' }));
        const broker = new HostRpcBroker({
            pluginId: 'host.plugin',
            workspaceId: 'ws-1',
            generation: 1,
            grants: grants([]),
            send: (envelope) => {
                sent.push(envelope);
            },
            methods: [
                {
                    method: 'storage.get',
                    grant: 'storage.read',
                    handler,
                },
            ],
        });

        const outcome = await broker.receive(
            createRpcRequest({
                id: 'req-2',
                method: 'storage.get',
                params: {},
                pluginId: 'spoofed',
            })
        );

        expect(handler).not.toHaveBeenCalled();
        expect(outcome).toMatchObject({ status: 'rejected', code: 'grant-denied' });
        expect(sent[0]).toMatchObject({
            kind: 'error',
            code: 'grant-denied',
            details: {
                hostPluginId: 'host.plugin',
                suppliedPluginId: 'spoofed',
            },
        });
    });

    it('stops subsequent calls after grant revocation', async () => {
        const broker = new HostRpcBroker({
            pluginId: 'host.plugin',
            workspaceId: 'ws-1',
            generation: 1,
            grants: grants(['storage.read']),
            send: () => {},
            methods: [
                {
                    method: 'storage.get',
                    grant: 'storage.read',
                    handler: () => ({ value: 1 }),
                },
            ],
        });

        await expect(
            broker.receive(
                createRpcRequest({
                    id: 'req-ok',
                    method: 'storage.get',
                    params: {},
                })
            )
        ).resolves.toMatchObject({ status: 'handled' });

        broker.setGrants(grants([]));
        await expect(
            broker.receive(
                createRpcRequest({
                    id: 'req-denied',
                    method: 'storage.get',
                    params: {},
                })
            )
        ).resolves.toMatchObject({ status: 'rejected', code: 'grant-denied' });
    });

    it('round-trips SDK-domain handler errors with codes and safe details', async () => {
        const sent: RpcEnvelope[] = [];
        const broker = new HostRpcBroker({
            pluginId: 'host.plugin',
            workspaceId: 'ws-1',
            generation: 1,
            grants: grants(['storage.read', 'storage.write']),
            send: (envelope) => {
                sent.push(envelope);
            },
            methods: [
                {
                    method: 'storage.set',
                    grant: 'storage.write',
                    handler: (params) => {
                        const code = params.code;
                        if (typeof code !== 'string') return { ok: true };
                        throw Object.assign(new Error(`${code} from handler`), {
                            rpcCode: code,
                            details: { expectedRevision: 7 },
                        });
                    },
                },
            ],
        });

        for (const code of ['conflict', 'invalid-input', 'locked', 'stale-context']) {
            sent.length = 0;
            await expect(
                broker.receive(
                    createRpcRequest({
                        id: `req-${code}`,
                        method: 'storage.set',
                        params: { code },
                    })
                )
            ).resolves.toMatchObject({ status: 'rejected', code });
            expect(sent[0]).toMatchObject({
                kind: 'error',
                code,
                details: { expectedRevision: 7 },
            });
        }
    });

    it('degrades unknown handler error codes to internal and drops unsafe details', async () => {
        const sent: RpcEnvelope[] = [];
        const broker = new HostRpcBroker({
            pluginId: 'host.plugin',
            workspaceId: 'ws-1',
            generation: 1,
            grants: grants(['storage.read', 'storage.write']),
            send: (envelope) => {
                sent.push(envelope);
            },
            methods: [
                {
                    method: 'storage.set',
                    grant: 'storage.write',
                    handler: () => {
                        throw Object.assign(new Error('boom'), {
                            rpcCode: 'not-a-wire-code',
                            details: ['not', 'an', 'object'],
                        });
                    },
                },
            ],
        });

        await expect(
            broker.receive(
                createRpcRequest({ id: 'req-unknown', method: 'storage.set', params: {} })
            )
        ).resolves.toMatchObject({ status: 'rejected', code: 'internal' });
        expect(sent[0]).toMatchObject({ kind: 'error', code: 'internal' });
        expect(sent[0]).not.toMatchObject({ details: expect.anything() });
    });

    it('rejects unknown methods and replayed ids', async () => {
        const broker = new HostRpcBroker({
            pluginId: 'host.plugin',
            workspaceId: 'ws-1',
            generation: 1,
            grants: grants(['storage.read']),
            send: () => {},
            methods: [
                {
                    method: 'storage.get',
                    grant: 'storage.read',
                    handler: () => null,
                },
            ],
        });

        await expect(
            broker.receive(
                createRpcRequest({
                    id: 'req-x',
                    method: 'evil.eval',
                    params: {},
                })
            )
        ).resolves.toMatchObject({ status: 'rejected', code: 'unknown-method' });

        await broker.receive(
            createRpcRequest({
                id: 'req-replay',
                method: 'storage.get',
                params: {},
            })
        );
        await expect(
            broker.receive(
                createRpcRequest({
                    id: 'req-replay',
                    method: 'storage.get',
                    params: {},
                })
            )
        ).resolves.toMatchObject({ status: 'rejected', code: 'replay' });
    });
});

describe('RPC completion during cancellation', () => {
    it.each([false, true])('only acknowledges completed mutations (committed=%s)', async (committed) => {
        const sent: RpcEnvelope[] = [];
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const broker = new HostRpcBroker({
            pluginId: 'p', workspaceId: 'w', generation: 1,
            grants: grants(['storage.read', 'storage.write']),
            send: (envelope) => { sent.push(envelope); },
            methods: [{ method: 'storage.set', grant: 'storage.write', handler: async (_params, context) => {
                if (committed) context.markCommitted?.();
                await gate;
                return { ok: true };
            } }],
        });
        const pending = broker.receive(createRpcRequest({ id: 'pending', method: 'storage.set', params: {} }));
        await broker.dispatch({ v: 1, kind: 'cancel', id: 'pending', reason: 'cancelled' });
        release();
        await pending;
        expect(sent.at(-1)).toMatchObject(committed ? { kind: 'response' } : { kind: 'error', code: 'cancelled' });
        broker.dispose();
    });

    it.each(['revocation', 'cancel'] as const)('keeps pending work charged after %s', async (reason) => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        let signal!: AbortSignal;
        const sent: RpcEnvelope[] = [];
        const broker = new HostRpcBroker({
            pluginId: 'p', workspaceId: 'w', generation: 1, maxInFlight: 1,
            grants: grants(['storage.write']), send: (event) => { sent.push(event); },
            methods: [{ method: 'storage.set', grant: 'storage.write', handler: async (_params, context) => {
                signal = context.signal;
                await gate;
                context.signal.throwIfAborted();
                return {};
            } }],
        });
        const pending = broker.receive(createRpcRequest({ id: 'one', method: 'storage.set', params: {} }));
        if (reason === 'revocation') broker.setGrants(grants([]));
        else await broker.dispatch({ v: 1, kind: 'cancel', id: 'one' });
        expect(signal.aborted).toBe(true);
        expect(broker.inFlightCount).toBe(1);
        await expect(broker.receive(createRpcRequest({ id: 'two', method: 'storage.set', params: {} })))
            .resolves.toMatchObject({ status: 'rejected', code: 'backpressure' });
        release();
        await pending;
        expect(sent.at(-1)).toMatchObject({ kind: 'error', code: 'cancelled' });
        expect(broker.inFlightCount).toBe(0);
        broker.dispose();
    });

    it('rejects a read that finishes after its deadline', async () => {
        vi.useFakeTimers();
        try {
            const sent: RpcEnvelope[] = [];
            let release!: () => void;
            const gate = new Promise<void>((resolve) => { release = resolve; });
            const broker = new HostRpcBroker({
                pluginId: 'p', workspaceId: 'w', generation: 1, grants: grants(),
                send: (envelope) => { sent.push(envelope); },
                methods: [{ method: 'storage.get', grant: 'storage.read', handler: async () => { await gate; return { value: 'late' }; } }],
            });
            const pending = broker.receive(createRpcRequest({ id: 'late', method: 'storage.get', params: {}, deadlineMs: 5 }));
            await vi.advanceTimersByTimeAsync(6);
            release();
            await pending;
            expect(sent.at(-1)).toMatchObject({ kind: 'error', code: 'deadline-exceeded' });
            broker.dispose();
        } finally { vi.useRealTimers(); }
    });
});
