import { db } from '~/db/client';
import type { Or3DB } from '~/db/client';
import { nowSec, nextClock } from '~/db/util';
import { useHooks } from '~/core/hooks/useHooks';
import type { FileMeta } from '~/db/schema';
import type {
    FileTransfer,
    FileTransferDirection,
} from '~~/shared/storage/types';
import {
    computeHashHex,
    parseHash,
} from '~/utils/hash';
import { err, reportError } from '~/utils/errors';
import { getActiveStorageProvider } from './provider-registry';
import type { ObjectStorageProvider } from './types';

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BACKOFF_BASE_MS = 1000;
const DEFAULT_BACKOFF_MAX_MS = 60000;
const DEFAULT_PRESIGN_EXPIRY_MS = 60 * 60 * 1000;

export interface FileTransferQueueConfig {
    concurrency?: number;
    maxAttempts?: number;
    backoffBaseMs?: number;
    backoffMaxMs?: number;
}

type TransferWaiter = {
    resolve: () => void;
    reject: (error: Error) => void;
};

export class FileTransferQueue {
    private concurrency: number;
    private maxAttempts: number;
    private backoffBaseMs: number;
    private backoffMaxMs: number;
    private running = new Set<string>();
    private waiters = new Map<string, TransferWaiter[]>();
    private workspaceId: string | null = null;

    constructor(
        private db: Or3DB,
        private provider: ObjectStorageProvider,
        config: FileTransferQueueConfig = {}
    ) {
        this.concurrency = config.concurrency ?? DEFAULT_CONCURRENCY;
        this.maxAttempts = config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
        this.backoffBaseMs = config.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
        this.backoffMaxMs = config.backoffMaxMs ?? DEFAULT_BACKOFF_MAX_MS;
    }

    setWorkspaceId(workspaceId: string | null) {
        this.workspaceId = workspaceId;
        if (workspaceId) {
            void this.processQueue();
        }
    }

    getWorkspaceId(): string | null {
        return this.workspaceId;
    }

    async enqueue(
        hash: string,
        direction: FileTransferDirection
    ): Promise<FileTransfer | null> {
        if (!this.workspaceId) {
            return null;
        }

        const existing = await this.findExistingTransfer(hash, direction);
        if (existing && existing.state !== 'failed') {
            void this.processQueue();
            return existing;
        }

        const now = nowSec();
        const transfer: FileTransfer = {
            id: crypto.randomUUID(),
            hash,
            workspace_id: this.workspaceId,
            direction,
            bytes_total: 0,
            bytes_done: 0,
            state: 'queued',
            attempts: 0,
            created_at: now,
            updated_at: now,
        };

        await this.db.file_transfers.put(transfer);
        void this.processQueue();
        return transfer;
    }

    async waitForTransfer(id: string): Promise<void> {
        const transfer = await this.db.file_transfers.get(id);
        if (!transfer) {
            throw new Error('Transfer not found');
        }
        if (transfer.state === 'done') return;
        if (transfer.state === 'failed') {
            throw new Error(transfer.last_error || 'Transfer failed');
        }

        await new Promise<void>((resolve, reject) => {
            const waiters = this.waiters.get(id) ?? [];
            waiters.push({ resolve, reject });
            this.waiters.set(id, waiters);
        });
    }

    async ensureDownloadedBlob(hash: string): Promise<Blob | undefined> {
        const existing = await this.db.file_blobs.get(hash);
        if (existing?.blob) return existing.blob;
        const transfer = await this.enqueue(hash, 'download');
        if (!transfer) return undefined;
        await this.waitForTransfer(transfer.id);
        const row = await this.db.file_blobs.get(hash);
        return row?.blob;
    }

    private async findExistingTransfer(
        hash: string,
        direction: FileTransferDirection
    ): Promise<FileTransfer | undefined> {
        const existing = await this.db.file_transfers
            .where('[hash+direction]')
            .equals([hash, direction])
            .toArray();
        return existing.find((transfer) => transfer.state !== 'done');
    }

    private async processQueue(): Promise<void> {
        if (!this.workspaceId) return;
        if (this.running.size >= this.concurrency) return;

        const available = this.concurrency - this.running.size;
        const pending = await this.db.file_transfers
            .where('state')
            .equals('queued')
            .toArray();

        const candidates = pending
            .filter((transfer) => transfer.workspace_id === this.workspaceId)
            .sort((a, b) => a.created_at - b.created_at)
            .slice(0, available);

        if (!candidates.length) return;

        for (const transfer of candidates) {
            this.running.add(transfer.id);
            void this.processTransfer(transfer).finally(() => {
                this.running.delete(transfer.id);
                void this.processQueue();
            });
        }
    }

