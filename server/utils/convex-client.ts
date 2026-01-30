import { ConvexHttpClient } from 'convex/browser';
import { api } from '~~/convex/_generated/api';
import { useRuntimeConfig } from '#imports';

let client: ConvexHttpClient | null = null;

/**
 * Get or create the server-side Convex HTTP client.
 */
export function getConvexClient() {
    if (client) return client;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
    const runtimeConfig = (useRuntimeConfig() || {}) as any;
    const serverSync = runtimeConfig.sync as { convexUrl?: string } | undefined;
    const publicConfig = runtimeConfig.public as { sync?: { convexUrl?: string }; convex?: { url?: string } } | undefined;
    const publicSync = publicConfig?.sync;
    const publicConvex = publicConfig?.convex;
    const url = serverSync?.convexUrl || publicSync?.convexUrl || publicConvex?.url;

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
