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

vi.mock('~~/shared/openrouter/url', () => ({
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

function makeEvent(headers: Record<string, string> = {}): H3Event {
    return {
        method: 'POST',
        context: {},
        node: {
            req: {
                headers: { host: 'chat.test', origin: 'https://chat.test', 'content-type': 'application/json', 'x-or3-cloud-intent': 'mutation', ...headers },
                on: vi.fn(),
            },
        },
    } as unknown as H3Event;
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
        expect(await handler(makeEvent())).toMatchObject({ code: 'context_full', retryable: false });
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

        await expect(handler(makeEvent({ 'x-or3-openrouter-key': 'caller-key' }))).resolves.toMatchObject({
            error: { code: 'ERR_UNSUPPORTED_MODEL', status: 404, source: 'provider', retryable: false,
                message: 'Choose another model and try again.' } });
        expect(setResponseStatusMock).toHaveBeenLastCalledWith(expect.anything(), 404);
        expect(setHeaderMock).toHaveBeenCalledWith(expect.anything(), 'X-OR3-Stream-Route', '1');
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

        await expect(
            handler(makeEvent({ 'x-or3-openrouter-key': 'caller-key' }))
        ).resolves.toMatchObject({ error: { code: 'ERR_PROVIDER', status: 502, source: 'provider', retryable: true, message: 'The AI provider could not complete the request. Please try again later.' } });
        expect(setResponseStatusMock).toHaveBeenLastCalledWith(
            expect.anything(),
            502
        );

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
});