    private async processTransfer(transfer: FileTransfer): Promise<void> {
        await this.updateTransfer(transfer.id, {
            state: 'running',
        });

        try {
            if (transfer.direction === 'upload') {
                await this.doUpload(transfer);
            } else {
                await this.doDownload(transfer);
            }

            const latest = await this.db.file_transfers.get(transfer.id);
            await this.updateTransfer(transfer.id, {
                state: 'done',
                bytes_done: latest?.bytes_total ?? transfer.bytes_total,
            });
            this.resolveWaiters(transfer.id);
        } catch (error) {
            const attempts = transfer.attempts + 1;
            const failed = attempts >= this.maxAttempts;
            const message = error instanceof Error ? error.message : String(error);
            await this.updateTransfer(transfer.id, {
                state: failed ? 'failed' : 'queued',
                attempts,
                last_error: message,
            });

            if (failed) {
                this.rejectWaiters(transfer.id, message);
                reportError(err('ERR_STORAGE_PROVIDER_ERROR', message), {
                    tags: { domain: 'storage', stage: transfer.direction },
                    silent: true,
                });
                return;
            }

            const delay = this.getBackoffDelay(attempts);
            setTimeout(() => void this.processQueue(), delay);
        }
    }

    private async doUpload(transfer: FileTransfer): Promise<void> {
        const meta = await this.db.file_meta.get(transfer.hash);
        const blobRow = await this.db.file_blobs.get(transfer.hash);
        if (!meta || !blobRow?.blob) {
            throw err(
                'ERR_STORAGE_FILE_NOT_FOUND',
                'File metadata or blob missing',
                { tags: { domain: 'storage', stage: 'upload' } }
            );
        }

        const hooks = useHooks();
        const policy = await hooks.applyFilters(
            'storage.files.upload:filter:policy',
            {
                hash: meta.hash,
                mime_type: meta.mime_type,
                size_bytes: meta.size_bytes,
            }
        );
        if (policy === false) {
            throw err('ERR_FILE_VALIDATION', 'Upload rejected by policy', {
                tags: { domain: 'storage', stage: 'upload' },
            });
        }

        await hooks.doAction('storage.files.upload:action:before', {
            hash: meta.hash,
            workspace_id: transfer.workspace_id,
            size_bytes: meta.size_bytes,
        });

        const urlOptions = await hooks.applyFilters(
            'storage.files.url:filter:options',
            {
                hash: meta.hash,
                expiry_ms: DEFAULT_PRESIGN_EXPIRY_MS,
            }
        );

        await this.updateTransfer(transfer.id, {
            bytes_total: meta.size_bytes,
            bytes_done: 0,
        });

        const presign = await this.provider.getPresignedUploadUrl({
            workspaceId: transfer.workspace_id,
            hash: meta.hash,
            mimeType: meta.mime_type,
            sizeBytes: meta.size_bytes,
            expiresInMs: urlOptions.expiry_ms,
            disposition: urlOptions.disposition,
        });

        const uploadResponse = await fetch(presign.url, {
            method: presign.method ?? 'POST',
            headers: presign.headers,
            body: blobRow.blob,
        });

        if (!uploadResponse.ok) {
            throw err(
                'ERR_STORAGE_UPLOAD_FAILED',
                `Upload failed (${uploadResponse.status})`,
                { tags: { domain: 'storage', stage: 'upload' } }
            );
        }

        let storageId = presign.storageId;
        if (!storageId) {
            try {
                const payload = (await uploadResponse.json()) as
                    | { storageId?: string; storage_id?: string }
                    | null;
                storageId = payload?.storageId ?? payload?.storage_id;
            } catch {
                storageId = undefined;
            }
        }

        if (!storageId) {
            throw err(
                'ERR_STORAGE_UPLOAD_FAILED',
                'Upload missing storage id',
                { tags: { domain: 'storage', stage: 'upload' } }
            );
        }

        if (this.provider.commitUpload) {
            await this.provider.commitUpload({
                workspaceId: transfer.workspace_id,
                hash: meta.hash,
                storageId,
                meta: toCommitMeta(meta),
                storageProviderId: this.provider.id,
            });
        }

        await this.persistUploadMetadata(meta, storageId);

        await hooks.doAction('storage.files.upload:action:after', {
            hash: meta.hash,
            workspace_id: transfer.workspace_id,
            storage_id: storageId,
        });
    }

