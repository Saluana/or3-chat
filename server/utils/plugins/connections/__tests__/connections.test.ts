import { describe, expect, it } from 'vitest';
import {
    connectionRefFor,
    parseConnectionRef,
    type ConnectionProviderDescriptor,
} from '~~/shared/plugins/connections/contracts';
import {
    FAKE_CONNECTION_PROVIDER,
    createFakeProviderTransport,
    fakeProviderSuccess,
} from '~~/shared/plugins/connections/fake-provider';
import { decryptConnectionSecret } from '../crypto';
import { PluginConnectionService } from '../service';
import { createMemoryPluginConnectionStore } from '../store/memory';
import {
    dispatchApprovedConnectionOperation,
    redactConnectionResponse,
} from '../dispatch';
import {
    describeConnectionFailure,
    isTestableOperation,
    runConnectionSetupTest,
} from '../setup-test';

const SECRET = 'test-connection-secret-with-enough-entropy';

function createService(overrides: { secret?: string | undefined; now?: () => number } = {}) {
    return new PluginConnectionService({
        store: createMemoryPluginConnectionStore(),
        secret: 'secret' in overrides ? overrides.secret : SECRET,
        now: overrides.now ?? (() => 1_000),
        generateId: () => 'conn1',
    });
}

async function createConnection(
    service: PluginConnectionService,
    overrides: Partial<{
        ownerUserId: string;
        workspaceId: string;
        pluginId: string;
        credential: string;
        scopes: readonly string[];
    }> = {}
) {
    const result = await service.create({
        ownerUserId: overrides.ownerUserId ?? 'user_1',
        workspaceId: overrides.workspaceId ?? 'ws_1',
        pluginId: overrides.pluginId ?? 'example.plugin',
        providerId: FAKE_CONNECTION_PROVIDER.id,
        label: 'Fake provider',
        scopes: overrides.scopes ?? ['read:items'],
        credential: overrides.credential ?? 'tok_live_123',
    });
    if (result.status !== 'created') throw new Error('expected created connection');
    return result;
}

