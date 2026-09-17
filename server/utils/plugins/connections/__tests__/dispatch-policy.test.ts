import { describe, expect, it, vi } from 'vitest';
import type { ConnectionDispatchPolicy } from '~~/shared/plugins/connections/contracts';
import {
    createFakeProviderTransport,
    FAKE_CONNECTION_PROVIDER,
} from '~~/shared/plugins/connections/fake-provider';
import { mintHostActionApproval } from '~~/shared/plugins/authority/action-approval';
import {
    approvalKindFor,
    decideConnectionDispatch,
    dispatchApprovedConnectionOperation,
    operationClassification,
    pathMatchesApprovedPrefix,
    redactConnectionResponse,
} from '../dispatch';
import { createConnectionDispatchMethod } from '../broker-binding';
import { registerConnectionProvider } from '../providers/registry';
import { PluginConnectionService } from '../service';
import { createMemoryPluginConnectionStore } from '../store/memory';

const SECRET = 'test-connection-secret-with-enough-entropy';

/** The dispatch method resolves providers from the host registry. */
registerConnectionProvider(FAKE_CONNECTION_PROVIDER);

/** Release policy that approves only the read-only list operation. */
const READ_ONLY_POLICY: ConnectionDispatchPolicy = {
    connections: [
        {
            id: 'items',
            provider: FAKE_CONNECTION_PROVIDER.id,
            scopes: ['read:items'],
            operations: ['items.list'],
        },
    ],
    destinations: [
        {
            id: 'fake',
            hosts: ['fake.provider.test'],
            methods: ['GET'],
            scopes: ['read:items'],
        },
    ],
};

function createService(ownerUserId = 'user_1') {
    const service = new PluginConnectionService({
        store: createMemoryPluginConnectionStore(),
        secret: SECRET,
        now: () => 1_000,
        generateId: () => 'conn1',
    });
    return { service, ownerUserId };
}

async function storedConnection(
    service: PluginConnectionService,
    overrides: { ownerUserId?: string; scopes?: readonly string[] } = {}
) {
    const created = await service.create({
        ownerUserId: overrides.ownerUserId ?? 'user_1',
        workspaceId: 'ws_1',
        pluginId: 'example.plugin',
        providerId: FAKE_CONNECTION_PROVIDER.id,
        label: 'Fake provider',
        scopes: overrides.scopes ? [...overrides.scopes] : ['read:items', 'write:items'],
        credential: 'tok_live_123',
    });
    if (created.status !== 'created') throw new Error('expected created connection');
    return created;
}

