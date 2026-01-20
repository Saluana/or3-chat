/**
 * Rate Limit Store
 *
 * Factory that creates the appropriate rate limit provider based on configuration.
 * Falls back to in-memory provider if the configured provider is unavailable.
 */

import type { RateLimitProvider } from './types';
import { memoryProvider } from './providers/memory';
import { convexProvider } from './providers/convex';

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
        case 'convex':
            // Check if Convex is actually available
            if (config.public.sync.convexUrl) {
                cachedProvider = convexProvider;
            } else {
                console.warn('[rate-limit] Convex URL not configured, using memory');
                cachedProvider = memoryProvider;
            }
            break;

        case 'redis':
            // Future: Redis provider
            console.warn('[rate-limit] Redis provider not yet implemented, using memory');
            cachedProvider = memoryProvider;
            break;

        case 'postgres':
            // Future: Postgres provider
            console.warn('[rate-limit] Postgres provider not yet implemented, using memory');
            cachedProvider = memoryProvider;
            break;

        case 'memory':
        default:
            cachedProvider = memoryProvider;
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
