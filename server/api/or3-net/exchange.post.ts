import {
    createError,
    defineEventHandler,
    getRequestHeader,
    readBody,
    setResponseHeader,
    type H3Event,
} from 'h3';
import { z } from 'zod';

import { requireCan } from '../../auth/can';
import { resolveSessionContext } from '../../auth/session';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import { setNoCacheHeaders } from '../../utils/headers';
import { normalizeHost } from '../../utils/normalize-host';
import {
    getClientIp,
    getProxyRequestHost,
    normalizeProxyTrustConfig,
} from '../../utils/net/request-identity';
import {
    checkSyncRateLimit,
    recordSyncRequest,
} from '../../utils/sync/rate-limiter';
import {
    issueOr3NetHostAssertion,
    OR3_NET_PROVIDER,
    resolveOr3NetScopes,
    type Or3NetExchangeResponse,
} from '../../utils/or3-net/assertion';
import { getOr3NetServerConfig } from '../../utils/or3-net/config';

const bodySchema = z
    .object({
        workspace_id: z.string().trim().min(1).optional(),
    })
    .partial()
    .default({});

function getOriginHost(value: string | null): string | null {
    if (!value) return null;
    try {
        return new URL(value).host;
    } catch {
        return null;
    }
}

function enforceSameOriginMutation(event: H3Event): void {
    const originHeader =
        getRequestHeader(event, 'origin') ?? getRequestHeader(event, 'referer');

    if (!originHeader) {
        return;
    }

    const originHost = getOriginHost(originHeader);
    if (!originHost) {
        throw createError({
            statusCode: 403,
            statusMessage: 'Forbidden: Origin validation failed',
        });
    }

    const runtimeConfig = useRuntimeConfig();
    const proxyConfig = normalizeProxyTrustConfig(runtimeConfig.security.proxy);
    const requestHost = getProxyRequestHost(event, proxyConfig);
    if (!requestHost) {
        throw createError({
            statusCode: 403,
            statusMessage: 'Forbidden: Host resolution failed',
        });
    }

    if (normalizeHost(originHost) !== normalizeHost(requestHost)) {
        throw createError({
            statusCode: 403,
            statusMessage: 'Forbidden: Origin mismatch',
        });
    }
}

function parseJsonResponse(text: string): unknown {
    if (text.trim() === '') return null;
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return null;
    }
}

function toUpstreamMessage(statusText: string, payload: unknown): string {
    if (payload && typeof payload === 'object') {
        const message = (payload as { error?: unknown; statusMessage?: unknown }).error;
        if (typeof message === 'string' && message.trim()) {
            return message;
        }
        const statusMessage = (payload as { statusMessage?: unknown }).statusMessage;
        if (typeof statusMessage === 'string' && statusMessage.trim()) {
            return statusMessage;
        }
    }

    return statusText || 'OR3 Net exchange failed';
}

export default defineEventHandler(async (event) => {
    setNoCacheHeaders(event);

    if (!isSsrAuthEnabled(event)) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

    const or3NetConfig = getOr3NetServerConfig();
    if (!or3NetConfig.enabled) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

    enforceSameOriginMutation(event);

    const runtimeConfig = useRuntimeConfig();
    const proxyConfig = normalizeProxyTrustConfig(runtimeConfig.security.proxy);
    const clientIp =
        getClientIp(event, proxyConfig) ??
        event.node.req.socket.remoteAddress ??
        'unknown';

    const rateLimit = checkSyncRateLimit(clientIp, 'auth:or3-net-exchange');
    if (!rateLimit.allowed) {
        const retryAfterSec = Math.ceil((rateLimit.retryAfterMs ?? 1000) / 1000);
        setResponseHeader(event, 'Retry-After', retryAfterSec);
        throw createError({
            statusCode: 429,
            statusMessage: `Rate limit exceeded. Retry after ${retryAfterSec}s`,
        });
    }

    const session = await resolveSessionContext(event);
    const activeWorkspaceId = session.workspace?.id;
    if (!session.authenticated || !activeWorkspaceId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }

    requireCan(session, 'workspace.read', {
        kind: 'workspace',
        id: activeWorkspaceId,
    });

    const parsedBody = bodySchema.parse((await readBody(event)) ?? {});
    if (
        parsedBody.workspace_id !== undefined &&
        parsedBody.workspace_id !== activeWorkspaceId
    ) {
        throw createError({
            statusCode: 403,
            statusMessage: 'Forbidden: workspace mismatch',
        });
    }

    const scopes = resolveOr3NetScopes(session, activeWorkspaceId);
    if (scopes.length === 0) {
        throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
    }

    const sessionProof = await issueOr3NetHostAssertion({
        secret: or3NetConfig.exchangeSecret,
        subject: session.user?.id ?? '',
        workspaceId: activeWorkspaceId,
        scopes,
        issuer: or3NetConfig.exchangeIssuer,
        audience: or3NetConfig.exchangeAudience,
        ttlMs: or3NetConfig.exchangeTtlMs,
    });

    let upstreamResponse: Response;
    try {
        upstreamResponse = await fetch(`${or3NetConfig.hostUrl}/v1/auth/exchange`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                provider: OR3_NET_PROVIDER,
                session_proof: sessionProof,
                workspace_id: activeWorkspaceId,
            }),
            signal: AbortSignal.timeout(10_000),
        });
    } catch (error) {
        throw createError({
            statusCode: 502,
            statusMessage:
                error instanceof Error
                    ? `OR3 Net exchange unavailable: ${error.message}`
                    : 'OR3 Net exchange unavailable',
        });
    }

    const responseText = await upstreamResponse.text();
    const payload = parseJsonResponse(responseText);

    if (!upstreamResponse.ok) {
        throw createError({
            statusCode: upstreamResponse.status,
            statusMessage: toUpstreamMessage(upstreamResponse.statusText, payload),
            data: payload,
        });
    }

    recordSyncRequest(clientIp, 'auth:or3-net-exchange');
    return payload as Or3NetExchangeResponse;
});
