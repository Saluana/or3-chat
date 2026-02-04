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
    const resolved = storageProvider
        ? getRateLimitProviderById(storageProvider)
        : null;

    if (!resolved) {
        if (storageProvider && storageProvider !== 'memory') {
            console.warn(
                `[rate-limit] Provider "${storageProvider}" not registered, using memory`
            );
        }
        cachedProvider = memoryRateLimitProvider;
    } else {
        cachedProvider = resolved;
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
