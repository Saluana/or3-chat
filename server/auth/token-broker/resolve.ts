/**
 * @module server/auth/token-broker/resolve.ts
 *
 * Purpose:
 * Resolve provider tokens via the configured ProviderTokenBroker.
 */
import type { H3Event } from 'h3';
import { LRUCache } from 'lru-cache';
import { useRuntimeConfig } from '#imports';
import { CLERK_PROVIDER_ID } from '~~/shared/cloud/provider-ids';
import type { ProviderTokenRequest } from './types';
import { getProviderTokenBroker } from './registry';

const DEFAULT_PROVIDER_TOKEN_CACHE_TTL_MS = 55_000;
const MAX_PROVIDER_TOKEN_CACHE_ENTRIES = 2_000;

type ProviderTokenCacheEntry = {
    token: string;
    expiresAtMs: number;
};

const providerTokenCache = new LRUCache<string, ProviderTokenCacheEntry>({
    max: MAX_PROVIDER_TOKEN_CACHE_ENTRIES,
});

function getConfiguredTokenCacheTtlMs(config: ReturnType<typeof useRuntimeConfig>): number {
    const candidate = Number(
        (config.auth as { tokenCacheTtlMs?: unknown } | undefined)
            ?.tokenCacheTtlMs
    );
    if (!Number.isFinite(candidate) || candidate <= 0) {
        return DEFAULT_PROVIDER_TOKEN_CACHE_TTL_MS;
    }
    return Math.floor(candidate);
}

function getTokenCacheScope(event: H3Event): string | null {
    const headers = (event as unknown as { node?: { req?: { headers?: Record<string, string | string[] | undefined> } } }).node?.req?.headers;
    const cookieHeader = headers?.cookie;
    if (typeof cookieHeader === 'string' && cookieHeader.length > 0) {
        return `cookie:${cookieHeader}`;
    }
    const authHeader = headers?.authorization;
    if (typeof authHeader === 'string' && authHeader.length > 0) {
        return `authorization:${authHeader}`;
    }
    return null;
}

function getTokenCacheKey(
    brokerId: string,
    request: ProviderTokenRequest,
    scope: string
): string {
    return `${brokerId}:${request.providerId}:${request.template ?? ''}:${scope}`;
}

export async function resolveProviderToken(
    event: H3Event,
    request: ProviderTokenRequest
): Promise<string | null> {
    const config = useRuntimeConfig(event);
    const brokerId = config.auth.provider || CLERK_PROVIDER_ID;
    const broker = getProviderTokenBroker(brokerId);
    if (!broker) {
        return null;
    }

    const scope = getTokenCacheScope(event);
    if (scope) {
        const cacheKey = getTokenCacheKey(brokerId, request, scope);
        const cached = providerTokenCache.get(cacheKey);
        if (cached) {
            if (cached.expiresAtMs > Date.now()) {
                return cached.token;
            }
            providerTokenCache.delete(cacheKey);
        }
    }

    const token = await broker.getProviderToken(event, request);
    if (token && scope) {
        providerTokenCache.set(getTokenCacheKey(brokerId, request, scope), {
            token,
            expiresAtMs: Date.now() + getConfiguredTokenCacheTtlMs(config),
        });
    }
    return token;
}

/**
 * Internal API.
 *
 * Purpose:
 * Clear shared provider token cache. Intended for tests.
 */
export function _resetProviderTokenCache(): void {
    providerTokenCache.clear();
}
