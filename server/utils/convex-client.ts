import { ConvexHttpClient } from 'convex/browser';
import { api } from '~~/convex/_generated/api';

let client: ConvexHttpClient | null = null;

/**
 * Get or create the server-side Convex HTTP client.
 */
export function getConvexClient() {
    if (client) return client;

    const runtimeConfig = useRuntimeConfig();
    const url = runtimeConfig.public.convex?.url ?? runtimeConfig.public.convexUrl;

    if (typeof url !== 'string' || url.length === 0) {
        throw new Error('CONVEX_URL is not defined in runtime config');
    }

    client = new ConvexHttpClient(url);
    return client;
}

/**
 * Export the api as well for convenience
 */
export { api };
