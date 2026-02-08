/**
 * @module server/utils/rate-limit/registry
 *
 * Purpose:
 * Registry for rate limit providers so provider packages can register
 * implementations without hard dependencies in core.
 */

import type { RateLimitProvider } from './types';

const providers = new Map<string, RateLimitProvider>();

export function registerRateLimitProvider(
    id: string,
    provider: RateLimitProvider
): void {
    providers.set(id, provider);
}

export function getRateLimitProviderById(id: string): RateLimitProvider | null {
    return providers.get(id) ?? null;
}

export function listRateLimitProviderIds(): string[] {
    return Array.from(providers.keys());
}
