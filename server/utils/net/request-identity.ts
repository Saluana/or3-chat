/**
 * Proxy-safe request identity utilities.
 * 
 * Provides functions to safely extract client IP and request host,
 * respecting trusted proxy configuration.
 * 
 * When behind a reverse proxy (e.g., nginx, Cloudflare), the socket address
 * is the proxy's IP, not the client's. These utilities parse X-Forwarded-*
 * headers when trustProxy is enabled, falling back to direct connection
 * info otherwise.
 */

import type { H3Event } from 'h3';
import { getHeader } from 'h3';

export type ForwardedForHeader = 'x-forwarded-for' | 'x-real-ip';
export type ForwardedHostHeader = 'x-forwarded-host';

export interface ProxyTrustConfig {
    /** Whether to trust X-Forwarded-* headers from proxies */
    trustProxy: boolean;
    /** Header name for client IP (default: x-forwarded-for) */
    forwardedForHeader?: ForwardedForHeader;
    /** Header name for forwarded host (default: x-forwarded-host) */
    forwardedHostHeader?: ForwardedHostHeader;
}

export interface ProxyTrustConfigInput {
    trustProxy?: boolean;
    forwardedForHeader?: string;
    forwardedHostHeader?: string;
}

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
 * Simple IPv4/IPv6 validation regex.
 * Matches common IP formats but not all edge cases.
 */
const IP_REGEX = /^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:.]+$/;

/**
 * Parse X-Forwarded-For header and return the first valid IP.
 * 
 * Format: client, proxy1, proxy2, ...
 * We take the first (client) IP.
 */
function parseForwardedFor(headerValue: string): string | null {
    if (!headerValue) return null;

    // Split by comma and take the first entry
    const firstIp = headerValue.split(',')[0]?.trim();
    if (!firstIp) return null;

    // Validate basic IP shape
    if (!IP_REGEX.test(firstIp)) return null;

    // Additional validation: reject private/local IPs if needed
    // For now, we accept any valid-looking IP
    return firstIp;
}

/**
 * Get the client IP address from the request.
 * 
 * When trustProxy is true, parses X-Forwarded-For header.
 * Otherwise, uses the socket's remote address.
 * 
 * @param event - The H3 event
 * @param cfg - Proxy trust configuration
 * @returns The client IP, or null if it cannot be determined
 */
export function getClientIp(event: H3Event, cfg: ProxyTrustConfig): string | null {
    if (cfg.trustProxy) {
        const headerName = cfg.forwardedForHeader ?? 'x-forwarded-for';
        const forwardedHeader = getHeader(event, headerName);

        if (forwardedHeader) {
            const parsed = parseForwardedFor(
                Array.isArray(forwardedHeader) ? forwardedHeader[0]! : forwardedHeader
            );
            if (parsed) return parsed;
        }

        // If forwarded header is missing/invalid, fall through to socket address
        // but return null to indicate we couldn't get a trusted identity
        return null;
    }

    // Trust proxy disabled: use socket address directly
    const socketAddr = event.node.req.socket.remoteAddress;
    return socketAddr || null;
}

/**
 * Get the request host (hostname) from the request.
 * 
 * When trustProxy is true, uses X-Forwarded-Host header.
 * Otherwise, uses the Host header.
 * 
 * @param event - The H3 event
 * @param cfg - Proxy trust configuration
 * @returns The request host, or null if it cannot be determined
 */
export function getProxyRequestHost(
    event: H3Event,
    cfg: ProxyTrustConfig
): string | null {
    if (cfg.trustProxy) {
        const headerName = cfg.forwardedHostHeader ?? 'x-forwarded-host';
        const forwardedHost = getHeader(event, headerName);

        if (forwardedHost) {
            const hostValue = Array.isArray(forwardedHost)
                ? forwardedHost[0]!
                : forwardedHost;
            const firstHost = hostValue.split(',')[0]?.trim();
            if (firstHost && firstHost.length > 0) {
                return firstHost.toLowerCase();
            }
        }

        // Fail closed when trustProxy is enabled and forwarded host is missing/invalid
        return null;
    }

    // Use Host header
    const hostHeader = getHeader(event, 'host');
    if (hostHeader) {
        const host = Array.isArray(hostHeader) ? hostHeader[0]! : hostHeader;
        return host.trim().toLowerCase();
    }

    return null;
}
