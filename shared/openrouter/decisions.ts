import type { DecisionsRequest } from '@openrouter/sdk/models';

/** Optional OpenRouter Decisions operation; callers retain their own policy and deadline. */
export async function createOpenRouterDecisions(options: {
    apiKey: string;
    origin: string;
    signal: AbortSignal;
    beforeDispatch?: () => Promise<void>;
}) {
    const { HTTPClient } = await import('@openrouter/sdk/lib/http.js');
    const { createOpenRouterClient } = await import('./client');
    const httpClient = new HTTPClient();
    if (options.beforeDispatch) httpClient.addHook('beforeRequest', async () => {
        await options.beforeDispatch!();
        options.signal.throwIfAborted();
    });
    const client = createOpenRouterClient({ apiKey: options.apiKey, serverURL: options.origin, httpClient });
    return (request: DecisionsRequest, timeoutMs: number) => client.alpha.decisions.create(
        { decisionsRequest: request },
        { retries: { strategy: 'none' }, timeoutMs, fetchOptions: { signal: options.signal } }
    );
}
