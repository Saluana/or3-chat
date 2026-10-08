import { EventEmitter } from 'node:events';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';
import type { ToolDefinition } from '~/utils/chat/types';
import { registerServerTool, unregisterServerTool } from '../../../utils/chat/tool-registry';

const readBodyMock = vi.fn();
const getHeaderMock = vi.fn();
const setResponseStatusMock = vi.fn();
const sendStreamMock = vi.fn((_event, stream) => stream);
const resolveSessionContextMock = vi.fn();
const requireCanMock = vi.fn();
const startBackgroundStreamMock = vi.fn();
const monitorForegroundStreamForClientMock = vi.fn((params) => params.stream);
const backgroundStreamingAvailableMock = vi.fn();
const catalogBoundary = vi.hoisted(() => ({ capacity: 1_000_000, calls: 0, unreachable: false }));
const bodyReader = vi.hoisted(() => ({ useActual: false }));

vi.mock('~~/shared/openrouter', async (original) => ({
    ...await original<typeof import('~~/shared/openrouter')>(),
    createOpenRouterClient: () => ({ models: { list: async () => ({
        async *[Symbol.asyncIterator]() {
            catalogBoundary.calls++;
            if (catalogBoundary.unreachable) throw Object.assign(new Error('Unable to make request'), { name: 'ConnectionError' });
            // The selected record is on a later SDK page.
            for (const id of ['unrelated/model', 'test/model']) yield { result: { data: [{
                id, name: id, canonicalSlug: id, contextLength: catalogBoundary.capacity,
                architecture: { inputModalities: ['text'], outputModalities: ['text'] },
                topProvider: { contextLength: catalogBoundary.capacity, maxCompletionTokens: 4096, isModerated: false },
                pricing: { prompt: '0', completion: '0' }, supportedParameters: ['tools'],
            }] } };
        },
    }) } }),
}));

vi.mock('#imports', () => ({ useRuntimeConfig: () => runtimeConfig }));

// Most tests feed bodies through `readBodyMock`. Tests that need real stream
// and size semantics switch to the production bounded reader.
vi.mock('../../../utils/security/limited-json-body', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../utils/security/limited-json-body')>();
    return {
        ...actual,
        readLimitedJsonBody: (event: H3Event, maxBytes?: number) =>
            bodyReader.useActual
                ? actual.readLimitedJsonBody(event, maxBytes)
                : readBodyMock(event, maxBytes),
    };
});

vi.mock('h3', async (importOriginal) => ({
    ...await importOriginal<typeof import('h3')>(),
    defineEventHandler: (handler: unknown) => handler,
    getRequestIP: vi.fn(() => '127.0.0.1'),
    setResponseHeader: vi.fn(),
}));

vi.mock('../../../auth/session', () => ({
    resolveSessionContext: resolveSessionContextMock,
}));

vi.mock('../../../auth/can', () => ({
    requireCan: requireCanMock,
}));

vi.mock('../../../utils/auth/is-ssr-auth-enabled', () => ({
    isSsrAuthEnabled: vi.fn(() => true),
}));

vi.mock('../../../utils/llm/rate-limiter', () => ({
    checkAndRecordLlmRequest: vi.fn(),
}));

vi.mock('../../../utils/rate-limit/store', () => ({
    getRateLimitProvider: vi.fn(() => null),
}));

vi.mock('../../../utils/net/request-identity', async (importOriginal) => ({
    ...await importOriginal<typeof import('../../../utils/net/request-identity')>(),
    getClientIp: vi.fn(() => '127.0.0.1'),
    getProxyRequestProtocol: vi.fn(() => 'https'),
    normalizeProxyTrustConfig: vi.fn(() => ({ trustProxy: false })),
}));

vi.mock('~~/shared/openrouter/url', async (original) => ({
    ...await original<typeof import('~~/shared/openrouter/url')>(),
    getOpenRouterChatCompletionsUrl: vi.fn(
        () => 'https://openrouter.test/api/v1/chat/completions'
    ),
}));

vi.mock('../../../utils/background-jobs/stream-handler', () => ({
    isBackgroundModeRequest: (body: Record<string, unknown>) =>
        body._background === true,
    validateBackgroundParams: vi.fn(() => ({
        valid: true,
        threadId: 'thread-1',
        messageId: 'message-1',
    })),
    startBackgroundStream: startBackgroundStreamMock,
    isBackgroundStreamingAvailable: () => backgroundStreamingAvailableMock(),
}));

vi.mock('../../../utils/webhooks/foreground-stream-monitor', () => ({
    monitorForegroundStreamForClient: monitorForegroundStreamForClientMock,
}));

let handler: (event: H3Event) => Promise<unknown>;
let runtimeConfig: Record<string, unknown>;

/** The outgoing response: it, not the already-consumed request, reports a client disconnect. */
function makeResponse() {
    return Object.assign(new EventEmitter(), { writableFinished: false, destroyed: false });
}

