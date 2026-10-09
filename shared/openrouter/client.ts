// shared/openrouter/client.ts
// OpenRouter SDK Client Adapter
// Provides consistent SDK initialization and common request options

import { OpenRouter, type HTTPClient } from '@openrouter/sdk';
import { normalizeOpenRouterBaseUrl } from './url';
import { DEFAULT_HEADERS } from './request-options';
export { DEFAULT_HEADERS, getRequestOptions } from './request-options';

export interface OpenRouterClientConfig {
    apiKey?: string;
    serverURL?: string;
    httpClient?: HTTPClient;
}

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
        serverURL: normalizeOpenRouterBaseUrl(config.serverURL),
        httpReferer: DEFAULT_HEADERS['HTTP-Referer'],
        appTitle: DEFAULT_HEADERS['X-Title'],
        httpClient: config.httpClient,
    });
}
