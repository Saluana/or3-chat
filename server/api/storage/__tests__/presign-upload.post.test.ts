import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';
import { STORAGE_CONTROL_BODY_LIMIT_BYTES } from '../../../utils/security/limited-json-body';

const { readBodyMock, setResponseHeaderMock, setHeaderMock } = vi.hoisted(() => ({
    readBodyMock: vi.fn(),
    setResponseHeaderMock: vi.fn(),
    setHeaderMock: vi.fn(),
}));
const useRuntimeConfigMock = vi.fn();

vi.mock('../../../utils/security/cloud-mutation', () => ({ requireCloudMutation: vi.fn() }));

vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    readBody: readBodyMock,
    getHeader: (event: { node?: { req?: { headers?: Record<string, string | undefined> } } }, name: string) =>
        event.node?.req?.headers?.[name.toLowerCase()],
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

vi.mock('#imports', () => ({
    useRuntimeConfig: useRuntimeConfigMock as any,
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
vi.mock('../../../utils/sync/rate-limiter', () => ({
    checkSyncRateLimit: checkSyncRateLimitMock as any,
    recordSyncRequest: recordSyncRequestMock as any,
}));

const recordUploadStartMock = vi.fn();
vi.mock('../../../utils/storage/metrics', () => ({
    recordUploadStart: recordUploadStartMock as any,
}));

const getWorkspaceStorageUsageSnapshotMock = vi.fn();
vi.mock('../../../utils/storage/quota', () => ({
    getWorkspaceStorageUsageSnapshot: getWorkspaceStorageUsageSnapshotMock as any,
}));

const presignUploadMock = vi.fn();
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
        mime_type: 'image/png',
        size_bytes: 1024,
        expires_in_ms: 12_345,
        disposition: 'inline',
    };
}

describe('POST /api/storage/presign-upload', () => {
    beforeEach(() => {
        readBodyMock.mockReset();
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
        recordUploadStartMock.mockReset();
        useRuntimeConfigMock.mockReset().mockReturnValue({
            storage: {
                allowedMimeTypes: undefined,
                allowAnyFileType: false,
                workspaceQuotaBytes: undefined,
            },
        });
        getWorkspaceStorageUsageSnapshotMock.mockReset().mockResolvedValue({
            usedBytes: 0,
            reservedBytes: 0,
            filesByHash: new Map<string, number>(),
        });
        presignUploadMock.mockReset().mockResolvedValue({
            url: 'https://upload.example',
            expiresAt: 123,
        });
        getActiveStorageGatewayAdapterMock.mockReset().mockReturnValue({
            id: 'adapter-1',
            presignUpload: presignUploadMock as any,
        });
    });

    it('returns 404 when auth or storage is disabled', async () => {
        const handler = (await import('../presign-upload.post')).default as (event: H3Event) => Promise<unknown>;

        isSsrAuthEnabledMock.mockReturnValue(false);
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 404 });

        isSsrAuthEnabledMock.mockReturnValue(true);
        isStorageEnabledMock.mockReturnValue(false);
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it('returns 400 for body schema failures', async () => {
        const handler = (await import('../presign-upload.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue({ workspace_id: 'ws-1', hash: 'h' });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 });
    });

    it.each([
        { field: 'workspace_id', value: '' },
        { field: 'workspace_id', value: '   ' },
        { field: 'hash', value: '' },
        { field: 'mime_type', value: '' },
        { field: 'size_bytes', value: -1 },
        { field: 'size_bytes', value: 1.5 },
        { field: 'size_bytes', value: Number.POSITIVE_INFINITY },
    ])('returns 400 for hostile $field input', async ({ field, value }) => {
        const handler = (await import('../presign-upload.post')).default as (
            event: H3Event
        ) => Promise<unknown>;
        readBodyMock.mockResolvedValue({
            ...makeValidBody(),
            [field]: value,
        });

        await expect(handler(makeEvent())).rejects.toMatchObject({
            statusCode: 400,
        });
        expect(presignUploadMock).not.toHaveBeenCalled();
    });

    it('returns 400 for invalid expires_in_ms bounds/type', async () => {
        const handler = (await import('../presign-upload.post')).default as (event: H3Event) => Promise<unknown>;

        readBodyMock.mockResolvedValue({ ...makeValidBody(), expires_in_ms: 0 });
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 });

        readBodyMock.mockResolvedValue({ ...makeValidBody(), expires_in_ms: 1.5 });
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 });

        readBodyMock.mockResolvedValue({ ...makeValidBody(), expires_in_ms: 86_400_001 });
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 });
    });

    it('returns 400 for invalid disposition values', async () => {
        const handler = (await import('../presign-upload.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue({ ...makeValidBody(), disposition: 'attachment; filename="x"' });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 });
    });

    it('returns 401 for unauthenticated session', async () => {
        const handler = (await import('../presign-upload.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        resolveSessionContextMock.mockResolvedValue({ authenticated: false });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 401 });
    });

    it('returns 403 on workspace.write denial', async () => {
        const handler = (await import('../presign-upload.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        requireCanMock.mockImplementation(() => {
            const err = new Error('Forbidden') as Error & { statusCode: number };
            err.statusCode = 403;
            throw err;
        });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 403 });
    });

    it('returns 429 with Retry-After when rate limited', async () => {
        const handler = (await import('../presign-upload.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        checkSyncRateLimitMock.mockReturnValue({ allowed: false, retryAfterMs: 2001 });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 429 });
        expect(setResponseHeaderMock).toHaveBeenCalledWith(expect.anything(), 'Retry-After', 3);
    });

    it('returns 413 when file size exceeds configured max', async () => {
        const handler = (await import('../presign-upload.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue({ ...makeValidBody(), size_bytes: Number.MAX_SAFE_INTEGER });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 413 });
    });

    it('returns 415 when MIME type is not allowlisted', async () => {
        const handler = (await import('../presign-upload.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue({ ...makeValidBody(), mime_type: 'application/zip' });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 415 });
    });

    it('accepts a zero-byte upload', async () => {
        const handler = (await import('../presign-upload.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue({ ...makeValidBody(), size_bytes: 0 });

        await expect(handler(makeEvent())).resolves.toMatchObject({
            url: 'https://upload.example',
        });
        expect(presignUploadMock).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ sizeBytes: 0 }),
        );
    });

    it('admits arbitrary MIME types only with the explicit capability setting', async () => {
        const handler = (await import('../presign-upload.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue({ ...makeValidBody(), mime_type: 'application/zip', file_kind_capability: 'v1' });

        useRuntimeConfigMock.mockReturnValue({
            storage: {
                allowedMimeTypes: ['image/png'],
                allowAnyFileType: true,
            },
        });

        await expect(handler(makeEvent())).resolves.toMatchObject({
            url: 'https://upload.example',
        });
    });

    it('returns 426 for an allowlisted generic MIME without file-kind capability', async () => {
        const handler = (await import('../presign-upload.post')).default as (event: H3Event) => Promise<unknown>;
        useRuntimeConfigMock.mockReturnValue({
            storage: {
                allowedMimeTypes: ['text/plain'],
            },
        });
        readBodyMock.mockResolvedValue({ ...makeValidBody(), mime_type: 'text/plain' });

        const failure = await handler(makeEvent()).catch((error: unknown) => error);
        expect(failure).toMatchObject({
            statusCode: 426,
            message: 'Update OR3 Chat to use general files',
        });
        expect(presignUploadMock).not.toHaveBeenCalled();
    });

    it('uses runtime-config MIME allowlist when provided', async () => {
        const handler = (await import('../presign-upload.post')).default as (event: H3Event) => Promise<unknown>;
        useRuntimeConfigMock.mockReturnValue({
            storage: {
                allowedMimeTypes: ['application/json'],
            },
        });
        readBodyMock.mockResolvedValue({
            ...makeValidBody(),
            mime_type: 'application/json',
            file_kind_capability: 'v1',
        });

        await expect(handler(makeEvent())).resolves.toMatchObject({
            url: 'https://upload.example',
        });
    });

    it('returns 413 when workspace quota would be exceeded', async () => {
        const handler = (await import('../presign-upload.post')).default as (event: H3Event) => Promise<unknown>;
        useRuntimeConfigMock.mockReturnValue({
            storage: {
                allowedMimeTypes: ['image/png'],
                workspaceQuotaBytes: 1_500,
            },
        });
        getWorkspaceStorageUsageSnapshotMock.mockResolvedValue({
            usedBytes: 1_000,
            reservedBytes: 0,
            filesByHash: new Map<string, number>(),
        });
        readBodyMock.mockResolvedValue({
            ...makeValidBody(),
            size_bytes: 600,
        });

        await expect(handler(makeEvent())).rejects.toMatchObject({
            statusCode: 413,
        });
    });

    it('includes active reservations in projected workspace quota', async () => {
        const handler = (await import('../presign-upload.post')).default as (event: H3Event) => Promise<unknown>;
        useRuntimeConfigMock.mockReturnValue({
            storage: {
                allowedMimeTypes: ['image/png'],
                workspaceQuotaBytes: 1_500,
            },
        });
        getWorkspaceStorageUsageSnapshotMock.mockResolvedValue({
            usedBytes: 1_000,
            reservedBytes: 400,
            filesByHash: new Map<string, number>(),
        });
        readBodyMock.mockResolvedValue({ ...makeValidBody(), size_bytes: 200 });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 413 });
        expect(presignUploadMock).not.toHaveBeenCalled();
    });

    it('returns 500 when adapter is missing', async () => {
        const handler = (await import('../presign-upload.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        getActiveStorageGatewayAdapterMock.mockReturnValue(null);

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 500 });
    });

    it('maps payload to adapter, records metrics/rate limit, and preserves disposition', async () => {
        const handler = (await import('../presign-upload.post')).default as (event: H3Event) => Promise<unknown>;
        const body = makeValidBody();
        readBodyMock.mockResolvedValue(body);

        await expect(handler(makeEvent())).resolves.toEqual({
            url: 'https://upload.example',
            expiresAt: 123,
            disposition: 'inline',
        });

        expect(presignUploadMock).toHaveBeenCalledWith(expect.anything(), {
            workspaceId: 'ws-1',
            hash: 'sha256:abc',
            mimeType: 'image/png',
            sizeBytes: 1024,
            expiresInMs: 12_345,
            disposition: 'inline',
        });
        expect(recordSyncRequestMock).toHaveBeenCalledWith('user-1', 'storage:upload');
        expect(recordUploadStartMock).toHaveBeenCalledTimes(1);
    });

    it('passes through upload method/headers/storageId from adapter response', async () => {
        const handler = (await import('../presign-upload.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        presignUploadMock.mockResolvedValue({
            url: '/api/storage/fs/upload?token=abc',
            expiresAt: 456,
            method: 'PUT',
            headers: { 'x-upload': '1' },
            storageId: 'ws-1:sha256:abc',
        });

        await expect(handler(makeEvent())).resolves.toEqual({
            url: '/api/storage/fs/upload?token=abc',
            expiresAt: 456,
            disposition: 'inline',
            method: 'PUT',
            headers: { 'x-upload': '1' },
            storageId: 'ws-1:sha256:abc',
        });
    });
    // Regression: the body was parsed by the unbounded framework reader before
    // authentication, so a body of any size was buffered. Failure cases: a large
    // body is read instead of refused; the refusal is not a 413; the request
    // still reaches the session or the storage adapter; a hostile shape (JSON
    // null, a primitive) is not a plain 400.
    describe('request body bounds', () => {
        const tooLarge = STORAGE_CONTROL_BODY_LIMIT_BYTES + 1;
        const load = async () => (await import('../presign-upload.post')).default as (event: H3Event) => Promise<unknown>;
        const streamed = (chunks: Buffer[]) => ({
            headers: {},
            async *[Symbol.asyncIterator]() {
                for (const chunk of chunks) yield chunk;
            },
        });

        it('rejects a declared oversized body with 413 before reading it', async () => {
            const handler = await load();
            readBodyMock.mockResolvedValue(makeValidBody());
            const event = { context: {}, node: { req: { headers: { 'content-length': String(tooLarge) } } } } as unknown as H3Event;

            await expect(handler(event)).rejects.toMatchObject({ statusCode: 413 });

            expect(readBodyMock).not.toHaveBeenCalled();
            expect(resolveSessionContextMock).not.toHaveBeenCalled();
            expect(presignUploadMock).not.toHaveBeenCalled();
        });

        it('rejects an oversized chunked body with 413 as soon as the limit is crossed', async () => {
            const handler = await load();
            const body = { ...makeValidBody(), padding: 'x'.repeat(tooLarge) };
            readBodyMock.mockResolvedValue(body);
            const bytes = Buffer.from(JSON.stringify(body));
            const request = {
                headers: {},
                async *[Symbol.asyncIterator]() {
                    yield bytes.subarray(0, tooLarge - 100);
                    yield bytes.subarray(tooLarge - 100);
                    throw new Error('the reader continued past the limit');
                },
            };

            await expect(handler({ context: {}, node: { req: request } } as unknown as H3Event)).rejects.toMatchObject({ statusCode: 413 });

            expect(resolveSessionContextMock).not.toHaveBeenCalled();
            expect(presignUploadMock).not.toHaveBeenCalled();
        });

        it.each([
            ['JSON null', 'null'],
            ['a JSON string', '"foo"'],
            ['a JSON number', '123'],
            ['malformed JSON', '{"workspace_id": '],
        ])('answers 400 for %s', async (_label, raw) => {
            const handler = await load();

            await expect(handler({ context: {}, node: { req: streamed([Buffer.from(raw)]) } } as unknown as H3Event))
                .rejects.toMatchObject({ statusCode: 400 });

            expect(presignUploadMock).not.toHaveBeenCalled();
        });
    });
});
