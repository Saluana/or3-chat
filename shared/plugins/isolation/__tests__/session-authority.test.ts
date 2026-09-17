import { describe, expect, it, vi } from 'vitest';
import type { PluginGrantReviewSnapshot } from '../../grant-review';
import {
    HostRpcBroker,
    type HostRpcMethodSpec,
} from '../host-rpc-broker';
import {
    createRpcRequest,
    parseRpcEnvelope,
    serializeRpcEnvelope,
    type RpcEnvelope,
} from '../rpc-envelope';
import {
    HostSessionAuthority,
    stripCallerSuppliedIdentity,
} from '../session-authority';

function grants(
    approved: readonly string[] = ['storage.read', 'storage.write']
): PluginGrantReviewSnapshot {
    return {
        requestedGrants: [...approved],
        approvedGrants: [...approved],
        revision: 'g1',
        status: 'current',
    };
}

function createAuthority(overrides: Partial<{
    generation: number;
    now: () => number;
}> = {}) {
    let clock = 1_000;
    return new HostSessionAuthority({
        pluginId: 'host.owned.plugin',
        workspaceId: 'ws_host',
        generation: overrides.generation ?? 4,
        sourceId: 'src_host_1',
        sessionTtlMs: 1_000,
        now: overrides.now ?? (() => clock),
        generateSessionId: (pluginId, generation) => `${pluginId}-${generation}-fixed`,
    });
}

function createBroker(options: {
    authority: HostSessionAuthority;
    handler?: HostRpcMethodSpec['handler'];
    inbox: RpcEnvelope[];
    requireHostSession?: boolean;
}) {
    const handler =
        options.handler ??
        (async () => ({ ok: true }));
    return new HostRpcBroker({
        pluginId: 'host.owned.plugin',
        workspaceId: 'ws_host',
        generation: 4,
        grants: grants(),
        methods: [{ method: 'storage.get', grant: 'storage.read', handler }],
        send: (envelope) => options.inbox.push(envelope),
        requireHostSession: options.requireHostSession ?? true,
        verifyInbound: (request) =>
            options.authority.verifyInbound({
                sessionId: request.sessionId,
                sourceId: request.sourceId,
                generation: request.generation,
            }),
    });
}

