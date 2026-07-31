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
    if (isLoopbackHost(host)) return;

    const trustProxy = config.security.proxy.trustProxy === true;
    const xfProto = trustProxy ? parseForwardedProto(getHeader(event, 'x-forwarded-proto')) : null;
    const socket = event.node.req.socket as (typeof event.node.req.socket & {
        encrypted?: boolean;
    });
    const proto = xfProto ?? (socket.encrypted ? 'https' : 'http');

    if (proto === 'https') return;

    const target = `https://${host}${event.node.req.url || ''}`;
    return sendRedirect(event, target, 301);
});

function parseForwardedProto(raw: string | undefined): 'http' | 'https' | null {
    if (!raw) return null;
    const first = raw.split(',')[0]?.trim().toLowerCase();
    if (first === 'http' || first === 'https') return first;
    return null;
}

function normalizeHost(rawHost: string): string {
    const host = rawHost.trim().toLowerCase();
    if (host.startsWith('[')) {
        const end = host.indexOf(']');
        return end > 0 ? host.slice(1, end) : host;
    }
    return host.split(':')[0] ?? host;
}

function isLoopbackHost(rawHost: string): boolean {
    const host = normalizeHost(rawHost);
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}
