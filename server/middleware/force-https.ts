import { defineEventHandler, getHeader, sendRedirect } from 'h3';
import { useRuntimeConfig } from '#imports';

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
 * - Determines protocol using (in order): `x-forwarded-proto`, then socket
 *   encryption state.
 * - If the request is not HTTPS and a `Host` header is present, issues a 301
 *   redirect to `https://{host}{url}`.
 *
 * Constraints:
 * - Correct proxy behavior depends on your proxy config emitting
 *   `x-forwarded-proto`.
 * - If `Host` is missing, it does nothing (cannot construct a safe target).
 *
 * Non-Goals:
 * - HSTS headers. Set those at the edge or via a dedicated middleware.
 * - Canonical host enforcement. This middleware preserves the inbound host.
 */

export default defineEventHandler((event) => {
    const config = useRuntimeConfig();
    const forceHttps = config.security.forceHttps === true;
    if (!forceHttps) return;

    const xfProto = getHeader(event, 'x-forwarded-proto');
    const socket = event.node.req.socket as (typeof event.node.req.socket & {
        encrypted?: boolean;
    });
    const proto = xfProto || (socket.encrypted ? 'https' : 'http');

    if (proto === 'https') return;

    const host = getHeader(event, 'host');
    if (!host) return;

    const target = `https://${host}${event.node.req.url || ''}`;
    return sendRedirect(event, target, 301);
});
