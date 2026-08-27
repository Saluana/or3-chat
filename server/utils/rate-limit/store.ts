/**
 * @module server/utils/rate-limit/store
 *
 * Purpose:
 * Resolve the configured rate limit provider for server usage.
 *
 * Responsibilities:
 * - Choose a provider based on runtime config.
 * - Use memory only when it is explicitly configured (or while Convex is
 *   registering during startup).
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
 * - Rejects configured providers that are unavailable rather than silently
 *   weakening multi-instance limits.
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
                // Do not cache a startup fallback. Provider plugins register
                // during server initialization, and a request racing that
                // registration must not pin this process to local-only limits.
                return memoryRateLimitProvider;
            }
            break;
        }

        case LIMITS_PROVIDER_IDS.redis:
        case LIMITS_PROVIDER_IDS.postgres:
            throw new Error(
                `[rate-limit] Provider "${storageProvider}" is not implemented. ` +
                    'Set OR3_LIMITS_STORAGE_PROVIDER to "memory" or "convex".'
            );

        case LIMITS_PROVIDER_IDS.memory:
            cachedProvider = memoryRateLimitProvider;
            break;

        default: {
            const registered = getRateLimitProviderById(storageProvider);
            if (!registered) {
                throw new Error(
                    `[rate-limit] Provider "${storageProvider}" is not registered. ` +
                        'Install its provider package or set OR3_LIMITS_STORAGE_PROVIDER to "memory" or "convex".'
                );
            }
            cachedProvider = registered;
            break;
        }
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
