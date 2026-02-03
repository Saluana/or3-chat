/**
 * @module server/utils/net/request-identity
 *
 * Purpose:
 * Proxy-safe request identity helpers for SSR endpoints.
 * These utilities extract client identity and host information while respecting
 * trusted proxy configuration.
 *
 * Responsibilities:
 * - Normalize proxy trust configuration.
 * - Extract client IP from trusted forwarded headers or socket address.
 * - Extract host value from trusted forwarded headers or Host header.
 *
 * Non-Goals:
 * - Full IP validation or geo-location.
 * - Parsing Proxy Protocol or other non-HTTP identity schemes.
 *
 * Constraints:
 * - When `trustProxy` is enabled, missing or invalid forwarded headers return null.
 * - All results are best-effort and should be treated as untrusted unless validated.
 */

import type { H3Event } from 'h3';
import { getHeader } from 'h3';

/**
 * Purpose:
 * Enumerates supported forwarded-for header names.
 */
export type ForwardedForHeader = 'x-forwarded-for' | 'x-real-ip';

/**
 * Purpose:
 * Enumerates supported forwarded-host header names.
 */
export type ForwardedHostHeader = 'x-forwarded-host';

/**
 * Purpose:
 * Normalized proxy trust configuration.
 *
 * Constraints:
 * - Header names are restricted to known values to avoid spoofed configuration.
 */
export interface ProxyTrustConfig {
    /** Whether to trust X-Forwarded-* headers from proxies */
    trustProxy: boolean;
    /** Header name for client IP (default: x-forwarded-for) */
    forwardedForHeader?: ForwardedForHeader;
    /** Header name for forwarded host (default: x-forwarded-host) */
    forwardedHostHeader?: ForwardedHostHeader;
}

/**
 * Purpose:
 * Input shape for proxy trust configuration before normalization.
 *
 * Constraints:
 * - Unknown header names are ignored and replaced with defaults.
 */
export interface ProxyTrustConfigInput {
    trustProxy?: boolean;
    forwardedForHeader?: string;
    forwardedHostHeader?: string;
}

/**
 * Purpose:
 * Normalize optional proxy trust settings into a safe, typed config.
 *
 * Behavior:
 * - Defaults to `trustProxy = false`.
 * - Allows only known forwarded header names.
 *
 * Non-Goals:
 * - Validation that the proxy chain is actually trustworthy.
 */
export function normalizeProxyTrustConfig(
    input?: ProxyTrustConfigInput
): ProxyTrustConfig {
    const trustProxy = input?.trustProxy === true;
    const forwardedForHeader: ForwardedForHeader =
        input?.forwardedForHeader === 'x-real-ip'
            ? 'x-real-ip'
            : 'x-forwarded-for';
    const forwardedHostHeader: ForwardedHostHeader =
        input?.forwardedHostHeader === 'x-forwarded-host'
            ? 'x-forwarded-host'
            : 'x-forwarded-host';
    return {
        trustProxy,
        forwardedForHeader,
        forwardedHostHeader,
    };
}

/**
 * Simple IPv4 and IPv6 validation regex.
 * Matches common IP formats but not all edge cases.
 */
const IP_REGEX = /^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:.]+$/;

function normalizeHeaderValue(
    value: unknown
): string | string[] | undefined {
    if (typeof value === 'string') return value;
    if (
        Array.isArray(value) &&
        value.every((entry) => typeof entry === 'string')
    ) {
        return value as string[];
    }
    return undefined;
}

/**
 * Parse X-Forwarded-For header and return the first valid IP.
 *
 * Format: client, proxy1, proxy2, ...
 */
function parseForwardedFor(headerValue: string): string | null {
    if (!headerValue) return null;

    // Split by comma and take the first entry
    const firstIp = headerValue.split(',')[0]?.trim();
    if (!firstIp) return null;

    // Validate basic IP shape
    if (!IP_REGEX.test(firstIp)) return null;

    return firstIp;
}

/**
 * Purpose:
 * Resolve the client IP for an incoming request.
 *
 * Behavior:
 * - When `trustProxy` is enabled, uses the configured forwarded-for header.
 * - When `trustProxy` is disabled, returns the socket remote address.
 * - Fails closed to `null` when forwarded headers are missing or invalid.
 *
 * Constraints:
 * - Returned IPs are not verified beyond basic shape checks.
 * - Trusting forwarded headers requires a trusted proxy boundary.
 *
 * Non-Goals:
 * - Filtering private or reserved IP ranges.
 */
export function getClientIp(
    event: H3Event,
    cfg: ProxyTrustConfig
): string | null {
    if (cfg.trustProxy) {
        const headerName = cfg.forwardedForHeader ?? 'x-forwarded-for';
        const forwardedHeader = normalizeHeaderValue(
            getHeader(event, headerName)
        );

        if (forwardedHeader) {
            const parsed = parseForwardedFor(
                Array.isArray(forwardedHeader) ? forwardedHeader[0]! : forwardedHeader
            );
            if (parsed) return parsed;
        }

        // If forwarded header is missing or invalid, fail closed.
        return null;
    }

    // Trust proxy disabled: use socket address directly
    const socketAddr = event.node.req.socket.remoteAddress;
    return socketAddr || null;
}

/**
 * Purpose:
 * Resolve the request host for an incoming request.
 *
 * Behavior:
 * - When `trustProxy` is enabled, uses the configured forwarded-host header.
 * - When `trustProxy` is disabled, uses the Host header.
 * - Fails closed to `null` when forwarded headers are missing or invalid.
 *
 * Constraints:
 * - Returns lowercased host values for consistent comparisons.
 * - Does not strip ports; callers can normalize if needed.
 */
export function getProxyRequestHost(
    event: H3Event,
    cfg: ProxyTrustConfig
): string | null {
    if (cfg.trustProxy) {
        const headerName = cfg.forwardedHostHeader ?? 'x-forwarded-host';
        const forwardedHost = normalizeHeaderValue(
            getHeader(event, headerName)
        );

        if (forwardedHost) {
            const hostValue = Array.isArray(forwardedHost)
                ? forwardedHost[0]!
                : forwardedHost;
            const firstHost = hostValue.split(',')[0]?.trim();
            if (firstHost && firstHost.length > 0) {
                return firstHost.toLowerCase();
            }
        }

        // Fail closed when trustProxy is enabled and forwarded host is missing or invalid.
        return null;
    }

    // Use Host header
    const hostHeader = getHeader(event, 'host');
    const normalizedHost = normalizeHeaderValue(hostHeader);
    if (normalizedHost) {
        const host = Array.isArray(normalizedHost)
            ? normalizedHost[0]!
            : normalizedHost;
        return host.trim().toLowerCase();
    }

    return null;
}
