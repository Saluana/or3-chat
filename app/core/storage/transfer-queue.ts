/** Persistent, workspace-scoped upload and download execution queue. */
import Dexie from 'dexie';
import { getDb, getWorkspaceDb } from '~/db/client';
import type { Or3DB } from '~/db/client';
import { nowSec, nextClock, getWriteTxTableNames } from '~/db/util';
import { useHooks } from '~/core/hooks/useHooks';
import type { FileMeta } from '~/db/schema';
import type {
    FileTransfer,
    FileTransferDirection,
    RecoverableFileTransferState,
} from '~~/shared/storage/types';
import { createRuntimeUuid } from '~~/shared/runtime-id';
import {
    computeHashHex,
    parseHash,
} from '~/utils/hash';
import { err, reportError } from '~/utils/errors';
import { getActiveStorageProvider } from './provider-registry';
import type { ObjectStorageProvider } from './types';
import {
    DEFAULT_BACKOFF_BASE_MS,
    DEFAULT_BACKOFF_MAX_MS,
    DEFAULT_LEASE_DURATION_MS,
    DEFAULT_MAX_ATTEMPTS,
    DEFAULT_MAX_DOWNLOAD_BYTES,
    DEFAULT_PRESIGN_EXPIRY_MS,
    TRANSFER_CLEANUP_INTERVAL_MS,
    TRANSFER_RETENTION_SEC,
    getDefaultConcurrency,
    normalizeTransferMime,
    isRecoverableTransferError,
    recoverableTransferError,
    resolveUploadMethod,
    toCommitMeta,
    type FileTransferQueueConfig,
    type TransferExecutionContext,
    type TransferWaiter,
} from './transfer-queue-support';

export type { FileTransferQueueConfig } from './transfer-queue-support';

function isAbortError(error: unknown): boolean {
    return typeof error === 'object'
        && error !== null
        && 'name' in error
        && (error as { name?: unknown }).name === 'AbortError';
}

function createAbortError(): Error {
    const error = new Error('Transfer cancelled');
    error.name = 'AbortError';
    return error;
}

/** Persistent transfer executor. Call `setWorkspaceId` before processing. */
export class FileTransferQueue {
    private concurrency: number;
    private maxAttempts: number;
    private backoffBaseMs: number;
    private backoffMaxMs: number;
    private running = new Set<string>();
    private waiters = new Map<string, TransferWaiter[]>();
    private abortControllers = new Map<string, AbortController>();
    private requeueOnAbort = new Set<string>();
    private workspaceId: string | null = null;
    private processQueueTimeout: ReturnType<typeof setTimeout> | null = null;
    private processQueueAt: number | null = null;
    private lastCleanupAt = 0;
    private dbResolver?: () => Or3DB;
    private workspaceDbResolver: (workspaceId: string) => Or3DB;
    private leaseDurationMs: number;
    private maxDownloadBytes: number;
    private readonly workerId = createRuntimeUuid();
    private leaseRenewals = new Map<string, ReturnType<typeof setInterval>>();

    constructor(
        private db: Or3DB,
        private provider: ObjectStorageProvider,
        config: FileTransferQueueConfig = {}
    ) {
        this.concurrency = config.concurrency ?? getDefaultConcurrency();
        this.maxAttempts = config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
        this.backoffBaseMs = config.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
        this.backoffMaxMs = config.backoffMaxMs ?? DEFAULT_BACKOFF_MAX_MS;
        this.leaseDurationMs = config.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
        this.maxDownloadBytes = config.maxDownloadBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES;
        this.dbResolver = config.dbResolver;
        this.workspaceDbResolver = config.workspaceDbResolver ?? getWorkspaceDb;
    }

