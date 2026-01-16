import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FileTransferQueue } from '../../app/core/storage/transfer-queue';
import type { ObjectStorageProvider } from '../../app/core/storage/types';
import type { Or3DB } from '../../app/db/client';

// Mock DB
const mockFileTransfers = {
    get: vi.fn(),
    put: vi.fn(),
    update: vi.fn(),
    where: vi.fn(() => ({
        equals: vi.fn(() => ({
            toArray: vi.fn(async () => []),
            sortBy: vi.fn(async () => []),
        })),
    })),
};

const mockFileMeta = {
    get: vi.fn(),
    put: vi.fn(),
    // @ts-ignore
    transaction: vi.fn(),
};

const mockFileBlobs = {
    get: vi.fn(),
    put: vi.fn(),
};

const mockDb = {
    file_transfers: mockFileTransfers,
    file_meta: mockFileMeta,
    file_blobs: mockFileBlobs,
    transaction: vi.fn((mode, tables, cb) => cb()),
} as unknown as Or3DB;

// Mock Provider
const mockProvider = {
    id: 'test-provider',
    getPresignedUploadUrl: vi.fn(),
    getPresignedDownloadUrl: vi.fn(),
} as unknown as ObjectStorageProvider;

describe('FileTransferQueue', () => {
    let queue: FileTransferQueue;

    beforeEach(() => {
        // Reset mocks
        mockFileTransfers.get.mockReset();
        mockFileTransfers.put.mockReset();
        mockFileTransfers.update.mockReset();
        // @ts-ignore
        mockFileTransfers.where.mockReturnValue({
            equals: vi.fn(() => ({
                toArray: vi.fn(async () => []),
                sortBy: vi.fn(async () => []),
            })),
        });

        queue = new FileTransferQueue(mockDb, mockProvider);
    });

    describe('getDefaultConcurrency', () => {
        // We need to be careful mocking global.navigator as it might affect other things
        // but for unit tests in isolation it should be fine if we restore it.
        const originalNavigator = global.navigator;

        afterEach(() => {
            // @ts-ignore
            global.navigator = originalNavigator;
        });

        it('should return 4 for 4g', () => {
            // @ts-ignore
            global.navigator = {
                connection: { effectiveType: '4g' }
            };
            const q = new FileTransferQueue(mockDb, mockProvider);
            // @ts-ignore - access private property for testing
            expect(q.concurrency).toBe(4);
        });

        it('should return 2 for 3g', () => {
            // @ts-ignore
            global.navigator = {
                connection: { effectiveType: '3g' }
            };
            const q = new FileTransferQueue(mockDb, mockProvider);
            // @ts-ignore - access private property for testing
            expect(q.concurrency).toBe(2);
        });

        it('should return 1 for 2g', () => {
            // @ts-ignore
            global.navigator = {
                connection: { effectiveType: '2g' }
            };
            const q = new FileTransferQueue(mockDb, mockProvider);
            // @ts-ignore - access private property for testing
            expect(q.concurrency).toBe(1);
        });

        it('should default to 2 if navigator is undefined', () => {
             // @ts-ignore
             global.navigator = undefined;
             const q = new FileTransferQueue(mockDb, mockProvider);
             // @ts-ignore
             expect(q.concurrency).toBe(2);
        });
    });

    describe('waitForTransfer', () => {
        it('should resolve immediately if transfer is done', async () => {
            mockFileTransfers.get.mockResolvedValue({ state: 'done' });
            await queue.waitForTransfer('test-id');
        });

        it('should reject if transfer is failed', async () => {
            mockFileTransfers.get.mockResolvedValue({ state: 'failed', last_error: 'Test error' });
            await expect(queue.waitForTransfer('test-id')).rejects.toThrow('Test error');
        });

        it('should timeout after specified duration', async () => {
            mockFileTransfers.get.mockResolvedValue({ state: 'queued' });
            // Using a short timeout for test
            await expect(queue.waitForTransfer('test-id', 100)).rejects.toThrow('Transfer timeout');
        });
    });

    describe('readBlobWithProgress', () => {
        it('should throttle progress updates', async () => {
            const transferId = 'test-transfer';
            const chunks = 10;
            const chunkSize = 100;
            const totalSize = chunks * chunkSize;

            // Mock Response reader
            const mockReader = {
                read: vi.fn()
            };

            // Implement read with delay
            let chunkCount = 0;
            mockReader.read.mockImplementation(async () => {
                if (chunkCount >= chunks) {
                    return { done: true, value: undefined };
                }
                chunkCount++;
                // Advance time by 10ms per chunk. Total 100ms.
                // Interval is 200ms.
                vi.advanceTimersByTime(10);
                return { done: false, value: new Uint8Array(chunkSize) };
            });

            const mockResponse = {
                headers: { get: () => String(totalSize) },
                body: {
                    getReader: () => mockReader
                },
                blob: () => Promise.resolve(new Blob(['']))
            } as unknown as Response;

            vi.useFakeTimers();
            vi.setSystemTime(1000); // Start at explicit time

            await (queue as any).readBlobWithProgress(mockResponse, transferId);

            // Logic Trace:
            // lastUpdate = 0 (initially).
            // Chunk 1: time=1010. 1010-0 > 200. Update! lastUpdate=1010.
            // Chunk 2: time=1020. 1020-1010 < 200. Skip.
            // ...
            // Chunk 10: time=1100. 1100-1010 < 200. Skip.
            // Done: Update (Final).
            // Expected: 2 updates.

            expect(mockFileTransfers.update).toHaveBeenCalled();
            const callCount = mockFileTransfers.update.mock.calls.length;
            expect(callCount).toBe(2);

            vi.useRealTimers();
        });
    });
});
