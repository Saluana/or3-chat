/**
 * @module server/api/openrouter/stream.post
 *
 * Purpose:
 * Proxies chat completion requests to OpenRouter, supporting both direct SSE streaming
 * and background job offloading for long-running tasks.
 *
 * Responsibilities:
 * - Validates API keys (Server-side env vs. Client-provided header).
 * - Enforces Rate Limits (via `checkAndRecordLlmRequest`).
 * - Forking Logic:
 *   - Direct Streaming: Pipes upstream SSE to client.
 *   - Background Job: Offloads via `startBackgroundStream` if requested or required.
 * - Error Handling: Translates upstream errors to 4xx/5xx responses.
 *
 * Behavior:
 * - Checks `x-or3-background`: If true (and available), spawns background job + returns 202.
 * - Checks Rate Limits ($Limit/User & $Limit/IP).
 * - Forwards headers (Referer, X-Title) for OpenRouter rankings.
 * - Aborts upstream request if client disconnects.
 *
 * Security:
 * - Key Precedence: User Key (if allowed) > Server Key.
 * - Rate Limiting: Strict token bucket enforcement.
 * - Logs: Never logs API keys.
 */
import { getRequestIP, setResponseHeader } from 'h3';
import { resolveSessionContext } from '../../auth/session';
import { isSsrAuthEnabled } from '../../utils/auth/is-ssr-auth-enabled';
import {
    checkAndRecordLlmRequest,
    getLlmRateLimitStats,
} from '../../utils/llm/rate-limiter';
import { getRateLimitProvider } from '../../utils/rate-limit/store';
import {
    isBackgroundModeRequest,
    validateBackgroundParams,
    startBackgroundStream,
    isBackgroundStreamingAvailable,
} from '../../utils/background-jobs/stream-handler';

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

    // Req 1, 4: Select API key. Prefer user key when connected.
    const config = useRuntimeConfig(event);
    const allowUserOverride = config.openrouterAllowUserOverride !== false;
    const requireUserKey = config.openrouterRequireUserKey === true;
    const authHeader = getHeader(event, 'authorization');
    const keyHeader = getHeader(event, 'x-or3-openrouter-key');
    const clientKey =
        (typeof keyHeader === 'string' && keyHeader.trim().length > 0
            ? keyHeader.trim()
            : undefined) ||
        (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined);

    const apiKey = requireUserKey
        ? clientKey
        : (allowUserOverride ? clientKey : undefined) ||
          config.openrouterApiKey ||
          process.env.OPENROUTER_API_KEY;

    if (!apiKey && process.env.NODE_ENV !== 'production') {
        console.warn('[openrouter][stream] missing api key', {
            hasRuntimeConfigKey: Boolean(config.openrouterApiKey),
            hasEnvKey: Boolean(process.env.OPENROUTER_API_KEY),
            allowUserOverride,
            requireUserKey,
            hasAuthHeader: Boolean(authHeader),
        });
    }
    if (!apiKey) {
        if (requireUserKey) {
            setResponseStatus(event, 400);
            return 'User OpenRouter API key required';
        }
        setResponseStatus(event, 400);
        return 'Missing OpenRouter API key';
    }

    // Resolve user key for rate limiting (user ID or IP)
    let rateKey: string = 'anonymous';
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

    const limits = config.limits;

    // Check requestsPerMinute limit
    const minuteConfig =
        limits.enabled !== false && limits.requestsPerMinute > 0
            ? {
                  windowMs: 60_000,
                  maxRequests: limits.requestsPerMinute,
              }
            : null;

    // Atomic check-and-record for per-minute rate limit (prevents TOCTOU race)
    let minuteResult: { allowed: boolean; remaining: number; retryAfterMs?: number } | null = null;
    if (minuteConfig) {
        minuteResult = checkAndRecordLlmRequest(rateKey, minuteConfig);
        if (!minuteResult.allowed) {
            const retryAfterSec = Math.ceil(
                (minuteResult.retryAfterMs ?? 1000) / 1000
            );
            setResponseHeader(event, 'Retry-After', retryAfterSec);
            setResponseHeader(event, 'X-RateLimit-Limit', String(minuteConfig.maxRequests));
            setResponseHeader(
                event,
                'X-RateLimit-Remaining',
                String(minuteResult.remaining)
            );
            setResponseStatus(event, 429);
            return `Rate limit exceeded. Retry after ${retryAfterSec}s`;
        }
    }

    // Check maxMessagesPerDay limit (24-hour rolling window)
    // Uses pluggable provider with atomic check-and-record
    const dailyConfig =
        limits.enabled !== false && limits.maxMessagesPerDay > 0
            ? {
                  windowMs: 24 * 60 * 60 * 1000, // 24 hours
                  maxRequests: limits.maxMessagesPerDay,
              }
            : null;

    // We'll check daily limit and record atomically
    const provider = dailyConfig ? getRateLimitProvider() : null;
    let dailyLimitResult: { allowed: boolean; remaining: number; retryAfterMs?: number } | null = null;

    if (dailyConfig && provider) {
        const dailyKey = `daily:${rateKey}`;
        // Atomic check-and-record to prevent race conditions
        dailyLimitResult = await provider.checkAndRecord(dailyKey, dailyConfig);
        if (!dailyLimitResult.allowed) {
            const retryAfterSec = Math.ceil(
                (dailyLimitResult.retryAfterMs ?? 1000) / 1000
            );
            setResponseHeader(event, 'Retry-After', retryAfterSec);
            setResponseHeader(
                event,
                'X-DailyLimit-Limit',
                String(dailyConfig.maxRequests)
            );
            setResponseHeader(
                event,
                'X-DailyLimit-Remaining',
                String(dailyLimitResult.remaining)
            );
            setResponseStatus(event, 429);
            return `Daily message limit reached (${dailyConfig.maxRequests}). Try again tomorrow.`;
        }
    }

    // =============================
    // BACKGROUND MODE HANDLING
    // =============================
    // If background mode is requested and enabled, start a background job
    // and return immediately with the job ID.
    if (isBackgroundModeRequest(body) && isBackgroundStreamingAvailable()) {
        // Resolve user ID for authorization
        let userId: string | null = null;
        let workspaceId: string | null = null;
        if (isSsrAuthEnabled(event)) {
            const session = await resolveSessionContext(event);
            if (session.authenticated && session.user?.id && session.workspace?.id) {
                userId = session.user.id;
                workspaceId = session.workspace.id;
            }
            if (!userId || !workspaceId) {
                if (process.env.NODE_ENV !== 'production') {
                    console.warn('[openrouter][stream][bg] session missing for background request', {
                        authenticated: session.authenticated,
                        hasUser: Boolean(session.user?.id),
                        hasWorkspace: Boolean(session.workspace?.id),
                    });
                }
            }
        }

        if (!userId || !workspaceId) {
            setResponseStatus(event, 401);
            return { error: 'Authentication required for background streaming' };
        }

        const validation = validateBackgroundParams(body);
        if (!validation.valid) {
            setResponseStatus(event, 400);
            return { error: validation.error };
        }

        const host = getHeader(event, 'host') || 'localhost';
        const xfProto = getHeader(event, 'x-forwarded-proto');
        const isLocal = /^localhost(?:\d+)?$|^127\.0\.0\.1(?::\d+)?$/.test(host);
        const proto = xfProto || (isLocal ? 'http' : 'https');

        try {
            const result = await startBackgroundStream({
                body,
                apiKey,
                userId,
                workspaceId,
                threadId: validation.threadId!,
                messageId: validation.messageId!,
                referer: `${proto}://${host}`,
            });

            return result;
        } catch (err) {
            if (err instanceof Error && err.message.includes('Max concurrent')) {
                setResponseStatus(event, 503);
                return { error: 'Server busy, try again later' };
            }
            setResponseStatus(event, 500);
            return { error: err instanceof Error ? err.message : 'Background stream failed' };
        }
    }

    // =============================
    // FOREGROUND STREAMING (existing behavior)
    // =============================

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

    // Per-minute rate limit already recorded atomically in checkAndRecordLlmRequest
    // Add rate limit headers for successful requests
    if (minuteConfig && minuteResult) {
        setResponseHeader(event, 'X-RateLimit-Limit', String(minuteConfig.maxRequests));
        setResponseHeader(
            event,
            'X-RateLimit-Remaining',
            String(minuteResult.remaining)
        );
    }

    // Daily limit already recorded atomically in checkAndRecord
    // Add daily limit headers for successful requests
    if (dailyConfig && dailyLimitResult) {
        setResponseHeader(
            event,
            'X-DailyLimit-Limit',
            String(dailyConfig.maxRequests)
        );
        setResponseHeader(
            event,
            'X-DailyLimit-Remaining',
            String(dailyLimitResult.remaining)
        );
    }

    // Just pipe the upstream SSE directly to client - no need to parse and re-encode
    // The client will parse it with the shared parser
    return sendStream(event, upstream.body);
});
