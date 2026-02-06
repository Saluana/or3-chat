/**
 * @module app/core/storage/transfer-queue
 *
 * Purpose:
 * Local-first file transfer queue that manages uploads and downloads
 * through the active storage provider. Transfers are persisted in the
 * `file_transfers` Dexie table so they survive page reloads.
 *
 * Responsibilities:
 * - Enqueue upload and download transfers
 * - Process transfers with configurable concurrency (adaptive to network type)
 * - Retry failed transfers with exponential backoff
 * - Verify download integrity via hash comparison
 * - Emit storage hooks before/after upload and download operations
 * - Apply upload policy filters via `storage.files.upload:filter:policy`
 * - Clean up completed/failed transfers after a retention window (7 days)
 *
 * Constraints:
 * - Client-only (accesses IndexedDB, navigator.connection)
 * - Workspace-scoped: switching workspaces cancels in-flight transfers
 * - Presigned URLs are short-lived (default 1 hour expiry)
 * - Maximum 5 retry attempts per transfer by default
 * - Non-retryable errors (413, validation) are marked as permanent failures
 *
 * Non-goals:
 * - Does not manage file metadata (see db/files)
 * - Does not handle multipart uploads
 * - Does not provide streaming progress to UI (transfers are observable via Dexie liveQuery)
 *
 * @see core/storage/types for ObjectStorageProvider interface
 * @see core/storage/provider-registry for provider resolution
 * @see shared/storage/types for FileTransfer schema
 */
import Dexie from 'dexie';
import { getDb } from '~/db/client';
import type { Or3DB } from '~/db/client';
import { nowSec, nextClock, getWriteTxTableNames } from '~/db/util';
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

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BACKOFF_BASE_MS = 1000;
const DEFAULT_BACKOFF_MAX_MS = 60000;
const DEFAULT_PRESIGN_EXPIRY_MS = 60 * 60 * 1000;
const TRANSFER_RETENTION_SEC = 7 * 24 * 60 * 60;
const TRANSFER_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

function getDefaultConcurrency(): number {
    if (typeof navigator === 'undefined' || !('connection' in navigator)) {
        return 2; // Default fallback
    }

    const connection = navigator.connection as { effectiveType?: string } | undefined;
    const effectiveType = connection?.effectiveType;

    if (effectiveType === '4g') {
        return 4;
    } else if (effectiveType === '3g') {
        return 2;
    } else {
        return 1; // 2g or slow-2g
    }
}

/**
 * Purpose:
 * Configuration for the file transfer queue.
 *
 * Constraints:
 * - Concurrency defaults are adaptive; override only for testing or tuning
 */
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

/**
 * Purpose:
 * Workspace-scoped queue for upload and download transfers.
 *
 * Behavior:
 * - Persists transfers in Dexie (`file_transfers`) so they survive reload
 * - Processes work with limited concurrency and retries with backoff
 * - Provides `waitForTransfer()` to await completion for UX flows
 *
 * Constraints:
 * - `setWorkspaceId()` must be called to enable processing
 * - Switching workspaces cancels in-flight transfers
 */
export class FileTransferQueue {
    private concurrency: number;
    private maxAttempts: number;
    private backoffBaseMs: number;
    private backoffMaxMs: number;
    private running = new Set<string>();
    private waiters = new Map<string, TransferWaiter[]>();
    private abortControllers = new Map<string, AbortController>();
    private workspaceId: string | null = null;
    private processQueueTimeout: ReturnType<typeof setTimeout> | null = null;
    private processQueueAt: number | null = null;
    private lastCleanupAt = 0;

    constructor(
        private db: Or3DB,
        private provider: ObjectStorageProvider,
        config: FileTransferQueueConfig = {}
    ) {
        this.concurrency = config.concurrency ?? getDefaultConcurrency();
        this.maxAttempts = config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
        this.backoffBaseMs = config.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
        this.backoffMaxMs = config.backoffMaxMs ?? DEFAULT_BACKOFF_MAX_MS;
    }

    setWorkspaceId(workspaceId: string | null) {
        const previousWorkspaceId = this.workspaceId;
        this.workspaceId = workspaceId;

        // Cancel in-flight transfers for the old workspace when switching
        if (previousWorkspaceId && workspaceId !== previousWorkspaceId) {
            this.cancelAllRunning();
        }

        if (workspaceId) {
            this.scheduleProcessQueue(0);
        }
    }

