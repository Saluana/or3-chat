/**
 * Convex gateway helpers for SSR sync endpoints.
 */
import type { H3Event } from 'h3';
import { createError } from 'h3';
import { ConvexHttpClient } from 'convex/browser';
import { useRuntimeConfig } from '#imports';
import { z } from 'zod';

// Validate Clerk auth context structure
const ClerkAuthContextSchema = z.object({
    getToken: z.function()
        .args(z.object({
            template: z.string().optional(),
            skipCache: z.boolean().optional(),
        }).optional())
        .returns(z.promise(z.string().nullable())),
});

export async function getClerkProviderToken(
    event: H3Event,
    template?: string
): Promise<string | null> {
    const authResult = event.context.auth?.();
    if (!authResult) {
        return null;
    }

    // Validate auth context structure
    const parsed = ClerkAuthContextSchema.safeParse(authResult);
    if (!parsed.success) {
        console.error('[sync-gateway] Invalid auth context structure:', {
            error: parsed.error.message,
        });
        return null;
    }

    try {
        const token = await parsed.data.getToken({ template, skipCache: false });
        
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

const gatewayClientCache = new Map<string, ConvexHttpClient>();
const MAX_GATEWAY_CLIENTS = 50;

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
        return cached;
    }

    const client = new ConvexHttpClient(url);
    client.setAuth(token);
    gatewayClientCache.set(cacheKey, client);

    if (gatewayClientCache.size > MAX_GATEWAY_CLIENTS) {
        const oldestKey = gatewayClientCache.keys().next().value;
        if (oldestKey) {
            gatewayClientCache.delete(oldestKey);
        }
    }

    return client;
}
