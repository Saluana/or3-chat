import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';
import { testRuntimeConfig } from '../../../../tests/setup';
import { STORAGE_CONTROL_BODY_LIMIT_BYTES } from '../../../utils/security/limited-json-body';

const { readBodyMock, setResponseHeaderMock, setHeaderMock, requireCloudMutationMock } = vi.hoisted(() => ({
    readBodyMock: vi.fn(),
    setResponseHeaderMock: vi.fn(),
    setHeaderMock: vi.fn(),
    requireCloudMutationMock: vi.fn(),
}));

vi.mock('../../../utils/security/cloud-mutation', () => ({ requireCloudMutation: requireCloudMutationMock }));

vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    readBody: readBodyMock,
    getHeader: (event: H3Event, name: string) => event.node.req.headers[name.toLowerCase()],
    getRequestHeader: (event: H3Event, name: string) => event.node.req.headers[name.toLowerCase()],
    setResponseHeader: setResponseHeaderMock,
    setHeader: setHeaderMock,
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

const isStorageEnabledMock = vi.fn(() => true);
vi.mock('../../../utils/storage/is-storage-enabled', () => ({
    isStorageEnabled: isStorageEnabledMock as any,
}));

const checkSyncRateLimitMock = vi.fn();
const recordSyncRequestMock = vi.fn();
vi.mock('../../../utils/sync/rate-limiter', async (importOriginal) => ({
    ...await importOriginal<typeof import('../../../utils/sync/rate-limiter')>(),
    checkSyncRateLimit: checkSyncRateLimitMock,
    recordSyncRequest: recordSyncRequestMock,
}));

const recordUploadCompleteMock = vi.fn();
vi.mock('../../../utils/storage/metrics', () => ({
    recordUploadComplete: recordUploadCompleteMock as any,
}));

const commitMock = vi.fn();
const getActiveStorageGatewayAdapterMock = vi.fn();
vi.mock('../../../storage/gateway/registry', () => ({
    getActiveStorageGatewayAdapter: getActiveStorageGatewayAdapterMock as any,
}));

function makeEvent(): H3Event {
    return { context: {}, node: { req: { headers: {} } } } as H3Event;
}

function makeValidBody() {
    return {
        workspace_id: 'ws-1',
        hash: 'sha256:abc',
        storage_id: 'storage-1',
        storage_provider_id: 'convex',
        mime_type: 'image/png',
        size_bytes: 100,
        name: 'file.png',
        kind: 'image',
        width: 100,
        height: 100,
    };
}

