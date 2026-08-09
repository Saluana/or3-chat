import { defineEventHandler, getHeader, sendRedirect } from 'h3';
import { useRuntimeConfig } from '#imports';
import { normalizeHost } from '../utils/normalize-host';
import {
    getProxyRequestProtocol,
    normalizeProxyTrustConfig,
} from '../utils/net/request-identity';

/**
 * @module server/middleware/force-https
 *
 * Purpose:
 * Enforces HTTPS by redirecting HTTP requests to the equivalent HTTPS URL.
 * This is a deployment guardrail for environments where TLS is terminated at a
 * load balancer or reverse proxy but the application can still receive plain
 * HTTP traffic.
 *
 * Behavior:
 * - No-ops unless `runtimeConfig.security.forceHttps === true`.
 * - Supports runtime env overrides for prebuilt artifacts:
 *   `NUXT_SECURITY_FORCE_HTTPS`, then `OR3_FORCE_HTTPS`.
 * - Determines protocol using (in order): `x-forwarded-proto`, then socket
 *   encryption state.
 * - If the request is not HTTPS and a `Host` header is present, issues a 301
 *   redirect to `https://{host}{url}`.
 *
 * Constraints:
 * - `x-forwarded-proto` is only trusted when `security.proxy.trustProxy` is true.
 * - Loopback hosts (`localhost`, `127.0.0.1`, `[::1]`) are never redirected.
 * - If `Host` is missing, it does nothing (cannot construct a safe target).
 *
 * Non-Goals:
 * - HSTS headers. Set those at the edge or via a dedicated middleware.
 * - Canonical host enforcement. This middleware preserves the inbound host.
 */

export default defineEventHandler((event) => {
    // During `nuxt generate`, prerender requests run over plain HTTP on localhost.
    // Redirecting them to HTTPS would bake meta-refresh redirect pages into static output.
    if (import.meta.prerender) return;

    const config = useRuntimeConfig();
    const forceHttpsOverride =
        process.env.NUXT_SECURITY_FORCE_HTTPS ?? process.env.OR3_FORCE_HTTPS;
    const forceHttps =
        forceHttpsOverride !== undefined
            ? forceHttpsOverride === 'true'
            : config.security.forceHttps === true;
    if (!forceHttps) return;

    const host = getHeader(event, 'host');
    if (!host) return;
    if (normalizeHost(host) === 'localhost') return;

    const proto = getProxyRequestProtocol(
        event,
        normalizeProxyTrustConfig(config.security.proxy),
    );

    if (proto === 'https') return;

    const target = `https://${host}${event.node.req.url || ''}`;
    return sendRedirect(event, target, 301);
});
