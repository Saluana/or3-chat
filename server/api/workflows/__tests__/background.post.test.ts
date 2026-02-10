import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';

const readBodyMock = vi.fn();
const getHeaderMock = vi.fn();
const setResponseHeaderMock = vi.fn();

vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    readBody: readBodyMock,
    getHeader: getHeaderMock,
    setResponseHeader: setResponseHeaderMock,
    createError: (opts: { statusCode: number; statusMessage?: string }) => {
        const err = new Error(opts.statusMessage ?? 'Error') as Error & {
            statusCode: number;
        };
        err.statusCode = opts.statusCode;
        return err;
    },
}));

const resolveSessionContextMock = vi.fn();
vi.mock('../../../auth/session', () => ({
    resolveSessionContext: resolveSessionContextMock as any,
}));

const requireCanMock = vi.fn();
vi.mock('../../../auth/can', () => ({
    requireCan: requireCanMock as any,
}));

const isSsrAuthEnabledMock = vi.fn(() => true);
vi.mock('../../../utils/auth/is-ssr-auth-enabled', () => ({
    isSsrAuthEnabled: isSsrAuthEnabledMock as any,
}));

const startBackgroundWorkflowMock = vi.fn();
vi.mock('../../../utils/workflows/background-execution', () => ({
    startBackgroundWorkflow: startBackgroundWorkflowMock as any,
}));

const resolveCanonicalWorkflowMock = vi.fn();
const workflowsMatchMock = vi.fn(() => true);
class WorkflowCatalogError extends Error {
    constructor(
        message: string,
        public statusCode: number
    ) {
        super(message);
    }
}
vi.mock('../../../utils/workflows/workflow-catalog', () => ({
    resolveCanonicalWorkflow: resolveCanonicalWorkflowMock as any,
    workflowsMatch: workflowsMatchMock as any,
    WorkflowCatalogError,
}));

const checkSyncRateLimitMock = vi.fn();
const recordSyncRequestMock = vi.fn();
vi.mock('../../../utils/sync/rate-limiter', () => ({
    checkSyncRateLimit: checkSyncRateLimitMock as any,
    recordSyncRequest: recordSyncRequestMock as any,
}));

function makeEvent(headers: Record<string, string> = {}): H3Event {
    return {
        context: {},
        node: {
            req: {
                headers,
            },
        },
    } as unknown as H3Event;
}

function baseBody(): Record<string, unknown> {
    return {
        workflowId: 'wf-1',
        workflowName: 'Workflow',
        workflowUpdatedAt: 100,
        workflowVersion: '2.0.0',
        prompt: 'run',
        threadId: 'thread-1',
        messageId: 'msg-1',
        conversationHistory: [{ role: 'user', content: 'hello' }],
        attachments: [],
    };
}

describe('POST /api/workflows/background', () => {
    beforeEach(() => {
        vi.unstubAllGlobals();
        readBodyMock.mockReset().mockResolvedValue(baseBody());
        getHeaderMock.mockReset().mockImplementation((event: H3Event, name: string) => {
            return (event.node.req.headers as Record<string, string | undefined>)[
                name.toLowerCase()
            ];
        });
        setResponseHeaderMock.mockReset();
        resolveSessionContextMock.mockReset().mockResolvedValue({
            authenticated: true,
            user: { id: 'user-1' },
            workspace: { id: 'ws-1' },
        });
        requireCanMock.mockReset();
        isSsrAuthEnabledMock.mockReset().mockReturnValue(true);
        startBackgroundWorkflowMock.mockReset().mockResolvedValue({
            jobId: 'job-1',
            status: 'streaming',
        });
        resolveCanonicalWorkflowMock.mockReset().mockResolvedValue({
            workflowId: 'wf-1',
            workflowName: 'Canonical Workflow',
            workflowUpdatedAt: 100,
            workflowVersion: '2.0.0',
            workflow: {
                meta: { version: '2.0.0', name: 'Canonical Workflow' },
                nodes: [],
                edges: [],
            },
        });
        workflowsMatchMock.mockReset().mockReturnValue(true);
        checkSyncRateLimitMock.mockReset().mockReturnValue({
            allowed: true,
            remaining: 10,
        });
        recordSyncRequestMock.mockReset();

        vi.stubGlobal('useRuntimeConfig', () => ({
            openrouterAllowUserOverride: true,
            openrouterRequireUserKey: false,
            openrouterApiKey: 'server-openrouter-key',
        }));
    });

    it('starts background workflow with canonical server workflow data', async () => {
        const handler = (await import('../background.post')).default as (
            event: H3Event
        ) => Promise<unknown>;

        const result = await handler(makeEvent());

        expect(result).toEqual({ jobId: 'job-1', status: 'streaming' });
        expect(resolveCanonicalWorkflowMock).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                workspaceId: 'ws-1',
                workflowId: 'wf-1',
                expectedUpdatedAt: 100,
                expectedVersion: '2.0.0',
            })
        );
        expect(startBackgroundWorkflowMock).toHaveBeenCalledWith(
            expect.objectContaining({
                workflowId: 'wf-1',
                workflowName: 'Canonical Workflow',
                userId: 'user-1',
                workspaceId: 'ws-1',
            })
        );
        expect(recordSyncRequestMock).toHaveBeenCalledWith(
            'user-1',
            'workflow:background'
        );
    });

    it('rejects mismatched inline workflow payloads', async () => {
        const handler = (await import('../background.post')).default as (
            event: H3Event
        ) => Promise<unknown>;
        readBodyMock.mockResolvedValue({
            ...baseBody(),
            workflow: { meta: { version: '1.0.0' } },
        });
        workflowsMatchMock.mockReturnValue(false);

        await expect(handler(makeEvent())).rejects.toMatchObject({
            statusCode: 409,
        });
        expect(startBackgroundWorkflowMock).not.toHaveBeenCalled();
    });

    it('returns 429 when rate limit is exceeded', async () => {
        const handler = (await import('../background.post')).default as (
            event: H3Event
        ) => Promise<unknown>;
        checkSyncRateLimitMock.mockReturnValue({
            allowed: false,
            retryAfterMs: 1500,
        });

        await expect(handler(makeEvent())).rejects.toMatchObject({
            statusCode: 429,
        });
        expect(setResponseHeaderMock).toHaveBeenCalledWith(
            expect.anything(),
            'Retry-After',
            2
        );
    });

    it('validates required request fields', async () => {
        const handler = (await import('../background.post')).default as (
            event: H3Event
        ) => Promise<unknown>;
        readBodyMock.mockResolvedValue({
            ...baseBody(),
            workflowId: '',
        });

        await expect(handler(makeEvent())).rejects.toMatchObject({
            statusCode: 400,
        });
        expect(startBackgroundWorkflowMock).not.toHaveBeenCalled();
    });
});