describe('connection storage and references (4.7)', () => {
    it('encrypts the credential with a key outside the database', async () => {
        const service = createService();
        const created = await createConnection(service);
        expect(created.view.ref).toBe('orc_conn1_r1');
        expect(connectionRefFor('conn1', 1)).toBe(created.view.ref);
        expect(parseConnectionRef(created.view.ref)).toEqual({ id: 'conn1', revision: 1 });

        // The stored record never carries the plaintext credential.
        const stored = await service.resolve({
            ref: created.view.ref,
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            ownerUserId: 'user_1',
        });
        expect(stored.status).toBe('resolved');
        if (stored.status !== 'resolved') return;
        expect(JSON.stringify(stored.connection)).not.toContain('tok_live_123');
        expect(stored.connection.secretCiphertext.startsWith('pcv1.')).toBe(true);
        // ... and it round-trips only with the same key.
        expect(decryptConnectionSecret(stored.connection.secretCiphertext, SECRET)).toBe(
            'tok_live_123'
        );
        expect(() =>
            decryptConnectionSecret(stored.connection.secretCiphertext, 'other-secret')
        ).toThrow();
        expect(service.revealCredential(stored.connection)).toBe('tok_live_123');
    });

    it('fails closed when no encryption key is configured', async () => {
        const service = createService({ secret: undefined });
        expect(service.available).toBe(false);
        const result = await service.create({
            ownerUserId: 'user_1',
            workspaceId: 'ws_1',
            pluginId: 'example.plugin',
            providerId: FAKE_CONNECTION_PROVIDER.id,
            label: 'x',
            scopes: [],
            credential: 'tok',
        });
        expect(result).toMatchObject({ status: 'denied', code: 'secret-unavailable' });
    });

    it('scopes references to one plugin and workspace', async () => {
        const service = createService();
        const created = await createConnection(service);
        expect(
            await service.resolve({
                ref: created.view.ref,
                pluginId: 'other.plugin',
                workspaceId: 'ws_1',
                ownerUserId: 'user_1',
            })
        ).toMatchObject({ status: 'denied', code: 'connection-foreign' });
        expect(
            await service.resolve({
                ref: created.view.ref,
                pluginId: 'example.plugin',
                workspaceId: 'ws_2',
                ownerUserId: 'user_1',
            })
        ).toMatchObject({ status: 'denied', code: 'connection-foreign' });
        expect(
            await service.resolve({
                ref: 'orc_conn1_r99',
                pluginId: 'example.plugin',
                workspaceId: 'ws_1',
                ownerUserId: 'user_1',
            })
        ).toMatchObject({ status: 'denied', code: 'reference-stale' });
        expect(
            await service.resolve({
                ref: 'not-a-ref',
                pluginId: 'example.plugin',
                workspaceId: 'ws_1',
                ownerUserId: 'user_1',
            })
        ).toMatchObject({ status: 'denied', code: 'reference-malformed' });
    });

    it('bumps the revision and invalidates reference and test evidence on rotation', async () => {
        const service = createService();
        const created = await createConnection(service);
        await service.recordTest({
            connectionId: created.view.id,
            revision: 1,
            operationId: 'items.list',
            ok: true,
            checkedAt: 1_000,
        });
        expect(await service.isTestCurrent(created.view.id)).toBe(true);

        const rotated = await service.rotate({
            connectionId: created.view.id,
            ownerUserId: 'user_1',
            credential: 'tok_live_456',
        });
        expect(rotated.status).toBe('created');
        if (rotated.status !== 'created') return;
        expect(rotated.view.revision).toBe(2);
        expect(rotated.view.ref).toBe('orc_conn1_r2');
        expect(await service.isTestCurrent(created.view.id)).toBe(false);
        expect(
            await service.resolve({
                ref: 'orc_conn1_r1',
                pluginId: 'example.plugin',
                workspaceId: 'ws_1',
                ownerUserId: 'user_1',
            })
        ).toMatchObject({ status: 'denied', code: 'reference-stale' });
    });

    it('refuses to rotate or delete another user’s connection', async () => {
        const service = createService();
        const created = await createConnection(service);
        expect(
            await service.rotate({
                connectionId: created.view.id,
                ownerUserId: 'user_2',
                credential: 'tok',
            })
        ).toMatchObject({ status: 'denied', code: 'connection-foreign' });
        expect(
            await service.delete({ connectionId: created.view.id, ownerUserId: 'user_2' })
        ).toMatchObject({ status: 'denied', code: 'connection-foreign' });
        expect(
            await service.delete({ connectionId: created.view.id, ownerUserId: 'user_1' })
        ).toEqual({ status: 'deleted' });
    });

    it('never returns a credential in a list view', async () => {
        const service = createService();
        await createConnection(service);
        const views = await service.list({ ownerUserId: 'user_1', workspaceId: 'ws_1' });
        expect(views).toHaveLength(1);
        expect(JSON.stringify(views)).not.toContain('tok_live_123');
        expect(views[0]).toMatchObject({ pluginId: 'example.plugin', revision: 1 });
    });
});

