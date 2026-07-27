import type { Or3DB } from '~/db/client';
import type { FileMeta } from '~/db/schema';
import { err } from '~/utils/errors';
import type { RecoverableFileTransferState } from '~~/shared/storage/types';

export const DEFAULT_MAX_ATTEMPTS = 5;
export const DEFAULT_BACKOFF_BASE_MS = 1000;
export const DEFAULT_BACKOFF_MAX_MS = 60000;
export const DEFAULT_PRESIGN_EXPIRY_MS = 60 * 60 * 1000;
export const TRANSFER_RETENTION_SEC = 7 * 24 * 60 * 60;
export const TRANSFER_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
export const DEFAULT_LEASE_DURATION_MS = 30_000;
export const DEFAULT_MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;

export interface FileTransferQueueConfig {
    concurrency?: number;
    maxAttempts?: number;
    backoffBaseMs?: number;
    backoffMaxMs?: number;
    leaseDurationMs?: number;
    maxDownloadBytes?: number;
    dbResolver?: () => Or3DB;
    workspaceDbResolver?: (workspaceId: string) => Or3DB;
}

export type TransferWaiter = {
    resolve: () => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
};

export type TransferExecutionContext = {
    workspaceId: string;
    dbName: string;
    db: Or3DB;
};

type RecoverableTransferError = Error & {
    transferState: RecoverableFileTransferState;
};

export function recoverableTransferError(
    state: RecoverableFileTransferState,
    message: string
): RecoverableTransferError {
    const error = err('ERR_STORAGE_FILE_NOT_FOUND', message, {
        tags: { domain: 'storage', stage: 'download' },
        retryable: false,
    }) as unknown as RecoverableTransferError;
    error.transferState = state;
    return error;
}

export function resolveUploadMethod(presign: {
    url: string;
    method?: string;
}): string {
    const explicit =
        typeof presign.method === 'string' ? presign.method.trim() : '';
    if (explicit.length > 0) return explicit.toUpperCase();
    return presign.url.startsWith('/api/storage/fs/upload') ? 'PUT' : 'POST';
}

export function getDefaultConcurrency(): number {
    if (typeof navigator === 'undefined' || !('connection' in navigator)) {
        return 2;
    }
    const connection = navigator.connection as
        | { effectiveType?: string }
        | undefined;
    if (connection?.effectiveType === '4g') return 4;
    if (connection?.effectiveType === '3g') return 2;
    return 1;
}

export function normalizeTransferMime(value: string): string {
    return value.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

export function toCommitMeta(meta: FileMeta) {
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
