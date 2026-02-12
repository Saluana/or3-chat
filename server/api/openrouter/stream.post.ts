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
    const OR_URL = config.openrouterUrl || 'https://openrouter.ai/api/v1/chat/completions';
    const authHeader = getHeader(event, 'authorization');
    const clientKey = authHeader?.startsWith('Bearer ')
        ? authHeader.slice(7)
        : undefined;

    const apiKey = config.openrouterApiKey || clientKey;
    if (!apiKey) {
        setResponseStatus(event, 400);
        return 'Missing OpenRouter API key';
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

    // Just pipe the upstream SSE directly to client - no need to parse and re-encode
    // The client will parse it with the shared parser
    return sendStream(event, upstream.body);
});
