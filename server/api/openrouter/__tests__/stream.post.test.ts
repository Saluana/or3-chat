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
const mirrorForegroundStreamCompletionMock = vi.fn();

vi.mock('h3', () => ({
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

vi.mock('../../../utils/net/request-identity', () => ({
    getClientIp: vi.fn(() => '127.0.0.1'),
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
    isBackgroundStreamingAvailable: vi.fn(() => true),
}));

vi.mock('../../../utils/webhooks/foreground-stream-monitor', () => ({
    mirrorForegroundStreamCompletion: mirrorForegroundStreamCompletionMock,
}));

let handler: (event: H3Event) => Promise<unknown>;
let runtimeConfig: Record<string, unknown>;

function makeEvent(headers: Record<string, string> = {}): H3Event {
    return {
        context: {},
        node: {
            req: {
                headers,
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
            security: { proxy: {} },
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
        mirrorForegroundStreamCompletionMock.mockReset();
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
        ).resolves.toBe('Failed to reach OpenRouter');
        expect(setResponseStatusMock).toHaveBeenLastCalledWith(
            expect.anything(),
            502
        );

        await handler(makeEvent({ 'x-or3-openrouter-key': 'caller-key' }));
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(sendStreamMock).toHaveBeenCalledTimes(1);
    });
});
