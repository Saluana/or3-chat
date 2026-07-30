import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileTransfer } from '~~/shared/storage/types';
import type { FileMeta } from '~/db/schema';
import { FileTransferQueue } from '../transfer-queue';
import type { ObjectStorageProvider } from '../types';
import { controlledIo, flushTransferScheduling } from './fixtures/transfer-faults';

const hookState = vi.hoisted(() => ({
    applyFilters: vi.fn(async (_name: string, payload: unknown) => payload),
    doAction: vi.fn(async () => undefined),
}));

vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => hookState,
}));

class TableStub<T extends Record<string, any>> {
    private rows = new Map<string, T>();

    constructor(private keyField: keyof T, initial: T[] = []) {
        initial.forEach((row) => this.rows.set(String(row[this.keyField]), { ...row }));
    }

    async put(row: T): Promise<void> {
        this.rows.set(String(row[this.keyField]), { ...row });
    }

    async get(key: string): Promise<T | undefined> {
        return this.rows.get(String(key));
    }

    async update(key: string, patch: Partial<T>): Promise<number> {
        const existing = this.rows.get(String(key));
        if (!existing) return 0;
        this.rows.set(String(key), { ...existing, ...patch });
        return 1;
    }

    async delete(key: string): Promise<void> {
        this.rows.delete(String(key));
    }

    where(field: string) {
        return {
            equals: (value: unknown) => {
                const matches = Array.from(this.rows.values()).filter((row) => {
                    if (field === '[hash+direction]') {
                        const [hash, direction] = value as [string, string];
                        return row.hash === hash && row.direction === direction;
                    }
                    return false;
                });
                return {
                    toArray: async () => matches,
                };
            },
            between: (lower: unknown, upper: unknown) => {
                const matches = Array.from(this.rows.values()).filter((row) => {
                    if (field === '[state+workspace_id+created_at]') {
                        const [ls, lw] = lower as [string, string, number];
                        const [us, uw] = upper as [string, string, number];
                        return row.state === ls && row.state === us && row.workspace_id === lw && row.workspace_id === uw;
                    }
                    if (field === '[state+workspace_id+retry_at]') {
                        const [ls, lw, lts] = lower as [string, string, number];
                        const [us, uw, uts] = upper as [string, string, number];
                        const retryAt = row.retry_at ?? 0;
                        const minRetryAt = typeof lts === 'number' ? lts : Number.NEGATIVE_INFINITY;
                        const maxRetryAt = typeof uts === 'number' ? uts : Number.POSITIVE_INFINITY;
                        return row.state === ls && row.state === us && row.workspace_id === lw &&
                            row.workspace_id === uw && retryAt >= minRetryAt && retryAt <= maxRetryAt;
                    }
                    if (field === '[state+workspace_id+lease_expires_at]') {
                        const [ls, lw, lts] = lower as [string, string, number];
                        const [us, uw, uts] = upper as [string, string, number];
                        const expiresAt = row.lease_expires_at ?? 0;
                        const minExpiresAt = typeof lts === 'number' ? lts : Number.NEGATIVE_INFINITY;
                        const maxExpiresAt = typeof uts === 'number' ? uts : Number.POSITIVE_INFINITY;
                        return row.state === ls && row.state === us && row.workspace_id === lw &&
                            row.workspace_id === uw && expiresAt >= minExpiresAt && expiresAt <= maxExpiresAt;
                    }
                    if (field === '[state+created_at]') {
                        const [ls, lts] = lower as [string, number];
                        const [us, uts] = upper as [string, number];
                        return row.state === ls && row.state === us && row.created_at >= lts && row.created_at <= uts;
                    }
                    return false;
                });
                return {
                    limit: (n: number) => ({
                        toArray: async () => matches.slice(0, n),
                    }),
                    delete: async () => {
                        for (const row of matches) {
                            this.rows.delete(String(row[this.keyField]));
                        }
                    },
                    toArray: async () => matches,
                };
            },
        };
    }

    dump() {
        return this.rows;
    }
}

function createDbStub(metaRows: FileMeta[], blobRows: Array<{ hash: string; blob: Blob }>) {
    return {
        file_transfers: new TableStub<FileTransfer>('id'),
        file_meta: new TableStub<FileMeta>('hash', metaRows),
        file_blobs: new TableStub<{ hash: string; blob: Blob }>('hash', blobRows),
        transaction: async (_mode: string, _tables: unknown, fn: () => Promise<unknown>) => fn(),
    };
}

function makeMeta(overrides?: Partial<FileMeta>): FileMeta {
    return {
        hash: `sha256:${'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'}`,
        name: 'hello.txt',
        mime_type: 'text/plain',
        kind: 'pdf',
        size_bytes: 5,
        ref_count: 1,
        created_at: 1,
        updated_at: 1,
        deleted: false,
        clock: 0,
        ...overrides,
    };
}

async function pumpQueue() {
    await flushTransferScheduling();
}

