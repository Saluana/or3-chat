/**
 * Rate Limit Store
 *
 * Factory that creates the appropriate rate limit provider based on configuration.
 * Falls back to in-memory provider if the configured provider is unavailable.
 */

import type { RateLimitProvider } from './types';
import { memoryRateLimitProvider } from './providers/memory';
import { convexRateLimitProvider } from './providers/convex';
import { LIMITS_PROVIDER_IDS } from '~~/shared/cloud/provider-ids';

let cachedProvider: RateLimitProvider | null = null;

/**
 * Get the active rate limit provider.
 * Caches the provider for performance.
 */
export function getRateLimitProvider(): RateLimitProvider {
    if (cachedProvider) {
        return cachedProvider;
    }

    const config = useRuntimeConfig();
    const storageProvider = config.limits.storageProvider;

    switch (storageProvider) {
        case LIMITS_PROVIDER_IDS.convex:
            // Check if Convex is actually available
            if ((config.sync as { convexUrl?: string } | undefined)?.convexUrl ?? config.public.sync.convexUrl) {
                cachedProvider = convexRateLimitProvider;
            } else {
                console.warn('[rate-limit] Convex URL not configured, using memory');
                cachedProvider = memoryRateLimitProvider;
            }
            break;

        case LIMITS_PROVIDER_IDS.redis:
            // Future: Redis provider
            console.warn('[rate-limit] Redis provider not yet implemented, using memory');
            cachedProvider = memoryRateLimitProvider;
            break;

        case LIMITS_PROVIDER_IDS.postgres:
            // Future: Postgres provider
            console.warn('[rate-limit] Postgres provider not yet implemented, using memory');
            cachedProvider = memoryRateLimitProvider;
            break;

        case LIMITS_PROVIDER_IDS.memory:
        default:
            cachedProvider = memoryRateLimitProvider;
            break;
    }

    return cachedProvider;
}

/**
 * Reset the cached provider (useful for testing or config changes)
 */
export function resetRateLimitProvider(): void {
    cachedProvider = null;
}
