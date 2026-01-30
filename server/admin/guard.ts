import { createError, getRequestHeader } from 'h3';
import type { H3Event } from 'h3';
import { isSsrAuthEnabled } from '../utils/auth/is-ssr-auth-enabled';
import { normalizeHost } from '../utils/normalize-host';
import { useRuntimeConfig } from '#imports';

function isMutationMethod(method?: string): boolean {
    const normalized = (method || 'GET').toUpperCase();
    return !['GET', 'HEAD', 'OPTIONS'].includes(normalized);
}

function getOriginHost(origin?: string): string | null {
    if (!origin) return null;
    try {
        return new URL(origin).host;
    } catch {
        return null;
    }
}

export function requireAdminRequest(event: H3Event): void {
    if (!isSsrAuthEnabled(event)) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
    const config = (useRuntimeConfig(event) || {}) as any;
    const adminConfig = config.admin as { allowedHosts?: string[] } | undefined;
    const allowedHosts = (adminConfig?.allowedHosts || [])
        .map((host) => host.trim())
        .filter(Boolean)
        .map((host) => normalizeHost(host));

    if (allowedHosts.length === 0) return;

    const hostHeader = getRequestHeader(event, 'host') || '';
    const normalizedHost = normalizeHost(hostHeader);
    if (!allowedHosts.includes(normalizedHost)) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }
}

export function requireAdminMutation(event: H3Event): void {
    if (!isMutationMethod(event.method)) return;

    const intent = getRequestHeader(event, 'x-or3-admin-intent');
    if (intent !== 'admin') {
        throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
    }

    const origin =
        getRequestHeader(event, 'origin') || getRequestHeader(event, 'referer');
    const originHost = getOriginHost(origin || undefined);
    if (!originHost) {
        throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
    }

    const hostHeader = getRequestHeader(event, 'host') || '';
    const normalizedHost = normalizeHost(hostHeader);
    const normalizedOrigin = normalizeHost(originHost);
    if (normalizedHost !== normalizedOrigin) {
        throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
    }
}
