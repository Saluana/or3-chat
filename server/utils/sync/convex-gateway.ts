/**
 * Convex gateway helpers for SSR sync endpoints.
 */
import type { H3Event } from 'h3';
import { createError } from 'h3';
import { ConvexHttpClient } from 'convex/browser';
import { useRuntimeConfig } from '#imports';

export async function getClerkProviderToken(
    event: H3Event,
    template?: string
): Promise<string | null> {
    const auth: unknown = event.context.auth?.();
    const getToken =
        auth && typeof (auth as { getToken?: unknown }).getToken === 'function'
            ? ((auth as {
                  getToken: (options?: {
                      template?: string;
                      skipCache?: boolean;
                  }) => Promise<string | null>;
              }).getToken)
            : undefined;

    if (!getToken) {
        return null;
    }

    try {
        return await getToken({ template, skipCache: false });
    } catch (error) {
        console.error('[sync-gateway] Failed to mint provider token:', error);
        return null;
    }
}

type RuntimeConfigWithConvex = {
    public?: {
        convex?: {
            url?: string;
        };
    };
    convex?: {
        url?: string;
    };
};

export function getConvexGatewayClient(event: H3Event, token: string): ConvexHttpClient {
    const config = useRuntimeConfig() as RuntimeConfigWithConvex;
    const url = config.public?.convex?.url || config.convex?.url;

    if (!url) {
        throw createError({
            statusCode: 500,
            statusMessage: 'Convex URL not configured',
        });
    }

    const client = new ConvexHttpClient(url);
    client.setAuth(token);
    return client;
}