    getWorkspaceId(): string | null {
        return this.workspaceId;
    }

    /** Cancel a specific transfer by ID */
    cancelTransfer(id: string): void {
        const controller = this.abortControllers.get(id);
        if (controller) {
            controller.abort();
        }
    }

    /** Cancel all currently running transfers */
    cancelAllRunning(): void {
        for (const id of this.running) {
            this.cancelTransfer(id);
        }
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
            this.scheduleProcessQueue(0);
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
        this.scheduleProcessQueue(0);
        return transfer;
    }

    async waitForTransfer(id: string, timeoutMs = 60_000): Promise<void> {
        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Transfer timeout')), timeoutMs);
        });

        // Register waiter first to avoid race condition where transfer
        // completes between state check and Promise creation
        const waiterPromise = new Promise<void>((resolve, reject) => {
            const waiters = this.waiters.get(id) ?? [];
            waiters.push({ resolve, reject });
            this.waiters.set(id, waiters);
        });

        // Suppress unhandled rejection if the race is lost or we throw early
        waiterPromise.catch(() => {});

        // Check current state - if already done/failed, resolve immediately
        const transfer = await this.db.file_transfers.get(id);
        if (!transfer) {
            this.resolveWaiters(id); // Clean up the just-added waiter
            throw new Error('Transfer not found');
        }
        if (transfer.state === 'done') {
            this.resolveWaiters(id);
            return;
        }
        if (transfer.state === 'failed') {
            const errorMsg = transfer.last_error || 'Transfer failed';
            this.rejectWaiters(id, errorMsg);
            throw new Error(errorMsg);
        }

        return Promise.race([waiterPromise, timeoutPromise]);
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

        await this.cleanupOldTransfers();

        const available = this.concurrency - this.running.size;
        // Use compound index for efficient workspace-scoped queries
        const candidates = await this.db.file_transfers
            .where('[state+workspace_id+created_at]')
            .between(
                ['queued', this.workspaceId, Dexie.minKey],
                ['queued', this.workspaceId, Dexie.maxKey]
            )
            .limit(available)
            .toArray();

        if (!candidates.length) return;

        for (const transfer of candidates) {
            this.running.add(transfer.id);
            void this.processTransfer(transfer).finally(() => {
                this.running.delete(transfer.id);
                this.scheduleProcessQueue(0);
            });
        }
    }

    private async processTransfer(transfer: FileTransfer): Promise<void> {
        const controller = new AbortController();
        this.abortControllers.set(transfer.id, controller);

        await this.updateTransfer(transfer.id, {
            state: 'running',
        });

        try {
            if (transfer.direction === 'upload') {
                await this.doUpload(transfer, controller.signal);
            } else {
                await this.doDownload(transfer, controller.signal);
            }

            const latest = await this.db.file_transfers.get(transfer.id);
            await this.updateTransfer(transfer.id, {
                state: 'done',
                bytes_done: latest?.bytes_total ?? transfer.bytes_total,
            });
            this.resolveWaiters(transfer.id);
        } catch (error) {
            // Handle abort specially - don't retry aborted transfers
            if (error instanceof Error && error.name === 'AbortError') {
                await this.updateTransfer(transfer.id, {
                    state: 'failed',
                    last_error: 'Transfer cancelled',
                });
                this.rejectWaiters(transfer.id, 'Transfer cancelled');
                return;
            }

            const attempts = transfer.attempts + 1;
            const message = error instanceof Error 
                ? error.message 
                : typeof error === 'object' && error !== null && 'message' in error
                    ? String((error as { message: unknown }).message)
                    : String(error);

            // Check if error is marked as non-retryable (e.g., file too large)
            const isNonRetryable = typeof error === 'object' && 
                error !== null && 
                'retryable' in error && 
                (error as { retryable?: boolean }).retryable === false;

            const failed = isNonRetryable || attempts >= this.maxAttempts;
            
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
            this.scheduleProcessQueue(delay);
        } finally {
            this.abortControllers.delete(transfer.id);
        }
    }

    private scheduleProcessQueue(delayMs: number): void {
        const targetAt = Date.now() + delayMs;
        if (this.processQueueTimeout) {
            if (this.processQueueAt !== null && this.processQueueAt <= targetAt) {
                return;
            }
            clearTimeout(this.processQueueTimeout);
        }
        this.processQueueAt = targetAt;
        this.processQueueTimeout = setTimeout(() => {
            this.processQueueTimeout = null;
            this.processQueueAt = null;
            void this.processQueue();
        }, delayMs);
    }

    private async doUpload(transfer: FileTransfer, signal: AbortSignal): Promise<void> {
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

        // Convex storage requires Content-Type header set to the file's MIME type
        // See: https://docs.convex.dev/file-storage/upload-files#calling-the-upload-apis-from-a-web-page
        const uploadHeaders: Record<string, string> = {
            'Content-Type': meta.mime_type,
            ...(presign.headers ?? {}),
        };

        const uploadResponse = await fetch(presign.url, {
            method: presign.method ?? 'POST',
            headers: uploadHeaders,
            body: blobRow.blob,
            signal,
        });

        if (!uploadResponse.ok) {
            // 413 Content Too Large - file exceeds storage provider's size limit
            if (uploadResponse.status === 413) {
                const sizeMB = (meta.size_bytes / (1024 * 1024)).toFixed(2);
                throw err(
                    'ERR_FILE_TOO_LARGE',
                    `File too large for storage provider (${sizeMB} MB). ` +
                    `Try compressing the image or using a smaller file.`,
                    { 
                        tags: { domain: 'storage', stage: 'upload' },
                        retryable: false, // Don't retry - permanent failure
                    }
                );
            }
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

    private async doDownload(transfer: FileTransfer, signal: AbortSignal): Promise<void> {
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
            signal,
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
        let received = 0;
        let lastUpdate = 0;
        const UPDATE_INTERVAL_MS = 200; // Update every 200ms max

        // Use a TransformStream approach to avoid double buffering
        // Stream chunks directly into a new Response for blob conversion
        const stream = new ReadableStream<Uint8Array>({
            pull: async (controller) => {
                const { done, value } = await reader.read();
                if (done) {
                    // Final update on completion
                    await this.updateTransfer(transferId, {
                        bytes_done: received,
                        bytes_total: contentLength || received,
                    });
                    controller.close();
                    return;
                }

                received += value.byteLength;

                const now = Date.now();
                if (now - lastUpdate > UPDATE_INTERVAL_MS) {
                    await this.updateTransfer(transferId, {
                        bytes_done: received,
                        bytes_total: contentLength || received,
                    });
                    lastUpdate = now;
                }

                controller.enqueue(value);
            },
        });

        const blob = await new Response(stream).blob();
        return { blob, bytesTotal: contentLength || blob.size };
    }

    private async persistUploadMetadata(
        meta: FileMeta,
        storageId: string
    ): Promise<void> {
        await this.db.transaction(
            'rw',
            getWriteTxTableNames(this.db, 'file_meta'),
            async () => {
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

    private async cleanupOldTransfers(): Promise<void> {
        const now = Date.now();
        if (now - this.lastCleanupAt < TRANSFER_CLEANUP_INTERVAL_MS) {
            return;
        }
        this.lastCleanupAt = now;

        const cutoff = nowSec() - TRANSFER_RETENTION_SEC;
        await this.db.file_transfers
            .where('[state+created_at]')
            .between(['done', 0], ['done', cutoff])
            .delete();
        await this.db.file_transfers
            .where('[state+created_at]')
            .between(['failed', 0], ['failed', cutoff])
            .delete();
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

/**
 * Purpose:
 * Return the singleton FileTransferQueue instance for the current client session.
 *
 * Constraints:
 * - Client-only; returns null in SSR
 */
export function getStorageTransferQueue(): FileTransferQueue | null {
    if (!import.meta.client) return null;
    if (queueInstance) return queueInstance;

    const provider = getActiveStorageProvider();
    if (!provider) return null;

    queueInstance = new FileTransferQueue(getDb(), provider);
    return queueInstance;
}

/**
 * Internal API.
 *
 * Purpose:
 * Dispose and reset the singleton transfer queue. Intended for tests and HMR.
 */
export function _resetStorageTransferQueue(): void {
    if (queueInstance) {
        queueInstance.cancelAllRunning();
    }
    queueInstance = null;
}