describe('host session authority (4.2)', () => {
    it('mints host-owned identity and echo fields the sandbox cannot choose', () => {
        const authority = createAuthority();
        expect(authority.current).toMatchObject({
            pluginId: 'host.owned.plugin',
            workspaceId: 'ws_host',
            generation: 4,
            sourceId: 'src_host_1',
        });
        expect(authority.echoFields).toEqual({
            sessionId: 'host.owned.plugin-4-fixed',
            sourceId: 'src_host_1',
            generation: 4,
        });
        expect(Object.isFrozen(authority.current)).toBe(true);
    });

    it('accepts only the current session, source and generation', () => {
        const authority = createAuthority();
        const session = authority.echoFields;

        expect(
            authority.verifyInbound({ ...session, origin: 'https://cloud.example' })
        ).toMatchObject({ status: 'authorized' });

        expect(
            authority.verifyInbound({ ...session, sourceId: 'src_other' })
        ).toMatchObject({ status: 'denied', code: 'source-mismatch' });

        expect(
            authority.verifyInbound({ ...session, generation: 3 })
        ).toMatchObject({ status: 'denied', code: 'generation-stale' });

        expect(
            authority.verifyInbound({ ...session, sessionId: 'forged-session' })
        ).toMatchObject({ status: 'denied', code: 'session-unknown' });

        expect(authority.verifyInbound({ sourceId: 'src_host_1' })).toMatchObject({
            status: 'denied',
            code: 'session-missing',
        });

        expect(
            authority.verifyInbound({ ...session, generation: undefined })
        ).toMatchObject({ status: 'denied', code: 'generation-unknown' });
    });

    it('treats origin=null as unverified on its own (RT11)', () => {
        const authority = createAuthority();
        const session = authority.echoFields;

        // A correct session proof from an opaque origin is authorized ...
        expect(
            authority.verifyInbound({ ...session, origin: null })
        ).toMatchObject({ status: 'authorized' });

        // ... but an opaque-origin message without a session is denied.
        expect(
            authority.verifyInbound({
                sessionId: undefined,
                sourceId: 'src_host_1',
                generation: 4,
                origin: null,
            })
        ).toMatchObject({ status: 'denied', code: 'session-missing' });
    });

    it('invalidates immediately on disable/update/workspace switch (RT09)', () => {
        const authority = createAuthority();
        const before = authority.echoFields;
        expect(authority.verifyInbound(before)).toMatchObject({ status: 'authorized' });

        authority.invalidate('plugin disabled');
        expect(authority.verifyInbound(before)).toMatchObject({
            status: 'denied',
            code: 'session-invalidated',
        });

        const rotated = authority.rotateGeneration(5);
        expect(rotated.generation).toBe(5);
        expect(authority.verifyInbound(before)).toMatchObject({
            status: 'denied',
            code: 'session-unknown',
        });
        expect(authority.verifyInbound(authority.echoFields)).toMatchObject({
            status: 'authorized',
        });
    });

    it('expires sessions', () => {
        let clock = 1_000;
        const authority = createAuthority({ now: () => clock });
        const session = authority.echoFields;
        clock += 1_001;
        expect(authority.verifyInbound(session)).toMatchObject({
            status: 'denied',
            code: 'session-expired',
        });
    });

    it('denies forged and stale broker calls with no handler side effects (RT06, RT09)', async () => {
        const authority = createAuthority();
        const handler = vi.fn(async () => ({ value: 'secret' }));
        const inbox: RpcEnvelope[] = [];
        const broker = createBroker({ authority, handler, inbox });

        // Forged plugin identity in arguments and on the wire is ignored.
        const forged = createRpcRequest({
            id: 'req-1',
            method: 'storage.get',
            params: {
                pluginId: 'other.plugin',
                workspaceId: 'ws_other',
                userId: 'someone-else',
            },
            pluginId: 'other.plugin',
        });
        const forgedOutcome = await broker.dispatch(forged);
        expect(forgedOutcome).toMatchObject({
            status: 'rejected',
            code: 'session-missing',
        });
        const errorEnvelope = inbox.find(
            (envelope) => envelope.kind === 'error'
        ) as Extract<RpcEnvelope, { kind: 'error' }>;
        expect(errorEnvelope.details).toMatchObject({ authority: 'session-missing' });
        expect(handler).not.toHaveBeenCalled();

        // The rotated-away session is no longer accepted at all ...
        const oldSession = authority.echoFields;
        authority.rotateGeneration(5);
        const stale = createRpcRequest({
            id: 'req-2',
            method: 'storage.get',
            params: {},
            ...oldSession,
        });
        const staleOutcome = await broker.dispatch(stale);
        expect(staleOutcome).toMatchObject({
            status: 'rejected',
            code: 'session-unknown',
        });
        expect(handler).not.toHaveBeenCalled();

        // ... and a current session claiming an older generation is stale.
        const staleGeneration = createRpcRequest({
            id: 'req-2b',
            method: 'storage.get',
            params: {},
            ...authority.echoFields,
            generation: 4,
        });
        const staleGenerationOutcome = await broker.dispatch(staleGeneration);
        expect(staleGenerationOutcome).toMatchObject({
            status: 'rejected',
            code: 'generation-stale',
        });
        expect(handler).not.toHaveBeenCalled();

        // The current session succeeds and reaches the handler once.
        const current = createRpcRequest({
            id: 'req-3',
            method: 'storage.get',
            params: { key: 'a' },
            ...authority.echoFields,
        });
        const currentOutcome = await broker.dispatch(current);
        expect(currentOutcome).toMatchObject({ status: 'handled' });
        expect(handler).toHaveBeenCalledTimes(1);

        broker.dispose();
    });

    it('requires host-issued session fields when configured', async () => {
        const authority = createAuthority();
        const handler = vi.fn(async () => ({}));
        const inbox: RpcEnvelope[] = [];
        const broker = createBroker({
            authority,
            handler,
            inbox,
            requireHostSession: true,
        });
        const outcome = await broker.dispatch(
            createRpcRequest({ id: 'req-legacy', method: 'storage.get', params: {} })
        );
        expect(outcome).toMatchObject({
            status: 'rejected',
            code: 'session-missing',
        });
        expect(handler).not.toHaveBeenCalled();
        broker.dispose();
    });

    it('denies missing session fields on a host with no authority object', async () => {
        const handler = vi.fn(async () => ({}));
        const inbox: RpcEnvelope[] = [];
        const broker = new HostRpcBroker({
            pluginId: 'host.owned.plugin',
            workspaceId: 'ws_host',
            generation: 4,
            grants: grants(),
            methods: [{ method: 'storage.get', grant: 'storage.read', handler }],
            send: (envelope) => inbox.push(envelope),
            requireHostSession: true,
        });
        const outcome = await broker.dispatch(
            createRpcRequest({ id: 'req-no-auth', method: 'storage.get', params: {} })
        );
        expect(outcome).toMatchObject({ status: 'rejected', code: 'policy-denied' });
        expect(handler).not.toHaveBeenCalled();
        broker.dispose();
    });

    it('propagates host session echo fields over the wire unchanged', () => {
        const authority = createAuthority();
        const request = createRpcRequest({
            id: 'req-echo',
            method: 'storage.get',
            params: { key: 'x' },
            ...authority.echoFields,
        });
        const roundTrip = parseRpcEnvelope(serializeRpcEnvelope(request));
        expect(roundTrip.ok).toBe(true);
        if (!roundTrip.ok || roundTrip.envelope.kind !== 'request') return;
        expect(roundTrip.envelope).toMatchObject(authority.echoFields);
    });

    it('strips caller-supplied identity from parameters but keeps opaque handles', () => {
        const stripped = stripCallerSuppliedIdentity(
            createRpcRequest({
                id: 'req-strip',
                method: 'documents.read',
                params: {
                    workspaceId: 'ws_other',
                    pluginId: 'other.plugin',
                    userId: 'someone-else',
                    connectionRef: 'orc_1_r2',
                    key: 'keep-me',
                },
                pluginId: 'other.plugin',
            })
        );
        expect(stripped.params).toEqual({
            connectionRef: 'orc_1_r2',
            key: 'keep-me',
        });
        expect(stripped.pluginId).toBeUndefined();
    });
});
