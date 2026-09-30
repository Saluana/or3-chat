/**
 * OpenRouter connection provider.
 *
 * This is the one product-required real provider for the Cloud runtime: the host
 * calls it directly with the user's own OpenRouter credential, so there is no
 * central OR3 credential proxy. Declared mechanisms, callback domains, costs and
 * unsupported features are explicit; anything not listed here is refused by the
 * dispatcher.
 */

import type {
    ApprovedConnectionOperation,
    ConnectionProviderDescriptor,
} from '~~/shared/plugins/connections/contracts';

const OPENROUTER_OPERATIONS: readonly ApprovedConnectionOperation[] = [
        {
            id: 'models.list',
            method: 'GET',
            host: 'openrouter.ai',
            pathPrefix: '/api/v1/models',
            scopes: ['models:read'],
            idempotent: true,
            readOnly: true,
            maxResponseBytes: 512 * 1024,
            classification: 'read',
            responseFields: ['data', 'object'],
            description: 'List available models (read-only; used as the setup test)',
        },
        {
            id: 'chat.completions.create',
            method: 'POST',
            host: 'openrouter.ai',
            pathPrefix: '/api/v1/chat/completions',
            scopes: ['chat:completion'],
            idempotent: false,
            readOnly: false,
            maxResponseBytes: 1024 * 1024,
            classification: 'commercial',
            // Paid completions are reachable only through the governed AI
            // capability, where the model allowlist, output ceiling and spend
            // accounting live. Generic dispatch refuses this operation.
            governedBy: 'ai.complete',
            responseFields: ['id', 'model', 'object', 'choices', 'usage', 'created'],
            description:
                'Create a completion; billed by OpenRouter to your account. Routed through ai.complete so budgets apply.',
        },
];

export const OPENROUTER_CONNECTION_PROVIDER: ConnectionProviderDescriptor = Object.freeze({
    id: 'openrouter',
    label: 'OpenRouter',
    mechanism: 'server',
    credentialHeader: 'authorization',
    credentialPrefix: 'Bearer ',
    scopes: ['models:read', 'chat:completion'],
    operations: OPENROUTER_OPERATIONS,
    responseHeaders: ['content-type', 'date', 'x-request-id', 'cf-ray'],
    callbackDomains: [],
    externalCost:
        'OpenRouter bills your own account per token; OR3 adds no fee and never sees your key.',
    unsupported: [
        'oauth-pkce: browser-held provider keys are not supported',
        'webhooks: no inbound provider callbacks are used',
        'streaming responses: this connection path returns bounded JSON only',
    ],
});

export const OPENROUTER_SETUP_TEST_URL = 'https://openrouter.ai/api/v1/models';
