import { describe, it, expect, beforeEach } from 'vitest';
import {
    recordUploadStart,
    recordUploadComplete,
    recordUploadFailed,
    recordDownloadStart,
    recordDownloadComplete,
    recordDownloadFailed,
    getMetrics,
    resetMetrics,
} from '../../server/utils/storage/metrics';

describe('Storage Metrics', () => {
    beforeEach(() => {
        resetMetrics();
    });

    it('should track upload stats', () => {
        recordUploadStart();
        recordUploadStart();
        recordUploadComplete(1000);
        recordUploadFailed();

        const m = getMetrics();
        expect(m.uploadsStarted).toBe(2);
        expect(m.uploadsCompleted).toBe(1);
        expect(m.uploadsFailed).toBe(1);
        expect(m.bytesUploaded).toBe(1000);
    });

    it('should track download stats', () => {
        recordDownloadStart();
        recordDownloadComplete(500);
        recordDownloadFailed();

        const m = getMetrics();
        expect(m.downloadsStarted).toBe(1);
        expect(m.downloadsCompleted).toBe(1);
        expect(m.downloadsFailed).toBe(1);
        expect(m.bytesDownloaded).toBe(500);
    });

    it('should reset metrics', () => {
        recordUploadStart();
        resetMetrics();
        const m = getMetrics();
        expect(m.uploadsStarted).toBe(0);
    });
});
