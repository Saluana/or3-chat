import {
    defineEventHandler,
    getHeader,
    setHeader,
    setResponseStatus,
    getResponseHeader,
} from 'h3';
import { useRuntimeConfig } from '#imports';

/**
 * @module server/middleware/cors
 *
 * Purpose:
 * Emits spec-correct CORS response headers for browser requests.
 * This middleware exists to support OR3 deployments where the UI and API may be
 * served from different origins, while keeping credential handling correct.
 *
 * Behavior:
 * - If the request has no `Origin` header, it does nothing.
 * - Rejects malformed/non-HTTP serialized origins before emitting CORS access.
 * - If `security.allowedOrigins` is empty, all origins are allowed and
 *   `Access-Control-Allow-Origin: *` is emitted.
 * - If `security.allowedOrigins` is non-empty, only exact matches are allowed.
 *   For allowed origins, the middleware echoes the origin and enables
 *   `Access-Control-Allow-Credentials: true`.
 * - Appends `Origin` to `Vary` before allowlist evaluation so cached blocked
 *   responses cannot poison responses for allowed origins.
 * - For `OPTIONS` preflight requests, responds with 204 and emits
 *   allow-methods and allow-headers.
 *
 * Constraints:
 * - Never emits `Access-Control-Allow-Credentials` together with `*`.
 * - Allowlist matching is exact string match. Scheme and port must match.
 *
 * Non-Goals:
 * - Pattern matching or wildcard allowlists.
 * - Setting `Access-Control-Max-Age` (left to deployment policy).
 */

export default defineEventHandler((event) => {
    const config = useRuntimeConfig();
    const allowedOrigins = config.security.allowedOrigins;
    const origin = getHeader(event, 'origin');

    if (!origin) return;

    appendVaryOrigin(event);
    if (!isValidCorsOrigin(origin)) return;

    const allowAll = allowedOrigins.length === 0;
    if (!allowAll && !allowedOrigins.includes(origin)) return;

    // Never emit '*' with credentials (spec violation)
    // Only emit credentials header when echoing an explicit origin
    if (allowAll) {
        setHeader(event, 'Access-Control-Allow-Origin', '*');
        // Do NOT emit Access-Control-Allow-Credentials with '*'
    } else {
        setHeader(event, 'Access-Control-Allow-Origin', origin);
        setHeader(event, 'Access-Control-Allow-Credentials', 'true');
    }

    if (event.method === 'OPTIONS') {
        const reqHeaders = getHeader(event, 'access-control-request-headers');
        setHeader(
            event,
            'Access-Control-Allow-Methods',
            'GET,POST,PUT,PATCH,DELETE,OPTIONS'
        );
        setHeader(
            event,
            'Access-Control-Allow-Headers',
            reqHeaders || 'Content-Type,Authorization'
        );
        setHeader(event, 'Access-Control-Max-Age', 3600);
        setResponseStatus(event, 204);
        return '';
    }
});

function appendVaryOrigin(event: Parameters<typeof getResponseHeader>[0]): void {
    const existingVary = getResponseHeader(event, 'Vary');
    if (existingVary) {
        const varyValues = existingVary.toString().split(',').map(v => v.trim());
        if (!varyValues.some((value) => value.toLowerCase() === 'origin')) {
            setHeader(event, 'Vary', `${existingVary}, Origin`);
        }
    } else {
        setHeader(event, 'Vary', 'Origin');
    }
}

function isValidCorsOrigin(origin: string): boolean {
    if (origin === 'null') {
        return true;
    }

    try {
        const parsed = new URL(origin);
        return (
            (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
            !parsed.username &&
            !parsed.password &&
            parsed.origin === origin
        );
    } catch {
        return false;
    }
}
