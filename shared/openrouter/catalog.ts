import { fetchOpenRouterCatalog } from './sdk-v1-compat';
import { DEFAULT_HEADERS } from './request-options';
import { normalizeOpenRouterBaseUrl } from './url';

/** Browser catalog construction; caching remains with the host model service. */
export async function fetchBrowserOpenRouterCatalog(apiKey: string, baseUrl?: string) {
    const { Models } = await import('@openrouter/sdk/sdk/models.js');
    return fetchOpenRouterCatalog({ models: new Models({
        apiKey,
        serverURL: normalizeOpenRouterBaseUrl(baseUrl),
        httpReferer: DEFAULT_HEADERS['HTTP-Referer'],
        appTitle: DEFAULT_HEADERS['X-Title'],
    }) });
}
