/**
 * GET /api/auth/session
 * Returns the current session context or null if not authenticated.
 */
import { defineEventHandler, createError, setResponseHeader } from 'h3';
import { resolveSessionContext } from '../../auth/session';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { 
    checkSyncRateLimit, 
    recordSyncRequest,
    getSyncRateLimitStats,
} from '../../utils/sync/rate-limiter';

export default defineEventHandler(async (event) => {
    // If SSR auth is disabled, always return null session
    if (!isSsrAuthEnabled(event)) {
        return { session: null };
    }

    // Rate limit per IP to prevent session enumeration and DOS
    const clientIP = event.node.req.socket.remoteAddress || 'unknown';
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
    
    // Set cache headers to reduce server load
    if (session.authenticated) {
        // Cache authenticated sessions for 60s
        setResponseHeader(event, 'Cache-Control', 'private, max-age=60');
    } else {
        // Don't cache unauthenticated responses
        setResponseHeader(event, 'Cache-Control', 'no-store');
    }

    // Record successful request for rate limiting
    recordSyncRequest(clientIP, 'auth:session');

    return {
        session: session.authenticated ? session : null,
    };
});
