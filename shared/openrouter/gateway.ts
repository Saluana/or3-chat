// shared/openrouter/gateway.ts
// Shared factory that builds a provider-neutral `OpenRouterModelGateway` from an
// UNPATCHED OpenRouter SDK v1 client. Both foreground (`executeWorkflow.ts`) and
// SSR background (`background-execution.ts`) workflow paths use this so neither
// depends on the removed `createWorkflowOpenRouterClient` monkey patch
// (R3.AC5, R3.AC6).

import {
    createOpenRouterModelGateway,
    type ModelGateway,
    type OpenRouterV1Client,
} from 'or3-workflow-core';
import {
    createOpenRouterClient,
    DEFAULT_HEADERS,
    type OpenRouterClientConfig,
} from './client';

export interface WorkflowGatewayConfig extends OpenRouterClientConfig {
    /** Opt into OpenRouter routing metadata. Default disabled for privacy. */
    metadata?: 'disabled' | 'enabled';
    /** Receives non-fatal preflight/mapping warnings. */
    onWarning?: (message: string) => void;
}

/**
 * Create a workflow `ModelGateway` backed by the public SDK v1 `chat.send`
 * transport. The unpatched client exposes exactly the `{ chatRequest }` shape
 * the gateway expects, so no compatibility patch is required.
 */
export function createWorkflowModelGateway(
    config: WorkflowGatewayConfig = {}
): ModelGateway {
    const client = createOpenRouterClient(config);
    return createOpenRouterModelGateway(
        client as unknown as OpenRouterV1Client,
        {
            httpReferer: DEFAULT_HEADERS['HTTP-Referer'],
            appTitle: DEFAULT_HEADERS['X-Title'],
            metadata: config.metadata ?? 'disabled',
            requestOptions: (signal?: AbortSignal) => ({
                fetchOptions: {
                    headers: DEFAULT_HEADERS,
                    ...(signal ? { signal } : {}),
                },
                ...(signal ? { signal } : {}),
            }),
            apiKey: config.apiKey,
            serverURL: config.serverURL,
            onWarning: config.onWarning,
        }
    );
}