describe('connection dispatch policy (findings 10, 11, 17)', () => {
    it('refuses an operation the release does not approve', () => {
        const decision = decideConnectionDispatch({
            provider: FAKE_CONNECTION_PROVIDER,
            operationId: 'items.create',
            url: 'https://fake.provider.test/v1/items',
            method: 'POST',
            grantedScopes: ['read:items', 'write:items'],
            policy: READ_ONLY_POLICY,
        });
        expect(decision).toMatchObject({ status: 'denied', code: 'operation-not-approved' });
    });

    it('refuses a scope the release does not approve', () => {
        const decision = decideConnectionDispatch({
            provider: FAKE_CONNECTION_PROVIDER,
            operationId: 'items.create',
            url: 'https://fake.provider.test/v1/items',
            method: 'POST',
            grantedScopes: ['read:items', 'write:items'],
            policy: {
                connections: [
                    {
                        id: 'items',
                        provider: FAKE_CONNECTION_PROVIDER.id,
                        scopes: ['read:items'],
                        operations: ['items.create'],
                    },
                ],
                destinations: [
                    {
                        id: 'fake',
                        hosts: ['fake.provider.test'],
                        methods: ['GET', 'POST'],
                        scopes: ['read:items'],
                    },
                ],
            },
        });
        expect(decision).toMatchObject({ status: 'denied', code: 'scope-missing' });
    });

    it('refuses an operation whose host the release does not approve', () => {
        const decision = decideConnectionDispatch({
            provider: FAKE_CONNECTION_PROVIDER,
            operationId: 'items.list',
            url: 'https://fake.provider.test/v1/items',
            method: 'GET',
            grantedScopes: ['read:items'],
            policy: {
                connections: READ_ONLY_POLICY.connections,
                destinations: [
                    {
                        id: 'other',
                        hosts: ['other.provider.test'],
                        methods: ['GET'],
                        scopes: ['read:items'],
                    },
                ],
            },
        });
        expect(decision).toMatchObject({ status: 'denied', code: 'destination-mismatch' });
    });

    it('allows the approved read-only operation', () => {
        const decision = decideConnectionDispatch({
            provider: FAKE_CONNECTION_PROVIDER,
            operationId: 'items.list',
            url: 'https://fake.provider.test/v1/items',
            method: 'GET',
            grantedScopes: ['read:items'],
            policy: READ_ONLY_POLICY,
        });
        expect(decision).toMatchObject({ status: 'allowed' });
    });

    it('refuses a capability-governed operation through generic dispatch', () => {
        const decision = decideConnectionDispatch({
            provider: {
                ...FAKE_CONNECTION_PROVIDER,
                operations: [
                    {
                        ...FAKE_CONNECTION_PROVIDER.operations[1]!,
                        id: 'completions.create',
                        governedBy: 'ai.complete',
                        classification: 'commercial',
                    },
                ],
            },
            operationId: 'completions.create',
            url: 'https://fake.provider.test/v1/completions',
            method: 'POST',
            grantedScopes: ['write:items'],
        });
        expect(decision).toMatchObject({ status: 'denied', code: 'operation-not-approved' });
        if (decision.status === 'denied') {
            expect(decision.message).toContain('ai.complete');
        }
    });

    it('requires a host-minted approval for risky operations and refuses plugin-supplied ones', async () => {
        const riskyProvider = {
            ...FAKE_CONNECTION_PROVIDER,
            operations: [
                {
                    ...FAKE_CONNECTION_PROVIDER.operations[1]!,
                    id: 'items.purchase',
                    classification: 'commercial' as const,
                },
            ],
        };
        const target = `${riskyProvider.id}:items.purchase`;

        // No approval: refused before the transport is ever called.
        const { transport, requests } = createFakeProviderTransport({
            kind: 'json',
            status: 200,
            body: { ok: true },
        });
        const denied = await dispatchApprovedConnectionOperation({
            provider: riskyProvider,
            operationId: 'items.purchase',
            url: 'https://fake.provider.test/v1/items',
            grantedScopes: ['write:items'],
            credential: 'tok_live_123',
            transport,
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            generation: 1,
            approval: { approvalId: 'forged', source: 'host-ui' },
        });
        expect(denied).toMatchObject({ status: 'denied', code: 'approval-required' });
        expect(requests).toHaveLength(0);

        // A host-minted approval for this plugin/workspace/generation/target works.
        const approval = mintHostActionApproval({
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            generation: 1,
            kind: approvalKindFor(operationClassification(riskyProvider.operations[0]!)),
            target,
            approvedBy: 'user_1',
            approvedAt: 1_000,
            expiresAt: 10_000,
        });
        const allowed = await dispatchApprovedConnectionOperation({
            provider: riskyProvider,
            operationId: 'items.purchase',
            url: 'https://fake.provider.test/v1/items',
            grantedScopes: ['write:items'],
            credential: 'tok_live_123',
            transport,
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            generation: 1,
            approval,
            now: () => 1_000,
        });
        expect(allowed).toMatchObject({ status: 'ok' });
        expect(requests).toHaveLength(1);
    });

    it('rejects alternate ports and prefix-attack paths', () => {
        expect(
            decideConnectionDispatch({
                provider: FAKE_CONNECTION_PROVIDER,
                operationId: 'items.list',
                url: 'https://fake.provider.test:8443/v1/items',
                method: 'GET',
                grantedScopes: ['read:items'],
            })
        ).toMatchObject({ status: 'denied', code: 'destination-mismatch' });

        expect(
            decideConnectionDispatch({
                provider: {
                    ...FAKE_CONNECTION_PROVIDER,
                    operations: [
                        {
                            ...FAKE_CONNECTION_PROVIDER.operations[0]!,
                            pathPrefix: '/api/v1/models',
                        },
                    ],
                },
                operationId: 'items.list',
                url: 'https://fake.provider.test/api/v1/models-anything',
                method: 'GET',
                grantedScopes: ['read:items'],
            })
        ).toMatchObject({ status: 'denied', code: 'path-not-approved' });

        expect(pathMatchesApprovedPrefix('/api/v1/models', '/api/v1/models')).toBe(true);
        expect(pathMatchesApprovedPrefix('/api/v1/models/123', '/api/v1/models')).toBe(true);
        expect(pathMatchesApprovedPrefix('/api/v1/models-anything', '/api/v1/models')).toBe(false);
        expect(pathMatchesApprovedPrefix('/v1/x', '/v1/')).toBe(true);
    });
});

