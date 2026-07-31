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
