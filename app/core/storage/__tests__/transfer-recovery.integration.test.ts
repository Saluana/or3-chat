import 'fake-indexeddb/auto';
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Or3DB, setActiveWorkspaceDb } from '~/db/client';
import type { FileMeta } from '~/db/schema';
import type { FileTransfer } from '~~/shared/storage/types';
import { DEFAULT_FILE_POLICY } from '~~/shared/storage/file-policy';
import { createOrRefFile, softDeleteFile } from '~/db/files';
import * as queues from '../transfer-queue';
import type { ObjectStorageProvider, PresignedUrlResult } from '../types';
import { deferred } from './fixtures/transfer-faults';

const policy = vi.hoisted(() => ({ cloud: false, cacheBytes: 10 * 1024 * 1024 }));
vi.mock('../file-policy', () => ({
    isCloudFileStorageEnabled: () => policy.cloud,
    loadFilePolicy: async () => ({ maxCachedFileBytes: policy.cacheBytes, maxCacheBytes: 250 * 1024 * 1024,
        retentionDays: 14, maxUploadBytes: 100 * 1024 * 1024 }),
}));
vi.mock('~/core/hooks/useHooks', () => ({ useHooks: () => ({
    applyFilters: async (_name: string, value: unknown) => value,
    doAction: async () => undefined,
}) }));

const databases: Or3DB[] = [];
const executors: queues.FileTransferQueue[] = [];
const hash = 'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
const meta = (): FileMeta => ({ hash, name: 'hello.txt', kind: 'file', mime_type: 'text/plain',
    size_bytes: 5, ref_count: 1, deleted: false, clock: 1, created_at: 1, updated_at: 1 });

async function database(name = `transfer-recovery-${crypto.randomUUID()}`) {
    const db = new Or3DB(name);
    databases.push(db);
    await db.open();
    return db;
}
function provider(): ObjectStorageProvider {
    return { id: 'recovery-provider', displayName: 'Recovery provider',
        supports: { presignedUpload: true, presignedDownload: true },
        getPresignedUploadUrl: vi.fn(async () => ({ url: 'https://storage.example/upload', expiresAt: Date.now() + 60_000, storageId: 'verified-original' })),
        getPresignedDownloadUrl: vi.fn(async () => ({ url: 'https://storage.example/download', expiresAt: Date.now() + 60_000 })),
        commitUpload: vi.fn(async () => undefined),
    };
}
function queue(db: Or3DB, storage = provider(), config: queues.FileTransferQueueConfig = {}) {
    const executor = new queues.FileTransferQueue(db, storage, { concurrency: 1,
        dbResolver: () => db, workspaceDbResolver: () => db, ...config });
    executors.push(executor);
    return executor;
}
async function until(predicate: () => boolean | Promise<boolean>, timeout = 1_500) {
    const deadline = performance.now() + timeout;
    while (!(await predicate())) {
        if (performance.now() >= deadline) throw new Error('Expected durable transfer outcome before deadline');
        await new Promise(resolve => setTimeout(resolve, 10));
    }
}
async function original(db: Or3DB) {
    await db.file_meta.put(meta());
    await db.file_blobs.put({ hash, blob: new NodeBlob(['hello']) as unknown as Blob });
}
function job(overrides: Partial<FileTransfer> = {}): FileTransfer {
    return { id: crypto.randomUUID(), hash, workspace_id: 'ws', direction: 'upload',
        bytes_total: 0, bytes_done: 0, state: 'queued', attempts: 0, retry_at: 0,
        created_at: 1, updated_at: 1, ...overrides };
}

beforeEach(() => {
    vi.stubGlobal('Blob', NodeBlob);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('hello', { headers: { 'content-type': 'text/plain' } })));
    policy.cloud = false;
    policy.cacheBytes = DEFAULT_FILE_POLICY.maxCachedFileBytes;
});
afterEach(async () => {
    for (const executor of executors.splice(0)) executor.dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    setActiveWorkspaceDb(null);
    await Promise.all(databases.splice(0).map(db => db.delete()));
});

