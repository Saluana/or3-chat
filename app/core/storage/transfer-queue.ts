import { normalizeError, presentError, parseRetryAfter, errorDiagnostics } from '~~/shared/errors';
/** Persistent, workspace-scoped upload and download execution queue. */
import Dexie, { liveQuery } from 'dexie';
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
import {
    DEFAULT_FILE_MIME_TYPE,
    isSupportedRasterMimeType,
} from '~~/shared/files/file-kind';
import { err, reportError } from '~/utils/errors';
import { getActiveStorageProvider } from './provider-registry';
import type { ObjectStorageProvider } from './types';
import { cacheDownloadedFile, cleanupFileCache, markUploadedFileCached, touchFileCache } from './file-cache';
import { isCloudFileStorageEnabled, loadFilePolicy } from './file-policy';
import type { FilePolicy } from '~~/shared/storage/file-policy';
import { withStorageDeadline } from './storage-request';
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

type BoundQueueContext = {
    workspaceId: string;
    db: Or3DB;
};

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

function leaseLostError(): Error {
    return Object.assign(new Error('Transfer lease lost'), { name: 'LeaseLostError' });
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
    private completedDownloads = new Map<string, Blob>();
    private directUploads = 0;
    private leaseRenewals = new Map<string, ReturnType<typeof setInterval>>();
    private claimTokens = new Map<string, string>();
    private recoveryCursor: string | undefined;
    private recoveryComplete = false;
    private processing = false;
    private processAgain = false;
    private readonly onOnline = () => this.scheduleProcessQueue(0);
    private readonly onOffline = () => this.pauseRunning();
    private readonly activity = globalThis as {
        addEventListener?: (type: string, callback: () => void) => void;
        removeEventListener?: (type: string, callback: () => void) => void;
    };

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
        this.activity.addEventListener?.('online', this.onOnline);
        this.activity.addEventListener?.('offline', this.onOffline);
    }

    setWorkspaceId(workspaceId: string | null) {
        const previousWorkspaceId = this.workspaceId;
        this.workspaceId = workspaceId;
        if (previousWorkspaceId !== workspaceId) {
            this.recoveryCursor = undefined;
            this.recoveryComplete = false;
        }

        // Cancel in-flight transfers for the old workspace when switching
        if (previousWorkspaceId && workspaceId !== previousWorkspaceId) {
            this.pauseRunning();
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

    hasDirectUploads(): boolean { return this.directUploads > 0; }

    /** Large user-selected files remain outside IndexedDB and are published after commit. */
    async uploadDirect(meta: FileMeta, blob: Blob, context: BoundQueueContext, assertCurrent: () => void): Promise<FileMeta> {
        this.assertBoundContext(context);
        assertCurrent();
        if (!this.provider.commitUpload) throw new Error('Verified Cloud uploads are unavailable for this provider.');
        const controller = new AbortController();
        const transfer = { id: createRuntimeUuid(), hash: meta.hash, workspace_id: context.workspaceId,
            direction: 'upload', state: 'running', attempts: 0, created_at: nowSec(), updated_at: nowSec() } as FileTransfer;
        this.abortControllers.set(transfer.id, controller);
        this.running.add(transfer.id);
        this.directUploads++;
        try {
            const storageId = await withStorageDeadline(signal => this.doUpload(transfer, signal,
                { ...context, dbName: context.db.name }, { meta, blob }), controller.signal, 300_000);
            this.assertBoundContext(context);
            assertCurrent();
            if (isCloudFileStorageEnabled()) await markUploadedFileCached(context.db, context.workspaceId, this.provider.id, meta.hash).catch(() => {});
            return { ...meta, storage_id: storageId, storage_provider_id: this.provider.id };
        } finally {
            this.abortControllers.delete(transfer.id);
            this.running.delete(transfer.id);
            this.requeueOnAbort.delete(transfer.id);
            this.directUploads--;
            this.scheduleProcessQueue(0);
        }
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

    private pauseRunning(): void {
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
        this.pauseRunning();
        if (this.processQueueTimeout) clearTimeout(this.processQueueTimeout);
        this.processQueueTimeout = null;
        this.processQueueAt = null;
        for (const timer of this.leaseRenewals.values()) clearInterval(timer);
        this.leaseRenewals.clear();
        this.activity.removeEventListener?.('online', this.onOnline);
        this.activity.removeEventListener?.('offline', this.onOffline);
        for (const [id] of this.waiters) {
            this.rejectWaiters(id, 'Transfer queue disposed');
        }
    }

    async enqueue(
        hash: string,
        direction: FileTransferDirection,
        boundContext?: BoundQueueContext
    ): Promise<FileTransfer | null> {
        const workspaceId = boundContext?.workspaceId ?? this.workspaceId;
        if (!workspaceId) {
            return null;
        }

        const db = boundContext?.db ?? (this.rebindDb(), this.db);
        if (boundContext) this.assertBoundContext(boundContext);

        const transfer = await db.transaction('rw', db.file_transfers, async () => {
            const existing = await this.findExistingTransfer(hash, direction, db);
            if (boundContext) this.assertBoundContext(boundContext);
            if (existing) {
                // Prior 404 / pre-commit races park here; re-queue so later success can proceed.
                if (
                    existing.state === 'remote_missing' ||
                    existing.state === 'pending_upload'
                ) {
                    await this.retryRecoverable(existing.id, db, boundContext);
                    if (boundContext) this.assertBoundContext(boundContext);
                    const retried = await db.file_transfers.get(existing.id);
                    if (boundContext) this.assertBoundContext(boundContext);
                    return retried ?? existing;
                }
                if (existing.state !== 'failed') {
                    return existing;
                }
            }

            const now = nowSec();
            const created: FileTransfer = {
                id: createRuntimeUuid(),
                hash,
                workspace_id: workspaceId,
                direction,
                bytes_total: 0,
                bytes_done: 0,
                state: 'queued',
                attempts: 0,
                retry_at: 0,
                created_at: now,
                updated_at: now,
            };

            if (boundContext) this.assertBoundContext(boundContext);
            await db.file_transfers.put(created);
            if (boundContext) this.assertBoundContext(boundContext);
            return created;
        });
        const tx = Dexie.currentTransaction as typeof Dexie.currentTransaction | undefined;
        if (tx?.db === db) tx.on('complete', () => this.scheduleProcessQueue(0));
        else this.scheduleProcessQueue(0);
        return transfer;
    }

    async waitForTransfer(id: string, timeoutMs = 60_000, db = this.db): Promise<void> {
        const current = await db.file_transfers.get(id);
        if (!current) throw new Error('Transfer not found');
        if (current.state === 'done') return;
        if (current.state === 'failed') throw Object.assign(new Error(current.last_error || 'Transfer failed'), current.last_error_details);
        if (current.state === 'pending_upload' || current.state === 'remote_missing')
            throw recoverableTransferError(current.state, current.last_error || 'Transfer requires reconciliation');
        return new Promise<void>((resolve, reject) => {
            const waiter: TransferWaiter = {
                resolve, reject,
                timeout: setTimeout(() => {
                    this.removeWaiter(id, waiter);
                    reject(new Error('Transfer timeout'));
                }, timeoutMs),
            };
            const waiters = this.waiters.get(id) ?? [];
            waiters.push(waiter);
            this.waiters.set(id, waiters);
            // Observe the persisted row, including writes committed by another tab.
            const subscription = liveQuery(() => db.file_transfers.get(id)).subscribe({
                next: transfer => {
                    if (!transfer) this.rejectWaiters(id, new Error('Transfer not found'));
                    else if (transfer.state === 'done') this.resolveWaiters(id);
                    else if (transfer.state === 'failed' || transfer.state === 'pending_upload' || transfer.state === 'remote_missing') {
                        const message = transfer.last_error || 'Transfer failed';
                        this.rejectWaiters(id, transfer.state === 'failed'
                            ? Object.assign(new Error(message), transfer.last_error_details)
                            : recoverableTransferError(transfer.state, message));
                    }
                },
                error: error => this.rejectWaiters(id, error),
            });
            waiter.unsubscribe = () => subscription.unsubscribe();
        });
    }

    /** Explicitly retry a transfer after upload/reconciliation state changes. */
    async retryRecoverable(
        id: string,
        db = this.db,
        boundContext?: BoundQueueContext
    ): Promise<boolean> {
        const transfer = await db.file_transfers.get(id);
        if (boundContext) this.assertBoundContext(boundContext);
        if (
            !transfer ||
            (transfer.state !== 'pending_upload' && transfer.state !== 'remote_missing')
        ) {
            return false;
        }
        if (boundContext) this.assertBoundContext(boundContext);
        await db.transaction('rw', db.file_transfers, async () => {
            const current = await db.file_transfers.get(id);
            if (!current || (current.state !== 'pending_upload' && current.state !== 'remote_missing')) return;
            await db.file_transfers.update(id, { state: 'queued', retry_at: 0, last_error: undefined, updated_at: nowSec() });
        });
        if (boundContext) this.assertBoundContext(boundContext);
        this.scheduleProcessQueue(0);
        return true;
    }

    async ensureDownloadedBlob(
        hash: string,
        boundContext?: BoundQueueContext
    ): Promise<Blob | undefined> {
        const db = boundContext?.db ?? this.db;
        const workspaceId = boundContext?.workspaceId ?? this.workspaceId;
        const capturedContext = workspaceId ? { workspaceId, db } : undefined;
        const existing = await db.file_blobs.get(hash);
        if (capturedContext) this.assertBoundContext(capturedContext);
        if (existing?.blob) {
            await touchFileCache(db, hash);
            if (capturedContext) this.assertBoundContext(capturedContext);
            return existing.blob;
        }
        if (!workspaceId) return undefined;
        if (capturedContext) this.assertBoundContext(capturedContext);
        const transfer = await this.enqueue(hash, 'download', {
            workspaceId,
            db,
        });
        if (!transfer) return undefined;
        if (capturedContext) this.assertBoundContext(capturedContext);
        try {
            await this.waitForTransfer(transfer.id, 60_000, db);
            if (capturedContext) this.assertBoundContext(capturedContext);
        } catch (error) {
            if (capturedContext) this.assertBoundContext(capturedContext);
            // Pre-commit / temporary remote gaps are expected; caller retries later.
            if (isRecoverableTransferError(error)) return undefined;
            const parked = await db.file_transfers.get(transfer.id);
            if (capturedContext) this.assertBoundContext(capturedContext);
            if (
                parked?.state === 'pending_upload' ||
                parked?.state === 'remote_missing'
            ) {
                return undefined;
            }
            throw error;
        }
        if (capturedContext) this.assertBoundContext(capturedContext);
        const transient = this.completedDownloads.get(transfer.id);
        if (transient) return transient;
        const row = await db.file_blobs.get(hash);
        if (capturedContext) this.assertBoundContext(capturedContext);
        if (row?.blob) return row.blob;
        // Cache admission may deliberately reject this file. The executing tab's
        // transient bytes are not shared, so retrieve and verify bytes for this caller.
        const controller = new AbortController();
        const localTransfer = { ...transfer, id: createRuntimeUuid(), lease_token: undefined };
        this.abortControllers.set(localTransfer.id, controller);
        this.running.add(localTransfer.id);
        try {
            return await withStorageDeadline(signal => this.doDownload(localTransfer, signal,
                { workspaceId, dbName: db.name, db }), controller.signal, 300_000);
        } finally {
            this.abortControllers.delete(localTransfer.id);
            this.running.delete(localTransfer.id);
            this.scheduleProcessQueue(0);
        }
    }

    private assertBoundContext(context: BoundQueueContext): void {
        if (this.db !== context.db || this.workspaceId !== context.workspaceId) {
            throw new Error('workspace changed during storage transfer');
        }
    }

    private async findExistingTransfer(
        hash: string,
        direction: FileTransferDirection,
        db = this.db
    ): Promise<FileTransfer | undefined> {
        try {
            const existing = await db.file_transfers
                .where('[hash+direction]')
                .equals([hash, direction])
                .toArray();
            return existing.find(transfer => transfer.workspace_id === this.workspaceId && transfer.state !== 'done' && transfer.state !== 'failed')
                ?? existing.find(transfer => transfer.workspace_id === this.workspaceId && transfer.state === 'failed');
        } catch (error) {
            if (!this.isDatabaseClosedError(error)) {
                throw error;
            }
            if (db !== this.db) throw error;
            this.rebindDb();
            return undefined;
        }
    }

    /** Repair pre-atomic-intake originals in bounded startup pages. */
    private async recoverOrphanUploads(context: TransferExecutionContext): Promise<void> {
        if (this.recoveryComplete || !isCloudFileStorageEnabled()) return;
        const rows = this.recoveryCursor
            ? await context.db.file_meta.where(':id').above(this.recoveryCursor).limit(50).toArray()
            : await context.db.file_meta.orderBy(':id').limit(50).toArray();
        for (const meta of rows) {
            if (meta.deleted || meta.storage_id) continue;
            await context.db.transaction('rw', context.db.file_meta, context.db.file_blobs, context.db.file_transfers, async () => {
                const current = await context.db.file_meta.get(meta.hash);
                const original = await context.db.file_blobs.get(meta.hash);
                if (!current || current.deleted || current.storage_id || !original || original.cache_accessed_at) return;
                if ((await context.db.file_transfers.where('[hash+direction]').equals([meta.hash, 'upload']).toArray())
                    .some(row => row.workspace_id === context.workspaceId && row.state !== 'done')) return;
                await this.enqueue(meta.hash, 'upload', context);
            });
        }
        this.recoveryCursor = rows.at(-1)?.hash;
        this.recoveryComplete = rows.length < 50;
        if (!this.recoveryComplete) this.scheduleProcessQueue(0);
    }

    private async processQueue(): Promise<void> {
        if (!this.workspaceId || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
        if (this.processing) { this.processAgain = true; return; }
        if (this.running.size >= this.concurrency) return;
        this.processing = true;

        try {
            await this.cleanupOldTransfers();
            const context: TransferExecutionContext = {
                workspaceId: this.workspaceId,
                dbName: this.db.name,
                db: this.db,
            };

            await this.recoverOrphanUploads(context);
            const available = this.concurrency - this.running.size;
            const candidates = await this.claimQueuedTransfers(context, available);

            if (!candidates.length) {
                await this.scheduleNextPersistedRetry(context);
                return;
            }

            for (const transfer of candidates) {
                if (this.workspaceId !== context.workspaceId || this.db !== context.db) {
                    await this.safeUpdateTransfer(transfer.id, { state: 'queued', retry_at: 0,
                        lease_owner: undefined, lease_token: undefined, lease_expires_at: undefined }, context.db, transfer.lease_token);
                    this.claimTokens.delete(transfer.id);
                    continue;
                }
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
        } finally {
            this.processing = false;
            if (this.processAgain) {
                this.processAgain = false;
                this.scheduleProcessQueue(0);
            }
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

        const claimed = await context.db.transaction('rw', context.db.file_transfers, async () => {
            const current = await context.db.file_transfers.get(transfer.id);
            if (!current) return;
            if (current.state === 'queued' && (current.retry_at ?? 0) <= Date.now()) {
                const next = this.claim(current);
                await context.db.file_transfers.put(next);
                return next;
            }
            if (current.state === 'running' && current.lease_owner === this.workerId &&
                current.lease_token && current.lease_token === transfer.lease_token &&
                (current.lease_expires_at ?? 0) > Date.now()) return current;
        });
        if (!claimed) { this.abortControllers.delete(transfer.id); return; }
        transfer = claimed;
        this.claimTokens.set(transfer.id, transfer.lease_token!);
        this.startLeaseRenewal(transfer.id, context.db, transfer.lease_token!);
        // One fresh policy read per operation, shared by admission and maintenance.
        // Start it alongside I/O; policy failure cannot fail verified file bytes.
        const policy = isCloudFileStorageEnabled()
            ? loadFilePolicy(context.workspaceId, controller.signal).catch(() => null) : undefined;

        try {
            await withStorageDeadline(async signal => {
                if (transfer.direction === 'upload') {
                    await this.doUpload(transfer, signal, context);
                } else {
                    const blob = await this.doDownload(transfer, signal, context, policy);
                    this.completedDownloads.set(transfer.id, blob);
                }
            }, controller.signal, 300_000);

            const latest = await context.db.file_transfers.get(transfer.id);
            const markedDone = await this.safeUpdateTransfer(transfer.id, {
                state: 'done',
                bytes_done: latest?.bytes_total ?? transfer.bytes_total,
                retry_at: 0,
                lease_owner: undefined,
                lease_expires_at: undefined,
                lease_token: undefined,
            }, context.db, transfer.lease_token);
            if (!markedDone) {
                return;
            }
            this.resolveWaiters(transfer.id);
            if (isCloudFileStorageEnabled()) void (async () => {
                if (transfer.direction === 'upload' && this.provider.commitUpload) {
                    await markUploadedFileCached(context.db, context.workspaceId, this.provider.id, transfer.hash);
                }
                const settings = await policy;
                if (!settings) return;
                this.assertBoundContext(context);
                await cleanupFileCache(context.db, context.workspaceId, this.provider, settings);
            })().catch(() => {}); // Cache maintenance cannot fail a committed transfer.
        } catch (error) {
            if ((error as Error | undefined)?.name === 'LeaseLostError' || (controller.signal.reason as Error | undefined)?.name === 'LeaseLostError') return;
            if (this.isDatabaseClosedError(error)) {
                await this.requeueTransferAfterDatabaseClose(transfer, context);
                return;
            }

            // Handle abort specially - don't retry aborted transfers
            // Chromium can surface an aborted fetch as `TypeError: Failed to fetch`
            // instead of an AbortError. The signal is the authoritative source.
            if (controller.signal.aborted || isAbortError(error)) {
                if (this.requeueOnAbort.delete(transfer.id)) {
                    await this.safeUpdateTransfer(transfer.id, {
                        state: 'queued',
                        retry_at: 0,
                        last_error: undefined,
                        lease_owner: undefined,
                        lease_expires_at: undefined,
                        lease_token: undefined,
                    }, context.db, transfer.lease_token);
                    return;
                }
                const settled = await this.safeUpdateTransfer(transfer.id, {
                    state: 'failed',
                    last_error: 'Transfer cancelled',
                    lease_owner: undefined, lease_expires_at: undefined, lease_token: undefined,
                }, context.db, transfer.lease_token);
                if (settled) this.rejectWaiters(transfer.id, 'Transfer cancelled');
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
                const settled = await this.safeUpdateTransfer(transfer.id, {
                    state: recoverableState,
                    last_error: message,
                    lease_owner: undefined, lease_expires_at: undefined, lease_token: undefined,
                }, context.db, transfer.lease_token);
                if (settled) this.rejectWaiters(transfer.id, parkedError);
                return;
            }

            const metadata = normalizeError(error, { source: 'storage', code: 'ERR_STORAGE_PROVIDER_ERROR' });
            // Server maintenance/rate-limit deferrals retain the durable transfer
            // and its retry budget. A later attempt obtains a fresh presigned URL.
            const deferred = (typeof navigator !== 'undefined' && navigator.onLine === false) ||
                metadata.status === 429 || metadata.status === 408 || (metadata.status !== undefined && metadata.status >= 500) ||
                error instanceof TypeError || (error as Error | undefined)?.name === 'TimeoutError' || (error as Error | undefined)?.name === 'NetworkError';
            const attempts = transfer.attempts + (deferred ? 0 : 1);
            const message = presentError(metadata).message;

            // Check if error is marked as non-retryable (e.g., file too large)
            const isNonRetryable = typeof error === 'object' && 
                error !== null && 
                'retryable' in error && 
                (error as { retryable?: boolean }).retryable === false;

            const failed = isNonRetryable || (!deferred && attempts >= this.maxAttempts);
            const delay = failed ? 0 : Math.max(this.getBackoffDelay(Math.max(1, attempts)), metadata.retryAfterMs ?? 0);
            const updated = await this.safeUpdateTransfer(transfer.id, {
                state: failed ? 'failed' : 'queued',
                attempts,
                last_error: message,
                last_error_details: errorDiagnostics(metadata),
                retry_at: failed ? 0 : Date.now() + delay,
                lease_owner: undefined,
                lease_expires_at: undefined,
                lease_token: undefined,
            }, context.db, transfer.lease_token);
            if (!updated) {
                return;
            }

            if (failed) {
                this.rejectWaiters(transfer.id, Object.assign(new Error(message), metadata));
                reportError(Object.assign(new Error(message), errorDiagnostics(metadata)), {
                    tags: { domain: 'storage', stage: transfer.direction },
                    silent: true,
                });
                return;
            }

            this.scheduleProcessQueue(delay);
        } finally {
            setTimeout(() => this.completedDownloads.delete(transfer.id), 0);
            this.requeueOnAbort.delete(transfer.id);
            this.stopLeaseRenewal(transfer.id);
            this.abortControllers.delete(transfer.id);
            if (this.claimTokens.get(transfer.id) === transfer.lease_token) this.claimTokens.delete(transfer.id);
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
                    ['running', context.workspaceId, now], true, true
                )
                .limit(limit)
                .toArray();
            const queued = await context.db.file_transfers
                .where('[state+workspace_id+retry_at]')
                .between(
                    ['queued', context.workspaceId, Dexie.minKey],
                    ['queued', context.workspaceId, now], true, true
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
                const next = this.claim(current);
                await context.db.file_transfers.put(next);
                this.claimTokens.set(next.id, next.lease_token!);
                claimed.push(next);
            }
            return claimed;
        });
    }

    private async scheduleNextPersistedRetry(context: TransferExecutionContext): Promise<void> {
        const now = Date.now();
        const [future, leases] = await Promise.all([context.db.file_transfers
            .where('[state+workspace_id+retry_at]')
            .between(
                ['queued', context.workspaceId, now],
                ['queued', context.workspaceId, Dexie.maxKey]
            )
            .limit(1)
            .toArray(), context.db.file_transfers
            .where('[state+workspace_id+lease_expires_at]')
            .between(['running', context.workspaceId, now], ['running', context.workspaceId, Dexie.maxKey])
            .limit(1).toArray()]);
        const next = Math.min(future[0]?.retry_at ?? Infinity, leases[0]?.lease_expires_at ?? Infinity);
        if (Number.isFinite(next)) {
            this.scheduleProcessQueue(Math.max(0, next - now));
        }
    }

    private claim(current: FileTransfer): FileTransfer {
        return { ...current, state: 'running', lease_owner: this.workerId,
            lease_token: createRuntimeUuid(), lease_expires_at: Date.now() + this.leaseDurationMs,
            last_attempt_at: Date.now(), retry_at: 0, updated_at: nowSec() };
    }

    private startLeaseRenewal(id: string, db: Or3DB, token: string): void {
        this.stopLeaseRenewal(id);
        const intervalMs = Math.max(250, Math.floor(this.leaseDurationMs / 3));
        const timer = setInterval(() => {
            void this.renewLease(id, db, token).catch(() => {
                this.abortControllers.get(id)?.abort(leaseLostError());
                this.stopLeaseRenewal(id);
            });
        }, intervalMs);
        this.leaseRenewals.set(id, timer);
    }

    private stopLeaseRenewal(id: string): void {
        const timer = this.leaseRenewals.get(id);
        if (timer) clearInterval(timer);
        this.leaseRenewals.delete(id);
    }

    private async renewLease(id: string, db: Or3DB, token = this.claimTokens.get(id)): Promise<boolean> {
        return db.transaction('rw', db.file_transfers, async () => {
            const current = await db.file_transfers.get(id);
            if (
                !current ||
                current.state !== 'running' ||
                current.lease_owner !== this.workerId || !token || current.lease_token !== token ||
                (current.lease_expires_at ?? 0) <= Date.now()
            ) {
                this.stopLeaseRenewal(id);
                if (this.claimTokens.get(id) === token) this.abortControllers.get(id)?.abort(leaseLostError());
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
        if (!this.workspaceId) return;
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
                console.error('[storage-transfer-queue] processQueue failed', errorDiagnostics(error));
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
        },
        source?: { meta: FileMeta; blob: Blob }
    ): Promise<string> {
        const meta = source?.meta ?? await context.db.file_meta.get(transfer.hash);
        const initialRow = source ? await context.db.file_meta.get(transfer.hash) : meta;
        const blobRow = source ? { blob: source.blob } : await context.db.file_blobs.get(transfer.hash);
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
        }, context.db, transfer.lease_token);

        const presign = await this.provider.getPresignedUploadUrl({
            workspaceId: transfer.workspace_id,
            hash: meta.hash,
            mimeType: meta.mime_type,
            sizeBytes: meta.size_bytes,
            expiresInMs: urlOptions.expiry_ms,
            disposition: urlOptions.disposition,
            signal,
        });
        await this.assertTransferActive(transfer, context.db, signal);

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
        await this.assertTransferActive(transfer, context.db, signal);

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
                        status: uploadResponse.status,
                        source: 'storage',
                        retryable: false, // Don't retry - permanent failure
                    }
                );
            }
            throw err(
                'ERR_STORAGE_UPLOAD_FAILED',
                `Upload failed (${uploadResponse.status})`,
                { tags: { domain: 'storage', stage: 'upload' }, status: uploadResponse.status, source: 'storage', retryAfterMs: parseRetryAfter(uploadResponse.headers.get('retry-after')) }
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
            await this.assertTransferActive(transfer, context.db, signal);
            const current = await context.db.file_meta.get(meta.hash);
            if ((initialRow && !current) || (current?.deleted && initialRow?.deleted !== true)) {
                throw createAbortError();
            }
            await this.assertTransferActive(transfer, context.db, signal);
            await this.provider.commitUpload({
                workspaceId: transfer.workspace_id,
                hash: meta.hash,
                storageId,
                intentId: presign.intentId,
                meta: toCommitMeta(meta),
                storageProviderId: this.provider.id,
                signal,
            });
        }

        await this.assertTransferActive(transfer, context.db, signal);
        if (!source) await this.persistUploadMetadata(meta, storageId, context.db, transfer, signal);

        await hooks.doAction('storage.files.upload:action:after', {
            hash: meta.hash,
            workspace_id: transfer.workspace_id,
            storage_id: storageId,
        });
        return storageId;
    }

    private async doDownload(
        transfer: FileTransfer,
        signal: AbortSignal,
        context: TransferExecutionContext = {
            workspaceId: transfer.workspace_id,
            dbName: this.db.name,
            db: this.db,
        },
        policy?: Promise<FilePolicy | null>
    ): Promise<Blob> {
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
            signal,
        });
        await this.assertTransferActive(transfer, context.db, signal);

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
                { tags: { domain: 'storage', stage: 'download' }, status: response.status, source: 'storage', retryAfterMs: parseRetryAfter(response.headers.get('retry-after')) }
            );
        }

        // FS downloads may omit Content-Type; treat missing/octet-stream as trusting file_meta.
        const responseMime = response.headers.get('content-type');
        const actualMime = responseMime
            ? normalizeTransferMime(responseMime)
            : '';
        const expectedMime = normalizeTransferMime(meta.mime_type);
        const fileKind = (meta as { kind?: string }).kind;
        const expectedMimeCanBeActive =
            fileKind === 'file'
                ? false
                : fileKind === 'pdf'
                    ? expectedMime === 'application/pdf'
                    : fileKind === 'image'
                        ? isSupportedRasterMimeType(expectedMime)
                        : isSupportedRasterMimeType(expectedMime) ||
                            expectedMime === 'application/pdf';
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
                ? expectedMimeCanBeActive
                    ? responseMime!
                    : DEFAULT_FILE_MIME_TYPE
                : expectedMimeCanBeActive
                    ? meta.mime_type
                    : DEFAULT_FILE_MIME_TYPE;

        const { blob, bytesTotal } = await this.readBlobWithProgress(
            response,
            transfer.id,
            context.db,
            isCloudFileStorageEnabled() ? Math.max(this.maxDownloadBytes, meta.size_bytes) : this.maxDownloadBytes,
            blobMime,
            signal,
            transfer.lease_token,
        );
        await this.updateTransfer(transfer.id, {
            bytes_total: bytesTotal,
            bytes_done: bytesTotal,
        }, context.db, transfer.lease_token);

        const parsed = parseHash(meta.hash);
        if (!parsed) {
            throw err(
                'ERR_STORAGE_DOWNLOAD_FAILED',
                'Invalid hash format for verification',
                { tags: { domain: 'storage', stage: 'download' } }
            );
        }

        const computedHex = await computeHashHex(blob, parsed.algorithm);
        await this.assertTransferActive(transfer, context.db, signal);
        if (computedHex !== parsed.hex) {
            throw err(
                'ERR_STORAGE_DOWNLOAD_FAILED',
                'Downloaded blob hash mismatch',
                { tags: { domain: 'storage', stage: 'download' } }
            );
        }

        if (isCloudFileStorageEnabled()) {
            try {
                const settings = await (policy ?? loadFilePolicy(context.workspaceId, signal));
                this.assertBoundContext(context);
                if (settings) await cacheDownloadedFile(context.db, context.workspaceId, this.provider.id, meta.hash, meta.storage_id, blob, settings,
                    () => this.assertTransferActive(transfer, context.db, signal));
            } catch {
                await this.assertTransferActive(transfer, context.db, signal);
                // The verified download is usable even when cache admission fails.
            }
        } else {
            await context.db.transaction('rw', context.db.file_blobs, context.db.file_transfers, async () => {
                await this.assertTransferActive(transfer, context.db, signal);
                await context.db.file_blobs.put({ hash: meta.hash, blob });
            });
        }

        await hooks.doAction('storage.files.download:action:after', {
            hash: meta.hash,
            workspace_id: transfer.workspace_id,
            size_bytes: bytesTotal,
        });
        return blob;
    }

    private async readBlobWithProgress(
        response: Response,
        transferId: string,
        db: Or3DB = this.db,
        maxBytes = this.maxDownloadBytes,
        mimeType = response.headers.get('content-type') ?? '',
        signal?: AbortSignal,
        claimToken?: string,
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
                    }, db, claimToken);
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
                    }, db, claimToken);
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
        db: Or3DB,
        transfer: FileTransfer,
        signal: AbortSignal,
    ): Promise<void> {
        await db.transaction(
            'rw',
            getWriteTxTableNames(db, 'file_meta', { include: ['file_transfers'] }),
            async () => {
                await this.assertTransferActive(transfer, db, signal);
                const existing = await db.file_meta.get(meta.hash);
                if (!existing || existing.deleted) return;
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
        db: Or3DB = this.db,
        claimToken?: string,
    ): Promise<void> {
        // Direct uploads/downloads have no durable row to mutate.
        if (!claimToken) return;
        await db.transaction('rw', db.file_transfers, async () => {
            await this.assertClaim(id, claimToken, db);
            await db.file_transfers.update(id, {
                ...patch,
                updated_at: nowSec(),
            });
        });
    }

    private async assertClaim(id: string, token: string, db: Or3DB): Promise<void> {
        const row = await db.file_transfers.get(id);
        if (!row || row.state !== 'running' || row.lease_owner !== this.workerId ||
            row.lease_token !== token || (row.lease_expires_at ?? 0) <= Date.now()) throw leaseLostError();
    }

    private async assertTransferActive(transfer: FileTransfer, db: Or3DB, signal: AbortSignal): Promise<void> {
        signal.throwIfAborted();
        if (transfer.lease_token) await this.assertClaim(transfer.id, transfer.lease_token, db);
        signal.throwIfAborted();
    }

    private async safeUpdateTransfer(
        id: string,
        patch: Partial<FileTransfer>,
        db: Or3DB = this.db,
        claimToken?: string,
    ): Promise<boolean> {
        try {
            await this.updateTransfer(id, patch, db, claimToken);
            return true;
        } catch (error) {
            if ((error as Error | undefined)?.name === 'LeaseLostError') return false;
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
        // Failed uploads remain visible and protect their staging originals.
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
        await this.safeUpdateTransfer(transfer.id, {
            state: 'queued',
            retry_at: 0,
            last_error: undefined,
            lease_owner: undefined,
            lease_expires_at: undefined,
            lease_token: undefined,
        }, recoveryDb, transfer.lease_token);
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
            waiter.unsubscribe?.();
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
            waiter.unsubscribe?.();
            waiter.reject(rejection);
        });
        this.waiters.delete(id);
    }

    private removeWaiter(id: string, waiter: TransferWaiter): void {
        const waiters = this.waiters.get(id);
        if (!waiters) return;
        waiter.unsubscribe?.();
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
