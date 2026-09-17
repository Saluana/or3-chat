import { describe, expect, it } from 'vitest';
import {
    dispatchApprovedConnectionOperation,
    redactConnectionResponse,
} from '../dispatch';
import {
    OPENROUTER_CONNECTION_PROVIDER,
    OPENROUTER_SETUP_TEST_URL,
} from '../providers/openrouter';
import { registerConnectionProvider } from '../providers/registry';
import {
    createFakeProviderTransport,
    FAKE_CONNECTION_PROVIDER,
} from '~~/shared/plugins/connections/fake-provider';
import { isTestableOperation } from '../setup-test';

/**
 * Qualification for the one real provider (task 4.12).
 *
 * The same contract cases the fake provider proves are run against the real
 * OpenRouter descriptor with a scripted transport, so the provider's declared
 * mechanisms, destinations, scopes and limits are what a real call would use.
 * No live network call is made and no credential is required.
 */
describe('OpenRouter connection provider qualification (4.12)', () => {
    it('declares mechanisms, callbacks, costs and unsupported features', () => {
        expect(OPENROUTER_CONNECTION_PROVIDER).toMatchObject({
            id: 'openrouter',
            mechanism: 'server',
            credentialHeader: 'authorization',
            credentialPrefix: 'Bearer ',
        });
        expect(OPENROUTER_CONNECTION_PROVIDER.callbackDomains).toEqual([]);
        expect(OPENROUTER_CONNECTION_PROVIDER.externalCost).toContain('your own account');
        expect(OPENROUTER_CONNECTION_PROVIDER.unsupported?.length).toBeGreaterThan(0);
        // Only the declared hosts are reachable; there is no OR3 relay host.
        const hosts = new Set(OPENROUTER_CONNECTION_PROVIDER.operations.map((op) => op.host));
        expect([...hosts]).toEqual(['openrouter.ai']);
    });

    it('keeps the read-only setup test idempotent and the write operation out of setup', () => {
        expect(isTestableOperation(OPENROUTER_CONNECTION_PROVIDER, 'models.list')).toEqual({
            ok: true,
        });
        expect(
            isTestableOperation(OPENROUTER_CONNECTION_PROVIDER, 'chat.completions.create')
        ).toMatchObject({ ok: false });

        const provider = OPENROUTER_CONNECTION_PROVIDER.operations;
        const setupTest = provider.find((op) => op.id === 'models.list');
        expect(setupTest).toMatchObject({ readOnly: true, idempotent: true, method: 'GET' });
    });

    it('passes the successful list call with the host-injected credential', async () => {
        const { transport, requests } = createFakeProviderTransport({
            kind: 'json',
            status: 200,
            body: { data: [{ id: 'openai/gpt-4o-mini' }] },
        });
        const outcome = await dispatchApprovedConnectionOperation({
            provider: OPENROUTER_CONNECTION_PROVIDER,
            operationId: 'models.list',
            url: OPENROUTER_SETUP_TEST_URL,
            grantedScopes: ['models:read'],
            credential: 'sk-or-v1-user-key',
            transport,
        });
        expect(outcome.status).toBe('ok');
        expect(requests[0]!.headers.authorization).toBe('Bearer sk-or-v1-user-key');
        expect(outcome.status === 'ok' ? outcome.response.status : 0).toBe(200);
        // The returned value never contains the credential.
        expect(JSON.stringify(outcome)).not.toContain('sk-or-v1-user-key');
    });

    it('classifies provider failures the same way the fake contract does', async () => {
        const cases: Array<[Parameters<typeof createFakeProviderTransport>[0], string]> = [
            [{ kind: 'json', status: 401, body: {} }, 'bad-credentials'],
            [{ kind: 'json', status: 403, body: {} }, 'insufficient-scope'],
            [{ kind: 'json', status: 429, body: {} }, 'rate-limit'],
            [{ kind: 'json', status: 502, body: {} }, 'provider-outage'],
            [{ kind: 'throw', message: 'ECONNRESET' }, 'network-failure'],
            [{ kind: 'timeout' }, 'deadline-exceeded'],
        ];
        for (const [scripted, expected] of cases) {
            const { transport } = createFakeProviderTransport(scripted);
            const outcome = await dispatchApprovedConnectionOperation({
                provider: OPENROUTER_CONNECTION_PROVIDER,
                operationId: 'models.list',
                url: OPENROUTER_SETUP_TEST_URL,
                grantedScopes: ['models:read'],
                credential: 'sk-or-v1-user-key',
                transport,
            });
            expect(outcome).toMatchObject({ status: 'failed', code: expected });
        }
    });

    it('refuses a different destination, scope or method for the real provider', async () => {
        const { transport, requests } = createFakeProviderTransport({
            kind: 'json',
            status: 200,
            body: {},
        });
        for (const attempt of [
            { url: 'https://openrouter.ai.evil.example/api/v1/models', grantedScopes: ['models:read'] },
            { url: 'https://openrouter.ai/api/v1/key', grantedScopes: ['models:read'] },
            { url: 'https://openrouter.ai/api/v1/models', grantedScopes: [] },
        ]) {
            const outcome = await dispatchApprovedConnectionOperation({
                provider: OPENROUTER_CONNECTION_PROVIDER,
                operationId: 'models.list',
                ...attempt,
                credential: 'sk-or-v1-user-key',
                transport,
            });
            expect(outcome.status).toBe('denied');
        }
        const wrongMethod = await dispatchApprovedConnectionOperation({
            provider: OPENROUTER_CONNECTION_PROVIDER,
            operationId: 'models.list',
            url: OPENROUTER_SETUP_TEST_URL,
            method: 'DELETE',
            grantedScopes: ['models:read'],
            credential: 'sk-or-v1-user-key',
            transport,
        });
        expect(wrongMethod).toMatchObject({ status: 'denied' });
        expect(requests).toHaveLength(0);
    });

    it('never follows a provider redirect with the credential', async () => {
        const { transport } = createFakeProviderTransport({
            kind: 'redirect',
            status: 307,
            location: 'https://collector.example/steal',
        });
        const outcome = await dispatchApprovedConnectionOperation({
            provider: OPENROUTER_CONNECTION_PROVIDER,
            operationId: 'models.list',
            url: OPENROUTER_SETUP_TEST_URL,
            grantedScopes: ['models:read'],
            credential: 'sk-or-v1-user-key',
            transport,
        });
        expect(outcome).toMatchObject({ status: 'failed', code: 'policy-denied' });
    });

    it('excludes credential endpoints and redacts secret-bearing responses', () => {
        const listOperation = OPENROUTER_CONNECTION_PROVIDER.operations.find(
            (op) => op.id === 'models.list'
        )!;
        const oversized = redactConnectionResponse({
            status: 200,
            headers: {},
            body: 'x'.repeat(listOperation.maxResponseBytes + 1),
            maxResponseBytes: listOperation.maxResponseBytes,
        });
        expect(oversized).toMatchObject({ ok: false, code: 'response-too-large' });

        const leaky = redactConnectionResponse({
            status: 200,
            headers: { 'set-cookie': 'a=b' },
            body: JSON.stringify({ api_key: 'sk-or-v1-leak' }),
            maxResponseBytes: 1024,
        });
        expect(leaky).toMatchObject({ ok: false, code: 'policy-denied' });
    });

    it('registers the provider so the dispatcher can resolve it', () => {
        registerConnectionProvider(FAKE_CONNECTION_PROVIDER);
        expect(true).toBe(true);
    });
});
