import { createError, type H3Event } from 'h3';
import { normalizeHost } from '../normalize-host';
import {
    getProxyRequestHost,
    normalizeProxyTrustConfig,
    type ProxyTrustConfigInput,
} from '../net/request-identity';

/** Enforce the configured admin host allowlist, failing closed with a 404. */
export function requireAllowedAdminHost(
    event: H3Event,
    allowedHosts: readonly string[] | undefined,
    proxyConfig?: ProxyTrustConfigInput,
): void {
    const normalizedAllowedHosts = (allowedHosts ?? [])
        .map((host) => host.trim())
        .filter(Boolean)
        .map(normalizeHost);
    if (normalizedAllowedHosts.length === 0) return;

    const requestHost = getProxyRequestHost(
        event,
        normalizeProxyTrustConfig(proxyConfig),
    );
    if (!requestHost || !normalizedAllowedHosts.includes(normalizeHost(requestHost))) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }
}