describe('approved-operation dispatch (4.8)', () => {
    const baseUrl = 'https://fake.provider.test/v1/items';

    it('denies a different origin, path or method with no credential attached (RT07)', async () => {
        const service = createService();
        const created = await createConnection(service);
        const { transport, requests } = fakeProviderSuccess();

        for (const url of [
            'https://evil.example/v1/items',
            'https://fake.provider.test/admin/items',
            'https://fake.provider.test/v1/debug/items',
        ]) {
            const outcome = await dispatchApprovedConnectionOperation({
                provider: FAKE_CONNECTION_PROVIDER,
                operationId: 'items.list',
                url,
                grantedScopes: ['read:items'],
                credential: 'tok_live_123',
                transport,
            });
            expect(outcome.status).toBe('denied');
        }

        const wrongMethod = await dispatchApprovedConnectionOperation({
            provider: FAKE_CONNECTION_PROVIDER,
            operationId: 'items.list',
            url: baseUrl,
            method: 'POST',
            grantedScopes: ['read:items'],
            credential: 'tok_live_123',
            transport,
        });
        expect(wrongMethod).toMatchObject({ status: 'denied', code: 'method-not-approved' });

        const unknownOperation = await dispatchApprovedConnectionOperation({
            provider: FAKE_CONNECTION_PROVIDER,
            operationId: 'everything.do',
            url: baseUrl,
            grantedScopes: ['read:items'],
            credential: 'tok_live_123',
            transport,
        });
        expect(unknownOperation).toMatchObject({ status: 'denied', code: 'operation-unknown' });

        const missingScope = await dispatchApprovedConnectionOperation({
            provider: FAKE_CONNECTION_PROVIDER,
            operationId: 'items.list',
            url: baseUrl,
            grantedScopes: [],
            credential: 'tok_live_123',
            transport,
        });
        expect(missingScope).toMatchObject({ status: 'denied', code: 'scope-missing' });

        // No refused call ever reached the transport, so no credential moved.
        expect(requests).toHaveLength(0);
    });

    it('rejects plugin-supplied Authorization, Cookie and Host headers (RT08)', async () => {
        const { transport, requests } = fakeProviderSuccess();
        for (const headers of [
            { authorization: 'Bearer attacker' },
            { cookie: 'session=1' },
            { host: 'evil.example' },
            { 'x-forwarded-host': 'evil.example' },
        ]) {
            const outcome = await dispatchApprovedConnectionOperation({
                provider: FAKE_CONNECTION_PROVIDER,
                operationId: 'items.list',
                url: baseUrl,
                headers,
                grantedScopes: ['read:items'],
                credential: 'tok_live_123',
                transport,
            });
            expect(outcome).toMatchObject({ status: 'denied', code: 'forbidden-header' });
        }
        expect(requests).toHaveLength(0);
    });

    it('injects the credential last, for the approved destination only', async () => {
        const { transport, requests } = fakeProviderSuccess();
        const outcome = await dispatchApprovedConnectionOperation({
            provider: FAKE_CONNECTION_PROVIDER,
            operationId: 'items.list',
            url: baseUrl,
            grantedScopes: ['read:items'],
            credential: 'tok_live_123',
            transport,
        });
        expect(outcome.status).toBe('ok');
        expect(requests).toHaveLength(1);
        expect(requests[0]!.url).toBe(baseUrl);
        expect(requests[0]!.headers.authorization).toBe('Bearer tok_live_123');
        // The credential never appears in the returned value.
        expect(JSON.stringify(outcome)).not.toContain('tok_live_123');
    });

    it('refuses a credential header the host does not control', async () => {
        const { transport, requests } = fakeProviderSuccess();
        const outcome = await dispatchApprovedConnectionOperation({
            provider: FAKE_CONNECTION_PROVIDER,
            operationId: 'items.list',
            url: baseUrl,
            grantedScopes: ['read:items'],
            credential: 'tok_live_123',
            credentialHeader: 'x-plugin-chosen',
            transport,
        });
        expect(outcome).toMatchObject({ status: 'denied', code: 'forbidden-header' });
        expect(requests).toHaveLength(0);
    });

    it('never follows a redirect with credentials', async () => {
        const { transport } = createFakeProviderTransport({
            kind: 'redirect',
            status: 302,
            location: 'https://evil.example/steal',
        });
        const outcome = await dispatchApprovedConnectionOperation({
            provider: FAKE_CONNECTION_PROVIDER,
            operationId: 'items.list',
            url: baseUrl,
            grantedScopes: ['read:items'],
            credential: 'tok_live_123',
            transport,
        });
        expect(outcome).toMatchObject({ status: 'failed', code: 'policy-denied' });
        expect(JSON.stringify(outcome)).not.toContain('evil.example');
    });

    it('redacts sensitive response headers and refuses secret-shaped bodies (RT13)', () => {
        const redacted = redactConnectionResponse({
            status: 200,
            headers: {
                'content-type': 'application/json',
                'set-cookie': 'session=abc',
                'x-auth-token': 'secret',
            },
            body: JSON.stringify({ items: [] }),
            maxResponseBytes: 1024,
        });
        expect(redacted.ok).toBe(true);
        if (!redacted.ok) return;
        expect(redacted.response.headers).toEqual({ 'content-type': 'application/json' });
        expect(redacted.response.removedHeaders).toEqual(
            expect.arrayContaining(['set-cookie', 'x-auth-token'])
        );

        const leaky = redactConnectionResponse({
            status: 200,
            headers: {},
            body: JSON.stringify({ access_token: 'abc' }),
            maxResponseBytes: 1024,
        });
        expect(leaky).toMatchObject({ ok: false, code: 'policy-denied' });

        const oversized = redactConnectionResponse({
            status: 200,
            headers: {},
            body: 'x'.repeat(2048),
            maxResponseBytes: 1024,
        });
        expect(oversized).toMatchObject({ ok: false, code: 'response-too-large' });
    });
});