function makeEvent(headers: Record<string, string> = {}, res = makeResponse()): H3Event {
    return {
        method: 'POST',
        context: {},
        node: {
            req: {
                headers: { host: 'chat.test', origin: 'https://chat.test', 'content-type': 'application/json', 'x-or3-cloud-intent': 'mutation', ...headers },
                on: vi.fn(),
                off: vi.fn(),
            },
            res,
        },
    } as unknown as H3Event;
}

/** An event whose request body arrives as a real Node-style chunk stream. */
function makeStreamedEvent(chunks: Buffer[], headers: Record<string, string> = {}): H3Event {
    const event = makeEvent({ 'x-or3-openrouter-key': 'caller-key', ...headers });
    (event.node.req as unknown as Record<symbol, unknown>)[Symbol.asyncIterator] = async function* () {
        for (const chunk of chunks) yield chunk;
    };
    return event;
}

function forbidden(statusCode: number): Error & { statusCode: number } {
    const error = new Error(statusCode === 401 ? 'Unauthorized' : 'Forbidden') as Error & {
        statusCode: number;
    };
    error.statusCode = statusCode;
    return error;
}

beforeAll(async () => {
    vi.stubGlobal('defineEventHandler', (value: unknown) => value);
    vi.stubGlobal('readBody', readBodyMock);
    vi.stubGlobal('getHeader', getHeaderMock);
    vi.stubGlobal('setResponseStatus', setResponseStatusMock);
    vi.stubGlobal('setHeader', vi.fn());
    vi.stubGlobal('sendStream', sendStreamMock);
    vi.stubGlobal('useRuntimeConfig', () => runtimeConfig);

    const mod = await import('../stream.post');
    handler = mod.default as (event: H3Event) => Promise<unknown>;
});