describe('POST /api/storage/commit', () => {
    beforeEach(async () => {
        const { resetSyncRateLimits } = await import('../../../utils/sync/rate-limiter');
        resetSyncRateLimits();
        testRuntimeConfig.value.limits.operationRateLimits = {};
        readBodyMock.mockReset();
        requireCloudMutationMock.mockReset();
        setResponseHeaderMock.mockReset();
        setHeaderMock.mockReset();
        resolveSessionContextMock.mockReset().mockResolvedValue({
            authenticated: true,
            user: { id: 'user-1' },
            workspace: { id: 'ws-1' },
        });
        requireCanMock.mockReset();
        isSsrAuthEnabledMock.mockReset().mockReturnValue(true);
        isStorageEnabledMock.mockReset().mockReturnValue(true);
        checkSyncRateLimitMock.mockReset().mockReturnValue({ allowed: true, remaining: 10 });
        recordSyncRequestMock.mockReset();
        recordUploadCompleteMock.mockReset();
        commitMock.mockReset().mockResolvedValue(undefined);
        getActiveStorageGatewayAdapterMock.mockReset().mockReturnValue({
            id: 'adapter-1',
            commit: commitMock as any,
        });
    });

    afterEach(async () => {
        const { resetSyncRateLimits } = await import('../../../utils/sync/rate-limiter');
        resetSyncRateLimits();
        vi.restoreAllMocks();
    });

    it('admits only the configured parallel commits and allows retry after the window', async () => {
        const limiter = await vi.importActual<typeof import('../../../utils/sync/rate-limiter')>(
            '../../../utils/sync/rate-limiter'
        );
        checkSyncRateLimitMock.mockImplementation(limiter.checkSyncRateLimit);
        recordSyncRequestMock.mockImplementation(limiter.recordSyncRequest);
        testRuntimeConfig.value.limits.operationRateLimits = {
            'storage:commit': { maxRequests: 2, windowMs: 60_000 },
        };
        let now = Date.now();
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        readBodyMock.mockResolvedValue(makeValidBody());
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        commitMock.mockImplementation(() => gate);
        const handler = (await import('../commit.post')).default as (event: H3Event) => Promise<unknown>;
        const requests = Array.from({ length: 3 }, () => handler(makeEvent()).then(
            () => 200,
            (error: { statusCode: number }) => error.statusCode
        ));
        try {
            await vi.waitFor(() => expect(commitMock.mock.calls.length).toBeGreaterThanOrEqual(2));
        } finally {
            release();
        }
        expect((await Promise.all(requests)).sort()).toEqual([200, 200, 429]);
        expect(commitMock).toHaveBeenCalledTimes(2);
        expect(setResponseHeaderMock).toHaveBeenCalledWith(expect.anything(), 'Retry-After', 60);

        // Another subject can work while this subject's configured bucket is full.
        resolveSessionContextMock.mockResolvedValue({
            authenticated: true,
            user: { id: 'user-2' },
            workspace: { id: 'ws-1' },
        });
        await expect(handler(makeEvent())).resolves.toEqual({ ok: true });
        resolveSessionContextMock.mockResolvedValue({
            authenticated: true,
            user: { id: 'user-1' },
            workspace: { id: 'ws-1' },
        });
        now += 60_000;
        await expect(handler(makeEvent())).resolves.toEqual({ ok: true });
    });

    it('returns 404 when auth or storage is disabled', async () => {
        const handler = (await import('../commit.post')).default as (event: H3Event) => Promise<unknown>;

        isSsrAuthEnabledMock.mockReturnValue(false);
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 404 });

        isSsrAuthEnabledMock.mockReturnValue(true);
        isStorageEnabledMock.mockReturnValue(false);
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it('returns 400 for invalid request body', async () => {
        const handler = (await import('../commit.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue({ workspace_id: 'ws-1' });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 });
    });

    describe('bounded commit control body', () => {
        function streamed(chunks: string[], headers: Record<string, string> = {}): H3Event {
            return {
                context: {},
                method: 'POST',
                node: { req: { headers, async *[Symbol.asyncIterator]() {
                    for (const chunk of chunks) yield Buffer.from(chunk);
                } } },
            } as unknown as H3Event;
        }

        it('rejects declared oversize before parsing or authentication', async () => {
            const handler = (await import('../commit.post')).default;
            const event = streamed([], { 'content-length': String(STORAGE_CONTROL_BODY_LIMIT_BYTES + 1) });
            await expect(handler(event)).rejects.toMatchObject({ statusCode: 413 });
            expect(readBodyMock).not.toHaveBeenCalled();
            expect(resolveSessionContextMock).not.toHaveBeenCalled();
            expect(commitMock).not.toHaveBeenCalled();
        });

        it.each([undefined, '1'])('bounds actual streamed bytes with declared length %s', async (length) => {
            const handler = (await import('../commit.post')).default;
            const event = streamed(['{"name":"', 'x'.repeat(STORAGE_CONTROL_BODY_LIMIT_BYTES), '"}'],
                length ? { 'content-length': length } : {});
            await expect(handler(event)).rejects.toMatchObject({ statusCode: 413 });
            expect(readBodyMock).not.toHaveBeenCalled();
            expect(resolveSessionContextMock).not.toHaveBeenCalled();
            expect(commitMock).not.toHaveBeenCalled();
        });

        it('rejects malformed streamed JSON before authentication', async () => {
            const handler = (await import('../commit.post')).default;
            await expect(handler(streamed(['{"workspace_id":']))).rejects.toMatchObject({ statusCode: 400 });
            expect(readBodyMock).not.toHaveBeenCalled();
            expect(resolveSessionContextMock).not.toHaveBeenCalled();
        });

        it.each([undefined, 'text/plain', 'application/x-www-form-urlencoded'])('retains real mutation guard rejection for content type %s', async (contentType) => {
            const actual = await vi.importActual<typeof import('../../../utils/security/cloud-mutation')>('../../../utils/security/cloud-mutation');
            requireCloudMutationMock.mockImplementation(actual.requireCloudMutation);
            const handler = (await import('../commit.post')).default;
            const headers: Record<string, string> = { 'x-or3-cloud-intent': 'mutation', authorization: 'Bearer test-only' };
            if (contentType) headers['content-type'] = contentType;
            await expect(handler(streamed([JSON.stringify(makeValidBody())], headers))).rejects.toMatchObject({ statusCode: 415 });
            expect(readBodyMock).not.toHaveBeenCalled();
            expect(resolveSessionContextMock).not.toHaveBeenCalled();
        });

        it('preserves valid streamed JSON, including exact-limit bodies', async () => {
            const actual = await vi.importActual<typeof import('../../../utils/security/cloud-mutation')>('../../../utils/security/cloud-mutation');
            requireCloudMutationMock.mockImplementation(actual.requireCloudMutation);
            const handler = (await import('../commit.post')).default;
            const body = makeValidBody();
            const raw = JSON.stringify(body);
            const padded = raw + ' '.repeat(STORAGE_CONTROL_BODY_LIMIT_BYTES - Buffer.byteLength(raw));
            await expect(handler(streamed([padded], {
                'x-or3-cloud-intent': 'mutation', authorization: 'Bearer test-only',
                'content-type': 'application/json; charset=utf-8',
                'content-length': String(STORAGE_CONTROL_BODY_LIMIT_BYTES),
            }))).resolves.toEqual({ ok: true });
            expect(readBodyMock).not.toHaveBeenCalled();
            expect(commitMock).toHaveBeenCalledWith(expect.anything(), body);
        });
    });

    it('returns 401 when user id is missing', async () => {
        const handler = (await import('../commit.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        resolveSessionContextMock.mockResolvedValue({ authenticated: true, workspace: { id: 'ws-1' } });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 401 });
    });

    it('returns 403 when workspace.write permission fails', async () => {
        const handler = (await import('../commit.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        requireCanMock.mockImplementation(() => {
            const err = new Error('Forbidden') as Error & { statusCode: number };
            err.statusCode = 403;
            throw err;
        });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 403 });
    });

    it('returns 429 when rate limit is exceeded', async () => {
        const handler = (await import('../commit.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        checkSyncRateLimitMock.mockReturnValue({
            allowed: false,
            remaining: 0,
            retryAfterMs: 2000,
        });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 429 });
        expect(setResponseHeaderMock).toHaveBeenCalledWith(expect.anything(), 'Retry-After', 2);
    });

    it('returns 500 when adapter is missing', async () => {
        const handler = (await import('../commit.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        getActiveStorageGatewayAdapterMock.mockReturnValue(null);

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 500 });
    });

    it('does not call adapter commit when capability is missing (no-op)', async () => {
        const handler = (await import('../commit.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        getActiveStorageGatewayAdapterMock.mockReturnValue({ id: 'adapter-1' });

        await expect(handler(makeEvent())).resolves.toEqual({ ok: true });
        expect(commitMock).not.toHaveBeenCalled();
    });

    it('calls adapter commit when available', async () => {
        const handler = (await import('../commit.post')).default as (event: H3Event) => Promise<unknown>;
        const body = makeValidBody();
        readBodyMock.mockResolvedValue(body);

        await expect(handler(makeEvent())).resolves.toEqual({ ok: true });
        expect(commitMock).toHaveBeenCalledWith(expect.anything(), body);
    });

    it('accepts generic zero-byte commit metadata', async () => {
        const handler = (await import('../commit.post')).default as (event: H3Event) => Promise<unknown>;
        const body = {
            ...makeValidBody(),
            mime_type: 'application/octet-stream',
            size_bytes: 0,
            name: 'empty.bin',
            kind: 'file',
            width: undefined,
            height: undefined,
            file_kind_capability: 'v1',
        };
        readBodyMock.mockResolvedValue(body);

        await expect(handler(makeEvent())).resolves.toEqual({ ok: true });
        expect(commitMock).toHaveBeenCalledWith(expect.anything(), body);
    });

    it('returns 426 for generic commit metadata from an older writer', async () => {
        const handler = (await import('../commit.post')).default as (event: H3Event) => Promise<unknown>;
        const body = {
            ...makeValidBody(),
            mime_type: 'application/octet-stream',
            kind: 'file',
        };
        readBodyMock.mockResolvedValue(body);

        const failure = await handler(makeEvent()).catch((error: unknown) => error);
        expect(failure).toMatchObject({
            statusCode: 426,
            message: 'Update OR3 Chat to use general files',
        });
        expect(commitMock).not.toHaveBeenCalled();
    });

    it('records successful upload metrics and does not charge denied rate checks', async () => {
        const handler = (await import('../commit.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());

        await handler(makeEvent());

        expect(recordSyncRequestMock).toHaveBeenCalledWith('user-1', 'storage:commit');
        expect(recordUploadCompleteMock).toHaveBeenCalledWith(100);

        recordSyncRequestMock.mockClear();
        recordUploadCompleteMock.mockClear();
        checkSyncRateLimitMock.mockReturnValue({ allowed: false, retryAfterMs: 1000 });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 429 });
        expect(recordSyncRequestMock).not.toHaveBeenCalled();
        expect(recordUploadCompleteMock).not.toHaveBeenCalled();
    });
});