describe('durable storage recovery contracts', () => {
    it.each([
        { connection: '4g', configured: 1, expected: 1 },
        { connection: '4g', configured: undefined, expected: 4 },
        { connection: '3g', configured: undefined, expected: 2 },
        { connection: '2g', configured: undefined, expected: 1 },
        { connection: null, configured: undefined, expected: 2 },
    ])('bounds overlapping recovery wakeups at $expected transfers (network $connection, override $configured)', async ({ connection, configured, expected }) => {
        policy.cloud = true;
        vi.stubGlobal('navigator', connection ? { onLine: true, connection: { effectiveType: connection } } : undefined);
        const db = await database();
        const { createHash } = await import('node:crypto');
        for (let index = 0; index < expected + 2; index++) {
            const bytes = `concurrent-original-${index}`;
            const fileHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
            await db.file_meta.put({ ...meta(), hash: fileHash, size_bytes: bytes.length });
            await db.file_blobs.put({ hash: fileHash, blob: new NodeBlob([bytes]) as unknown as Blob });
        }
        const presign = deferred<PresignedUrlResult>();
        const storage = provider(); storage.getPresignedUploadUrl = vi.fn(() => presign.promise);
        const executor = queue(db, storage, { concurrency: configured });
        executor.setWorkspaceId('ws');
        try {
            await until(() => vi.mocked(storage.getPresignedUploadUrl).mock.calls.length >= expected);
            await new Promise(resolve => setTimeout(resolve, 100));
            expect(storage.getPresignedUploadUrl).toHaveBeenCalledTimes(expected);
        } finally {
            presign.resolve({ url: 'https://storage.example/upload', expiresAt: Date.now() + 60_000, storageId: 'uploaded' });
            executor.dispose();
        }
    });

    it('coalesces streamed download progress while persisting the final byte count and verified original', async () => {
        const db = await database();
        const { createHash } = await import('node:crypto');
        const content = 'a'.repeat(1_000);
        const fileHash = `sha256:${createHash('sha256').update(content).digest('hex')}`;
        await db.file_meta.put({ ...meta(), hash: fileHash, size_bytes: 1_000,
            storage_id: 'remote-original', storage_provider_id: 'recovery-provider' });
        const progress: number[] = [];
        db.file_transfers.hook('updating', function (mods, _id, previous) {
            const bytes = (mods as Partial<FileTransfer>).bytes_done;
            if (typeof bytes === 'number' && bytes > previous.bytes_done) {
                this.onsuccess = () => { progress.push(bytes); };
            }
        });
        let now = Date.now();
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        const finish = deferred<void>();
        let chunks = 0;
        const response = new Response(new ReadableStream<Uint8Array>({
            async pull(controller) {
                if (chunks === 10) {
                    await finish.promise;
                    controller.close();
                    return;
                }
                chunks += 1;
                now += 10;
                controller.enqueue(new TextEncoder().encode('a'.repeat(100)));
            },
        }), { headers: { 'content-type': 'text/plain', 'content-length': '1000' } });
        vi.stubGlobal('fetch', vi.fn(async () => response));
        const executor = queue(db); executor.setWorkspaceId('ws');
        const transfer = await executor.enqueue(fileHash, 'download');
        try {
            await until(() => chunks === 10);
            expect(progress).toHaveLength(1);
            expect(progress[0]).toBeGreaterThan(0);
            expect(progress[0]).toBeLessThan(1_000);
        } finally { finish.resolve(); }
        await until(async () => (await db.file_transfers.get(transfer!.id))?.state === 'done');
        expect(progress).toHaveLength(2);
        expect(progress[1]).toBe(1_000);
        expect(await db.file_transfers.get(transfer!.id)).toMatchObject({ bytes_done: 1_000, bytes_total: 1_000 });
        expect(await (await db.file_blobs.get(fileHash))?.blob.text()).toBe(content);
    });

    it('deduplicates concurrent enqueue from independent tabs, preferring active work over failed history', async () => {
        const db = await database();
        const otherDb = await database(db.name);
        await db.file_transfers.put(job({ id: 'old-failure', state: 'failed' }));
        const first = queue(db, provider(), { concurrency: 0 });
        const second = queue(otherDb, provider(), { concurrency: 0 });
        first.setWorkspaceId('ws'); second.setWorkspaceId('ws');
        const [a, b] = await Promise.all([first.enqueue(hash, 'upload'), second.enqueue(hash, 'upload')]);
        expect(a?.id).toBe(b?.id);
        expect((await db.file_transfers.toArray()).filter(row => row.state === 'queued')).toHaveLength(1);
        expect((await second.enqueue(hash, 'upload'))?.id).toBe(a?.id);
    });

    it('executes a retry due at exactly the current millisecond', async () => {
        const db = await database(); await original(db);
        const now = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(now);
        const transfer = job({ retry_at: now }); await db.file_transfers.put(transfer);
        const executor = queue(db); executor.setWorkspaceId('ws');
        await until(async () => (await db.file_transfers.get(transfer.id))?.state === 'done', 500);
        expect((await db.file_meta.get(hash))?.storage_id).toBe('verified-original');
    });

    it('wakes at a crashed worker lease expiry even when startup precedes expiry', async () => {
        const db = await database(); await original(db);
        const transfer = job({ state: 'running', lease_owner: 'crashed-tab', lease_expires_at: Date.now() + 120 });
        await db.file_transfers.put(transfer);
        const executor = queue(db, provider(), { leaseDurationMs: 300 }); executor.setWorkspaceId('ws');
        await until(async () => (await db.file_transfers.get(transfer.id))?.state === 'done', 700);
    });

    it('preserves retry budget offline and resumes on reconnect without a user retry', async () => {
        const db = await database(); await original(db);
        const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        const storage = provider();
        const executor = queue(db, storage, { maxAttempts: 1 }); executor.setWorkspaceId('ws');
        const transfer = await executor.enqueue(hash, 'upload');
        await new Promise(resolve => setTimeout(resolve, 80));
        expect(storage.getPresignedUploadUrl).not.toHaveBeenCalled();
        expect(await db.file_transfers.get(transfer!.id)).toMatchObject({ state: 'queued', attempts: 0 });
        online.mockReturnValue(true); window.dispatchEvent(new Event('online'));
        await until(async () => (await db.file_transfers.get(transfer!.id))?.state === 'done');
    });

    it('fences a delayed former owner before network, metadata, progress and settlement', async () => {
        const db = await database(); await original(db);
        const presign = deferred<PresignedUrlResult>();
        const storage = provider(); storage.getPresignedUploadUrl = vi.fn(() => presign.promise);
        const executor = queue(db, storage, { leaseDurationMs: 90 }); executor.setWorkspaceId('ws');
        const transfer = await executor.enqueue(hash, 'upload');
        await until(() => vi.mocked(storage.getPresignedUploadUrl).mock.calls.length === 1);
        const claimed = await db.file_transfers.get(transfer!.id);
        await db.file_transfers.put({ ...claimed!, lease_owner: 'replacement', lease_expires_at: Date.now() + 60_000,
            bytes_done: 2, bytes_total: 5, last_attempt_at: (claimed!.last_attempt_at ?? 0) + 1 });
        presign.resolve({ url: 'https://storage.example/late', expiresAt: Date.now() + 60_000, storageId: 'stale-storage' });
        await new Promise(resolve => setTimeout(resolve, 160));
        expect(fetch).not.toHaveBeenCalled();
        expect(storage.commitUpload).not.toHaveBeenCalled();
        expect((await db.file_meta.get(hash))?.storage_id).toBeUndefined();
        expect(await db.file_transfers.get(transfer!.id)).toMatchObject({ state: 'running', lease_owner: 'replacement', bytes_done: 2 });
    });

    it('does not publish metadata or completion after ownership is lost during commit', async () => {
        const db = await database(); await original(db);
        const commit = deferred<void>(); const storage = provider();
        storage.commitUpload = vi.fn(() => commit.promise);
        const executor = queue(db, storage, { leaseDurationMs: 90 }); executor.setWorkspaceId('ws');
        const transfer = await executor.enqueue(hash, 'upload');
        await until(() => vi.mocked(storage.commitUpload!).mock.calls.length === 1);
        const claimed = await db.file_transfers.get(transfer!.id);
        await db.file_transfers.put({ ...claimed!, lease_owner: 'replacement', lease_expires_at: Date.now() + 60_000,
            bytes_done: 2, last_attempt_at: (claimed!.last_attempt_at ?? 0) + 1 });
        commit.resolve();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect((await db.file_meta.get(hash))?.storage_id).toBeUndefined();
        expect(await db.file_transfers.get(transfer!.id)).toMatchObject({ state: 'running', lease_owner: 'replacement', bytes_done: 2 });
    });

    it('does not commit an upload when its local file was deleted while bytes were in flight', async () => {
        const db = setActiveWorkspaceDb(`delete-during-upload-${crypto.randomUUID()}`);
        databases.push(db); await db.open(); await original(db);
        const bytes = deferred<Response>(); vi.stubGlobal('fetch', vi.fn(() => bytes.promise));
        const storage = provider(); const executor = queue(db, storage); executor.setWorkspaceId('ws');
        const transfer = await executor.enqueue(hash, 'upload');
        await until(() => vi.mocked(fetch).mock.calls.length === 1);

        await softDeleteFile(hash);
        bytes.resolve(new Response('', { status: 200 }));
        await until(async () => ['done', 'failed'].includes((await db.file_transfers.get(transfer!.id))?.state ?? ''));

        expect(storage.commitUpload).not.toHaveBeenCalled();
        expect(await db.file_meta.get(hash)).toMatchObject({ deleted: true });
        expect((await db.file_meta.get(hash))?.storage_id).toBeUndefined();
        expect((await db.file_blobs.get(hash))?.blob.size).toBe(5);
    });

    it('aborts an outstanding request when lease renewal discovers replacement ownership', async () => {
        const db = await database(); await original(db);
        let byteSignal: AbortSignal | undefined;
        vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
            byteSignal = init.signal ?? undefined;
            return new Promise((_resolve, reject) => byteSignal?.addEventListener('abort',
                () => reject(byteSignal?.reason), { once: true }));
        }));
        const executor = queue(db, provider(), { leaseDurationMs: 90 }); executor.setWorkspaceId('ws');
        const transfer = await executor.enqueue(hash, 'upload');
        await until(() => Boolean(byteSignal));
        await db.file_transfers.update(transfer!.id, { lease_owner: 'replacement', lease_expires_at: Date.now() + 60_000 });
        await until(() => byteSignal?.aborted === true, 700);
        expect(await db.file_transfers.get(transfer!.id)).toMatchObject({ state: 'running', lease_owner: 'replacement', attempts: 0 });
    });

    it('settles a different tab waiter from persisted completion', async () => {
        const db = await database(); const otherDb = await database(db.name); await original(db);
        const owner = queue(db, provider(), { concurrency: 0 });
        const observer = queue(otherDb, provider(), { concurrency: 0 });
        owner.setWorkspaceId('ws'); observer.setWorkspaceId('ws');
        const transfer = await owner.enqueue(hash, 'upload');
        const result = observer.waitForTransfer(transfer!.id, 900, otherDb).then(() => 'done', () => 'timeout');
        await db.file_transfers.update(transfer!.id, { state: 'done' });
        expect(await result).toBe('done');
    });

    it('delivers verified bytes to the requesting tab when another tab owns an uncached download', async () => {
        policy.cloud = true; policy.cacheBytes = 0;
        const db = await database(); const otherDb = await database(db.name);
        await db.file_meta.put({ ...meta(), storage_id: 'remote-original', storage_provider_id: 'recovery-provider' });
        const body = deferred<Response>(); vi.stubGlobal('fetch', vi.fn(async () => (await body.promise).clone()));
        const owner = queue(db); const requester = queue(otherDb);
        owner.setWorkspaceId('ws'); requester.setWorkspaceId('ws');
        const transfer = await owner.enqueue(hash, 'download');
        await until(() => vi.mocked(fetch).mock.calls.length === 1);
        const received = requester.ensureDownloadedBlob(hash);
        body.resolve(new Response('hello', { headers: { 'content-type': 'text/plain' } }));
        const outcome = await Promise.race([received, new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), 1_000))]);
        expect(await outcome?.text()).toBe('hello');
        expect(await db.file_blobs.get(hash)).toBeUndefined();
        expect((await db.file_transfers.get(transfer!.id))?.state).toBe('done');
    });

    it('recovers an original with no upload intent left by a previous interrupted intake', async () => {
        policy.cloud = true;
        const db = await database(); await original(db);
        const executor = queue(db); executor.setWorkspaceId('ws');
        await until(async () => (await db.file_transfers.toArray()).some(row => row.hash === hash && row.state === 'done'), 700);
        expect((await db.file_meta.get(hash))?.storage_id).toBe('verified-original');
        expect((await db.file_transfers.toArray()).filter(row => row.hash === hash && row.state === 'done')).toHaveLength(1);
    });

    it('rolls back original intake if its durable upload intent cannot be persisted', async () => {
        policy.cloud = true;
        const db = setActiveWorkspaceDb(`atomic-intake-${crypto.randomUUID()}`); databases.push(db); await db.open();
        const executor = queue(db, provider(), { concurrency: 0 }); executor.setWorkspaceId('ws');
        vi.spyOn(queues, 'getStorageTransferQueue').mockReturnValue(executor);
        vi.spyOn(db.file_transfers, 'put').mockRejectedValue(new Error('intent disk failure'));
        await expect(createOrRefFile(new NodeBlob(['hello'], { type: 'text/plain' }) as unknown as Blob, 'hello.txt'))
            .rejects.toThrow('intent disk failure');
        expect(await db.file_meta.get(hash)).toBeUndefined();
        expect(await db.file_blobs.get(hash)).toBeUndefined();
    });
});
