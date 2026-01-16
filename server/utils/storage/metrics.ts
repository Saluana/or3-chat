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

export function recordUploadStart(): void {
    metrics.uploadsStarted++;
}

export function recordUploadComplete(bytes: number): void {
    metrics.uploadsCompleted++;
    metrics.bytesUploaded += bytes;
}

export function recordUploadFailed(): void {
    metrics.uploadsFailed++;
}

export function recordDownloadStart(): void {
    metrics.downloadsStarted++;
}

export function recordDownloadComplete(bytes: number): void {
    metrics.downloadsCompleted++;
    metrics.bytesDownloaded += bytes;
}

export function recordDownloadFailed(): void {
    metrics.downloadsFailed++;
}

export function getMetrics(): Readonly<StorageMetrics> {
    return { ...metrics };
}

export function resetMetrics(): void {
    Object.keys(metrics).forEach(k => {
        metrics[k as keyof StorageMetrics] = 0;
    });
}