describe('POST /api/openrouter/stream credential authorization', () => {
    beforeEach(() => {
        catalogBoundary.capacity = 1_000_000; catalogBoundary.calls = 0; catalogBoundary.unreachable = false;
        bodyReader.useActual = false;
        vi.unstubAllGlobals();
        vi.stubGlobal('defineEventHandler', (value: unknown) => value);
        vi.stubGlobal('readBody', readBodyMock);
        vi.stubGlobal('getHeader', getHeaderMock);
        vi.stubGlobal('setResponseStatus', setResponseStatusMock);
        vi.stubGlobal('setHeader', vi.fn());
        vi.stubGlobal('sendStream', sendStreamMock);
        vi.stubGlobal('useRuntimeConfig', () => runtimeConfig);

        runtimeConfig = {
            openrouterApiKey: 'managed-key',
            openrouterBaseUrl: 'https://openrouter.test/api/v1',
            openrouterAllowUserOverride: true,
            openrouterRequireUserKey: false,
            limits: {
                enabled: false,
                requestsPerMinute: 0,
                maxMessagesPerDay: 0,
            },
            security: { proxy: {}, allowedOrigins: [] },
        };
        readBodyMock.mockReset().mockResolvedValue({ model: 'test/model' });
        getHeaderMock.mockReset().mockImplementation(
            (event: H3Event, name: string) =>
                (event.node.req.headers as Record<string, string | undefined>)[
                    name.toLowerCase()
                ]
        );
        setResponseStatusMock.mockReset();
        sendStreamMock.mockClear();
        resolveSessionContextMock.mockReset().mockResolvedValue({
            authenticated: true,
            user: { id: 'user-1' },
            workspace: { id: 'workspace-1' },
            role: 'editor',
        });
        requireCanMock.mockReset();
        startBackgroundStreamMock.mockReset().mockResolvedValue({
            jobId: 'job-1',
            status: 'streaming',
        });
        monitorForegroundStreamForClientMock.mockReset().mockImplementation(
            (params) => params.stream
        );
        backgroundStreamingAvailableMock.mockReset().mockReturnValue(true);
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                new Response('data: [DONE]\n\n', {
                    status: 200,
                    headers: { 'Content-Type': 'text/event-stream' },
                })
            )
        );
    });

    it('rejects an oversized native envelope using independent catalog capacity instead of forged client facts', async () => {
        catalogBoundary.capacity = 100;
        readBodyMock.mockResolvedValue({ model: 'test/model', stream: true,
            messages: [{ role: 'user', content: 'Keep every source turn. '.repeat(100) }],
            _context: { version: 1, user_max_context_tokens: null, requested_completion_tokens: null,
                model_context_tokens: 9_000_000 } });
        const res = makeResponse();
        expect(await handler(makeEvent({}, res))).toMatchObject({ code: 'context_full', retryable: false });
        expect(res.listenerCount('close')).toBe(0);
        expect(catalogBoundary.calls).toBe(1); expect(fetch).not.toHaveBeenCalled();
        expect(startBackgroundStreamMock).not.toHaveBeenCalled();
    });

    it('keeps unknown server capacity explicit and recoverable without an application fallback', async () => {
        catalogBoundary.capacity = 0;
        readBodyMock.mockResolvedValue({ model: 'test/model', stream: true, messages: [{ role: 'user', content: 'Draft' }],
            _context: { version: 1, user_max_context_tokens: null, requested_completion_tokens: null } });
        expect(await handler(makeEvent())).toMatchObject({ code: 'model_metadata_unavailable', retryable: false });
        expect(fetch).not.toHaveBeenCalled(); expect(startBackgroundStreamMock).not.toHaveBeenCalled();
    });

    it('reports an unreachable model catalog as a provider outage, not a model choice problem', async () => {
        catalogBoundary.unreachable = true;
        readBodyMock.mockResolvedValue({ model: 'test/model', stream: true, messages: [{ role: 'user', content: 'Draft' }],
            _context: { version: 1, user_max_context_tokens: null, requested_completion_tokens: null } });
        expect(await handler(makeEvent())).toMatchObject({ error: { code: 'ERR_PROVIDER', status: 502, source: 'provider' } });
        expect(setResponseStatusMock).toHaveBeenLastCalledWith(expect.anything(), 502);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('strips the native context envelope while preserving full provider messages and default reply capacity', async () => {
        const text = 'Source text '.repeat(50_000);
        readBodyMock.mockResolvedValue({ model: 'test/model', stream: true, messages: [{ role: 'user', content: text }],
            _context: { version: 1, user_max_context_tokens: null, requested_completion_tokens: null } });
        await handler(makeEvent());
        expect(fetch).toHaveBeenCalledOnce();
        const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string);
        expect(body.model).toBe('test/model'); expect(body.max_tokens).toBe(4096);
        expect(body.messages).toHaveLength(1); expect(body.messages[0].content === text).toBe(true);
        expect(body).not.toHaveProperty('_context'); expect(catalogBoundary.calls).toBe(1);
    });

    // OpenRouter reserves credit for max_tokens. The default allowance is the
    // model's whole output window, which a small balance cannot reserve.
    const creditRefusal = (affordable: number) => new Response(JSON.stringify({ error: { code: 402, message:
        `This request requires more credits, or fewer max_tokens. You requested up to 4096 tokens, but can only afford ${affordable}. To increase, visit https://openrouter.ai/settings/keys` } }),
        { status: 402, headers: { 'Content-Type': 'application/json' } });
    const stream = () => new Response('data: [DONE]\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });

    it('retries a default reply allowance once at the size the key can afford', async () => {
        readBodyMock.mockResolvedValue({ model: 'test/model', stream: true, messages: [{ role: 'user', content: 'Say hi' }],
            _context: { version: 1, user_max_context_tokens: null, requested_completion_tokens: null } });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(creditRefusal(2048)).mockResolvedValueOnce(stream()));
        await handler(makeEvent({ 'x-or3-openrouter-key': 'caller-key' }));
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string).max_tokens).toBe(4096);
        expect(JSON.parse(vi.mocked(fetch).mock.calls[1]![1]!.body as string).max_tokens).toBe(2048);
        expect(sendStreamMock).toHaveBeenCalledOnce();
    });

    it.each([
        ['an explicit reply allowance', 4096, 2048],
        ['a balance below a useful reply', null, 100],
    ] as const)('keeps the credit error for %s', async (_label, requested, affordable) => {
        readBodyMock.mockResolvedValue({ model: 'test/model', stream: true, messages: [{ role: 'user', content: 'Say hi' }],
            ...(requested ? { max_tokens: requested } : {}),
            _context: { version: 1, user_max_context_tokens: null, requested_completion_tokens: requested } });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(creditRefusal(affordable)).mockResolvedValueOnce(stream()));
        await expect(handler(makeEvent({ 'x-or3-openrouter-key': 'caller-key' }))).resolves.toMatchObject({
            error: { code: 'ERR_CREDITS', status: 402, retryable: false } });
        expect(fetch).toHaveBeenCalledOnce();
        expect(sendStreamMock).not.toHaveBeenCalled();
    });

    it('rejects background context overflow before durable job admission', async () => {
        readBodyMock.mockResolvedValue({ model: 'test/model', messages: [{ role: 'user', content: 'full source '.repeat(100) }],
            _background: true, _threadId: 'thread-1', _messageId: 'message-1',
            _context: { version: 1, user_max_context_tokens: 100, requested_completion_tokens: null } });
        expect(await handler(makeEvent())).toMatchObject({ code: 'context_full', retryable: false });
        expect(fetch).not.toHaveBeenCalled(); expect(startBackgroundStreamMock).not.toHaveBeenCalled();
    });

    it.each([0, -1, 1.5, 'invalid'])('rejects malformed provider reply maximum %s even when the native envelope requests the default', async (max_tokens) => {
        readBodyMock.mockResolvedValue({ model: 'test/model', max_tokens, messages: [{ role: 'user', content: 'Draft' }],
            _context: { version: 1, user_max_context_tokens: null, requested_completion_tokens: null } });
        expect(await handler(makeEvent())).toMatchObject({ code: 'invalid_output_limit', retryable: false });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('passes only canonical captured choices into durable background admission', async () => {
        readBodyMock.mockResolvedValue({ model: 'test/model', messages: [{ role: 'user', content: 'Draft' }],
            _background: true, _threadId: 'thread-1', _messageId: 'message-1',
            _context: { version: 1, user_max_context_tokens: 500, requested_completion_tokens: 100,
                model_context_tokens: 9_000_000, forged_configuration: 'discard' } });
        expect(await handler(makeEvent())).toMatchObject({ jobId: 'job-1' });
        expect(startBackgroundStreamMock.mock.calls[0]?.[0].body._context)
            .toEqual({ version: 1, user_max_context_tokens: 500, requested_completion_tokens: 100 });
    });

    it('rejects anonymous use of the managed key before contacting OpenRouter', async () => {
        resolveSessionContextMock.mockResolvedValue({ authenticated: false });
        requireCanMock.mockImplementation(() => {
            throw forbidden(401);
        });

        await expect(handler(makeEvent())).rejects.toMatchObject({
            statusCode: 401,
        });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('rejects viewer use of the managed key before contacting OpenRouter', async () => {
        resolveSessionContextMock.mockResolvedValue({
            authenticated: true,
            user: { id: 'user-1' },
            workspace: { id: 'workspace-1' },
            role: 'viewer',
        });
        requireCanMock.mockImplementation(() => {
            throw forbidden(403);
        });

        await expect(handler(makeEvent())).rejects.toMatchObject({
            statusCode: 403,
        });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('allows a guest foreground request with caller-supplied credentials', async () => {
        runtimeConfig.openrouterApiKey = 'managed-key';
        resolveSessionContextMock.mockResolvedValue({ authenticated: false });

        await handler(
            makeEvent({
                'x-or3-openrouter-key': 'caller-key',
                host: 'chat.test',
            })
        );

        expect(requireCanMock).not.toHaveBeenCalled();
        expect(fetch).toHaveBeenCalledWith(
            'https://openrouter.test/api/v1/chat/completions',
            expect.objectContaining({
                headers: expect.objectContaining({
                    Authorization: 'Bearer caller-key',
                }),
            })
        );
    });

    it('requires workspace.write before starting background work', async () => {
        readBodyMock.mockResolvedValue({
            model: 'test/model',
            _background: true,
            _threadId: 'thread-1',
            _messageId: 'message-1',
        });
        resolveSessionContextMock.mockResolvedValue({
            authenticated: true,
            user: { id: 'user-1' },
            workspace: { id: 'workspace-1' },
            role: 'viewer',
        });
        requireCanMock.mockImplementation(() => {
            throw forbidden(403);
        });

        await expect(
            handler(
                makeEvent({
                    'x-or3-openrouter-key': 'caller-key',
                    host: 'chat.test',
                })
            )
        ).rejects.toMatchObject({ statusCode: 403 });
        expect(startBackgroundStreamMock).not.toHaveBeenCalled();
    });

    it('passes the managed key to background work for an authorized writer', async () => {
        readBodyMock.mockResolvedValue({
            model: 'test/model',
            _background: true,
            _threadId: 'thread-1',
            _messageId: 'message-1',
        });

        await expect(handler(makeEvent({ host: 'chat.test' }))).resolves.toEqual({
            jobId: 'job-1',
            status: 'streaming',
        });
        expect(requireCanMock).toHaveBeenCalledWith(
            expect.objectContaining({ role: 'editor' }),
            'workspace.write',
            { kind: 'workspace', id: 'workspace-1' }
        );
        expect(startBackgroundStreamMock).toHaveBeenCalledWith(
            expect.objectContaining({
                apiKey: 'managed-key',
                workspaceId: 'workspace-1',
            })
        );
    });

    it('rejects malformed tool schemas before contacting the provider', async () => {
        readBodyMock.mockResolvedValue({
            model: 'test/model',
            tools: [{
                type: 'function',
                function: {
                    name: 'bad_schema',
                    description: 'bad',
                    parameters: {
                        type: 'object',
                        properties: { value: { type: 'not-a-real-type' } },
                    },
                },
            }],
        });

        await expect(handler(makeEvent({ 'x-or3-openrouter-key': 'caller-key' })))
            .resolves.toMatchObject({ error: expect.stringContaining('Invalid JSON Schema') });
        expect(setResponseStatusMock).toHaveBeenCalledWith(expect.anything(), 400);
        expect(fetch).not.toHaveBeenCalled();
        expect(startBackgroundStreamMock).not.toHaveBeenCalled();
    });

    it('rejects mismatched background server definitions before provider invocation', async () => {
        const registered: ToolDefinition = {
            type: 'function',
            function: {
                name: 'boundary_tool',
                description: 'registered definition',
                parameters: { type: 'object', properties: {} },
            },
            runtime: 'server',
        };
        registerServerTool(registered, () => 'nope', { override: true });
        const requested = structuredClone(registered);
        requested.function.description = 'tampered definition';
        readBodyMock.mockResolvedValue({
            model: 'test/model',
            _background: true,
            _threadId: 'thread-1',
            _messageId: 'message-1',
            _toolRuntime: { boundary_tool: 'server' },
            tools: [requested],
        });

        try {
            await expect(handler(makeEvent({ 'x-or3-openrouter-key': 'caller-key' })))
                .resolves.toMatchObject({ error: expect.stringContaining('does not match') });
            expect(setResponseStatusMock).toHaveBeenCalledWith(expect.anything(), 400);
            expect(startBackgroundStreamMock).not.toHaveBeenCalled();
            expect(fetch).not.toHaveBeenCalled();
        } finally {
            unregisterServerTool('boundary_tool');
        }
    });

    it('marks a relayed provider 404 as a route response with model guidance', async () => {
        const setHeaderMock = vi.fn(); vi.stubGlobal('setHeader', setHeaderMock);
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 404,
            message: 'No endpoints found that support image input' } }), { status: 404, headers: { 'Content-Type': 'application/json' } })));

        const res = makeResponse();
        await expect(handler(makeEvent({ 'x-or3-openrouter-key': 'caller-key' }, res))).resolves.toMatchObject({
            error: { code: 'ERR_UNSUPPORTED_MODEL', status: 404, source: 'provider', retryable: false,
                message: 'Choose another model and try again.' } });
        expect(setResponseStatusMock).toHaveBeenLastCalledWith(expect.anything(), 404);
        expect(setHeaderMock).toHaveBeenCalledWith(expect.anything(), 'X-OR3-Stream-Route', '1');
        expect(res.listenerCount('close')).toBe(0);
    });

    it('isolates a transient OpenRouter network outage and serves the next request', async () => {
        const fetchMock = vi
            .fn()
            .mockRejectedValueOnce(new TypeError('network partition'))
            .mockResolvedValueOnce(
                new Response('data: [DONE]\n\n', {
                    status: 200,
                    headers: { 'Content-Type': 'text/event-stream' },
                })
            );
        vi.stubGlobal('fetch', fetchMock);

        const res = makeResponse();
        await expect(
            handler(makeEvent({ 'x-or3-openrouter-key': 'caller-key' }, res))
        ).resolves.toMatchObject({ error: { code: 'ERR_PROVIDER', status: 502, source: 'provider', retryable: true, message: 'The AI provider could not complete the request. Please try again later.' } });
        expect(setResponseStatusMock).toHaveBeenLastCalledWith(
            expect.anything(),
            502
        );
        expect(res.listenerCount('close')).toBe(0);

        await handler(makeEvent({ 'x-or3-openrouter-key': 'caller-key' }));
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(sendStreamMock).toHaveBeenCalledTimes(1);
    });

    it.each([
        { label: 'simple cross-origin body', origin: 'https://untrusted.example.test', intent: false, callerKey: false, trusted: false, status: 403 },
        { label: 'untrusted origin with intent', origin: 'https://untrusted.example.test', intent: true, callerKey: false, trusted: false, status: 403 },
        { label: 'same-origin managed request', origin: 'https://chat.example.test', intent: true, callerKey: false, trusted: false, status: 200 },
        { label: 'configured browser origin', origin: 'https://trusted.example.test', intent: true, callerKey: false, trusted: true, status: 200 },
        { label: 'originless guest with personal key', origin: '', intent: false, callerKey: true, trusted: false, status: 200 },
    ])('enforces mutation protection without breaking $label', async ({ origin, intent, callerKey, trusted, status }) => {
        const h3 = await vi.importActual<typeof import('h3')>('h3');
        const auth = await vi.importActual<typeof import('../../../auth/can')>('../../../auth/can');
        requireCanMock.mockImplementation(auth.requireCan);
        if (callerKey) resolveSessionContextMock.mockResolvedValue({ authenticated: false });
        if (trusted) runtimeConfig.security = { proxy: {}, allowedOrigins: [origin] };
        bodyReader.useActual = true;
        vi.stubGlobal('readBody', h3.readBody);
        vi.stubGlobal('getHeader', h3.getHeader);
        vi.stubGlobal('setResponseStatus', h3.setResponseStatus);
        vi.stubGlobal('setHeader', h3.setHeader);
        vi.stubGlobal('sendStream', h3.sendStream);
        const app = h3.createApp().use('/api/openrouter/stream', h3.defineEventHandler(handler));
        const headers: Record<string, string> = { host: 'chat.example.test' };
        if (origin) { headers.origin = origin; headers.cookie = 'or3-auth=test-session'; }
        if (intent) { headers['x-or3-cloud-intent'] = 'mutation'; headers['content-type'] = 'application/json'; }
        if (callerKey) headers['x-or3-openrouter-key'] = 'personal-key';
        const request = new Request('https://chat.example.test/api/openrouter/stream', {
            method: 'POST', headers,
            // A byte-array fetch body sends no implicit Content-Type or CORS preflight.
            body: new TextEncoder().encode(JSON.stringify({
                model: 'test/model', messages: [{ role: 'user', content: 'hello' }], stream: true,
            })),
        });
        const response = await h3.toWebHandler(app)(request);
        await response.text();
        expect(response.status).toBe(status);
        if (status === 403) expect(fetch).not.toHaveBeenCalled();
        else expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
            headers: expect.objectContaining({ Authorization: `Bearer ${callerKey ? 'personal-key' : 'managed-key'}` }),
        }));
    });

    it('does not forward OR3 background metadata when using the foreground fallback', async () => {
        backgroundStreamingAvailableMock.mockReturnValue(false);
        readBodyMock.mockResolvedValue({
            model: 'test/model',
            messages: [],
            stream: true,
            _background: true,
            _threadId: 'thread-1',
            _messageId: 'message-1',
            _toolRuntime: { private_tool: 'server' },
            _streamedFieldMode: 'delta',
        });

        await handler(makeEvent({ 'x-or3-openrouter-key': 'caller-key' }));

        const request = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as
            | { body?: string }
            | undefined;
        const body = JSON.parse(request?.body ?? '{}') as Record<string, unknown>;
        expect(body).not.toHaveProperty('_background');
        expect(body).not.toHaveProperty('_threadId');
        expect(body).not.toHaveProperty('_messageId');
        expect(body).not.toHaveProperty('_toolRuntime');
        expect(body).not.toHaveProperty('_streamedFieldMode');
    });
    describe('client disconnect', () => {
        /** A provider whose response headers have not arrived; resolves only if never aborted. */
        function stubHeldProvider() {
            const seen: { signal?: AbortSignal } = {};
            vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
                seen.signal = init.signal as AbortSignal;
                seen.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
            })));
            return seen;
        }

        // Regression: the route listened for 'close' on the incoming request. Its
        // body is fully read before the provider is contacted, so that request has
        // already closed and its event can never report a later disconnect: the
        // provider request outlived a cancelled client. Failure case: the signal
        // handed to the provider is never aborted and the handler never settles.
        it('aborts the provider request when the client disconnects before provider headers arrive', async () => {
            const provider = stubHeldProvider();
            const res = makeResponse();
            const pending = handler(makeEvent({ 'x-or3-openrouter-key': 'caller-key' }, res));
            await vi.waitFor(() => expect(provider.signal).toBeDefined());
            // The POST body is done, yet the chat request is still live.
            expect(provider.signal!.aborted).toBe(false);

            res.emit('close');

            await expect(pending).resolves.toBeUndefined();
            expect(provider.signal!.aborted).toBe(true);
            expect(sendStreamMock).not.toHaveBeenCalled();
            expect(res.listenerCount('close')).toBe(0);
        });

        // Stop and a closed tab are the same transport event: the browser drops
        // the connection. Failure case: the upstream stream keeps being drained
        // (and billed) after nobody is listening, or the abort surfaces as an
        // unhandled error response.
        it('cancels the upstream stream and settles quietly when the client disconnects mid-stream', async () => {
            let upstreamCancelled = false;
            const upstream = new ReadableStream<Uint8Array>({
                start(controller) { controller.enqueue(new TextEncoder().encode('data: {"partial":true}\n\n')); },
                pull: () => new Promise<void>(() => {}),
                cancel() { upstreamCancelled = true; },
            });
            vi.stubGlobal('fetch', vi.fn(async () => new Response(upstream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })));
            let firstChunk!: () => void;
            const gotFirstChunk = new Promise<void>((resolve) => { firstChunk = resolve; });
            // h3 resolves sendStream only when the pipe ends; model that pipe.
            sendStreamMock.mockImplementationOnce((async (_event: unknown, stream: ReadableStream<Uint8Array>) => {
                const reader = stream.getReader();
                for (;;) {
                    const { done } = await reader.read();
                    firstChunk();
                    if (done) return;
                }
            }) as never);
            const res = makeResponse();
            const pending = handler(makeEvent({ 'x-or3-openrouter-key': 'caller-key' }, res));
            await gotFirstChunk;

            res.emit('close');

            await expect(pending).resolves.toBeUndefined();
            expect(upstreamCancelled).toBe(true);
            expect(res.listenerCount('close')).toBe(0);
        });

        it('removes its close listener once the stream settles and never cancels a finished response', async () => {
            let upstreamCancelled = false;
            const upstream = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
                    controller.close();
                },
                cancel() { upstreamCancelled = true; },
            });
            vi.stubGlobal('fetch', vi.fn(async () => new Response(upstream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })));
            sendStreamMock.mockImplementationOnce((async (_event: unknown, stream: ReadableStream<Uint8Array>) => {
                const reader = stream.getReader();
                for (;;) {
                    const { done } = await reader.read();
                    if (done) return;
                }
            }) as never);
            const res = makeResponse();

            await expect(handler(makeEvent({ 'x-or3-openrouter-key': 'caller-key' }, res))).resolves.toBeUndefined();

            // Settled: nothing is left attached to the response.
            expect(res.listenerCount('close')).toBe(0);
            // Node emits 'close' after 'finish' for every completed response.
            res.writableFinished = true;
            res.emit('close');
            expect(upstreamCancelled).toBe(false);
        });

        it('treats a client that is already gone before the provider call as a disconnect', async () => {
            const provider = stubHeldProvider();
            const res = makeResponse();
            res.destroyed = true;

            await expect(handler(makeEvent({ 'x-or3-openrouter-key': 'caller-key' }, res))).resolves.toBeUndefined();

            expect(provider.signal?.aborted ?? true).toBe(true);
            expect(sendStreamMock).not.toHaveBeenCalled();
        });

        it('never ties background admission to the foreground response lifetime', async () => {
            readBodyMock.mockResolvedValue({ model: 'test/model', _background: true, _threadId: 'thread-1', _messageId: 'message-1' });
            const res = makeResponse();

            await handler(makeEvent({}, res));
            res.emit('close');

            expect(startBackgroundStreamMock).toHaveBeenCalledTimes(1);
            expect(res.listenerCount('close')).toBe(0);
            expect(startBackgroundStreamMock.mock.calls[0]?.[0]).not.toHaveProperty('signal');
        });
    });

    describe('request body bounds', () => {
        const limits = () => vi.importActual<typeof import('../../../utils/security/limited-json-body')>('../../../utils/security/limited-json-body');

        // Regression: the body was parsed by the unbounded framework reader, then
        // `'tools' in body` ran on whatever came back. Failure cases: any size is
        // buffered; JSON null or a primitive throws a TypeError (500); an oversized
        // body is reported as a generic 400, hiding the real reason.
        it('rejects a body declared above the model-request limit with 413 and reaches no provider', async () => {
            bodyReader.useActual = true;
            const { MODEL_REQUEST_BODY_LIMIT_BYTES } = await limits();

            await expect(handler(makeStreamedEvent(
                [Buffer.from('{"model":"test/model"}')],
                { 'content-length': String(MODEL_REQUEST_BODY_LIMIT_BYTES + 1) }
            ))).rejects.toMatchObject({ statusCode: 413 });

            expect(setResponseStatusMock).not.toHaveBeenCalledWith(expect.anything(), 400);
            expect(fetch).not.toHaveBeenCalled();
            expect(startBackgroundStreamMock).not.toHaveBeenCalled();
        });

        it('lets a bounded-reader size rejection through instead of reporting it as a malformed body', async () => {
            readBodyMock.mockRejectedValue(Object.assign(new Error('The request body is too large.'), { statusCode: 413 }));

            await expect(handler(makeEvent({ 'x-or3-openrouter-key': 'caller-key' }))).rejects.toMatchObject({ statusCode: 413 });

            expect(fetch).not.toHaveBeenCalled();
        });

        it('reads the body with the model-request limit, not a control-message limit', async () => {
            const { MODEL_REQUEST_BODY_LIMIT_BYTES } = await limits();

            await handler(makeEvent({ 'x-or3-openrouter-key': 'caller-key' }));

            expect(readBodyMock).toHaveBeenCalledWith(expect.anything(), MODEL_REQUEST_BODY_LIMIT_BYTES);
            // Chat histories with inline attachments are legitimately far larger than any control message.
            expect(MODEL_REQUEST_BODY_LIMIT_BYTES).toBeGreaterThanOrEqual(64 * 1024 * 1024);
        });

        it('accepts a multi-megabyte structured chat history', async () => {
            bodyReader.useActual = true;
            const history = JSON.stringify({
                model: 'test/model', stream: true,
                messages: [{ role: 'user', content: 'x'.repeat(6 * 1024 * 1024) }],
            });
            const bytes = Buffer.from(history);
            const chunks: Buffer[] = [];
            for (let offset = 0; offset < bytes.byteLength; offset += 64 * 1024) chunks.push(bytes.subarray(offset, offset + 64 * 1024));

            await handler(makeStreamedEvent(chunks));

            expect(fetch).toHaveBeenCalledTimes(1);
            expect(setResponseStatusMock).not.toHaveBeenCalledWith(expect.anything(), 413);
        });

        it.each([
            ['JSON null', null],
            ['a JSON string', 'foo'],
            ['a JSON number', 123],
            ['a JSON array', [{ model: 'test/model' }]],
        ])('answers 400, not a server error, for %s', async (_label, parsed) => {
            readBodyMock.mockResolvedValue(parsed);

            await expect(handler(makeEvent({ 'x-or3-openrouter-key': 'caller-key' }))).resolves.toBe('Invalid request body');

            expect(setResponseStatusMock).toHaveBeenLastCalledWith(expect.anything(), 400);
            expect(fetch).not.toHaveBeenCalled();
            expect(startBackgroundStreamMock).not.toHaveBeenCalled();
        });

        it('answers 400 for malformed JSON and reaches no provider', async () => {
            bodyReader.useActual = true;

            await expect(handler(makeStreamedEvent([Buffer.from('{"model": ')]))).resolves.toBe('Invalid request body');

            expect(setResponseStatusMock).toHaveBeenLastCalledWith(expect.anything(), 400);
            expect(fetch).not.toHaveBeenCalled();
        });
    });
});

