/**
 * Proxy-aware same-origin protection for authenticated browser mutations.
 *
 * A sibling subdomain is same-site for cookies but is not same-origin. This
 * guard therefore compares the browser's exact Origin (or Referer origin) to
 * the effective request origin after applying the configured proxy policy.
 */
import { createError, getRequestHeader } from 'h3';
import type { H3Event } from 'h3';
import { useRuntimeConfig } from '#imports';
import {
    getProxyRequestHost,
    getProxyRequestProtocol,
    normalizeProxyTrustConfig,
} from '../net/request-identity';

export interface SameOriginMutationOptions {
    intentHeader: string;
    intentValue: string;
    requireJson?: boolean;
}

function isMutationMethod(method?: string): boolean {
    const normalized = (method || 'GET').toUpperCase();
    return !['GET', 'HEAD', 'OPTIONS'].includes(normalized);
}

function parseHttpRequestSource(
    value: string | undefined,
    requireSerializedOrigin: boolean
): URL | null {
    if (!value) return null;
    try {
        const parsed = new URL(value);
        if (
            (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
            parsed.username ||
            parsed.password ||
            (requireSerializedOrigin && parsed.origin !== value)
        ) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

function requireJsonContentType(event: H3Event): void {
    const contentType = getRequestHeader(event, 'content-type');
    const mediaType = contentType?.split(';', 1)[0]?.trim().toLowerCase();
    if (mediaType !== 'application/json') {
        throw createError({
            statusCode: 415,
            statusMessage: 'JSON request required',
        });
    }
}

export function requireSameOriginMutation(
    event: H3Event,
    options: SameOriginMutationOptions
): void {
    if (!isMutationMethod(event.method)) return;

    if (
        getRequestHeader(event, options.intentHeader) !== options.intentValue
    ) {
        throw createError({
            statusCode: 403,
            statusMessage: 'Forbidden: Missing mutation intent',
        });
    }

    if (options.requireJson) {
        requireJsonContentType(event);
    }

    const originHeader = getRequestHeader(event, 'origin');
    const requestSource = parseHttpRequestSource(
        originHeader || getRequestHeader(event, 'referer'),
        Boolean(originHeader)
    );
    if (!requestSource) {
        throw createError({
            statusCode: 403,
            statusMessage: 'Forbidden: Origin validation failed',
        });
    }

    const proxyConfig = normalizeProxyTrustConfig(
        useRuntimeConfig(event).security.proxy
    );
    const requestHost = getProxyRequestHost(event, proxyConfig);
    const requestProtocol = getProxyRequestProtocol(event, proxyConfig);
    if (!requestHost || !requestProtocol) {
        throw createError({
            statusCode: 403,
            statusMessage: 'Forbidden: Host resolution failed',
        });
    }

    let requestOrigin: string;
    try {
        requestOrigin = new URL(`${requestProtocol}://${requestHost}`).origin;
    } catch {
        throw createError({
            statusCode: 403,
            statusMessage: 'Forbidden: Host resolution failed',
        });
    }

    if (requestOrigin !== requestSource.origin) {
        throw createError({
            statusCode: 403,
            statusMessage: 'Forbidden: Origin mismatch',
        });
    }
}
