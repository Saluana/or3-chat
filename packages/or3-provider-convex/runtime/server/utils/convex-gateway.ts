import type { H3Event } from 'h3';
import { createError } from 'h3';
import { ConvexHttpClient } from 'convex/browser';
import type { UserIdentityAttributes } from 'convex/server';
import { useRuntimeConfig } from '#imports';
import { getProviderTokenBroker } from '~~/server/auth/token-broker/registry';
import { CONVEX_PROVIDER_ID } from '~~/shared/cloud/provider-ids';

export async function getProviderToken(
    event: H3Event,
    template?: string
): Promise<string | null> {
    const config = useRuntimeConfig(event);
    const broker = getProviderTokenBroker(config.auth.provider);
    if (!broker) {
        return null;
    }

    return broker.getProviderToken(event, {
        providerId: CONVEX_PROVIDER_ID,
        template,
    });
}

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

export function getConvexGatewayClient(event: H3Event, token: string): ConvexHttpClient {
    const url = resolveConvexUrl(event);
    const cacheKey = `user:${url}:${token}`;
    const cached = gatewayClientCache.get(cacheKey);
    if (cached) {
        cached.lastAccessed = Date.now();
        return cached.client;
    }

    const client = new ConvexHttpClient(url);
    client.setAuth(token);
    gatewayClientCache.set(cacheKey, {
        client,
        lastAccessed: Date.now(),
    });

    if (gatewayClientCache.size > MAX_GATEWAY_CLIENTS) {
        evictLRU();
    }

    return client;
}

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
