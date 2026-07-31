/**
 * @module server/utils/storage/metrics
 *
 * Purpose:
 * Track in-process storage transfer metrics for diagnostics and telemetry.
 *
 * Responsibilities:
 * - Maintain counters for upload and download activity.
 * - Provide immutable snapshots for reporting.
 * - Offer a reset helper for tests and instrumentation.
 *
 * Non-Goals:
 * - Persistent metrics storage or aggregation across instances.
 * - Detailed per-object analytics.
 */

/**
 * Purpose:
 * In-memory counters for storage operations.
 */
export interface StorageMetrics {
    uploadsStarted: number;
    uploadsCompleted: number;
    uploadsFailed: number;
    downloadsStarted: number;
    downloadsCompleted: number;
    downloadsFailed: number;
    bytesUploaded: number;
    bytesDownloaded: number;
}

const metrics: StorageMetrics = {
    uploadsStarted: 0,
    uploadsCompleted: 0,
    uploadsFailed: 0,
    downloadsStarted: 0,
    downloadsCompleted: 0,
    downloadsFailed: 0,
    bytesUploaded: 0,
    bytesDownloaded: 0,
};

/**
 * Purpose:
 * Record the start of an upload transfer.
 */
export function recordUploadStart(): void {
    metrics.uploadsStarted++;
}

/**
 * Purpose:
 * Record a completed upload and its byte count.
 */
export function recordUploadComplete(bytes: number): void {
    metrics.uploadsCompleted++;
    metrics.bytesUploaded += bytes;
}

/**
 * Purpose:
 * Record a failed upload attempt.
 */
export function recordUploadFailed(): void {
    metrics.uploadsFailed++;
}

/**
 * Purpose:
 * Record the start of a download transfer.
 */
export function recordDownloadStart(): void {
    metrics.downloadsStarted++;
}

/**
 * Purpose:
 * Record a completed download and its byte count.
 */
export function recordDownloadComplete(bytes: number): void {
    metrics.downloadsCompleted++;
    metrics.bytesDownloaded += bytes;
}

/**
 * Purpose:
 * Record a failed download attempt.
 */
export function recordDownloadFailed(): void {
    metrics.downloadsFailed++;
}

/**
 * Purpose:
 * Return a snapshot of current metrics.
 *
 * Behavior:
 * - Returns a shallow copy to prevent accidental mutation.
 */
export function getMetrics(): Readonly<StorageMetrics> {
    return { ...metrics };
}

/**
 * Purpose:
 * Reset all counters to zero.
 *
 * Constraints:
 * - Intended for tests and local diagnostics.
 */
export function resetMetrics(): void {
    Object.keys(metrics).forEach(k => {
        metrics[k as keyof StorageMetrics] = 0;
    });
}
