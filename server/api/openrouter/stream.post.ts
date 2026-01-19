/**
 * Nitro server route: POST /api/openrouter/stream
 *
 * Proxies OpenRouter streaming requests, preferring env.OPENROUTER_API_KEY.
 * Pipes upstream SSE through to the client; the client parses with the shared parser.
 * Aborts upstream on client disconnect.
 *
 * Note: Per design doc, we keep raw fetch for streaming because the SDK's chat.send()
 * buffers the entire response. Streaming requires direct body access which SDK doesn't expose.
 *
 * Reqs: 1 (env-or-client key), 2 (streaming + abort), 4 (no logging keys)
 */

import { getRequestIP, setResponseHeader } from 'h3';
import { resolveSessionContext } from '../../auth/session';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import {
    checkLlmRateLimit,
    getLlmRateLimitStats,
    recordLlmRequest,
} from '../../utils/llm/rate-limiter';

const OR_URL = 'https://openrouter.ai/api/v1/chat/completions';

export default defineEventHandler(async (event) => {
    // Read request body
    let body: Record<string, unknown>;
    try {
        body = await readBody(event);
    } catch {
        setResponseStatus(event, 400);
        return 'Invalid request body';
    }

    // Req 1, 4: Select API key: env > Authorization header. Never log keys.
    const config = useRuntimeConfig(event);
    const allowUserOverride = config.openrouterAllowUserOverride !== false;
    const authHeader = getHeader(event, 'authorization');
    const clientKey = authHeader?.startsWith('Bearer ')
        ? authHeader.slice(7)
        : undefined;

    const apiKey = config.openrouterApiKey || (allowUserOverride ? clientKey : undefined);
    if (!apiKey) {
        setResponseStatus(event, 400);
        return 'Missing OpenRouter API key';
    }

    const limits = config.limits;
    const limitConfig =
        limits?.enabled !== false && (limits?.requestsPerMinute ?? 0) > 0
            ? {
                  windowMs: 60_000,
                  maxRequests: limits?.requestsPerMinute ?? 20,
              }
            : null;
    let rateKey: string | null = null;
    if (limitConfig) {
        rateKey = 'anonymous';
        if (isSsrAuthEnabled(event)) {
            const session = await resolveSessionContext(event);
            if (session.authenticated && session.user?.id) {
                rateKey = `user:${session.user.id}`;
            }
        }
        if (rateKey === 'anonymous') {
            const ip =
                getRequestIP(event, { xForwardedFor: true }) ||
                event.node.req.socket.remoteAddress ||
                'unknown';
            rateKey = `ip:${ip}`;
        }
        const rateResult = checkLlmRateLimit(rateKey, limitConfig);
        if (!rateResult.allowed) {
            const retryAfterSec = Math.ceil(
                (rateResult.retryAfterMs ?? 1000) / 1000
            );
            setResponseHeader(event, 'Retry-After', String(retryAfterSec));
            const stats = getLlmRateLimitStats(rateKey, limitConfig);
            setResponseHeader(
                event,
                'X-RateLimit-Limit',
                String(stats.limit)
            );
            setResponseHeader(
                event,
                'X-RateLimit-Remaining',
                String(stats.remaining)
            );
            setResponseStatus(event, 429);
            return `Rate limit exceeded. Retry after ${retryAfterSec}s`;
        }
    }

    // Req 2: Setup abort controller for client disconnect
    const ac = new AbortController();

    // Listen for client disconnect
    event.node.req.on('close', () => {
        ac.abort();
    });

    // Req 2: Proxy POST to OpenRouter with Accept: text/event-stream
    let upstream: Response;
    try {
        const host = getHeader(event, 'host') || 'localhost';
        const xfProto = getHeader(event, 'x-forwarded-proto');
        const isLocal = /^localhost(?::\d+)?$|^127\.0\.0\.1(?::\d+)?$/.test(
            host
        );
        const proto = xfProto || (isLocal ? 'http' : 'https');

        upstream = await fetch(OR_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                Accept: 'text/event-stream',
                'HTTP-Referer': `${proto}://${host}`,
                'X-Title': 'or3.chat',
            },
            body: JSON.stringify(body),
            signal: ac.signal,
        });
    } catch (e: unknown) {
        // Handle abort or network error
        if (e instanceof Error && e.name === 'AbortError') {
            // Client disconnected
            return;
        }
        // Other network error
        setResponseStatus(event, 502);
        return 'Failed to reach OpenRouter';
    }

    // Handle upstream non-OK responses
    if (!upstream.ok || !upstream.body) {
        let respText = '<no-body>';
        try {
            respText = await upstream.text();
        } catch {
            respText = '<error-reading-body>';
        }
        setResponseStatus(event, upstream.status);
        return respText.slice(0, 2000);
    }

    // Req 6: Set SSE headers
    setHeader(event, 'Content-Type', 'text/event-stream');
    setHeader(event, 'Cache-Control', 'no-cache, no-transform');
    setHeader(event, 'Connection', 'keep-alive');

    if (limitConfig && rateKey) {
        const stats = getLlmRateLimitStats(rateKey, limitConfig);
        setResponseHeader(event, 'X-RateLimit-Limit', String(stats.limit));
        setResponseHeader(
            event,
            'X-RateLimit-Remaining',
            String(stats.remaining)
        );
        recordLlmRequest(rateKey, limitConfig);
    }

    // Just pipe the upstream SSE directly to client - no need to parse and re-encode
    // The client will parse it with the shared parser
    return sendStream(event, upstream.body);
});
