/**
 * @module server/admin/guard.ts
 *
 * Purpose:
 * Network and protocol-level guards for Admin API requests. Provides "defense in depth"
 * by enforcing host whitelisting and CSRF protection before any logic executes.
 *
 * Responsibilities:
 * - **Host Gating**: Restricts admin traffic to specific hostnames (e.g., `admin.example.com`).
 * - **CSRF Protection**: Enforces Same-Origin checks for state-changing mutations.
 * - **Intent Gating**: Requires specific custom headers (`x-or3-admin-intent`) to prevent
 *   accidental or automated browser-only clicks from triggering admin actions.
 *
 * Security Characteristics:
 * - Returns 404 for host failures to minimize the detectable surface area (security by obscurity).
 * - Enforces SSR auth enablement check as a global prerequisite.
 *
 * Constraints:
 * - Host validation supports proxy trust levels (X-Forwarded-Host).
 */
import { createError, getRequestHeader } from 'h3';
import type { H3Event } from 'h3';
import { isSsrAuthEnabled } from '../utils/auth/is-ssr-auth-enabled';
import { normalizeHost } from '../utils/normalize-host';
import { useRuntimeConfig } from '#imports';
import { getProxyRequestHost, normalizeProxyTrustConfig } from '../utils/net/request-identity';

/**
 * Checks if the request method implies a state change.
 */
function isMutationMethod(method?: string): boolean {
    const normalized = (method || 'GET').toUpperCase();
    return !['GET', 'HEAD', 'OPTIONS'].includes(normalized);
}

/**
 * Safely extracts the host portion from an Origin or Referer header.
 */
function getOriginHost(origin?: string): string | null {
    if (!origin) return null;
    try {
        return new URL(origin).host;
    } catch {
        return null;
    }
}

/**
 * Purpose:
 * Enforces architectural gates for all admin requests.
 * 
 * Behavior:
 * 1. Verifies SSR auth is enabled.
 * 2. Compares the request host against the `admin.allowedHosts` whitelist.
 * 3. Throws 404 on failure to avoid leaking route existence.
 * 
 * @throws 404 if SSR is disabled or host is not whitelisted.
 */
export function requireAdminRequest(event: H3Event): void {
    if (!isSsrAuthEnabled(event)) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

    const config = useRuntimeConfig(event);
    
    // Normalize and filter allowed hosts
    const allowedHosts = config.admin.allowedHosts
        .map((host) => host.trim())
        .filter(Boolean)
        .map((host) => normalizeHost(host));

    if (allowedHosts.length === 0) return;

    // Resolve true request host (handling proxies)
    const proxyConfig = normalizeProxyTrustConfig(config.security.proxy);
    const requestHost = getProxyRequestHost(event, proxyConfig);

    if (!requestHost) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

    const normalizedHost = normalizeHost(requestHost);
    if (!allowedHosts.includes(normalizedHost)) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }
}

/**
 * Purpose:
 * Implements CSRF and accidental-trigger protection for admin mutations.
 * 
 * Behavior:
 * 1. Skips for safe methods (GET, HEAD, OPTIONS).
 * 2. Requires `x-or3-admin-intent: admin` header.
 * 3. Enforces that the `Origin` (or `Referer`) exactly matches the `Host`.
 * 
 * @throws 403 if CSRF or intent checks fail.
 */
export function requireAdminMutation(event: H3Event): void {
    if (!isMutationMethod(event.method)) return;

    // Explicit intent check
    const intent = getRequestHeader(event, 'x-or3-admin-intent');
    if (intent !== 'admin') {
        throw createError({ statusCode: 403, statusMessage: 'Forbidden: Missing admin intent' });
    }

    // Origin/Referer matching (Same-Origin-ish)
    const origin =
        getRequestHeader(event, 'origin') || getRequestHeader(event, 'referer');
    const originHost = getOriginHost(origin || undefined);
    if (!originHost) {
        throw createError({ statusCode: 403, statusMessage: 'Forbidden: Origin validation failed' });
    }

    const proxyConfig = normalizeProxyTrustConfig(useRuntimeConfig(event).security.proxy);
    const requestHost = getProxyRequestHost(event, proxyConfig);

    if (!requestHost) {
        throw createError({ statusCode: 403, statusMessage: 'Forbidden: Host resolution failed' });
    }

    const normalizedHost = normalizeHost(requestHost);
    const normalizedOrigin = normalizeHost(originHost);
    if (normalizedHost !== normalizedOrigin) {
        throw createError({ statusCode: 403, statusMessage: 'Forbidden: Origin mismatch' });
    }
}
