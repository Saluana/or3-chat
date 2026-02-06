import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileTransfer } from '~~/shared/storage/types';
import type { FileMeta } from '~/db/schema';
import { FileTransferQueue } from '../transfer-queue';
import type { ObjectStorageProvider } from '../types';

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
        transaction: async (_mode: string, _tables: unknown, fn: () => Promise<void>) => {
            await fn();
        },
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
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();
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
            headers: { 'content-length': '5' },
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
