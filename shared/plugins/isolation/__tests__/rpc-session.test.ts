import { describe, expect, it } from 'vitest';
import {
    createRpcError,
    createRpcResponse,
} from '../rpc-envelope';
import { RpcSession } from '../rpc-session';

describe('rpc-session (8.2)', () => {
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

    it('prunes completed outbound ids after the replay window', async () => {
        let now = 0;
        const session = new RpcSession({
            now: () => now,
            send: (envelope) => {
                if (envelope.kind === 'request') {
                    queueMicrotask(() => {
                        session.receive(
                            createRpcResponse({ id: envelope.id, result: true })
                        );
                    });
                }
            },
        });

        await expect(
            session.call('storage.get', {}, { id: 'reusable' })
        ).resolves.toMatchObject({ ok: true });
        await expect(
            session.call('storage.get', {}, { id: 'reusable' })
        ).resolves.toMatchObject({ ok: false, code: 'replay' });

        now = 60_001;
        await expect(
            session.call('storage.get', {}, { id: 'reusable' })
        ).resolves.toMatchObject({ ok: true });
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
