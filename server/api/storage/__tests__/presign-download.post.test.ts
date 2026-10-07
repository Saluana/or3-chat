import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';
import { STORAGE_CONTROL_BODY_LIMIT_BYTES } from '../../../utils/security/limited-json-body';

const { readBodyMock, setResponseHeaderMock, setHeaderMock } = vi.hoisted(() => ({
    readBodyMock: vi.fn(),
    setResponseHeaderMock: vi.fn(),
    setHeaderMock: vi.fn(),
}));

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
            statusMessage?: string;
        };
        err.statusCode = opts.statusCode;
        err.statusMessage = opts.statusMessage;
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
vi.mock('../../../utils/sync/rate-limiter', () => ({
    checkSyncRateLimit: checkSyncRateLimitMock as any,
    recordSyncRequest: recordSyncRequestMock as any,
}));

const recordDownloadStartMock = vi.fn();
vi.mock('../../../utils/storage/metrics', () => ({
    recordDownloadStart: recordDownloadStartMock as any,
}));

vi.mock('../../../utils/storage/presign-expiry', () => ({
    DEFAULT_PRESIGN_EXPIRY_MS: 60_000,
    resolvePresignExpiresAt: (result: { expiresAt?: unknown }) =>
        typeof result.expiresAt === 'number'
            ? result.expiresAt
            : Date.now() + 60_000,
}));

const presignDownloadMock = vi.fn();
const getActiveStorageGatewayAdapterMock = vi.fn();
const queryCanonicalStorageMock = vi.fn();
vi.mock('../../../storage/gateway/registry', () => ({
    getActiveStorageGatewayAdapter: getActiveStorageGatewayAdapterMock as any,
}));

vi.mock('../../../sync/gateway/registry', () => ({
    getActiveSyncGatewayAdapter: () => ({
        queryCanonicalStorage: queryCanonicalStorageMock,
    }),
}));

function makeEvent(): H3Event {
    return { context: {}, node: { req: { headers: {} } } } as H3Event;
}

function makeValidBody() {
    return {
        workspace_id: 'ws-1',
        hash: `sha256:${'a'.repeat(64)}`,
        expires_in_ms: 54_321,
        disposition: 'attachment',
    };
}