    private async doDownload(transfer: FileTransfer): Promise<void> {
        const meta = await this.db.file_meta.get(transfer.hash);
        if (!meta?.storage_id) {
            throw err(
                'ERR_STORAGE_FILE_NOT_FOUND',
                'Remote file not available',
                { tags: { domain: 'storage', stage: 'download' } }
            );
        }

        const hooks = useHooks();
        await hooks.doAction('storage.files.download:action:before', {
            hash: meta.hash,
            workspace_id: transfer.workspace_id,
        });

        const urlOptions = await hooks.applyFilters(
            'storage.files.url:filter:options',
            {
                hash: meta.hash,
                expiry_ms: DEFAULT_PRESIGN_EXPIRY_MS,
            }
        );

        const presign = await this.provider.getPresignedDownloadUrl({
            workspaceId: transfer.workspace_id,
            hash: meta.hash,
            storageId: meta.storage_id,
            expiresInMs: urlOptions.expiry_ms,
            disposition: urlOptions.disposition,
        });

        const response = await fetch(presign.url, {
            method: presign.method ?? 'GET',
            headers: presign.headers,
        });

        if (!response.ok) {
            throw err(
                'ERR_STORAGE_DOWNLOAD_FAILED',
                `Download failed (${response.status})`,
                { tags: { domain: 'storage', stage: 'download' } }
            );
        }

        const { blob, bytesTotal } = await this.readBlobWithProgress(
            response,
            transfer.id
        );
        await this.updateTransfer(transfer.id, {
            bytes_total: bytesTotal,
            bytes_done: bytesTotal,
        });

        const parsed = parseHash(meta.hash);
        if (!parsed) {
            throw err(
                'ERR_STORAGE_DOWNLOAD_FAILED',
                'Invalid hash format for verification',
                { tags: { domain: 'storage', stage: 'download' } }
            );
        }

        const computedHex = await computeHashHex(blob, parsed.algorithm);
        if (computedHex !== parsed.hex) {
            throw err(
                'ERR_STORAGE_DOWNLOAD_FAILED',
                'Downloaded blob hash mismatch',
                { tags: { domain: 'storage', stage: 'download' } }
            );
        }

        await this.db.file_blobs.put({ hash: meta.hash, blob });

        await hooks.doAction('storage.files.download:action:after', {
            hash: meta.hash,
            workspace_id: transfer.workspace_id,
            size_bytes: bytesTotal,
        });
    }

    private async readBlobWithProgress(
        response: Response,
        transferId: string
    ): Promise<{ blob: Blob; bytesTotal: number }> {
        const contentLength = Number(response.headers.get('content-length') || 0);
        if (!response.body) {
            const blob = await response.blob();
            return { blob, bytesTotal: contentLength || blob.size };
        }

        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
                chunks.push(value);
                received += value.length;
                await this.updateTransfer(transferId, {
                    bytes_done: received,
                    bytes_total: contentLength || received,
                });
            }
        }

        const blob = new Blob(chunks);
        return { blob, bytesTotal: contentLength || blob.size };
    }

    private async persistUploadMetadata(
        meta: FileMeta,
        storageId: string
    ): Promise<void> {
        await this.db.transaction('rw', this.db.file_meta, async () => {
            const existing = await this.db.file_meta.get(meta.hash);
            if (!existing) return;
            await this.db.file_meta.put({
                ...existing,
                storage_id: storageId,
                storage_provider_id: this.provider.id,
                updated_at: nowSec(),
                clock: nextClock(existing.clock),
            });
        });
    }

    private async updateTransfer(
        id: string,
        patch: Partial<FileTransfer>
    ): Promise<void> {
        await this.db.file_transfers.update(id, {
            ...patch,
            updated_at: nowSec(),
        });
    }

    private getBackoffDelay(attempt: number): number {
        const delay = this.backoffBaseMs * Math.pow(2, attempt - 1);
        return Math.min(delay, this.backoffMaxMs);
    }

    private resolveWaiters(id: string) {
        const waiters = this.waiters.get(id);
        if (!waiters) return;
        waiters.forEach((waiter) => waiter.resolve());
        this.waiters.delete(id);
    }

    private rejectWaiters(id: string, message: string) {
        const waiters = this.waiters.get(id);
        if (!waiters) return;
        waiters.forEach((waiter) => waiter.reject(new Error(message)));
        this.waiters.delete(id);
    }
}

function toCommitMeta(meta: FileMeta) {
    return {
        name: meta.name,
        mimeType: meta.mime_type,
        sizeBytes: meta.size_bytes,
        kind: meta.kind,
        width: meta.width,
        height: meta.height,
        pageCount: meta.page_count,
    };
}

let queueInstance: FileTransferQueue | null = null;

export function getStorageTransferQueue(): FileTransferQueue | null {
    if (!import.meta.client) return null;
    if (queueInstance) return queueInstance;

    const provider = getActiveStorageProvider();
    if (!provider) return null;

    queueInstance = new FileTransferQueue(db, provider);
    return queueInstance;
}

export function _resetStorageTransferQueue(): void {
    queueInstance = null;
}
