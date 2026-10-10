import { beforeEach, describe, expect, it, vi } from 'vitest';

const getRouterParamMock = vi.fn();
const setResponseStatusMock = vi.fn();
const setHeaderMock = vi.fn();

// Route files use Nuxt auto-import globals (no h3 import), so the test
// provides them on globalThis before importing the module under test.
const globalAny = globalThis as typeof globalThis & Record<string, unknown>;
globalAny.defineEventHandler = (handler: unknown) => handler;
globalAny.getRouterParam = getRouterParamMock;
globalAny.setResponseStatus = setResponseStatusMock;
globalAny.setHeader = setHeaderMock;

const getJobProviderMock = vi.fn();
vi.mock('../../../utils/background-jobs/store', () => ({
    getJobProvider: getJobProviderMock,
}));

const resolveSessionContextMock = vi.fn();
vi.mock('../../../auth/session', () => ({
    resolveSessionContext: resolveSessionContextMock,
}));

const isSsrAuthEnabledMock = vi.fn(() => true);
vi.mock('../../../utils/auth/is-ssr-auth-enabled', () => ({
    isSsrAuthEnabled: isSsrAuthEnabledMock,
}));

let handler: (event: unknown) => Promise<unknown>;

beforeEach(async () => {
    vi.clearAllMocks();
    isSsrAuthEnabledMock.mockReturnValue(true);
    resolveSessionContextMock.mockResolvedValue({
        authenticated: true,
        user: { id: 'user-1' },
    });
    const mod = await import('../admission/[admissionId].get');
    handler = mod.default as (event: unknown) => Promise<unknown>;
});

describe('GET /api/jobs/admission/:admissionId', () => {
    it('returns the committed job for a known admission', async () => {
        getRouterParamMock.mockReturnValue('admission-1');
        getJobProviderMock.mockResolvedValue({
            findJobByIdempotencyKey: vi.fn(async () => ({
                id: 'job-1',
                status: 'streaming',
                threadId: 'thread-1',
                messageId: 'message-1',
            })),
        });

        const result = await handler({});
        expect(result).toMatchObject({
            jobId: 'job-1',
            status: 'streaming',
        });
        expect(setResponseStatusMock).not.toHaveBeenCalled();
    });

    it('returns 404 when no job was committed for the admission', async () => {
        getRouterParamMock.mockReturnValue('admission-missing');
        getJobProviderMock.mockResolvedValue({
            findJobByIdempotencyKey: vi.fn(async () => null),
        });

        const result = await handler({});
        expect(setResponseStatusMock).toHaveBeenCalledWith(
            expect.anything(),
            404
        );
        expect(result).toMatchObject({
            error: 'No job for this admission',
        });
    });

    it('returns 401 without an authenticated session', async () => {
        getRouterParamMock.mockReturnValue('admission-1');
        resolveSessionContextMock.mockResolvedValue({
            authenticated: false,
        });

        await handler({});
        expect(setResponseStatusMock).toHaveBeenCalledWith(
            expect.anything(),
            401
        );
    });

    it('returns 400 for a missing or oversized admission ID', async () => {
        getRouterParamMock.mockReturnValue('');
        await handler({});
        expect(setResponseStatusMock).toHaveBeenCalledWith(
            expect.anything(),
            400
        );

        vi.clearAllMocks();
        getRouterParamMock.mockReturnValue('x'.repeat(129));
        await handler({});
        expect(setResponseStatusMock).toHaveBeenCalledWith(
            expect.anything(),
            400
        );
    });

    it('returns 501 when the provider cannot look up admissions', async () => {
        getRouterParamMock.mockReturnValue('admission-1');
        getJobProviderMock.mockResolvedValue({});

        await handler({});
        expect(setResponseStatusMock).toHaveBeenCalledWith(
            expect.anything(),
            501
        );
    });
});
