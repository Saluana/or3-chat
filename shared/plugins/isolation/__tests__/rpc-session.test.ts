import { describe, expect, it, vi } from 'vitest';
import {
    createRpcError,
    createRpcResponse,
    type RpcEnvelope,
} from '../rpc-envelope';
import { RpcSession } from '../rpc-session';

describe('rpc-session (8.2)', () => {
    it('correlates responses to requests', async () => {
        const sent: RpcEnvelope[] = [];
        const session = new RpcSession({
            send: (envelope) => {
                sent.push(envelope);
                if (envelope.kind === 'request') {
                    queueMicrotask(() => {
                        session.receive(
                            createRpcResponse({
                                id: envelope.id,
                                result: { ok: true, method: envelope.method },
                            })
                        );
                    });
                }
            },
            generateId: () => 'fixed-1',
        });

        const result = await session.call('storage.get', { key: 'k' });
        expect(result).toEqual({
            ok: true,
            result: { ok: true, method: 'storage.get' },
        });
        expect(sent).toHaveLength(1);
        expect(session.inFlightCount).toBe(0);
    });

    it('times out when the deadline elapses', async () => {
        vi.useFakeTimers();
        try {
            const session = new RpcSession({
                send: () => {},
                defaultDeadlineMs: 50,
                generateId: () => 'deadline-1',
            });
            const pending = session.call('storage.get', {});
            await vi.advanceTimersByTimeAsync(50);
            await expect(pending).resolves.toMatchObject({
                ok: false,
                code: 'deadline-exceeded',
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it('cancels an in-flight request', async () => {
        const sent: RpcEnvelope[] = [];
        const session = new RpcSession({
            send: (envelope) => {
                sent.push(envelope);
            },
            generateId: () => 'cancel-1',
            defaultDeadlineMs: 10_000,
        });
        const pending = session.call('storage.get', {});
        expect(session.cancel('cancel-1', 'stop')).toBe(true);
        await expect(pending).resolves.toEqual({
            ok: false,
            code: 'cancelled',
            message: 'stop',
        });
        expect(sent.some((e) => e.kind === 'cancel')).toBe(true);
    });

    it('rejects duplicate/replayed request ids', async () => {
        const session = new RpcSession({
            send: () => {},
            generateId: () => 'dup-1',
            defaultDeadlineMs: 10_000,
        });
        void session.call('storage.get', {});
        await expect(session.call('storage.get', {})).resolves.toMatchObject({
            ok: false,
            code: 'replay',
        });
        expect(session.rememberInboundId('inbound-1')).toBe('accepted');
        expect(session.rememberInboundId('inbound-1')).toBe('replay');
    });

    it('ignores late responses after settle', async () => {
        vi.useFakeTimers();
        try {
            const session = new RpcSession({
                send: () => {},
                defaultDeadlineMs: 10,
                generateId: () => 'late-1',
            });
            const pending = session.call('storage.get', {});
            await vi.advanceTimersByTimeAsync(10);
            await expect(pending).resolves.toMatchObject({
                ok: false,
                code: 'deadline-exceeded',
            });
            session.receive(
                createRpcResponse({ id: 'late-1', result: { sneaky: true } })
            );
            expect(session.isReplay('late-1')).toBe(true);
            expect(session.inFlightCount).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('applies backpressure when in-flight limit is reached', async () => {
        const session = new RpcSession({
            send: () => {},
            maxInFlight: 1,
            defaultDeadlineMs: 10_000,
            generateId: (() => {
                let n = 0;
                return () => `bp-${++n}`;
            })(),
        });
        void session.call('storage.get', {});
        await expect(session.call('storage.set', { key: 'a' })).resolves.toMatchObject({
            ok: false,
            code: 'backpressure',
        });
    });

    it('surfaces remote error envelopes', async () => {
        const session = new RpcSession({
            send: (envelope) => {
                if (envelope.kind === 'request') {
                    queueMicrotask(() => {
                        session.receive(
                            createRpcError({
                                id: envelope.id,
                                code: 'grant-denied',
                                message: 'no grant',
                            })
                        );
                    });
                }
            },
            generateId: () => 'err-1',
        });
        await expect(session.call('storage.get', {})).resolves.toEqual({
            ok: false,
            code: 'grant-denied',
            message: 'no grant',
        });
    });
});