describe('POST /api/storage/presign-download', () => {
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
        recordDownloadStartMock.mockReset();
        queryCanonicalStorageMock.mockReset().mockResolvedValue({
            items: [{
                kind: 'metadata',
                hash: `sha256:${'a'.repeat(64)}`,
                sizeBytes: 3,
                storageId: 'storage-live',
                mimeType: 'image/png',
                name: 'image.png',
                fileKind: 'image',
                updatedAt: 1,
            }],
            hasMore: false,
        });
        presignDownloadMock.mockReset().mockResolvedValue({
            url: 'https://download.example',
            expiresAt: 9_999,
        });
        getActiveStorageGatewayAdapterMock.mockReset().mockReturnValue({
            id: 'adapter-1',
            presignDownload: presignDownloadMock as any,
        });
    });

    it('returns 404 when auth or storage flags are disabled', async () => {
        const handler = (await import('../presign-download.post')).default as (event: H3Event) => Promise<unknown>;

        isSsrAuthEnabledMock.mockReturnValue(false);
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 404 });

        isSsrAuthEnabledMock.mockReturnValue(true);
        isStorageEnabledMock.mockReturnValue(false);
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 404 });
    });

    it('returns 400 for body schema failures', async () => {
        const handler = (await import('../presign-download.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue({ workspace_id: 'ws-1' });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 });
    });

    it('returns 400 for invalid expires_in_ms bounds/type', async () => {
        const handler = (await import('../presign-download.post')).default as (event: H3Event) => Promise<unknown>;

        readBodyMock.mockResolvedValue({ ...makeValidBody(), expires_in_ms: 0 });
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 });

        readBodyMock.mockResolvedValue({ ...makeValidBody(), expires_in_ms: 1.25 });
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 });

        readBodyMock.mockResolvedValue({ ...makeValidBody(), expires_in_ms: 86_400_001 });
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 });
    });

    it('returns 400 for invalid disposition values', async () => {
        const handler = (await import('../presign-download.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue({ ...makeValidBody(), disposition: 'attachment; filename="x"' });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 });
    });

    it('returns 400 for a non-canonical hash', async () => {
        const handler = (await import('../presign-download.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue({ ...makeValidBody(), hash: 'raw-object-key' });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 });
        expect(presignDownloadMock).not.toHaveBeenCalled();
    });

    it('returns 401 when session is unauthenticated', async () => {
        const handler = (await import('../presign-download.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        resolveSessionContextMock.mockResolvedValue({ authenticated: false });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 401 });
    });

    it('returns 403 when workspace.read fails', async () => {
        const handler = (await import('../presign-download.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        requireCanMock.mockImplementation(() => {
            const err = new Error('Forbidden') as Error & { statusCode: number };
            err.statusCode = 403;
            throw err;
        });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 403 });
        expect(queryCanonicalStorageMock).not.toHaveBeenCalled();
        expect(presignDownloadMock).not.toHaveBeenCalled();
    });

    it('returns 429 and Retry-After when rate limited', async () => {
        const handler = (await import('../presign-download.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        checkSyncRateLimitMock.mockReturnValue({ allowed: false, retryAfterMs: 1900 });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 429 });
        expect(setResponseHeaderMock).toHaveBeenCalledWith(expect.anything(), 'Retry-After', 2);
        expect(queryCanonicalStorageMock).not.toHaveBeenCalled();
        expect(presignDownloadMock).not.toHaveBeenCalled();
    });

    it('returns 500 when adapter is missing', async () => {
        const handler = (await import('../presign-download.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        getActiveStorageGatewayAdapterMock.mockReturnValue(null);

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 500 });
    });

    it('returns a generic 404 for missing, soft-deleted, or pending metadata', async () => {
        const handler = (await import('../presign-download.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());

        for (const items of [
            [],
            [{
                kind: 'metadata',
                hash: `sha256:${'a'.repeat(64)}`,
                sizeBytes: 3,
                storageId: 'storage-live',
                deleted: true,
                updatedAt: 1,
            }],
            [{
                kind: 'metadata',
                hash: `sha256:${'a'.repeat(64)}`,
                sizeBytes: 3,
                updatedAt: 1,
            }],
        ]) {
            queryCanonicalStorageMock.mockResolvedValueOnce({ items, hasMore: false });
            await expect(handler(makeEvent())).rejects.toMatchObject({
                statusCode: 404,
                statusMessage: 'File not found',
            });
        }

        expect(presignDownloadMock).not.toHaveBeenCalled();
    });

    it('uses provider expiresAt when provided', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-02-06T12:00:00.000Z'));
        const handler = (await import('../presign-download.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        presignDownloadMock.mockResolvedValue({
            url: 'https://download.example',
            expiresAt: 777_777,
        });

        await expect(handler(makeEvent())).resolves.toEqual({
            url: 'https://download.example',
            expiresAt: 777_777,
            disposition: 'attachment',
        });

        vi.useRealTimers();
    });

    it('falls back to default expiry when provider omits expiresAt', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-02-06T12:00:00.000Z'));
        const handler = (await import('../presign-download.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        presignDownloadMock.mockResolvedValue({
            url: 'https://download.example',
            expiresAt: undefined,
        });

        await expect(handler(makeEvent())).resolves.toEqual({
            url: 'https://download.example',
            expiresAt: Date.now() + 60_000,
            disposition: 'attachment',
        });

        vi.useRealTimers();
    });

    it('records metrics and rate limit accounting on success', async () => {
        const handler = (await import('../presign-download.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());

        await handler(makeEvent());

        expect(recordSyncRequestMock).toHaveBeenCalledWith('user-1', 'storage:download');
        expect(recordDownloadStartMock).toHaveBeenCalledTimes(1);
    });

    it('forwards expiry/disposition to adapter', async () => {
        const handler = (await import('../presign-download.post')).default as (event: H3Event) => Promise<unknown>;
        const body = makeValidBody();
        readBodyMock.mockResolvedValue(body);

        await handler(makeEvent());

        expect(queryCanonicalStorageMock).toHaveBeenCalledWith(expect.anything(), {
            scope: { workspaceId: 'ws-1' },
            kind: 'live_metadata',
            hash: `sha256:${'a'.repeat(64)}`,
            limit: 1,
        });
        expect(presignDownloadMock).toHaveBeenCalledWith(expect.anything(), {
            workspaceId: 'ws-1',
            hash: `sha256:${'a'.repeat(64)}`,
            storageId: 'storage-live',
            mimeType: 'image/png',
            expiresInMs: 54_321,
            disposition: 'attachment',
            filename: 'image.png',
        });
    });

    it('forces generic files to inert attachment downloads despite caller hints', async () => {
        const handler = (await import('../presign-download.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue({ ...makeValidBody(), disposition: 'inline', file_kind_capability: 'v1' });
        queryCanonicalStorageMock.mockResolvedValue({
            items: [{
                kind: 'metadata',
                hash: `sha256:${'a'.repeat(64)}`,
                sizeBytes: 3,
                storageId: 'storage-live',
                mimeType: 'text/html',
                name: '../../evil' + String.fromCharCode(13, 10) + '.html',
                fileKind: 'file',
                updatedAt: 1,
            }],
            hasMore: false,
        });

        await expect(handler(makeEvent())).resolves.toMatchObject({
            disposition: 'attachment',
        });
        expect(presignDownloadMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            mimeType: 'application/octet-stream',
            disposition: 'attachment',
            filename: '.._.._evil__.html',
        }));
    });

    it('returns 426 before presigning a generic file for an older reader', async () => {
        const handler = (await import('../presign-download.post')).default as (event: H3Event) => Promise<unknown>;
        queryCanonicalStorageMock.mockResolvedValue({
            items: [{
                kind: 'metadata',
                hash: `sha256:${'a'.repeat(64)}`,
                sizeBytes: 3,
                storageId: 'storage-live',
                mimeType: 'text/plain',
                name: 'notes.txt',
                fileKind: 'file',
                updatedAt: 1,
            }],
            hasMore: false,
        });
        readBodyMock.mockResolvedValue(makeValidBody());

        await expect(handler(makeEvent())).rejects.toMatchObject({
            statusCode: 426,
            statusMessage: 'Update OR3 Chat to use general files',
        });
        expect(presignDownloadMock).not.toHaveBeenCalled();
    });

    it('passes through download method/headers/storageId from adapter response', async () => {
        const handler = (await import('../presign-download.post')).default as (event: H3Event) => Promise<unknown>;
        readBodyMock.mockResolvedValue(makeValidBody());
        presignDownloadMock.mockResolvedValue({
            url: '/api/storage/fs/download?token=abc',
            expiresAt: 321,
            method: 'GET',
            headers: { 'x-download': '1' },
            storageId: 'ws-1:sha256:abc',
        });

        await expect(handler(makeEvent())).resolves.toEqual({
            url: '/api/storage/fs/download?token=abc',
            expiresAt: 321,
            disposition: 'attachment',
            method: 'GET',
            headers: { 'x-download': '1' },
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
        const load = async () => (await import('../presign-download.post')).default as (event: H3Event) => Promise<unknown>;
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
            expect(presignDownloadMock).not.toHaveBeenCalled();
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
            expect(presignDownloadMock).not.toHaveBeenCalled();
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

            expect(presignDownloadMock).not.toHaveBeenCalled();
        });
    });
});