describe('FileTransferQueue', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        hookState.applyFilters.mockClear();
        hookState.applyFilters.mockImplementation(async (_name: string, payload: unknown) => payload);
        hookState.doAction.mockClear();
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('runs successful upload flow (presign -> upload -> commit -> metadata persistence)', async () => {
        const meta = makeMeta({ kind: 'image', mime_type: 'image/png', name: 'a.png', size_bytes: 3 });
        const db = createDbStub([meta], [{ hash: meta.hash, blob: new Blob(['abc']) }]);

        const provider: ObjectStorageProvider = {
            id: 'provider-1',
            displayName: 'Provider',
            supports: { presignedUpload: true, presignedDownload: true },
            getPresignedUploadUrl: vi.fn(async () => ({ url: 'https://upload.example', expiresAt: Date.now(), storageId: 'st_1' })),
            getPresignedDownloadUrl: vi.fn(async () => ({ url: 'https://download.example', expiresAt: Date.now() })),
            commitUpload: vi.fn(async () => undefined),
        };

        vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));

        const queue = new FileTransferQueue(db as any, provider, { concurrency: 1, maxAttempts: 2 });
        queue.setWorkspaceId('ws-1');

        const transfer = await queue.enqueue(meta.hash, 'upload');
        await pumpQueue();
        await queue.waitForTransfer(transfer!.id);

        expect(provider.getPresignedUploadUrl).toHaveBeenCalled();
        expect(provider.commitUpload).toHaveBeenCalled();

        const savedMeta = await db.file_meta.get(meta.hash);
        expect(savedMeta?.storage_id).toBe('st_1');
        expect(savedMeta?.storage_provider_id).toBe('provider-1');

        const finalTransfer = await db.file_transfers.get(transfer!.id);
        expect(finalTransfer?.state).toBe('done');
        expect(hookState.doAction).toHaveBeenCalledWith('storage.files.upload:action:before', expect.anything());
        expect(hookState.doAction).toHaveBeenCalledWith('storage.files.upload:action:after', expect.anything());
    });

    it('defaults fs token upload URLs to PUT when presign method is missing', async () => {
        const meta = makeMeta({ kind: 'image', mime_type: 'image/png', name: 'a.png', size_bytes: 3 });
        const db = createDbStub([meta], [{ hash: meta.hash, blob: new Blob(['abc']) }]);

        const provider: ObjectStorageProvider = {
            id: 'provider-fs',
            displayName: 'Provider',
            supports: { presignedUpload: true, presignedDownload: true },
            getPresignedUploadUrl: vi.fn(async () => ({
                url: '/api/storage/fs/upload?token=test-token',
                expiresAt: Date.now(),
                storageId: 'st_1',
            })),
            getPresignedDownloadUrl: vi.fn(async () => ({ url: 'https://download.example', expiresAt: Date.now() })),
        };

        const fetchMock = vi.fn(async () => new Response('', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        const queue = new FileTransferQueue(db as any, provider, { concurrency: 1, maxAttempts: 2 });
        await (queue as any).doUpload(
            {
                id: 'upload-1',
                hash: meta.hash,
                workspace_id: 'ws-1',
                direction: 'upload',
                bytes_total: 0,
                bytes_done: 0,
                state: 'running',
                attempts: 0,
                created_at: 1,
                updated_at: 1,
            } as FileTransfer,
            new AbortController().signal
        );

        expect(fetchMock).toHaveBeenCalledWith(
            '/api/storage/fs/upload?token=test-token',
            expect.objectContaining({ method: 'PUT' })
        );
    });

    it('runs successful download flow with hash verification and blob persistence', async () => {
        const meta = makeMeta({ storage_id: 'st_1', storage_provider_id: 'provider-1' });
        const db = createDbStub([meta], []);

        const provider: ObjectStorageProvider = {
            id: 'provider-1',
            displayName: 'Provider',
            supports: { presignedUpload: true, presignedDownload: true },
            getPresignedUploadUrl: vi.fn(async () => ({ url: 'https://upload.example', expiresAt: Date.now() })),
            getPresignedDownloadUrl: vi.fn(async () => ({ url: 'https://download.example', expiresAt: Date.now() })),
        };

        vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['hello']), {
            status: 200,
            headers: { 'content-length': '5', 'content-type': 'text/plain' },
        })));

        const queue = new FileTransferQueue(db as any, provider, { concurrency: 1, maxAttempts: 2 });
        queue.setWorkspaceId('ws-1');
        (queue as any).readBlobWithProgress = vi.fn(async () => ({
            blob: {
                size: 5,
                arrayBuffer: async () => new TextEncoder().encode('hello').buffer,
            } as Blob,
            bytesTotal: 5,
        }));
        await (queue as any).doDownload(
            {
                id: 'download-1',
                hash: meta.hash,
                workspace_id: 'ws-1',
                direction: 'download',
                bytes_total: 0,
                bytes_done: 0,
                state: 'running',
                attempts: 0,
                created_at: 1,
                updated_at: 1,
            },
            new AbortController().signal
        );

        const blobRow = await db.file_blobs.get(meta.hash);
        expect(blobRow?.blob).toBeDefined();
        expect(hookState.doAction).toHaveBeenCalledWith('storage.files.download:action:before', expect.anything());
        expect(hookState.doAction).toHaveBeenCalledWith('storage.files.download:action:after', expect.anything());
    });

    it('rejects MIME mismatches and aborts streaming downloads over the hard cap', async () => {
        const meta = makeMeta({ storage_id: 'st_1', mime_type: 'text/plain' });
        const db = createDbStub([meta], []);
        const provider: ObjectStorageProvider = {
            id: 'provider-1',
            displayName: 'Provider',
            supports: { presignedUpload: true, presignedDownload: true },
            getPresignedUploadUrl: vi.fn(async () => ({ url: 'upload', expiresAt: Date.now() })),
            getPresignedDownloadUrl: vi.fn(async () => ({ url: 'download', expiresAt: Date.now() })),
        };
        const queue = new FileTransferQueue(db as any, provider, { maxDownloadBytes: 5 });
        vi.stubGlobal('fetch', vi.fn(async () => new Response('hello', {
            status: 200,
            headers: { 'content-type': 'application/json' },
        })));

        await expect((queue as any).doDownload({
            id: 'mime-mismatch',
            hash: meta.hash,
            workspace_id: 'ws-1',
            direction: 'download',
            bytes_total: 0,
            bytes_done: 0,
            state: 'running',
            attempts: 0,
            created_at: 1,
            updated_at: 1,
        }, new AbortController().signal)).rejects.toThrow('content-type mismatch');
        expect(await db.file_blobs.get(meta.hash)).toBeUndefined();

        const oversizedStream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array([1, 2, 3]));
                controller.enqueue(new Uint8Array([4, 5, 6]));
                controller.close();
            },
        });
        await expect((queue as any).readBlobWithProgress(
            new Response(oversizedStream, { headers: { 'content-type': 'text/plain' } }),
            'oversized-stream',
            db,
            5,
            'text/plain'
        )).rejects.toThrow('byte limit');

        const verified = await (queue as any).readBlobWithProgress(
            new Response('hello', { headers: { 'content-type': 'text/plain; charset=utf-8' } }),
            'verified-mime',
            db,
            5,
            'text/plain; charset=utf-8'
        );
        expect(verified.blob.type).toContain('text/plain');
    });

    it('records a recoverable outcome without deleting metadata or cache on one 404', async () => {
        const meta = makeMeta({
            hash: `sha256:${'c'.repeat(64)}`,
            storage_id: 'missing-remote',
            storage_provider_id: 'provider-1',
            deleted: false,
            deleted_at: undefined,
        });
        const db = createDbStub([meta], []);

        const provider: ObjectStorageProvider = {
            id: 'provider-1',
            displayName: 'Provider',
            supports: { presignedUpload: true, presignedDownload: true },
            getPresignedUploadUrl: vi.fn(async () => ({ url: 'https://upload.example', expiresAt: Date.now() })),
            getPresignedDownloadUrl: vi.fn(async () => ({ url: 'https://download.example/missing', expiresAt: Date.now() })),
        };

        vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));

        const queue = new FileTransferQueue(db as any, provider, { concurrency: 1, maxAttempts: 5 });

        let missingError: unknown;
        try {
            await (queue as any).doDownload(
            {
                id: 'download-404',
                hash: meta.hash,
                workspace_id: 'ws-1',
                direction: 'download',
                bytes_total: 0,
                bytes_done: 0,
                state: 'running',
                attempts: 0,
                created_at: 1,
                updated_at: 1,
            } as FileTransfer,
            new AbortController().signal,
            );
        } catch (error) {
            missingError = error;
        }

        const updatedMeta = await db.file_meta.get(meta.hash);
        expect((missingError as { transferState?: string }).transferState).toBe('remote_missing');
        expect(updatedMeta).toEqual(meta);
    });

    it('treats missing storage_id as pending upload without mutating metadata', async () => {
        const meta = makeMeta({ storage_id: undefined, deleted: false });
        const cached = { hash: meta.hash, blob: new Blob(['cached']) };
        const db = createDbStub([meta], [cached]);
        const provider: ObjectStorageProvider = {
            id: 'provider-1',
            displayName: 'Provider',
            supports: { presignedUpload: true, presignedDownload: true },
            getPresignedUploadUrl: vi.fn(async () => ({ url: 'https://upload.example', expiresAt: Date.now() })),
            getPresignedDownloadUrl: vi.fn(async () => ({ url: 'https://download.example', expiresAt: Date.now() })),
        };
        const queue = new FileTransferQueue(db as any, provider);

        await expect((queue as any).doDownload({
            id: 'pending-upload',
            hash: meta.hash,
            workspace_id: 'ws-1',
            direction: 'download',
            bytes_total: 0,
            bytes_done: 0,
            state: 'running',
            attempts: 0,
            created_at: 1,
            updated_at: 1,
        }, new AbortController().signal)).rejects.toMatchObject({
            transferState: 'pending_upload',
        });

        expect(await db.file_meta.get(meta.hash)).toEqual(meta);
        expect(await db.file_blobs.get(meta.hash)).toEqual(cached);
    });

    it('persists recoverable transfer state and requires an explicit retry', async () => {
        const meta = makeMeta({ storage_id: undefined });
        const db = createDbStub([meta], []);
        const transfer: FileTransfer = {
            id: 'recoverable-download',
            hash: meta.hash,
            workspace_id: 'ws-1',
            direction: 'download',
            bytes_total: 0,
            bytes_done: 0,
            state: 'queued',
            attempts: 0,
            created_at: 1,
            updated_at: 1,
        };
        await db.file_transfers.put(transfer);
        const provider: ObjectStorageProvider = {
            id: 'provider-1',
            displayName: 'Provider',
            supports: { presignedUpload: true, presignedDownload: true },
            getPresignedUploadUrl: vi.fn(async () => ({ url: 'https://upload.example', expiresAt: Date.now() })),
            getPresignedDownloadUrl: vi.fn(async () => ({ url: 'https://download.example', expiresAt: Date.now() })),
        };
        const queue = new FileTransferQueue(db as any, provider);

        await (queue as any).processTransfer(transfer);
        expect((await db.file_transfers.get(transfer.id))?.state).toBe('pending_upload');

        await db.file_meta.put({ ...meta, storage_id: 'now-committed' });
        await expect(queue.retryRecoverable(transfer.id)).resolves.toBe(true);
        expect((await db.file_transfers.get(transfer.id))?.state).toBe('queued');
    });

    it('re-queues remote_missing downloads on enqueue so later blob availability can succeed', async () => {
        const meta = makeMeta({ storage_id: 'st_1', mime_type: 'image/webp' });
        const db = createDbStub([meta], []);
        const stuck: FileTransfer = {
            id: 'stuck-remote-missing',
            hash: meta.hash,
            workspace_id: 'ws-1',
            direction: 'download',
            bytes_total: 0,
            bytes_done: 0,
            state: 'remote_missing',
            attempts: 1,
            created_at: 1,
            updated_at: 1,
            last_error: 'Remote object is temporarily missing and requires reconciliation',
        };
        await db.file_transfers.put(stuck);
        const provider: ObjectStorageProvider = {
            id: 'provider-1',
            displayName: 'Provider',
            supports: { presignedUpload: true, presignedDownload: true },
            getPresignedUploadUrl: vi.fn(async () => ({ url: 'https://upload.example', expiresAt: Date.now() })),
            getPresignedDownloadUrl: vi.fn(async () => ({ url: 'https://download.example', expiresAt: Date.now() })),
        };
        const queue = new FileTransferQueue(db as any, provider);
        queue.setWorkspaceId('ws-1');

        const result = await queue.enqueue(meta.hash, 'download');
        expect(result?.id).toBe(stuck.id);
        expect(result?.state).toBe('queued');
    });

    it('accepts downloads with missing or octet-stream content-type using file_meta mime', async () => {
        const meta = makeMeta({ storage_id: 'st_1', mime_type: 'image/webp' });
        const db = createDbStub([meta], []);
        const provider: ObjectStorageProvider = {
            id: 'provider-1',
            displayName: 'Provider',
            supports: { presignedUpload: true, presignedDownload: true },
            getPresignedUploadUrl: vi.fn(async () => ({ url: 'upload', expiresAt: Date.now() })),
            getPresignedDownloadUrl: vi.fn(async () => ({
                url: 'download',
                expiresAt: Date.now(),
            })),
        };
        const queue = new FileTransferQueue(db as any, provider);
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({
                ok: true,
                status: 200,
                headers: { get: () => null },
                body: { cancel: vi.fn() },
            }))
        );
        (queue as any).readBlobWithProgress = vi.fn(async (_response: Response, _id: string, _db: unknown, _max: number, mimeType: string) => ({
            blob: {
                size: 5,
                type: mimeType,
                arrayBuffer: async () => new TextEncoder().encode('hello').buffer,
            } as Blob,
            bytesTotal: 5,
        }));

        await (queue as any).doDownload(
            {
                id: 'missing-mime',
                hash: meta.hash,
                workspace_id: 'ws-1',
                direction: 'download',
                bytes_total: 0,
                bytes_done: 0,
                state: 'running',
                attempts: 0,
                created_at: 1,
                updated_at: 1,
            },
            new AbortController().signal
        );

        expect((queue as any).readBlobWithProgress).toHaveBeenCalledWith(
            expect.anything(),
            'missing-mime',
            expect.anything(),
            expect.anything(),
            'image/webp',
            expect.any(AbortSignal)
        );
        expect(await db.file_blobs.get(meta.hash)).toBeDefined();
    });

    it('cancels in-flight transfer on workspace switch and explicit cancellation', async () => {
        const meta = makeMeta({ kind: 'image', mime_type: 'image/png', name: 'a.png', size_bytes: 3 });
        const db = createDbStub([meta], [{ hash: meta.hash, blob: new Blob(['abc']) }]);

        const provider: ObjectStorageProvider = {
            id: 'provider-1',
            displayName: 'Provider',
            supports: { presignedUpload: true, presignedDownload: true },
            getPresignedUploadUrl: vi.fn(async () => ({ url: 'https://upload.example', expiresAt: Date.now(), storageId: 'st_1' })),
            getPresignedDownloadUrl: vi.fn(async () => ({ url: 'https://download.example', expiresAt: Date.now() })),
        };

        const queue = new FileTransferQueue(db as any, provider, { concurrency: 1, maxAttempts: 2 });
        queue.setWorkspaceId('ws-1');
        const controllerA = new AbortController();
        (queue as any).running.add('running-a');
        (queue as any).abortControllers.set('running-a', controllerA);
        queue.cancelTransfer('running-a');
        expect(controllerA.signal.aborted).toBe(true);

        const manualController = new AbortController();
        (queue as any).running.add('running-b');
        (queue as any).abortControllers.set('running-b', manualController);
        queue.setWorkspaceId('ws-2');
        expect(manualController.signal.aborted).toBe(true);
    });

    it('requeues a transfer interrupted by a workspace switch', async () => {
        const meta = makeMeta({ kind: 'image', mime_type: 'image/png', name: 'a.png', size_bytes: 3 });
        const db = createDbStub([meta], [{ hash: meta.hash, blob: new Blob(['abc']) }]);
        const transfer: FileTransfer = {
            id: 'workspace-switch-upload',
            hash: meta.hash,
            workspace_id: 'ws-1',
            direction: 'upload',
            bytes_total: 0,
            bytes_done: 0,
            state: 'queued',
            attempts: 0,
            created_at: 1,
            updated_at: 1,
        };
        await db.file_transfers.put(transfer);

        const provider: ObjectStorageProvider = {
            id: 'provider-1',
            displayName: 'Provider',
            supports: { presignedUpload: true, presignedDownload: true },
            getPresignedUploadUrl: vi.fn(async () => ({
                url: 'https://upload.example',
                expiresAt: Date.now(),
                storageId: 'st_1',
            })),
            getPresignedDownloadUrl: vi.fn(async () => ({
                url: 'https://download.example',
                expiresAt: Date.now(),
            })),
        };
        const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
                const signal = init?.signal;
                const rejectAbort = () => reject(new DOMException('Aborted', 'AbortError'));
                if (signal?.aborted) {
                    rejectAbort();
                    return;
                }
                signal?.addEventListener('abort', rejectAbort, { once: true });
            })
        );
        vi.stubGlobal('fetch', fetchMock);

        const queue = new FileTransferQueue(db as any, provider, {
            concurrency: 1,
            maxAttempts: 2,
        });
        queue.setWorkspaceId('ws-1');
        (queue as any).running.add(transfer.id);

        const processing = (queue as any).processTransfer(transfer);
        for (let i = 0; i < 20 && fetchMock.mock.calls.length === 0; i += 1) {
            await Promise.resolve();
        }
        expect(fetchMock).toHaveBeenCalledOnce();

        queue.setWorkspaceId('ws-2');
        await processing;

        expect(await db.file_transfers.get(transfer.id)).toMatchObject({
            state: 'queued',
            retry_at: 0,
            last_error: undefined,
            lease_owner: undefined,
            lease_expires_at: undefined,
        });
    });

    it('requeues a running transfer in a freshly opened workspace database after eviction', async () => {
        const meta = makeMeta();
        const closedDb = createDbStub([meta], []);
        const reopenedDb = createDbStub([meta], []);
        const transfer: FileTransfer = {
            id: 'evicted-workspace-download',
            hash: meta.hash,
            workspace_id: 'ws-evicted',
            direction: 'download',
            bytes_total: 0,
            bytes_done: 0,
            state: 'running',
            attempts: 0,
            retry_at: 0,
            lease_owner: 'old-worker',
            lease_expires_at: Date.now() + 30_000,
            created_at: 1,
            updated_at: 1,
        };
        await reopenedDb.file_transfers.put(transfer);

        const provider = {
            id: 'provider-1',
            displayName: 'Provider',
            supports: { presignedUpload: true, presignedDownload: true },
            getPresignedUploadUrl: vi.fn(),
            getPresignedDownloadUrl: vi.fn(),
        } as unknown as ObjectStorageProvider;
        const queue = new FileTransferQueue(closedDb as any, provider, {
            workspaceDbResolver: (workspaceId) => {
                expect(workspaceId).toBe('ws-evicted');
                return reopenedDb as any;
            },
        });

        await (queue as any).requeueTransferAfterDatabaseClose(transfer, {
            workspaceId: 'ws-evicted',
            dbName: 'or3-db-ws-evicted',
            db: closedDb,
        });

        expect(await reopenedDb.file_transfers.get(transfer.id)).toMatchObject({
            state: 'queued',
            retry_at: 0,
            last_error: undefined,
            lease_owner: undefined,
            lease_expires_at: undefined,
        });
    });

    it('settles an in-flight transfer only against its captured workspace database', async () => {
        const hash = `sha256:${'a'.repeat(64)}`;
        const oldMeta = makeMeta({ hash, storage_id: undefined, name: 'old-workspace.png', size_bytes: 3 });
        const newMeta = makeMeta({ hash, storage_id: undefined, name: 'new-workspace.png', size_bytes: 3 });
        const oldDb = createDbStub([oldMeta], [{ hash, blob: new Blob(['old']) }]);
        const newDb = createDbStub([newMeta], [{ hash, blob: new Blob(['new']) }]);
        const transfer: FileTransfer = {
            id: 'workspace-bound-upload',
            hash,
            workspace_id: 'ws-old',
            direction: 'upload',
            bytes_total: 0,
            bytes_done: 0,
            state: 'queued',
            attempts: 0,
            created_at: 1,
            updated_at: 1,
        };
        await oldDb.file_transfers.put(transfer);
        await newDb.file_transfers.put({ ...transfer, workspace_id: 'ws-new' });
        let activeDb = oldDb;
        const upload = controlledIo<Response>();
        vi.stubGlobal('fetch', upload.request);
        const provider: ObjectStorageProvider = {
            id: 'provider-1',
            displayName: 'Provider',
            supports: { presignedUpload: true, presignedDownload: true },
            getPresignedUploadUrl: vi.fn(async () => ({
                url: 'https://upload.example',
                expiresAt: Date.now(),
                storageId: 'old-storage-id',
            })),
            getPresignedDownloadUrl: vi.fn(async () => ({ url: 'https://download.example', expiresAt: Date.now() })),
        };
        const queue = new FileTransferQueue(oldDb as any, provider, {
            dbResolver: () => activeDb as any,
        });
        queue.setWorkspaceId('ws-old');
        (queue as any).running.add(transfer.id);

        const processing = (queue as any).processTransfer(transfer);
        for (let i = 0; i < 20 && !vi.mocked(fetch).mock.calls.length; i++) await Promise.resolve();
        activeDb = newDb;
        queue.setWorkspaceId('ws-new');
        upload.succeed(new Response('', { status: 200 }));
        await processing;

        expect((await oldDb.file_meta.get(hash))?.storage_id).toBe('old-storage-id');
        expect((await oldDb.file_transfers.get(transfer.id))?.state).toBe('done');
        expect(await newDb.file_meta.get(hash)).toEqual(newMeta);
        expect((await newDb.file_transfers.get(transfer.id))?.state).toBe('queued');
    });

    it('enforces concurrency cap', async () => {
        const metaA = makeMeta({ hash: `sha256:${'a'.repeat(64)}` });
        const metaB = makeMeta({ hash: `sha256:${'b'.repeat(64)}` });
        const db = createDbStub(
            [metaA, metaB],
            [
                { hash: metaA.hash, blob: new Blob(['a']) },
                { hash: metaB.hash, blob: new Blob(['b']) },
            ]
        );

        const provider: ObjectStorageProvider = {
            id: 'provider-1',
            displayName: 'Provider',
            supports: { presignedUpload: true, presignedDownload: true },
            getPresignedUploadUrl: vi.fn(async ({ hash }) => ({ url: `https://upload.example/${hash}`, expiresAt: Date.now(), storageId: `st_${hash}` })),
            getPresignedDownloadUrl: vi.fn(async () => ({ url: 'https://download.example', expiresAt: Date.now() })),
            commitUpload: vi.fn(async () => undefined),
        };

        let active = 0;
        let maxActive = 0;
        vi.stubGlobal('fetch', vi.fn(async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise((r) => setTimeout(r, 20));
            active -= 1;
            return new Response('', { status: 200 });
        }));

        const queue = new FileTransferQueue(db as any, provider, { concurrency: 1, maxAttempts: 2 });
        queue.setWorkspaceId('ws-1');

        const t1 = await queue.enqueue(metaA.hash, 'upload');
        const t2 = await queue.enqueue(metaB.hash, 'upload');

        await vi.advanceTimersByTimeAsync(100);
        await queue.waitForTransfer(t1!.id);
        await queue.waitForTransfer(t2!.id);

        expect(maxActive).toBe(1);
    });

    it('supports backoff progression and caps delay', () => {
        const meta = makeMeta();
        const db = createDbStub([meta], [{ hash: meta.hash, blob: new Blob(['x']) }]);
        const provider = {
            id: 'provider-1',
            displayName: 'Provider',
            supports: { presignedUpload: true, presignedDownload: true },
            getPresignedUploadUrl: vi.fn(),
            getPresignedDownloadUrl: vi.fn(),
        } as unknown as ObjectStorageProvider;

        const queue = new FileTransferQueue(db as any, provider, {
            backoffBaseMs: 100,
            backoffMaxMs: 250,
        });

        expect((queue as any).getBackoffDelay(1)).toBe(100);
        expect((queue as any).getBackoffDelay(2)).toBe(200);
        expect((queue as any).getBackoffDelay(3)).toBe(250);
        expect((queue as any).getBackoffDelay(8)).toBe(250);
    });

    it('persists retry_at so immediate pumping cannot bypass backoff', async () => {
        vi.setSystemTime(1_000);
        const meta = makeMeta();
        const db = createDbStub([meta], [{ hash: meta.hash, blob: new Blob(['x']) }]);
        const provider = {
            id: 'provider-1',
            displayName: 'Provider',
            supports: { presignedUpload: true, presignedDownload: true },
            getPresignedUploadUrl: vi.fn(),
            getPresignedDownloadUrl: vi.fn(),
        } as unknown as ObjectStorageProvider;
        const queue = new FileTransferQueue(db as any, provider, {
            backoffBaseMs: 100,
            backoffMaxMs: 100,
            maxAttempts: 3,
        });
        (queue as any).workspaceId = 'ws-1';
        const transfer: FileTransfer = {
            id: 'persisted-retry',
            hash: meta.hash,
            workspace_id: 'ws-1',
            direction: 'upload',
            bytes_total: 0,
            bytes_done: 0,
            state: 'queued',
            attempts: 0,
            retry_at: 0,
            created_at: 1,
            updated_at: 1,
        };
        await db.file_transfers.put(transfer);
        (queue as any).doUpload = vi.fn()
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce(undefined);

        await (queue as any).processTransfer(transfer);
        expect(await db.file_transfers.get(transfer.id)).toMatchObject({
            state: 'queued',
            attempts: 1,
            retry_at: 1_100,
        });

        (queue as any).scheduleProcessQueue(0);
        await vi.advanceTimersByTimeAsync(99);
        expect((queue as any).doUpload).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        for (let i = 0; i < 20 && (queue as any).doUpload.mock.calls.length < 2; i++) {
            await Promise.resolve();
        }
        expect((queue as any).doUpload).toHaveBeenCalledTimes(2);
        expect((await db.file_transfers.get(transfer.id))?.state).toBe('done');
    });

    it('treats 413 uploads as non-retryable permanent failure', async () => {
        const meta = makeMeta({ kind: 'image', mime_type: 'image/png', name: 'a.png', size_bytes: 10 * 1024 * 1024 });
        const db = createDbStub([meta], [{ hash: meta.hash, blob: new Blob(['abc']) }]);

        const provider: ObjectStorageProvider = {
            id: 'provider-1',
            displayName: 'Provider',
            supports: { presignedUpload: true, presignedDownload: true },
            getPresignedUploadUrl: vi.fn(async () => ({ url: 'https://upload.example', expiresAt: Date.now() })),
            getPresignedDownloadUrl: vi.fn(async () => ({ url: 'https://download.example', expiresAt: Date.now() })),
        };

        const queue = new FileTransferQueue(db as any, provider, { maxAttempts: 5 });
        queue.setWorkspaceId('ws-1');
        (queue as any).doUpload = vi.fn(async () => {
            throw { message: 'File too large', retryable: false };
        });

        const transfer: FileTransfer = {
            id: 'non-retryable-1',
            hash: meta.hash,
            workspace_id: 'ws-1',
            direction: 'upload',
            bytes_total: 0,
            bytes_done: 0,
            state: 'queued',
            attempts: 0,
            created_at: 1,
            updated_at: 1,
        };
        await db.file_transfers.put(transfer);
        await (queue as any).processTransfer(transfer);

        const failed = await db.file_transfers.get(transfer.id);
        expect(failed?.state).toBe('failed');
        expect(failed?.attempts).toBe(1);
        expect(failed?.last_error).toContain('File too large');
    });

    it('waitForTransfer handles done/failed/not-found/timeout and ensureDownloadedBlob uses cache', async () => {
        const meta = makeMeta({ storage_id: 'st_1', storage_provider_id: 'provider-1' });
        const db = createDbStub([meta], [{ hash: meta.hash, blob: new Blob(['cached']) }]);

        const provider: ObjectStorageProvider = {
            id: 'provider-1',
            displayName: 'Provider',
            supports: { presignedUpload: true, presignedDownload: true },
            getPresignedUploadUrl: vi.fn(async () => ({ url: 'u', expiresAt: Date.now() })),
            getPresignedDownloadUrl: vi.fn(async () => ({ url: 'd', expiresAt: Date.now() })),
        };

        const queue = new FileTransferQueue(db as any, provider, { concurrency: 1 });

        await db.file_transfers.put({
            id: 'done-1',
            hash: meta.hash,
            workspace_id: 'ws-1',
            direction: 'download',
            bytes_total: 1,
            bytes_done: 1,
            state: 'done',
            attempts: 0,
            created_at: 1,
            updated_at: 1,
        } as FileTransfer);
        await expect(queue.waitForTransfer('done-1', 100_000)).resolves.toBeUndefined();

        await db.file_transfers.put({
            id: 'failed-1',
            hash: meta.hash,
            workspace_id: 'ws-1',
            direction: 'download',
            bytes_total: 1,
            bytes_done: 0,
            state: 'failed',
            attempts: 1,
            created_at: 1,
            updated_at: 1,
            last_error: 'failed-x',
        } as FileTransfer);
        await expect(queue.waitForTransfer('failed-1', 100_000)).rejects.toThrow('failed-x');

        await expect(queue.waitForTransfer('missing-id', 100_000)).rejects.toThrow('Transfer not found');

        await db.file_transfers.put({
            id: 'queued-1',
            hash: meta.hash,
            workspace_id: 'ws-1',
            direction: 'download',
            bytes_total: 0,
            bytes_done: 0,
            state: 'queued',
            attempts: 0,
            created_at: 1,
            updated_at: 1,
        } as FileTransfer);
        vi.clearAllTimers();
        const timeoutPromise = expect(queue.waitForTransfer('queued-1', 5)).rejects.toThrow('Transfer timeout');
        await vi.advanceTimersByTimeAsync(10);
        await timeoutPromise;

        const cached = await queue.ensureDownloadedBlob(meta.hash);
        expect(cached).toBeDefined();
    });

    it('waitForTransfer rejects pending_upload as a recoverable error', async () => {
        const meta = makeMeta({ storage_id: undefined });
        const db = createDbStub([meta], []);
        const provider: ObjectStorageProvider = {
            id: 'provider-1',
            displayName: 'Provider',
            supports: { presignedUpload: true, presignedDownload: true },
            getPresignedUploadUrl: vi.fn(async () => ({ url: 'https://upload.example', expiresAt: Date.now() })),
            getPresignedDownloadUrl: vi.fn(async () => ({ url: 'https://download.example', expiresAt: Date.now() })),
        };
        const queue = new FileTransferQueue(db as any, provider);

        await db.file_transfers.put({
            id: 'pending-dl',
            hash: meta.hash,
            workspace_id: 'ws-1',
            direction: 'download',
            bytes_total: 0,
            bytes_done: 0,
            state: 'pending_upload',
            attempts: 0,
            created_at: 1,
            updated_at: 1,
            last_error: 'Remote upload has not been committed yet',
        } as FileTransfer);

        await expect(queue.waitForTransfer('pending-dl')).rejects.toMatchObject({
            transferState: 'pending_upload',
            message: 'Remote upload has not been committed yet',
        });
        expect(provider.getPresignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('ensureDownloadedBlob returns undefined when download parks as pending_upload', async () => {
        const meta = makeMeta({ storage_id: undefined });
        const db = createDbStub([meta], []);
        const provider: ObjectStorageProvider = {
            id: 'provider-1',
            displayName: 'Provider',
            supports: { presignedUpload: true, presignedDownload: true },
            getPresignedUploadUrl: vi.fn(async () => ({ url: 'https://upload.example', expiresAt: Date.now() })),
            getPresignedDownloadUrl: vi.fn(async () => ({ url: 'https://download.example', expiresAt: Date.now() })),
        };
        const queue = new FileTransferQueue(db as any, provider, {
            concurrency: 1,
            dbResolver: () => db as any,
        });
        (queue as any).workspaceId = 'ws-1';

        const blobPromise = queue.ensureDownloadedBlob(meta.hash);
        await pumpQueue();
        await expect(blobPromise).resolves.toBeUndefined();
        expect(provider.getPresignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('disposes timers, waiters, lease renewals, and running requests idempotently', async () => {
        const meta = makeMeta();
        const db = createDbStub([meta], []);
        const provider = {
            id: 'provider-1',
            displayName: 'Provider',
            supports: { presignedUpload: true, presignedDownload: true },
            getPresignedUploadUrl: vi.fn(),
            getPresignedDownloadUrl: vi.fn(),
        } as unknown as ObjectStorageProvider;
        const queue = new FileTransferQueue(db as any, provider);
        const transfer: FileTransfer = {
            id: 'dispose-me',
            hash: meta.hash,
            workspace_id: 'ws-1',
            direction: 'download',
            bytes_total: 0,
            bytes_done: 0,
            state: 'queued',
            attempts: 0,
            retry_at: 0,
            created_at: 1,
            updated_at: 1,
        };
        await db.file_transfers.put(transfer);
        (queue as any).workspaceId = 'ws-1';
        (queue as any).scheduleProcessQueue(1_000);
        const controller = new AbortController();
        (queue as any).running.add(transfer.id);
        (queue as any).abortControllers.set(transfer.id, controller);
        (queue as any).leaseRenewals.set(transfer.id, setInterval(() => undefined, 1_000));
        const waiting = expect(queue.waitForTransfer(transfer.id, 10_000))
            .rejects.toThrow('Transfer queue disposed');
        await Promise.resolve();

        queue.dispose();
        queue.dispose();
        await waiting;

        expect(controller.signal.aborted).toBe(true);
        expect((queue as any).waiters.size).toBe(0);
        expect((queue as any).leaseRenewals.size).toBe(0);
        expect((queue as any).processQueueTimeout).toBeNull();
        expect(queue.getWorkspaceId()).toBeNull();
    });

    it('rejects upload via policy filter and cleans old done/failed transfers', async () => {
        const meta = makeMeta({ kind: 'image', mime_type: 'image/png', name: 'a.png' });
        const db = createDbStub([meta], [{ hash: meta.hash, blob: new Blob(['abc']) }]);

        hookState.applyFilters.mockImplementation(async (name: string, payload: unknown) => {
            if (name === 'storage.files.upload:filter:policy') return false;
            return payload;
        });

        const provider: ObjectStorageProvider = {
            id: 'provider-1',
            displayName: 'Provider',
            supports: { presignedUpload: true, presignedDownload: true },
            getPresignedUploadUrl: vi.fn(async () => ({ url: 'u', expiresAt: Date.now() })),
            getPresignedDownloadUrl: vi.fn(async () => ({ url: 'd', expiresAt: Date.now() })),
        };

        const queue = new FileTransferQueue(db as any, provider, { maxAttempts: 1 });
        queue.setWorkspaceId('ws-1');

        const transfer = await queue.enqueue(meta.hash, 'upload');
        await pumpQueue();

        const failed = await db.file_transfers.get(transfer!.id);
        expect(failed?.state).toBe('failed');
        expect(failed?.last_error).toContain('Upload rejected by policy');

        // Seed old done/failed entries and force cleanup
        await db.file_transfers.put({
            id: 'old-done',
            hash: 'h1',
            workspace_id: 'ws-1',
            direction: 'upload',
            bytes_total: 1,
            bytes_done: 1,
            state: 'done',
            attempts: 0,
            created_at: 0,
            updated_at: 0,
        } as FileTransfer);
        await db.file_transfers.put({
            id: 'old-failed',
            hash: 'h2',
            workspace_id: 'ws-1',
            direction: 'upload',
            bytes_total: 1,
            bytes_done: 0,
            state: 'failed',
            attempts: 1,
            created_at: 0,
            updated_at: 0,
        } as FileTransfer);

        ;(queue as any).lastCleanupAt = 0;
        await (queue as any).cleanupOldTransfers();

        expect(await db.file_transfers.get('old-done')).toBeUndefined();
        expect(await db.file_transfers.get('old-failed')).toBeUndefined();
    });

    it('rebinds to active db when old db is closed during workspace handoff', async () => {
        const provider: ObjectStorageProvider = {
            id: 'provider-1',
            displayName: 'Provider',
            supports: { presignedUpload: true, presignedDownload: true },
            getPresignedUploadUrl: vi.fn(async () => ({ url: 'u', expiresAt: Date.now() })),
            getPresignedDownloadUrl: vi.fn(async () => ({ url: 'd', expiresAt: Date.now() })),
        };

        const closedError = {
            name: 'DatabaseClosedError',
            message: 'DatabaseClosedError Database has been closed',
        };

        const closedDb = {
            file_transfers: {
                where: vi.fn(() => ({
                    between: vi.fn(() => ({
                        limit: vi.fn(() => ({
                            toArray: vi.fn(async () => {
                                throw closedError;
                            }),
                        })),
                    })),
                })),
            },
            transaction: async (_mode: string, _table: unknown, fn: () => Promise<unknown>) => fn(),
        };

        const openDb = {
            file_transfers: {
                where: vi.fn(() => ({
                    between: vi.fn(() => ({
                        limit: vi.fn(() => ({
                            toArray: vi.fn(async () => []),
                        })),
                    })),
                })),
            },
            transaction: async (_mode: string, _table: unknown, fn: () => Promise<unknown>) => fn(),
        };

        let currentDb = closedDb as any;
        const queue = new FileTransferQueue(currentDb, provider, {
            dbResolver: () => currentDb,
        });

        (queue as any).workspaceId = 'ws-new';
        (queue as any).cleanupOldTransfers = vi.fn(async () => undefined);

        currentDb = openDb as any;

        await expect((queue as any).processQueue()).resolves.toBeUndefined();
        expect((queue as any).db).toBe(openDb);
    });
});