    setWorkspaceId(workspaceId: string | null) {
        const previousWorkspaceId = this.workspaceId;
        this.workspaceId = workspaceId;

        // Cancel in-flight transfers for the old workspace when switching
        if (previousWorkspaceId && workspaceId !== previousWorkspaceId) {
            this.cancelRunningForWorkspaceSwitch();
            if (this.processQueueTimeout) {
                clearTimeout(this.processQueueTimeout);
                this.processQueueTimeout = null;
                this.processQueueAt = null;
            }
        }

        if (workspaceId) {
            this.rebindDb();
            this.scheduleProcessQueue(0);
        }
    }

    getWorkspaceId(): string | null {
        return this.workspaceId;
    }

    /** Cancel a specific transfer by ID */
    cancelTransfer(id: string): void {
        this.requeueOnAbort.delete(id);
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

    private cancelRunningForWorkspaceSwitch(): void {
        for (const id of this.running) {
            const controller = this.abortControllers.get(id);
            if (!controller || controller.signal.aborted) continue;
            this.requeueOnAbort.add(id);
            controller.abort();
        }
    }

    /** Idempotently release every resource owned by this queue instance. */
    dispose(): void {
        this.workspaceId = null;
        this.cancelAllRunning();
        if (this.processQueueTimeout) clearTimeout(this.processQueueTimeout);
        this.processQueueTimeout = null;
        this.processQueueAt = null;
        for (const timer of this.leaseRenewals.values()) clearInterval(timer);
        this.leaseRenewals.clear();
        for (const [id] of this.waiters) {
            this.rejectWaiters(id, 'Transfer queue disposed');
        }
    }

    async enqueue(
        hash: string,
        direction: FileTransferDirection
    ): Promise<FileTransfer | null> {
        if (!this.workspaceId) {
            return null;
        }

        this.rebindDb();

        const existing = await this.findExistingTransfer(hash, direction);
        if (existing) {
            // Prior 404 / pre-commit races park here; re-queue so later success can proceed.
            if (
                existing.state === 'remote_missing' ||
                existing.state === 'pending_upload'
            ) {
                await this.retryRecoverable(existing.id);
                const retried = await this.db.file_transfers.get(existing.id);
                return retried ?? existing;
            }
            if (existing.state !== 'failed') {
                this.scheduleProcessQueue(0);
                return existing;
            }
        }

        const now = nowSec();
        const transfer: FileTransfer = {
            id: createRuntimeUuid(),
            hash,
            workspace_id: this.workspaceId,
            direction,
            bytes_total: 0,
            bytes_done: 0,
            state: 'queued',
            attempts: 0,
            retry_at: 0,
            created_at: now,
            updated_at: now,
        };

        await this.db.file_transfers.put(transfer);
        this.scheduleProcessQueue(0);
        return transfer;
    }

    async waitForTransfer(id: string, timeoutMs = 60_000): Promise<void> {
        // Register waiter first to avoid race condition where transfer
        // completes between state check and Promise creation
        const waiterPromise = new Promise<void>((resolve, reject) => {
            const waiters = this.waiters.get(id) ?? [];
            const waiter = {} as TransferWaiter;
            waiter.resolve = resolve;
            waiter.reject = reject;
            waiter.timeout = setTimeout(() => {
                this.removeWaiter(id, waiter);
                reject(new Error('Transfer timeout'));
            }, timeoutMs);
            waiters.push(waiter);
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
        if (
            transfer.state === 'failed' ||
            transfer.state === 'pending_upload' ||
            transfer.state === 'remote_missing'
        ) {
            const errorMsg = transfer.last_error || 'Transfer failed';
            const parkedError =
                transfer.state === 'pending_upload' ||
                transfer.state === 'remote_missing'
                    ? recoverableTransferError(transfer.state, errorMsg)
                    : new Error(errorMsg);
            this.rejectWaiters(id, parkedError);
            throw parkedError;
        }

        return waiterPromise;
    }

    /** Explicitly retry a transfer after upload/reconciliation state changes. */
    async retryRecoverable(id: string): Promise<boolean> {
        const transfer = await this.db.file_transfers.get(id);
        if (
            !transfer ||
            (transfer.state !== 'pending_upload' && transfer.state !== 'remote_missing')
        ) {
            return false;
        }
        await this.updateTransfer(id, {
            state: 'queued',
            retry_at: 0,
            last_error: undefined,
        });
        this.scheduleProcessQueue(0);
        return true;
    }

    async ensureDownloadedBlob(hash: string): Promise<Blob | undefined> {
        const existing = await this.db.file_blobs.get(hash);
        if (existing?.blob) return existing.blob;
        const transfer = await this.enqueue(hash, 'download');
        if (!transfer) return undefined;
        try {
            await this.waitForTransfer(transfer.id);
        } catch (error) {
            // Pre-commit / temporary remote gaps are expected; caller retries later.
            if (isRecoverableTransferError(error)) return undefined;
            const parked = await this.db.file_transfers.get(transfer.id);
            if (
                parked?.state === 'pending_upload' ||
                parked?.state === 'remote_missing'
            ) {
                return undefined;
            }
            throw error;
        }
        const row = await this.db.file_blobs.get(hash);
        return row?.blob;
    }

    private async findExistingTransfer(
        hash: string,
        direction: FileTransferDirection
    ): Promise<FileTransfer | undefined> {
        try {
            const existing = await this.db.file_transfers
                .where('[hash+direction]')
                .equals([hash, direction])
                .toArray();
            return existing.find((transfer) => transfer.state !== 'done');
        } catch (error) {
            if (!this.isDatabaseClosedError(error)) {
                throw error;
            }
            this.rebindDb();
            return undefined;
        }
    }

    private async processQueue(): Promise<void> {
        if (!this.workspaceId) return;
        if (this.running.size >= this.concurrency) return;

        try {
            await this.cleanupOldTransfers();
            const context: TransferExecutionContext = {
                workspaceId: this.workspaceId,
                dbName: this.db.name,
                db: this.db,
            };

            const available = this.concurrency - this.running.size;
            const candidates = await this.claimQueuedTransfers(context, available);

            if (!candidates.length) {
                await this.scheduleNextPersistedRetry(context);
                return;
            }

            for (const transfer of candidates) {
                this.running.add(transfer.id);
                void this.processTransfer(transfer, context).finally(() => {
                    this.running.delete(transfer.id);
                    this.scheduleProcessQueue(0);
                });
            }
        } catch (error) {
            if (!this.isDatabaseClosedError(error)) {
                throw error;
            }
            this.rebindDb();
            this.scheduleProcessQueue(50);
        }
    }

    private async processTransfer(
        transfer: FileTransfer,
        context: TransferExecutionContext = {
            workspaceId: transfer.workspace_id,
            dbName: this.db.name,
            db: this.db,
        }
    ): Promise<void> {
        const controller = new AbortController();
        this.abortControllers.set(transfer.id, controller);

        const markedRunning = await this.safeUpdateTransfer(transfer.id, {
            state: 'running',
            lease_owner: this.workerId,
            lease_expires_at: Date.now() + this.leaseDurationMs,
            last_attempt_at: Date.now(),
        }, context.db);
        if (!markedRunning) {
            return;
        }
        this.startLeaseRenewal(transfer.id, context.db);

        try {
            if (transfer.direction === 'upload') {
                await this.doUpload(transfer, controller.signal, context);
            } else {
                await this.doDownload(transfer, controller.signal, context);
            }

            const latest = await context.db.file_transfers.get(transfer.id);
            const markedDone = await this.safeUpdateTransfer(transfer.id, {
                state: 'done',
                bytes_done: latest?.bytes_total ?? transfer.bytes_total,
                retry_at: 0,
                lease_owner: undefined,
                lease_expires_at: undefined,
            }, context.db);
            if (!markedDone) {
                return;
            }
            this.resolveWaiters(transfer.id);
        } catch (error) {
            if (this.isDatabaseClosedError(error)) {
                await this.requeueTransferAfterDatabaseClose(transfer, context);
                return;
            }

            // Handle abort specially - don't retry aborted transfers
            if (isAbortError(error)) {
                if (this.requeueOnAbort.delete(transfer.id)) {
                    await this.safeUpdateTransfer(transfer.id, {
                        state: 'queued',
                        retry_at: 0,
                        last_error: undefined,
                        lease_owner: undefined,
                        lease_expires_at: undefined,
                    }, context.db);
                    return;
                }
                await this.safeUpdateTransfer(transfer.id, {
                    state: 'failed',
                    last_error: 'Transfer cancelled',
                }, context.db);
                this.rejectWaiters(transfer.id, 'Transfer cancelled');
                return;
            }

            const recoverableState =
                error && typeof error === 'object' && 'transferState' in error
                    ? (error as { transferState?: RecoverableFileTransferState }).transferState
                    : undefined;
            if (recoverableState === 'pending_upload' || recoverableState === 'remote_missing') {
                const message = error instanceof Error ? error.message : 'Transfer requires reconciliation';
                const parkedError = isRecoverableTransferError(error)
                    ? error
                    : recoverableTransferError(recoverableState, message);
                await this.safeUpdateTransfer(transfer.id, {
                    state: recoverableState,
                    last_error: message,
                }, context.db);
                this.rejectWaiters(transfer.id, parkedError);
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
            const delay = failed ? 0 : this.getBackoffDelay(attempts);
            const updated = await this.safeUpdateTransfer(transfer.id, {
                state: failed ? 'failed' : 'queued',
                attempts,
                last_error: message,
                retry_at: failed ? 0 : Date.now() + delay,
                lease_owner: undefined,
                lease_expires_at: undefined,
            }, context.db);
            if (!updated) {
                return;
            }

            if (failed) {
                this.rejectWaiters(transfer.id, message);
                reportError(err('ERR_STORAGE_PROVIDER_ERROR', message), {
                    tags: { domain: 'storage', stage: transfer.direction },
                    silent: true,
                });
                return;
            }

            this.scheduleProcessQueue(delay);
        } finally {
            this.requeueOnAbort.delete(transfer.id);
            this.stopLeaseRenewal(transfer.id);
            this.abortControllers.delete(transfer.id);
        }
    }

    private async claimQueuedTransfers(
        context: TransferExecutionContext,
        limit: number
    ): Promise<FileTransfer[]> {
        if (limit <= 0) return [];
        const now = Date.now();
        return context.db.transaction('rw', context.db.file_transfers, async () => {
            const expired = await context.db.file_transfers
                .where('[state+workspace_id+lease_expires_at]')
                .between(
                    ['running', context.workspaceId, Dexie.minKey],
                    ['running', context.workspaceId, now]
                )
                .limit(limit)
                .toArray();
            const queued = await context.db.file_transfers
                .where('[state+workspace_id+retry_at]')
                .between(
                    ['queued', context.workspaceId, Dexie.minKey],
                    ['queued', context.workspaceId, now]
                )
                .limit(limit)
                .toArray();
            const candidates = [...expired, ...queued].slice(0, limit);
            const claimed: FileTransfer[] = [];
            for (const candidate of candidates) {
                const current = await context.db.file_transfers.get(candidate.id);
                if (!current) continue;
                const queuedAndDue =
                    current.state === 'queued' && (current.retry_at ?? 0) <= now;
                const abandoned =
                    current.state === 'running' && (current.lease_expires_at ?? 0) <= now;
                if (!queuedAndDue && !abandoned) continue;
                const next: FileTransfer = {
                    ...current,
                    state: 'running',
                    lease_owner: this.workerId,
                    lease_expires_at: now + this.leaseDurationMs,
                    last_attempt_at: now,
                    retry_at: 0,
                    updated_at: nowSec(),
                };
                await context.db.file_transfers.put(next);
                claimed.push(next);
            }
            return claimed;
        });
    }

    private async scheduleNextPersistedRetry(context: TransferExecutionContext): Promise<void> {
        const now = Date.now();
        const future = await context.db.file_transfers
            .where('[state+workspace_id+retry_at]')
            .between(
                ['queued', context.workspaceId, now + 1],
                ['queued', context.workspaceId, Dexie.maxKey]
            )
            .limit(1)
            .toArray();
        const retryAt = future[0]?.retry_at;
        if (typeof retryAt === 'number') {
            this.scheduleProcessQueue(Math.max(0, retryAt - now));
        }
    }

    private startLeaseRenewal(id: string, db: Or3DB): void {
        this.stopLeaseRenewal(id);
        const intervalMs = Math.max(250, Math.floor(this.leaseDurationMs / 3));
        const timer = setInterval(() => {
            void this.renewLease(id, db);
        }, intervalMs);
        this.leaseRenewals.set(id, timer);
    }

    private stopLeaseRenewal(id: string): void {
        const timer = this.leaseRenewals.get(id);
        if (timer) clearInterval(timer);
        this.leaseRenewals.delete(id);
    }

    private async renewLease(id: string, db: Or3DB): Promise<boolean> {
        return db.transaction('rw', db.file_transfers, async () => {
            const current = await db.file_transfers.get(id);
            if (
                !current ||
                current.state !== 'running' ||
                current.lease_owner !== this.workerId
            ) {
                this.stopLeaseRenewal(id);
                return false;
            }
            await db.file_transfers.update(id, {
                lease_expires_at: Date.now() + this.leaseDurationMs,
                updated_at: nowSec(),
            });
            return true;
        });
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
            void this.processQueue().catch((error) => {
                if (this.isDatabaseClosedError(error)) {
                    this.rebindDb();
                    if (this.workspaceId) {
                        this.scheduleProcessQueue(50);
                    }
                    return;
                }
                console.error('[storage-transfer-queue] processQueue failed', error);
            });
        }, delayMs);
    }

    private async doUpload(
        transfer: FileTransfer,
        signal: AbortSignal,
        context: TransferExecutionContext = {
            workspaceId: transfer.workspace_id,
            dbName: this.db.name,
            db: this.db,
        }
    ): Promise<void> {
        const meta = await context.db.file_meta.get(transfer.hash);
        const blobRow = await context.db.file_blobs.get(transfer.hash);
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
        }, context.db);

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
            method: resolveUploadMethod(presign),
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
                intentId: presign.intentId,
                meta: toCommitMeta(meta),
                storageProviderId: this.provider.id,
            });
        }

        await this.persistUploadMetadata(meta, storageId, context.db);

        await hooks.doAction('storage.files.upload:action:after', {
            hash: meta.hash,
            workspace_id: transfer.workspace_id,
            storage_id: storageId,
        });
    }

    private async doDownload(
        transfer: FileTransfer,
        signal: AbortSignal,
        context: TransferExecutionContext = {
            workspaceId: transfer.workspace_id,
            dbName: this.db.name,
            db: this.db,
        }
    ): Promise<void> {
        const meta = await context.db.file_meta.get(transfer.hash);
        if (!meta?.storage_id) {
            throw recoverableTransferError(
                'pending_upload',
                'Remote upload has not been committed yet'
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
            mimeType: meta.mime_type,
            expiresInMs: urlOptions.expiry_ms,
            disposition: urlOptions.disposition,
        });

        const response = await fetch(presign.url, {
            method: presign.method ?? 'GET',
            headers: presign.headers,
            credentials: 'include',
            signal,
        });
        if (signal.aborted) {
            await response.body?.cancel();
            throw createAbortError();
        }

        if (!response.ok) {
            if (response.status === 404 || response.status === 410) {
                throw recoverableTransferError(
                    'remote_missing',
                    'Remote object is temporarily missing and requires reconciliation'
                );
            }
            throw err(
                'ERR_STORAGE_DOWNLOAD_FAILED',
                `Download failed (${response.status})`,
                { tags: { domain: 'storage', stage: 'download' } }
            );
        }

        // FS downloads may omit Content-Type; treat missing/octet-stream as trusting file_meta.
        const responseMime = response.headers.get('content-type');
        const actualMime = responseMime
            ? normalizeTransferMime(responseMime)
            : '';
        const expectedMime = normalizeTransferMime(meta.mime_type);
        const mimeTrusted =
            !actualMime ||
            actualMime === 'application/octet-stream' ||
            actualMime === expectedMime;
        if (!mimeTrusted) {
            await response.body?.cancel();
            throw err(
                'ERR_STORAGE_DOWNLOAD_FAILED',
                'Downloaded object content-type mismatch',
                { tags: { domain: 'storage', stage: 'download' }, retryable: false }
            );
        }
        const blobMime =
            actualMime && actualMime !== 'application/octet-stream'
                ? responseMime!
                : meta.mime_type;

        const { blob, bytesTotal } = await this.readBlobWithProgress(
            response,
            transfer.id,
            context.db,
            this.maxDownloadBytes,
            blobMime,
            signal
        );
        await this.updateTransfer(transfer.id, {
            bytes_total: bytesTotal,
            bytes_done: bytesTotal,
        }, context.db);

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

        await context.db.file_blobs.put({ hash: meta.hash, blob });

        await hooks.doAction('storage.files.download:action:after', {
            hash: meta.hash,
            workspace_id: transfer.workspace_id,
            size_bytes: bytesTotal,
        });
    }

    private async readBlobWithProgress(
        response: Response,
        transferId: string,
        db: Or3DB = this.db,
        maxBytes = this.maxDownloadBytes,
        mimeType = response.headers.get('content-type') ?? '',
        signal?: AbortSignal
    ): Promise<{ blob: Blob; bytesTotal: number }> {
        if (signal?.aborted) {
            await response.body?.cancel();
            throw createAbortError();
        }
        const contentLength = Number(response.headers.get('content-length') || 0);
        if (contentLength > maxBytes) {
            await response.body?.cancel();
            throw err('ERR_STORAGE_DOWNLOAD_FAILED', 'Download exceeds configured byte limit', {
                tags: { domain: 'storage', stage: 'download' },
                retryable: false,
            });
        }
        if (!response.body) {
            const blob = await response.blob();
            if (blob.size > maxBytes) {
                throw err('ERR_STORAGE_DOWNLOAD_FAILED', 'Download exceeds configured byte limit', {
                    tags: { domain: 'storage', stage: 'download' },
                    retryable: false,
                });
            }
            return { blob, bytesTotal: contentLength || blob.size };
        }

        const reader = response.body.getReader();
        const abortReader = () => {
            void reader.cancel('transfer aborted').catch(() => {});
        };
        signal?.addEventListener('abort', abortReader, { once: true });
        let received = 0;
        let lastUpdate = 0;
        const UPDATE_INTERVAL_MS = 200; // Update every 200ms max

        // Use a TransformStream approach to avoid double buffering
        // Stream chunks directly into a new Response for blob conversion
        const stream = new ReadableStream<Uint8Array>({
            pull: async (controller) => {
                if (signal?.aborted) {
                    await reader.cancel('transfer aborted');
                    controller.error(createAbortError());
                    return;
                }
                const { done, value } = await reader.read();
                if (signal?.aborted) {
                    await reader.cancel('transfer aborted');
                    controller.error(createAbortError());
                    return;
                }
                if (done) {
                    // Final update on completion
                    await this.updateTransfer(transferId, {
                        bytes_done: received,
                        bytes_total: contentLength || received,
                    }, db);
                    controller.close();
                    return;
                }

                received += value.byteLength;
                if (received > maxBytes) {
                    await reader.cancel('download byte limit exceeded');
                    controller.error(err(
                        'ERR_STORAGE_DOWNLOAD_FAILED',
                        'Download exceeds configured byte limit',
                        { tags: { domain: 'storage', stage: 'download' }, retryable: false }
                    ));
                    return;
                }

                const now = Date.now();
                if (now - lastUpdate > UPDATE_INTERVAL_MS) {
                    await this.updateTransfer(transferId, {
                        bytes_done: received,
                        bytes_total: contentLength || received,
                    }, db);
                    lastUpdate = now;
                }

                controller.enqueue(value);
            },
        });

        try {
            const blob = await new Response(stream, {
                headers: mimeType ? { 'content-type': mimeType } : undefined,
            }).blob();
            if (signal?.aborted) throw createAbortError();
            return { blob, bytesTotal: contentLength || blob.size };
        } finally {
            signal?.removeEventListener('abort', abortReader);
        }
    }

    private async persistUploadMetadata(
        meta: FileMeta,
        storageId: string,
        db: Or3DB = this.db
    ): Promise<void> {
        await db.transaction(
            'rw',
            getWriteTxTableNames(db, 'file_meta'),
            async () => {
            const existing = await db.file_meta.get(meta.hash);
            if (!existing) return;
            await db.file_meta.put({
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
        patch: Partial<FileTransfer>,
        db: Or3DB = this.db
    ): Promise<void> {
        await db.file_transfers.update(id, {
            ...patch,
            updated_at: nowSec(),
        });
    }

    private async safeUpdateTransfer(
        id: string,
        patch: Partial<FileTransfer>,
        db: Or3DB = this.db
    ): Promise<boolean> {
        try {
            await this.updateTransfer(id, patch, db);
            return true;
        } catch (error) {
            if (!this.isDatabaseClosedError(error)) {
                throw error;
            }
            this.rebindDb();
            return false;
        }
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

    private rebindDb(): void {
        if (!this.dbResolver) return;
        this.db = this.dbResolver();
    }

    private async requeueTransferAfterDatabaseClose(
        transfer: FileTransfer,
        context: TransferExecutionContext
    ): Promise<void> {
        const recoveryDb = this.workspaceDbResolver(context.workspaceId);
        await this.updateTransfer(transfer.id, {
            state: 'queued',
            retry_at: 0,
            last_error: undefined,
            lease_owner: undefined,
            lease_expires_at: undefined,
        }, recoveryDb);
        if (this.workspaceId === context.workspaceId) {
            this.db = recoveryDb;
        } else {
            this.rebindDb();
        }
    }

    private isDatabaseClosedError(error: unknown): boolean {
        if (!error || typeof error !== 'object') return false;
        const name = (error as { name?: unknown }).name;
        if (name === 'DatabaseClosedError') return true;
        const message = (error as { message?: unknown }).message;
        return typeof message === 'string' && message.includes('Database has been closed');
    }

    private resolveWaiters(id: string) {
        const waiters = this.waiters.get(id);
        if (!waiters) return;
        waiters.forEach((waiter) => {
            clearTimeout(waiter.timeout);
            waiter.resolve();
        });
        this.waiters.delete(id);
    }

    private rejectWaiters(id: string, error: unknown) {
        const waiters = this.waiters.get(id);
        if (!waiters) return;
        const rejection =
            error instanceof Error ? error : new Error(String(error));
        waiters.forEach((waiter) => {
            clearTimeout(waiter.timeout);
            waiter.reject(rejection);
        });
        this.waiters.delete(id);
    }

    private removeWaiter(id: string, waiter: TransferWaiter): void {
        const waiters = this.waiters.get(id);
        if (!waiters) return;
        const remaining = waiters.filter((candidate) => candidate !== waiter);
        if (remaining.length) this.waiters.set(id, remaining);
        else this.waiters.delete(id);
    }
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

    queueInstance = new FileTransferQueue(getDb(), provider, {
        dbResolver: getDb,
    });
    return queueInstance;
}

/**
 * Internal API.
 *
 * Purpose:
 * Dispose and reset the singleton transfer queue. Intended for tests and HMR.
 */
export function _resetStorageTransferQueue(): void {
    queueInstance?.dispose();
    queueInstance = null;
}
