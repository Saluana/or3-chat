// shared/openrouter/client.ts
// OpenRouter SDK Client Adapter
// Provides consistent SDK initialization and common request options

import { OpenRouter } from '@openrouter/sdk';

export interface OpenRouterClientConfig {
    apiKey?: string;
}

// Default headers for all requests
export const DEFAULT_HEADERS = {
    'HTTP-Referer': 'https://or3.chat',
    'X-Title': 'or3.chat',
};

/**
 * Create a configured OpenRouter SDK client.
 *
 * In SSR context: Uses env key if available, otherwise empty (will fail for auth-required calls)
 * In client context: Uses user's stored key from state/localStorage
 */
export function createOpenRouterClient(
    config: OpenRouterClientConfig = {}
): OpenRouter {
    return new OpenRouter({
        apiKey: config.apiKey ?? '',
    });
}

/**
 * Get request options with common headers.
 * Use this when calling SDK methods to inject referer/title headers.
 */
export function getRequestOptions(signal?: AbortSignal) {
    return {
        fetchOptions: {
            headers: DEFAULT_HEADERS,
            ...(signal && { signal }),
        },
    };
}
