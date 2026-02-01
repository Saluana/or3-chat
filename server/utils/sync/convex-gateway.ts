/**
 * Convex gateway helpers for SSR sync endpoints.
 */
import type { H3Event } from 'h3';
import { createError } from 'h3';
import { ConvexHttpClient } from 'convex/browser';
import { useRuntimeConfig } from '#imports';

// Type guard for Clerk auth context
type ClerkAuthContext = {
    getToken: (options?: {
        template?: string;
    }) => Promise<string | null>;
};

function isClerkAuthContext(value: unknown): value is ClerkAuthContext {
    return (
        typeof value === 'object' &&
        value !== null &&
        'getToken' in value &&
        typeof (value as Record<string, unknown>).getToken === 'function'
    );
}

export async function getClerkProviderToken(
    event: H3Event,
    template?: string
): Promise<string | null> {
    const authResult: unknown = event.context.auth?.();
    if (!authResult) {
        return null;
    }

    // Validate auth context structure
    if (!isClerkAuthContext(authResult)) {
        console.error('[sync-gateway] Invalid auth context structure: getToken is not a function');
        return null;
    }

    try {
        const token = await authResult.getToken({ template });
        
        // Validate token is non-empty
        if (!token || token.trim().length === 0) {
            console.warn('[sync-gateway] Empty or whitespace-only token returned');
            return null;
        }
        
        return token;
    } catch (error) {
        console.error('[sync-gateway] Failed to mint provider token:', {
            template,
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
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

// LRU Cache implementation for gateway clients
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

export function getConvexGatewayClient(event: H3Event, token: string): ConvexHttpClient {
    const config = useRuntimeConfig() as RuntimeConfigWithConvex;
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

    const cacheKey = `${url}:${token}`;
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
