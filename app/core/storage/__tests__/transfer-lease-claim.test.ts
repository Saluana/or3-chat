import { afterEach, describe, expect, it, vi } from 'vitest';
import { Or3DB } from '~/db/client';
import type { FileTransfer } from '~~/shared/storage/types';
import type { ObjectStorageProvider } from '../types';
import { FileTransferQueue } from '../transfer-queue';
import { installFaultClock, raceWorkers } from './fixtures/transfer-faults';

vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => ({
        applyFilters: async (_name: string, payload: unknown) => payload,
        doAction: async () => undefined,
    }),
}));

const policyState = vi.hoisted(() => ({ cloud: false }));
vi.mock('../file-policy', async importOriginal => ({
    ...await importOriginal<typeof import('../file-policy')>(),
    isCloudFileStorageEnabled: () => policyState.cloud,
}));
const databases: Or3DB[] = [];

afterEach(async () => {
    policyState.cloud = false;
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

// A completed download used to fetch policy once for admission and again for
// eviction. Check the real queue boundary, including a fresh next operation.
it('reads current policy once per completed Cloud download', async () => {
    policyState.cloud = true;
    const { Blob: NodeBlob } = await import('node:buffer');
    const { DEFAULT_FILE_POLICY } = await import('~~/shared/storage/file-policy');
    vi.stubGlobal('Blob', NodeBlob);
    const policyRequests = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        if (url.startsWith('/api/storage/policy')) {
            policyRequests();
            return new Response(JSON.stringify(DEFAULT_FILE_POLICY));
        }
        return new Response('original', { headers: { 'content-type': 'text/plain' } });
    }));
    const db = new Or3DB(`transfer-policy-${crypto.randomUUID()}`);
    databases.push(db);
    await db.open();
    const hash = 'sha256:0682c5f2076f099c34cfdd15a9e063849ed437a49677e6fcc5b4198c76575be5';
    await db.file_meta.put({ hash, storage_id: 'remote', mime_type: 'text/plain', kind: 'file', name: 'original.txt',
        size_bytes: 8, ref_count: 1, created_at: 1, updated_at: 1, clock: 1, deleted: false });
    const queue = new FileTransferQueue(db, provider(), { dbResolver: () => db, workspaceDbResolver: () => db });
    (queue as any).scheduleProcessQueue = vi.fn();
    queue.setWorkspaceId('ws-1');
    try {
        for (let operation = 1; operation <= 2; operation++) {
            const transfer: FileTransfer = { id: `download-${operation}`, hash, workspace_id: 'ws-1',
                direction: 'download', state: 'queued', bytes_total: 0, bytes_done: 0, attempts: 0, created_at: 1, updated_at: 1 };
            await db.file_transfers.put(transfer);
            await (queue as any).processTransfer(transfer, { workspaceId: 'ws-1', dbName: db.name, db });
            expect((await db.file_transfers.get(transfer.id))?.state).toBe('done');
            await new Promise(resolve => setTimeout(resolve, 20));
            expect(policyRequests).toHaveBeenCalledTimes(operation);
        }
    } finally { queue.dispose(); }
});
