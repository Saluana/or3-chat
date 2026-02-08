/**
 * @module server/utils/rate-limit/store
 *
 * Purpose:
 * Resolve the configured rate limit provider for server usage.
 *
 * Responsibilities:
 * - Choose a provider based on runtime config.
 * - Fall back to the in-memory provider when unavailable.
 * - Cache the resolved provider instance.
 *
 * Non-Goals:
 * - Implementing rate limit logic.
 */

import type { RateLimitProvider } from './types';
import { memoryRateLimitProvider } from './providers/memory';
import { getRateLimitProviderById } from './registry';
import { LIMITS_PROVIDER_IDS } from '~~/shared/cloud/provider-ids';

let cachedProvider: RateLimitProvider | null = null;

/**
 * Purpose:
 * Get the active rate limit provider.
 *
 * Behavior:
 * - Uses runtime config to pick a provider.
 * - Falls back to memory when the configured provider is unavailable.
 * - Caches the resolved provider for reuse.
 */
export function getRateLimitProvider(): RateLimitProvider {
    if (cachedProvider) {
        return cachedProvider;
    }

    const config = useRuntimeConfig();
    const storageProvider = config.limits.storageProvider;

    switch (storageProvider) {
        case LIMITS_PROVIDER_IDS.convex: {
            const registered = getRateLimitProviderById(storageProvider);
            if (registered) {
                cachedProvider = registered;
            } else {
                console.warn('[rate-limit] Provider not registered, using memory:', storageProvider);
                cachedProvider = memoryRateLimitProvider;
            }
            break;
        }

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
 * Purpose:
 * Clear the cached provider, typically for tests or config changes.
 */
export function resetRateLimitProvider(): void {
    cachedProvider = null;
}
