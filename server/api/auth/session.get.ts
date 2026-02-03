/**
 * @module server/api/auth/session.get
 *
 * Purpose:
 * Retrieves the current authentication state for the active request.
 *
 * Responsibilities:
 * - Bootstraps client-side session state during hydration.
 * - Checks rate limits (`auth:session`) by IP to prevent enumeration.
 * - Disables caching (`Cache-Control: no-store`) to prevent leakage.
 */
import { defineEventHandler, createError, setResponseHeader } from 'h3';
import { resolveSessionContext } from '../../auth/session';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { 
    checkSyncRateLimit, 
    recordSyncRequest,
    getSyncRateLimitStats,
} from '../../utils/sync/rate-limiter';
import { getClientIp, normalizeProxyTrustConfig } from '../../utils/net/request-identity';

/**
 * GET /api/auth/session
 *
 * Purpose:
 * Session bootstrapper.
 *
 * Behavior:
 * 1. Checks feature flag (`SSR_AUTH_ENABLED`).
 * 2. Rate limits by IP.
 * 3. Resolves session context from cookies/tokens.
 * 4. Returns session object or null.
 *
 * Security:
 * - Never cached.
 * - Rate limited.
 */
export default defineEventHandler(async (event) => {
    // If SSR auth is disabled, always return null session
    if (!isSsrAuthEnabled(event)) {
        return { session: null };
    }

    // Get proxy-safe client IP
    const config = useRuntimeConfig();
    const proxyConfig = normalizeProxyTrustConfig(config.security.proxy);
    
    const clientIP = getClientIp(event, proxyConfig) || 
        event.node.req.socket.remoteAddress || 
        'unknown';

    // Rate limit per IP to prevent session enumeration and DOS
    const rateLimitResult = checkSyncRateLimit(clientIP, 'auth:session');
    
    if (!rateLimitResult.allowed) {
        const retryAfterSec = Math.ceil((rateLimitResult.retryAfterMs ?? 1000) / 1000);
        setResponseHeader(event, 'Retry-After', retryAfterSec);
        throw createError({
            statusCode: 429,
            statusMessage: `Rate limit exceeded. Retry after ${retryAfterSec}s`,
        });
    }

    // Add rate limit headers for client visibility
    const stats = getSyncRateLimitStats(clientIP, 'auth:session');
    if (stats) {
        setResponseHeader(event, 'X-RateLimit-Limit', String(stats.limit));
        setResponseHeader(event, 'X-RateLimit-Remaining', String(stats.remaining));
    }

    const session = await resolveSessionContext(event);

    // Session responses must never be cached.
    // Caching here causes stale workspace selection after switching workspaces.
    setResponseHeader(event, 'Cache-Control', 'no-store');

    // Record successful request for rate limiting
    recordSyncRequest(clientIP, 'auth:session');

    return {
        session: session.authenticated ? session : null,
    };
});

export const SESSION_CACHE_CONTROL = 'no-store';