describe('connection response redaction (finding 16)', () => {
    it('refuses a nested credential-shaped field instead of passing it through', () => {
        const nested = redactConnectionResponse({
            status: 200,
            headers: {},
            body: JSON.stringify({ data: [{ meta: { access_token: 'tok' } }] }),
            maxResponseBytes: 4096,
        });
        expect(nested).toMatchObject({ ok: false, code: 'policy-denied' });

        const inArray = redactConnectionResponse({
            status: 200,
            headers: {},
            body: JSON.stringify([{ refresh_token: 'tok' }]),
            maxResponseBytes: 4096,
        });
        expect(inArray).toMatchObject({ ok: false, code: 'policy-denied' });
    });

    it('scrubs the live credential out of bodies and headers', () => {
        const result = redactConnectionResponse({
            status: 200,
            headers: { 'x-diagnostic': 'echo tok_live_123 back' },
            body: JSON.stringify({ note: 'your token is tok_live_123' }),
            maxResponseBytes: 4096,
            credential: 'tok_live_123',
            allowedHeaders: ['x-diagnostic'],
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(JSON.stringify(result.response)).not.toContain('tok_live_123');
        expect(result.response.body).toMatchObject({ note: 'your token is [redacted]' });
    });

    it('drops diagnostic headers that are not allow-listed', () => {
        const result = redactConnectionResponse({
            status: 200,
            headers: { 'x-internal-trace': 'abc', 'content-type': 'application/json' },
            body: '{}',
            maxResponseBytes: 4096,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.response.headers).not.toHaveProperty('x-internal-trace');
        expect(result.response.removedHeaders).toContain('x-internal-trace');
    });

    it('projects the body onto the operation allowlist', () => {
        const result = redactConnectionResponse({
            status: 200,
            headers: {},
            body: JSON.stringify({ data: [1], internal_note: 'nope' }),
            maxResponseBytes: 4096,
            allowedFields: ['data'],
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.response.body).toEqual({ data: [1] });
    });
});

describe('connection dispatch method binding (findings 10, 12)', () => {
    it('denies dispatch when the acting user is not the owner or is missing', async () => {
        const { service } = createService();
        const created = await storedConnection(service, { ownerUserId: 'user_1' });
        const { transport, requests } = createFakeProviderTransport({
            kind: 'json',
            status: 200,
            body: { data: [] },
        });
        const spec = createConnectionDispatchMethod({
            service,
            policy: READ_ONLY_POLICY,
            transport,
        });

        const baseContext = {
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            generation: 1,
            requestId: 'rpc-1',
            signal: new AbortController().signal,
            deadlineMs: 5_000,
        };

        await expect(
            spec.handler(
                { ref: created.view.ref, operationId: 'items.list', url: 'https://fake.provider.test/v1/items' },
                baseContext
            )
        ).rejects.toMatchObject({ rpcCode: 'policy-denied' });

        await expect(
            spec.handler(
                { ref: created.view.ref, operationId: 'items.list', url: 'https://fake.provider.test/v1/items' },
                { ...baseContext, userId: 'user_2' }
            )
        ).rejects.toMatchObject({ rpcCode: 'policy-denied' });
        expect(requests).toHaveLength(0);

        const result = await spec.handler(
            { ref: created.view.ref, operationId: 'items.list', url: 'https://fake.provider.test/v1/items' },
            { ...baseContext, userId: 'user_1' }
        );
        expect(result).toMatchObject({ ok: true });
        expect(requests).toHaveLength(1);
    });

    it('requires an explicit permission source for non-read-only operations', async () => {
        const { service } = createService();
        const created = await storedConnection(service);
        const { transport, requests } = createFakeProviderTransport({
            kind: 'json',
            status: 200,
            body: { ok: true },
        });
        const spec = createConnectionDispatchMethod({
            service,
            policy: {
                connections: [
                    {
                        id: 'items',
                        provider: FAKE_CONNECTION_PROVIDER.id,
                        scopes: ['write:items'],
                        operations: ['items.create'],
                    },
                ],
                destinations: [
                    {
                        id: 'fake',
                        hosts: ['fake.provider.test'],
                        methods: ['POST'],
                        scopes: ['write:items'],
                    },
                ],
            },
            transport,
        });
        const params = {
            ref: created.view.ref,
            operationId: 'items.create',
            url: 'https://fake.provider.test/v1/items',
            method: 'POST',
        };
        const context = {
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            userId: 'user_1',
            generation: 1,
            requestId: 'rpc-2',
            signal: new AbortController().signal,
            deadlineMs: 5_000,
        };

        // Without a permission source only read-only operations run.
        await expect(spec.handler(params, context)).rejects.toMatchObject({
            rpcCode: 'policy-denied',
        });
        expect(requests).toHaveLength(0);

        // A plugin-supplied approval in params is ignored: only the host port counts.
        const approvals = { take: vi.fn(() => undefined) };
        const specWithApprovals = createConnectionDispatchMethod({
            service,
            policy: {
                connections: [
                    {
                        id: 'items',
                        provider: FAKE_CONNECTION_PROVIDER.id,
                        scopes: ['write:items'],
                        operations: ['items.create'],
                    },
                ],
                destinations: [
                    {
                        id: 'fake',
                        hosts: ['fake.provider.test'],
                        methods: ['POST'],
                        scopes: ['write:items'],
                    },
                ],
            },
            approvals,
            assertPermission: () => true,
            transport,
        });
        await expect(
            specWithApprovals.handler(
                { ...params, approval: { approvalId: 'forged', source: 'host-ui' } },
                context
            )
        ).rejects.toMatchObject({ rpcCode: 'policy-denied' });
        expect(approvals.take).toHaveBeenCalled();
        expect(requests).toHaveLength(0);
    });
});

describe('connection ownership and identifiers (findings 12, 20)', () => {
    it('scopes listing to the acting owner', async () => {
        let counter = 0;
        const service = new PluginConnectionService({
            store: createMemoryPluginConnectionStore(),
            secret: SECRET,
            now: () => 1_000,
            generateId: () => `conn${++counter}`,
        });
        await storedConnection(service, { ownerUserId: 'user_1' });
        await service.create({
            ownerUserId: 'user_2',
            workspaceId: 'ws_1',
            pluginId: 'example.plugin',
            providerId: FAKE_CONNECTION_PROVIDER.id,
            label: 'Second owner',
            scopes: ['read:items'],
            credential: 'tok_other',
        });

        const mine = await service.list({ ownerUserId: 'user_1', workspaceId: 'ws_1' });
        expect(mine).toHaveLength(1);
        const theirs = await service.list({ ownerUserId: 'user_2', workspaceId: 'ws_1' });
        expect(theirs).toHaveLength(1);
        expect(JSON.stringify(mine)).not.toContain(theirs[0]!.ref);
    });

    it('uses collision-safe ids and refuses to overwrite an existing record', async () => {
        const service = new PluginConnectionService({
            store: createMemoryPluginConnectionStore(),
            secret: SECRET,
            now: () => 1_000,
        });
        const first = await service.create({
            ownerUserId: 'user_1',
            workspaceId: 'ws_1',
            pluginId: 'example.plugin',
            providerId: FAKE_CONNECTION_PROVIDER.id,
            label: 'First',
            scopes: ['read:items'],
            credential: 'tok_one',
        });
        const second = await service.create({
            ownerUserId: 'user_2',
            workspaceId: 'ws_1',
            pluginId: 'example.plugin',
            providerId: FAKE_CONNECTION_PROVIDER.id,
            label: 'Second',
            scopes: ['read:items'],
            credential: 'tok_two',
        });
        expect(first.status).toBe('created');
        expect(second.status).toBe('created');
        if (first.status !== 'created' || second.status !== 'created') return;
        expect(first.view.id).not.toBe(second.view.id);
        expect(first.view.id).toMatch(/^[A-Za-z0-9]{1,32}$/);
        // Each owner's record survives with its own credential.
        const firstReloaded = await service.resolve({
            ref: first.view.ref,
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            ownerUserId: 'user_1',
        });
        const secondReloaded = await service.resolve({
            ref: second.view.ref,
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            ownerUserId: 'user_2',
        });
        expect(firstReloaded.status).toBe('resolved');
        expect(secondReloaded.status).toBe('resolved');
        if (firstReloaded.status !== 'resolved' || secondReloaded.status !== 'resolved') return;
        expect(firstReloaded.connection.secretCiphertext).not.toBe(
            secondReloaded.connection.secretCiphertext
        );
        expect(firstReloaded.connection.ownerUserId).toBe('user_1');
        expect(secondReloaded.connection.ownerUserId).toBe('user_2');
    });

    it('refuses to upsert over an existing id', async () => {
        const service = new PluginConnectionService({
            store: createMemoryPluginConnectionStore(),
            secret: SECRET,
            now: () => 1_000,
            generateId: () => 'conn1',
        });
        await storedConnection(service);
        const collision = await service.create({
            ownerUserId: 'user_2',
            workspaceId: 'ws_1',
            pluginId: 'example.plugin',
            providerId: FAKE_CONNECTION_PROVIDER.id,
            label: 'Collision',
            scopes: ['read:items'],
            credential: 'tok_other',
        });
        // Insert-only creation: the collision is refused (and retryable), and the
        // existing record's owner is untouched.
        expect(collision).toMatchObject({ status: 'denied', code: 'conflict' });
        const stored = await service.list({ ownerUserId: 'user_1', workspaceId: 'ws_1' });
        expect(stored).toHaveLength(1);
        expect(stored[0]?.id).toBe('conn1');
    });

    it('inserts only: a second create with a fresh id never touches the first record', async () => {
        let counter = 0;
        const service = new PluginConnectionService({
            store: createMemoryPluginConnectionStore(),
            secret: SECRET,
            now: () => 1_000,
            generateId: () => `conn${(counter += 1)}`,
        });
        const first = await storedConnection(service);
        const second = await storedConnection(service, { ownerUserId: 'user_2' });
        expect(first.view.id).toBe('conn1');
        expect(second.view.id).toBe('conn2');
        const reloaded = await service.resolve({
            ref: first.view.ref,
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            ownerUserId: 'user_1',
        });
        expect(reloaded.status).toBe('resolved');
        if (reloaded.status !== 'resolved') return;
        expect(reloaded.connection.ownerUserId).toBe('user_1');
    });
});