// Failure inventory: caller-controlled model/questions, oversized state,
// unauthenticated/viewer/cross-workspace billing, missing/forbidden personal key.
// This route owns auth/key/limits; Dexie tests own stale classification commits.
describe('project memory classification proxy admission', () => {
    let classify: (event: H3Event) => Promise<unknown>;
    beforeAll(async () => { classify = (await import('../classify-memory.post')).default as typeof classify; });
    beforeEach(() => {
        runtimeConfig = { auth: { enabled: true }, security: { proxy: {}, allowedOrigins: [] },
            openrouterApiKey: 'managed-fixture', openrouterAllowUserOverride: true, openrouterRequireUserKey: false,
            limits: { enabled: false } };
        vi.stubGlobal('useRuntimeConfig', () => runtimeConfig);
        readBodyMock.mockReset().mockResolvedValue({ workspaceId: 'workspace-1', state: { memory: 'We chose SQLite.', messages: [] } });
        getHeaderMock.mockImplementation((event: H3Event, name: string) => event.node.req.headers[name.toLowerCase()]);
        requireCanMock.mockReset();
        resolveSessionContextMock.mockResolvedValue({ authenticated: true, user: { id: 'user-1' }, workspace: { id: 'workspace-1' }, role: 'editor' });
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ model: 'typesafe/jev-1.13',
            answers: { memory_kind: { type: 'choice', choice: 'decision', probabilities: { fact: 0.01, decision: 0.98, uncertain: 0.01 } } },
            usage: { input_tokens: 30, output_tokens: 0 } }), { headers: { 'Content-Type': 'application/json' } })));
    });
    const requestEvent = () => makeEvent({ host: 'chat.test', origin: 'https://chat.test',
        'content-type': 'application/json', 'x-or3-cloud-intent': 'mutation' });
    it('uses a fixed classifier and hides provider failures and keys', async () => {
        expect(await classify(requestEvent())).toMatchObject({ kind: 'decision' });
        const fetcher = vi.mocked(fetch); const req = fetcher.mock.calls[0]![0] as Request;
        expect(req.url).toBe('https://openrouter.ai/api/alpha/decisions');
        expect((await req.json()).model).toBe('typesafe/jev-1.13');
        fetcher.mockRejectedValueOnce(new Error('secret upstream failure'));
        expect(await classify(requestEvent())).toMatchObject({ kind: 'fact' });
    });
    it('refuses a workspace mismatch before provider dispatch', async () => {
        readBodyMock.mockResolvedValue({ workspaceId: 'foreign', state: { memory: 'We chose SQLite.', messages: [] } });
        await expect(classify(requestEvent())).rejects.toMatchObject({ statusCode: 403 });
        expect(fetch).not.toHaveBeenCalled();
    });
    it('enforces write admission before dispatch', async () => {
        requireCanMock.mockImplementation(() => { throw forbidden(403); });
        await expect(classify(requestEvent())).rejects.toMatchObject({ statusCode: 403 });
        expect(fetch).not.toHaveBeenCalled();
    });
    it.each([
        { workspaceId: 'workspace-1', state: { memory: 'text', messages: [] }, model: 'attacker/model' },
        { workspaceId: 'workspace-1', state: { memory: 'text', messages: Array(7).fill({ role: 'user', text: 'text' }) } },
        { workspaceId: 'workspace-1', state: { memory: 'text', messages: [{ role: 'user', text: 'x'.repeat(17000) }] } },
    ])('rejects unbounded or caller-configured input %#', async body => {
        readBodyMock.mockResolvedValue(body);
        await expect(classify(requestEvent())).rejects.toMatchObject({ statusCode: 400 });
        expect(fetch).not.toHaveBeenCalled();
    });
});

