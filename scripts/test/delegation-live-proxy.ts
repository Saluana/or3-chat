/** Guard paid calls from the disposable durable-delegation harness. */
export function createDelegationLiveProxy(options: {
    apiKey: string;
    proxyToken: string;
    models: readonly string[];
    forward?: typeof fetch;
}) {
    const forward = options.forward ?? fetch;
    const allowed = new Set(options.models);
    const requests: ('parent' | 'child')[] = [];
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let childStarted = 0;
    const snapshot = () => ({ requests: [...requests], childStarted });
    const handle = async (request: Request): Promise<Response> => {
        const path = new URL(request.url).pathname;
        if (request.headers.get('authorization') !== `Bearer ${options.proxyToken}`)
            return new Response('Unauthorized', { status: 401 });
        if (request.method === 'GET' && path === '/api/v1/models') {
            try {
                const result = await forward('https://openrouter.ai/api/v1/models', {
                    headers: { authorization: `Bearer ${options.apiKey}` }, signal: AbortSignal.timeout(20_000),
                });
                return new Response(result.body, { status: result.status, headers: { 'content-type': 'application/json' } });
            } catch { return new Response('Catalog unavailable', { status: 502 }); }
        }
        if (request.method !== 'POST' || path !== '/api/v1/chat/completions') return new Response('Not found', { status: 404 });
        if (Number(request.headers.get('content-length') ?? 0) > 100_000) return new Response('Request too large', { status: 413 });
        let body: Record<string, unknown>;
        try {
            const data = await request.text();
            if (new TextEncoder().encode(data).byteLength > 100_000) return new Response('Request too large', { status: 413 });
            const parsed: unknown = JSON.parse(data);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
            body = parsed as Record<string, unknown>;
        } catch { return new Response('Invalid request', { status: 400 }); }
        if (typeof body.model !== 'string' || !allowed.has(body.model) || requests.length >= 8 || body.stream !== true || !Array.isArray(body.messages))
            return new Response('Request not permitted', { status: 403 });
        const hasDelegate = Array.isArray(body.tools) && body.tools.some(item => item && typeof item === 'object' &&
            'function' in item && item.function && typeof item.function === 'object' && 'name' in item.function && item.function.name === 'delegate_chat');
        const hasMarker = body.messages.some(item => item && typeof item === 'object' && 'role' in item && item.role === 'user' &&
            'content' in item && typeof item.content === 'string' && item.content.includes('JADE ORCHID'));
        if (!hasDelegate && !hasMarker) return new Response('Request not permitted', { status: 403 });
        const kind = hasDelegate ? 'parent' : 'child';
        requests.push(kind);
        const requestedTokens = typeof body.max_tokens === 'number' && Number.isFinite(body.max_tokens) ? body.max_tokens : 512;
        body.max_tokens = Math.max(1, Math.min(Math.floor(requestedTokens), 512));
        body.n = 1;
        delete body.max_completion_tokens;
        delete body.models;
        delete body.route;
        delete body.plugins;
        if (kind === 'child') { childStarted++; await held; }
        try {
            const result = await forward('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST', headers: { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json' },
                body: JSON.stringify(body), signal: AbortSignal.timeout(120_000),
            });
            return new Response(result.body, { status: result.status,
                headers: { 'content-type': result.headers.get('content-type') ?? 'application/json' } });
        } catch { return new Response('Upstream unavailable', { status: 502 }); }
    };
    return { handle, release, snapshot };
}
