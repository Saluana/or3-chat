import { afterEach, describe, expect, it, vi } from 'vitest';
import { Or3DB } from '~/db/client';
import type { FileTransfer } from '~~/shared/storage/types';
import type { ObjectStorageProvider } from '../types';
import { FileTransferQueue } from '../transfer-queue';
import { installFaultClock, raceWorkers } from './fixtures/transfer-faults';
import { verifyTransferLeaseContract } from '~~/shared/testing/contracts/storage';

vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => ({
        applyFilters: async (_name: string, payload: unknown) => payload,
        doAction: async () => undefined,
    }),
}));

const databases: Or3DB[] = [];

afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await Promise.all(databases.splice(0).map((db) => db.delete()));
});

function provider(): ObjectStorageProvider {
    return {
        id: 'lease-test',
        displayName: 'Lease test',
        supports: { presignedUpload: true, presignedDownload: true },
        getPresignedUploadUrl: async () => ({ url: 'upload', expiresAt: 1 }),
        getPresignedDownloadUrl: async () => ({ url: 'download', expiresAt: 1 }),
    };
}

describe('transfer lease claims', () => {
    it('executes the shared lease race and expired-owner recovery contract', async () => {
        const clock = installFaultClock(100);
        const db = new Or3DB(`transfer-contract-${crypto.randomUUID()}`);
        databases.push(db);
        await db.open();
        const workers = new Map([
            ['worker-a', new FileTransferQueue(db, provider(), { leaseDurationMs: 50 })],
            ['worker-b', new FileTransferQueue(db, provider(), { leaseDurationMs: 50 })],
            ['worker-c', new FileTransferQueue(db, provider(), { leaseDurationMs: 50 })],
        ]);
        for (const [workerId, queue] of workers) (queue as any).workerId = workerId;
        const context = { workspaceId: 'ws-1', dbName: db.name, db };

        await verifyTransferLeaseContract({
            name: 'dexie-transfer-queue',
            async enqueue(id) {
                await db.file_transfers.put({
                    id, hash: 'hash', workspace_id: 'ws-1', direction: 'download',
                    bytes_total: 0, bytes_done: 0, state: 'queued', attempts: 0,
                    retry_at: 0, created_at: 1, updated_at: 1,
                });
            },
            async claim(workerId, now) {
                clock.set(now);
                const claimed = await (workers.get(workerId) as any)
                    .claimQueuedTransfers(context, 1) as FileTransfer[];
                return claimed[0]?.id ?? null;
            },
            async expire(id, now) {
                clock.set(now);
                await db.file_transfers.update(id, { lease_expires_at: now });
            },
        });
    });

    it('allows only one worker to claim a queued transfer and renews only for its owner', async () => {
        const clock = installFaultClock(10_000);
        const db = new Or3DB(`transfer-claim-${crypto.randomUUID()}`);
        databases.push(db);
        await db.open();
        const transfer: FileTransfer = {
            id: 'claim-me',
            hash: 'hash',
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
        const first = new FileTransferQueue(db, provider(), { leaseDurationMs: 3_000 });
        const second = new FileTransferQueue(db, provider(), { leaseDurationMs: 3_000 });
        const context = { workspaceId: 'ws-1', dbName: db.name, db };

        const [firstClaims, secondClaims] = await raceWorkers(
            () => (first as any).claimQueuedTransfers(context, 1) as Promise<FileTransfer[]>,
            () => (second as any).claimQueuedTransfers(context, 1) as Promise<FileTransfer[]>,
        );

        expect(firstClaims.length + secondClaims.length).toBe(1);
        const owner = firstClaims.length ? first : second;
        const nonOwner = firstClaims.length ? second : first;
        const claimed = await db.file_transfers.get(transfer.id);
        expect(claimed).toMatchObject({
            state: 'running',
            lease_expires_at: 13_000,
            last_attempt_at: 10_000,
        });
        expect(claimed?.lease_owner).toBe((owner as any).workerId);

        clock.set(11_000);
        await expect((nonOwner as any).renewLease(transfer.id, db)).resolves.toBe(false);
        await expect((owner as any).renewLease(transfer.id, db)).resolves.toBe(true);
        expect((await db.file_transfers.get(transfer.id))?.lease_expires_at).toBe(14_000);
    });

    it('reclaims an expired running upload after a crash and completes it once', async () => {
        installFaultClock(20_000);
        const db = new Or3DB(`transfer-reclaim-${crypto.randomUUID()}`);
        databases.push(db);
        await db.open();
        const hash = `sha256:${'a'.repeat(64)}`;
        await db.file_meta.put({
            hash,
            name: 'recover.bin',
            mime_type: 'application/octet-stream',
            kind: 'pdf',
            size_bytes: 3,
            ref_count: 1,
            created_at: 1,
            updated_at: 1,
            deleted: false,
            clock: 0,
        });
        await db.file_blobs.put({ hash, blob: new Blob(['abc']) });
        await db.file_transfers.put({
            id: 'crashed-upload',
            hash,
            workspace_id: 'ws-1',
            direction: 'upload',
            bytes_total: 0,
            bytes_done: 0,
            state: 'running',
            attempts: 1,
            lease_owner: 'dead-worker',
            lease_expires_at: 19_000,
            retry_at: 0,
            created_at: 1,
            updated_at: 1,
        });
        vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
        const uploadProvider = provider();
        uploadProvider.getPresignedUploadUrl = vi.fn(async () => ({
            url: 'https://upload.example',
            expiresAt: 30_000,
            storageId: 'recovered-storage',
        }));
        const first = new FileTransferQueue(db, uploadProvider, { leaseDurationMs: 3_000 });
        const second = new FileTransferQueue(db, uploadProvider, { leaseDurationMs: 3_000 });
        const context = { workspaceId: 'ws-1', dbName: db.name, db };

        const [a, b] = await raceWorkers(
            () => (first as any).claimQueuedTransfers(context, 1) as Promise<FileTransfer[]>,
            () => (second as any).claimQueuedTransfers(context, 1) as Promise<FileTransfer[]>,
        );
        expect(a.length + b.length).toBe(1);
        const owner = a.length ? first : second;
        const claimed = (a[0] ?? b[0])!;
        await (owner as any).processTransfer(claimed, context);

        expect(uploadProvider.getPresignedUploadUrl).toHaveBeenCalledTimes(1);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(await db.file_transfers.get(claimed.id)).toMatchObject({ state: 'done' });
        expect((await db.file_meta.get(hash))?.storage_id).toBe('recovered-storage');
    });
});
