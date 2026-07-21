import { describe, expect, it } from 'vitest';
import {
    createRpcCancel,
    createRpcError,
    createRpcEvent,
    createRpcRequest,
    createRpcResponse,
    parseRpcEnvelope,
    RPC_ENVELOPE_VERSION,
    RPC_MAX_MESSAGE_BYTES,
    serializeRpcEnvelope,
} from '../rpc-envelope';

describe('rpc-envelope (8.1)', () => {
    it('parses each message kind', () => {
        const fixtures = [
            createRpcRequest({ id: 'req-1', method: 'storage.get', params: { key: 'a' } }),
            createRpcResponse({ id: 'req-1', result: { value: 1 } }),
            createRpcError({ id: 'req-1', code: 'grant-denied', message: 'nope' }),
            createRpcEvent({ id: 'evt-1', name: 'hooks.fired', payload: { hook: 'x' } }),
            createRpcCancel({ id: 'req-1', reason: 'user' }),
        ];
        for (const envelope of fixtures) {
            const parsed = parseRpcEnvelope(envelope);
            expect(parsed.ok).toBe(true);
            if (parsed.ok) {
                expect(parsed.envelope.v).toBe(RPC_ENVELOPE_VERSION);
                expect(parsed.envelope.kind).toBe(envelope.kind);
            }
        }
    });

    it('rejects unknown versions', () => {
        const parsed = parseRpcEnvelope({
            v: 99,
            kind: 'request',
            id: 'req-1',
            method: 'storage.get',
            params: {},
        });
        expect(parsed).toEqual({
            ok: false,
            code: 'unknown-version',
            message: 'Unsupported RPC envelope version: 99',
        });
    });

    it('rejects malformed IDs', () => {
        for (const id of ['', 'has space', 'bad/id', 'x'.repeat(129)]) {
            const parsed = parseRpcEnvelope({
                v: 1,
                kind: 'request',
                id,
                method: 'storage.get',
                params: {},
            });
            expect(parsed.ok).toBe(false);
            if (!parsed.ok) {
                expect(parsed.code).toBe('malformed-id');
            }
        }
    });

    it('rejects invalid payloads', () => {
        expect(
            parseRpcEnvelope({
                v: 1,
                kind: 'request',
                id: 'req-1',
                method: '',
                params: {},
            }).ok
        ).toBe(false);
        expect(
            parseRpcEnvelope({
                v: 1,
                kind: 'request',
                id: 'req-1',
                method: 'storage.get',
                params: [],
            }).ok
        ).toBe(false);
        expect(
            parseRpcEnvelope({
                v: 1,
                kind: 'response',
                id: 'req-1',
                ok: false,
                result: null,
            }).ok
        ).toBe(false);
        expect(parseRpcEnvelope(null).ok).toBe(false);
        expect(parseRpcEnvelope('not-json{').ok).toBe(false);
    });

    it('rejects oversized messages', () => {
        const huge = 'x'.repeat(RPC_MAX_MESSAGE_BYTES + 1);
        const parsed = parseRpcEnvelope(huge);
        expect(parsed).toMatchObject({ ok: false, code: 'oversized' });

        const envelope = createRpcRequest({
            id: 'req-1',
            method: 'storage.set',
            params: { key: 'a', value: 'y'.repeat(1000) },
        });
        const serialized = serializeRpcEnvelope(envelope);
        expect(
            parseRpcEnvelope(envelope, {
                serialized,
                maxBytes: 100,
            })
        ).toMatchObject({ ok: false, code: 'oversized' });
    });
});