// Capture shares the existing route's admission/key policy. This transport test
// protects the fixed model task and skip-before-extraction contract, not Dexie writes.
describe('automatic memory proxy', () => {
    it('runs only the fixed gate when no durable memory is present', async () => {
        const capture = (await import('../classify-memory.post')).default;
        runtimeConfig = { auth: { enabled: true }, security: { proxy: {}, allowedOrigins: [] },
            openrouterApiKey: 'managed-fixture', openrouterAllowUserOverride: true,
            openrouterRequireUserKey: false, limits: { enabled: false } };
        resolveSessionContextMock.mockResolvedValue({ authenticated: true, user: { id: 'user-1' },
            workspace: { id: 'workspace-1' }, role: 'editor' });
        requireCanMock.mockReset();
        getHeaderMock.mockImplementation((event: H3Event, name: string) => event.node.req.headers[name.toLowerCase()]);
        readBodyMock.mockResolvedValue({ workspaceId: 'workspace-1', capture: {
            messages: [{ id: 'u', role: 'user', text: 'What is SQLite?', fresh: true }], existing: [] } });
        const fetcher = vi.fn(async () => new Response(JSON.stringify({ model: 'typesafe/jev-1.13',
            answers: { worth_saving: { type: 'choice', choice: 'skip', probabilities: { save: 0.01, skip: 0.98, uncertain: 0.01 } } } })));
        vi.stubGlobal('fetch', fetcher);
        const event = () => makeEvent({ host: 'chat.test', origin: 'https://chat.test',
            'content-type': 'application/json', 'x-or3-cloud-intent': 'mutation' });
        expect(await capture(event())).toEqual({ memories: [] });
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).model).toBe('typesafe/jev-1.13');
        requireCanMock.mockImplementation(() => { throw forbidden(403); });
        await expect(capture(event())).rejects.toMatchObject({ statusCode: 403 });
        expect(fetcher).toHaveBeenCalledTimes(1);
    });
});
