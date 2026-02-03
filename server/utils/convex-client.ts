/**
 * @module server/utils/convex-client
 *
 * Purpose:
 * Provide a shared Convex HTTP client for server-side mutations and queries.
 *
 * Responsibilities:
 * - Lazily initialize the client from runtime config.
 * - Reuse the client across server calls in a single process.
 *
 * Non-Goals:
 * - Client-side Convex usage.
 * - Multi-tenant client pooling.
 *
 * Constraints:
 * - Requires `runtimeConfig.sync.convexUrl` to be configured.
 * - Server-only usage.
 */

import { ConvexHttpClient } from 'convex/browser';
import { api } from '~~/convex/_generated/api';
import { useRuntimeConfig } from '#imports';

let client: ConvexHttpClient | null = null;

/**
 * Purpose:
 * Get or create the server-side Convex HTTP client.
 *
 * Behavior:
 * - Initializes once and caches the instance for reuse.
 * - Throws when Convex URL is missing.
 *
 * @throws Error when the Convex URL is not configured.
 */
export function getConvexClient() {
    if (client) return client;

    const runtimeConfig = useRuntimeConfig();
    const url = runtimeConfig.sync.convexUrl;

    if (typeof url !== 'string' || url.length === 0) {
        throw new Error('CONVEX_URL is not defined in runtime config');
    }

    client = new ConvexHttpClient(url);
    return client;
}

/**
 * Purpose:
 * Re-export the generated Convex API for convenience.
 */
export { api };