describe('fake-provider setup tests (4.9)', () => {
    it('passes with a read-only idempotent operation and records evidence', async () => {
        const service = createService();
        const created = await createConnection(service);
        const { transport } = fakeProviderSuccess();
        const result = await runConnectionSetupTest({
            service,
            provider: FAKE_CONNECTION_PROVIDER,
            ref: created.view.ref,
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            ownerUserId: 'user_1',
            operationId: 'items.list',
            url: 'https://fake.provider.test/v1/items',
            transport,
        });
        expect(result).toMatchObject({ status: 'ok' });
        expect(await service.isTestCurrent(created.view.id)).toBe(true);
        const view = (await service.list({ ownerUserId: 'user_1', workspaceId: 'ws_1' }))[0];
        expect(view?.lastTest).toMatchObject({ revision: 1, ok: true });
    });

    it('distinguishes every failure class', async () => {
        const cases: Array<[Parameters<typeof createFakeProviderTransport>[0], string]> = [
            [{ kind: 'json', status: 401, body: {} }, 'bad-credentials'],
            [{ kind: 'json', status: 403, body: {} }, 'insufficient-scope'],
            [{ kind: 'json', status: 429, body: {} }, 'rate-limit'],
            [{ kind: 'json', status: 503, body: {} }, 'provider-outage'],
            [{ kind: 'throw', message: 'socket hang up' }, 'network-failure'],
            [{ kind: 'timeout' }, 'deadline-exceeded'],
        ];

        for (const [outcome, expectedCode] of cases) {
            const service = createService();
            const created = await createConnection(service);
            const { transport } = createFakeProviderTransport(outcome);
            const result = await runConnectionSetupTest({
                service,
                provider: FAKE_CONNECTION_PROVIDER,
                ref: created.view.ref,
                pluginId: 'example.plugin',
                workspaceId: 'ws_1',
            ownerUserId: 'user_1',
                operationId: 'items.list',
                url: 'https://fake.provider.test/v1/items',
                transport,
                deadlineMs: 50,
            });
            expect(result.status).toBe('failed');
            if (result.status !== 'failed') continue;
            expect(result.code).toBe(expectedCode);
            expect(describeConnectionFailure(result.code)).not.toContain('Unhandled');
            expect(await service.isTestCurrent(created.view.id)).toBe(false);
        }
    });

    it('returns distinct, actionable copy per failure class', () => {
        const copy = new Set(
            (
                [
                    'bad-credentials',
                    'insufficient-scope',
                    'network-failure',
                    'rate-limit',
                    'provider-outage',
                    'deadline-exceeded',
                    'policy-denied',
                ] as const
            ).map(describeConnectionFailure)
        );
        expect(copy.size).toBe(7);
    });

    it('refuses non-idempotent and write operations as setup tests', async () => {
        const service = createService();
        const created = await createConnection(service, { scopes: ['write:items'] });
        const { transport, requests } = fakeProviderSuccess();
        const result = await runConnectionSetupTest({
            service,
            provider: FAKE_CONNECTION_PROVIDER,
            ref: created.view.ref,
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            ownerUserId: 'user_1',
            operationId: 'items.create',
            url: 'https://fake.provider.test/v1/items',
            transport,
        });
        expect(result).toMatchObject({ status: 'denied', code: 'operation-not-testable' });
        expect(requests).toHaveLength(0);

        expect(isTestableOperation(FAKE_CONNECTION_PROVIDER, 'items.create')).toMatchObject({
            ok: false,
        });
        expect(isTestableOperation(FAKE_CONNECTION_PROVIDER, 'missing')).toMatchObject({
            ok: false,
        });
    });

    it('denies a test against another workspace or plugin reference', async () => {
        const service = createService();
        const created = await createConnection(service);
        const { transport } = fakeProviderSuccess();
        const result = await runConnectionSetupTest({
            service,
            provider: FAKE_CONNECTION_PROVIDER,
            ref: created.view.ref,
            pluginId: 'other.plugin',
            workspaceId: 'ws_1',
            ownerUserId: 'user_1',
            operationId: 'items.list',
            url: 'https://fake.provider.test/v1/items',
            transport,
        });
        expect(result).toMatchObject({ status: 'denied', code: 'connection-foreign' });
    });

    it('keeps the recorded evidence bound to the revision that earned it', async () => {
        const service = createService();
        const created = await createConnection(service);
        const { transport } = fakeProviderSuccess();
        await runConnectionSetupTest({
            service,
            provider: FAKE_CONNECTION_PROVIDER,
            ref: created.view.ref,
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            ownerUserId: 'user_1',
            operationId: 'items.list',
            url: 'https://fake.provider.test/v1/items',
            transport,
        });
        const before = await service.testEvidence(created.view.id);
        expect(before).toMatchObject({ revision: 1, ok: true });

        await service.rotate({
            connectionId: created.view.id,
            ownerUserId: 'user_1',
            credential: 'tok_live_next',
        });
        const after = await service.testEvidence(created.view.id);
        // The old evidence is replaced by a re-test marker, never kept as a pass.
        expect(after).toMatchObject({ revision: 2, ok: false });
        expect(await service.isTestCurrent(created.view.id)).toBe(false);
    });
});

