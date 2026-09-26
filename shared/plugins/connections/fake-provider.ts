/**
 * Fake connection provider used by tests to prove the connection contract.
 *
 * It declares the same shape a real provider must declare and is driven by a
 * scripted transport, so every failure class (bad credentials, insufficient
 * scope, network failure, rate limit, provider outage, deadline, oversized or
 * secret-bearing response) can be reproduced deterministically with no network.
 */

import type {
    ApprovedConnectionOperation,
    ConnectionProviderDescriptor,
} from './contracts';

export const FAKE_PROVIDER_ID = 'fake';

const FAKE_OPERATIONS: readonly ApprovedConnectionOperation[] = [
    {
        id: 'items.list',
        method: 'GET',
        host: 'fake.provider.test',
        pathPrefix: '/v1/',
        scopes: ['read:items'],
        idempotent: true,
        readOnly: true,
        maxResponseBytes: 64 * 1024,
        classification: 'read',
        responseFields: ['items', 'data'],
        description: 'List items (read-only; used as the setup test)',
    },
    {
        id: 'items.create',
        method: 'POST',
        host: 'fake.provider.test',
        pathPrefix: '/v1/',
        scopes: ['write:items'],
        idempotent: false,
        readOnly: false,
        maxResponseBytes: 64 * 1024,
        classification: 'external',
        responseFields: ['item', 'ok'],
        description: 'Create an item (non-idempotent; refused as a setup test)',
    },
];

export const FAKE_CONNECTION_PROVIDER: ConnectionProviderDescriptor = Object.freeze({
    id: FAKE_PROVIDER_ID,
    label: 'Fake provider (contract tests)',
    mechanism: 'server',
    scopes: ['read:items', 'write:items'],
    credentialHeader: 'authorization',
    credentialPrefix: 'Bearer ',
    operations: FAKE_OPERATIONS,
    responseHeaders: ['content-type'],
    callbackDomains: [],
    externalCost: 'None: the fake provider performs no network calls.',
    unsupported: ['oauth-callback', 'webhooks'],
});

export type FakeProviderOutcome =
    | { readonly kind: 'json'; readonly status: number; readonly body: unknown; readonly headers?: Readonly<Record<string, string>> }
    | { readonly kind: 'text'; readonly status: number; readonly body: string; readonly headers?: Readonly<Record<string, string>> }
    | { readonly kind: 'redirect'; readonly status: number; readonly location: string }
    | { readonly kind: 'throw'; readonly message: string }
    | { readonly kind: 'timeout' };

/**
 * Build a transport that answers with one scripted outcome and records every
 * request so tests can assert no credential was attached to a refused call.
 */
export function createFakeProviderTransport(outcome: FakeProviderOutcome) {
    const requests: Array<{
        readonly url: string;
        readonly method: string;
        readonly headers: Readonly<Record<string, string>>;
        readonly body?: string;
    }> = [];

    const transport = async (request: {
        readonly url: string;
        readonly method: string;
        readonly headers: Readonly<Record<string, string>>;
        readonly body?: string;
    }) => {
        requests.push({
            url: request.url,
            method: request.method,
            headers: request.headers,
            ...(request.body === undefined ? {} : { body: request.body }),
        });

        switch (outcome.kind) {
            case 'json':
                return {
                    status: outcome.status,
                    headers: {
                        'content-type': 'application/json',
                        ...(outcome.headers ?? {}),
                    },
                    body: JSON.stringify(outcome.body),
                };
            case 'text':
                return {
                    status: outcome.status,
                    headers: outcome.headers ?? {},
                    body: outcome.body,
                };
            case 'redirect':
                return {
                    status: outcome.status,
                    headers: { location: outcome.location },
                    body: '',
                };
            case 'throw':
                throw new Error(outcome.message);
            case 'timeout':
                throw new Error('operation timed out');
            default: {
                const exhaustive: never = outcome;
                throw new Error(`Unhandled fake outcome: ${String(exhaustive)}`);
            }
        }
    };

    return { transport, requests };
}

/** Convenience: the successful read-only setup test answer. */
export function fakeProviderSuccess() {
    return createFakeProviderTransport({
        kind: 'json',
        status: 200,
        body: { items: [], total: 0 },
    });
}
