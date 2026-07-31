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
import { createError } from 'h3';
import type { H3Event } from 'h3';
import { isSsrAuthEnabled } from '../utils/auth/is-ssr-auth-enabled';
import { normalizeHost } from '../utils/normalize-host';
import { useRuntimeConfig } from '#imports';
import { requireSameOriginMutation } from '../utils/security/mutation-guard';
import {
    getProxyRequestHost,
    normalizeProxyTrustConfig,
} from '../utils/net/request-identity';

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
 * 3. Enforces that the `Origin` (or `Referer`) exactly matches the effective
 *    request scheme, host, and port.
 * 
 * @throws 403 if CSRF or intent checks fail.
 */
export function requireAdminMutation(event: H3Event): void {
    requireSameOriginMutation(event, {
        intentHeader: 'x-or3-admin-intent',
        intentValue: 'admin',
    });
}