describe('provider declaration', () => {
    it('declares mechanisms, callbacks, cost and unsupported features', () => {
        const provider: ConnectionProviderDescriptor = FAKE_CONNECTION_PROVIDER;
        expect(provider.mechanism).toBe('server');
        expect(provider.callbackDomains).toEqual([]);
        expect(provider.externalCost).toContain('fake provider');
        expect(provider.unsupported).toContain('oauth-callback');
        expect(provider.operations.every((operation) => operation.host.length > 0)).toBe(true);
    });
});

describe('connection write concurrency (findings 1, 2)', () => {
    it('binds a created credential to its declared package slot', async () => {
        const service = createService();
        const created = await service.create({
            ownerUserId: 'user_1',
            workspaceId: 'ws_1',
            pluginId: 'example.plugin',
            providerId: FAKE_CONNECTION_PROVIDER.id,
            slotId: 'docs',
            label: 'Fake provider',
            scopes: ['read:items'],
            credential: 'tok_live_123',
        });
        if (created.status !== 'created') throw new Error('expected created connection');
        expect(created.view.slotId).toBe('docs');
        const reloaded = await service.resolve({
            ref: created.view.ref,
            pluginId: 'example.plugin',
            workspaceId: 'ws_1',
            ownerUserId: 'user_1',
        });
        expect(reloaded.status).toBe('resolved');
        if (reloaded.status !== 'resolved') return;
        expect(reloaded.connection.slotId).toBe('docs');
    });

    it('refuses a rotation that loses the revision compare-and-swap', async () => {
        const store = createMemoryPluginConnectionStore();
        const service = new PluginConnectionService({
            store,
            secret: SECRET,
            now: () => 1_000,
            generateId: () => 'conn1',
        });
        const created = await createConnection(service);

        // Another process lands its own rotation of the same revision first.
        expect(
            await store.update({
                id: created.view.id,
                expectedRevision: 1,
                revision: 2,
                updatedAt: 2_000,
                secretCiphertext: 'winner-ciphertext',
            })
        ).toBe(true);
        // A write that still believes revision 1 is current must not land.
        expect(
            await store.update({
                id: created.view.id,
                expectedRevision: 1,
                revision: 2,
                updatedAt: 3_000,
                secretCiphertext: 'loser-ciphertext',
            })
        ).toBe(false);
        expect((await store.get(created.view.id))?.secretCiphertext).toBe('winner-ciphertext');
    });

    it('retries a lost rotation and reports a conflict rather than a false success', async () => {
        const base = createMemoryPluginConnectionStore();
        const racing = { ...base, update: async () => false };
        const service = new PluginConnectionService({
            store: racing,
            secret: SECRET,
            now: () => 1_000,
            generateId: () => 'conn1',
        });
        const created = await createConnection(service);
        const result = await service.rotate({
            connectionId: created.view.id,
            ownerUserId: 'user_1',
            credential: 'tok_live_next',
        });
        expect(result).toMatchObject({ status: 'denied', code: 'conflict' });
        // Nothing was written: the stored revision and ciphertext are untouched.
        const stored = await base.get(created.view.id);
        expect(stored?.revision).toBe(1);
        expect(stored?.secretCiphertext).toBe(
            (await base.get(created.view.id))?.secretCiphertext
        );
        expect(await service.isTestCurrent(created.view.id)).toBe(false);
    });

    it('drops a late test result for a revision that is no longer current', async () => {
        const service = createService();
        const created = await createConnection(service);
        await service.rotate({
            connectionId: created.view.id,
            ownerUserId: 'user_1',
            credential: 'tok_live_next',
        });
        const accepted = await service.recordTest({
            connectionId: created.view.id,
            revision: 1,
            operationId: 'items.list',
            ok: true,
            checkedAt: 9_999_999,
        });
        expect(accepted).toBe(false);
        expect(await service.isTestCurrent(created.view.id)).toBe(false);
    });

    it('does not let an older completion replace newer evidence for the same revision', async () => {
        const service = createService();
        const created = await createConnection(service);
        expect(
            await service.recordTest({
                connectionId: created.view.id,
                revision: 1,
                operationId: 'items.list',
                ok: true,
                checkedAt: 2_000,
            })
        ).toBe(true);
        expect(
            await service.recordTest({
                connectionId: created.view.id,
                revision: 1,
                operationId: 'items.list',
                ok: false,
                code: 'bad-credentials',
                checkedAt: 1_000,
            })
        ).toBe(false);
        expect(await service.isTestCurrent(created.view.id)).toBe(true);
    });

    it('fails closed when the encryption key is absent', async () => {
        const store = createMemoryPluginConnectionStore();
        const configured = new PluginConnectionService({
            store,
            secret: SECRET,
            now: () => 1_000,
            generateId: () => 'conn1',
        });
        const missingKey = new PluginConnectionService({
            store,
            secret: undefined,
            now: () => 1_000,
            generateId: () => 'conn1',
        });
        const created = await createConnection(configured);
        expect(missingKey.available).toBe(false);

        const fresh = await missingKey.create({
            ownerUserId: 'user_1',
            workspaceId: 'ws_1',
            pluginId: 'example.plugin',
            providerId: FAKE_CONNECTION_PROVIDER.id,
            label: 'Fake provider',
            scopes: ['read:items'],
            credential: 'tok_live_new',
        });
        expect(fresh).toMatchObject({ status: 'denied', code: 'secret-unavailable' });

        const rotated = await missingKey.rotate({
            connectionId: created.view.id,
            ownerUserId: 'user_1',
            credential: 'tok_live_next',
        });
        expect(rotated).toMatchObject({ status: 'denied', code: 'secret-unavailable' });
        expect((await store.get(created.view.id))?.revision).toBe(1);
    });
});
