/**
 * @module server/utils/sync/convex-gateway
 *
 * Purpose:
 * Helper utilities for Convex gateway mode in SSR sync endpoints.
 * This module mints provider tokens and caches ConvexHttpClient instances
 * keyed by user identity to avoid repeated initialization.
 *
 * Responsibilities:
 * - Retrieve provider tokens from Clerk auth context.
 * - Resolve Convex URLs across runtime config shapes.
 * - Provide cached Convex clients for user and admin contexts.
 *
 * Non-Goals:
 * - Authorization checks. SSR endpoints must enforce `can()`.
 * - Token refresh scheduling beyond per-request access.
 *
 * Constraints:
 * - Server-only usage.
 * - Cache is process-local and bounded by an LRU policy.
 */

import type { H3Event } from 'h3';
import { createError } from 'h3';
import { ConvexHttpClient } from 'convex/browser';
import type { UserIdentityAttributes } from 'convex/server';
import { useRuntimeConfig } from '#imports';

type RuntimeConfigWithConvex = {
    sync?: {
        convexUrl?: string;
    };
    public?: {
        convex?: {
            url?: string;
        };
        sync?: {
            convexUrl?: string;
        };
    };
    convex?: {
        url?: string;
    };
};

// LRU cache entry for gateway clients.
interface CacheEntry {
    client: ConvexHttpClient;
    lastAccessed: number;
}

const gatewayClientCache = new Map<string, CacheEntry>();
const MAX_GATEWAY_CLIENTS = 50;

function evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of gatewayClientCache) {
        if (entry.lastAccessed < oldestTime) {
            oldestTime = entry.lastAccessed;
            oldestKey = key;
        }
    }

    if (oldestKey) {
        gatewayClientCache.delete(oldestKey);
    }
}

function resolveConvexUrl(event: H3Event): string {
    const config = useRuntimeConfig(event) as RuntimeConfigWithConvex;
    const url =
        config.sync?.convexUrl ||
        config.public?.sync?.convexUrl ||
        config.public?.convex?.url ||
        config.convex?.url;

    if (!url) {
        throw createError({
            statusCode: 500,
            statusMessage: 'Convex URL not configured',
        });
    }

    return url;
}

/**
 * Purpose:
 * Create or retrieve a cached Convex client for a user token.
 *
 * Behavior:
 * - Uses a process-local LRU cache keyed by URL and token.
 * - Updates access time on cache hits.
 *
 * Constraints:
 * - Cache is bounded to `MAX_GATEWAY_CLIENTS` entries.
 */
export function getConvexGatewayClient(event: H3Event, token: string): ConvexHttpClient {
    const url = resolveConvexUrl(event);
    const cacheKey = `user:${url}:${token}`;
    const cached = gatewayClientCache.get(cacheKey);
    if (cached) {
        // Update last accessed time for LRU
        cached.lastAccessed = Date.now();
        return cached.client;
    }

    const client = new ConvexHttpClient(url);
    client.setAuth(token);
    gatewayClientCache.set(cacheKey, {
        client,
        lastAccessed: Date.now(),
    });

    // Evict oldest entry if over capacity (LRU)
    if (gatewayClientCache.size > MAX_GATEWAY_CLIENTS) {
        evictLRU();
    }

    return client;
}

/**
 * Purpose:
 * Create or retrieve a cached Convex client for admin auth.
 *
 * Behavior:
 * - Uses `setAdminAuth` with the provided identity.
 * - Caches per admin key and identity tuple.
 */
export function getConvexAdminGatewayClient(
    event: H3Event,
    adminKey: string,
    identity: UserIdentityAttributes
): ConvexHttpClient {
    const url = resolveConvexUrl(event);
    const cacheKey = `admin:${url}:${adminKey}:${identity.subject}:${identity.issuer}`;
    const cached = gatewayClientCache.get(cacheKey);
    if (cached) {
        cached.lastAccessed = Date.now();
        return cached.client;
    }

    const client = new ConvexHttpClient(url);
    client.setAdminAuth(adminKey, identity);
    gatewayClientCache.set(cacheKey, {
        client,
        lastAccessed: Date.now(),
    });

    if (gatewayClientCache.size > MAX_GATEWAY_CLIENTS) {
        evictLRU();
    }

    return client;
}
