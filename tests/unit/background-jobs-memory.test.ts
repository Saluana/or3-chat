/**
 * Unit tests for Memory Background Job Provider
 * Phase 9.1: Memory provider tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { CreateJobParams } from '../../server/utils/background-jobs/types';

// Mock the store module to avoid useRuntimeConfig dependency
vi.mock('../../server/utils/background-jobs/store', () => ({
    getJobConfig: vi.fn(() => ({
        maxConcurrentJobs: 20,
        jobTimeoutMs: 5 * 60 * 1000,
        completedJobRetentionMs: 5 * 60 * 1000,
    })),
}));

import {
    memoryJobProvider,
    clearAllJobs,
    getJobCount,
} from '../../server/utils/background-jobs/providers/memory';

// Helper to update mock config
async function setMockJobConfig(config: {
    maxConcurrentJobs?: number;
    jobTimeoutMs?: number;
    completedJobRetentionMs?: number;
}) {
    const { getJobConfig } = await import('../../server/utils/background-jobs/store');
    vi.mocked(getJobConfig).mockReturnValue({
        maxConcurrentJobs: config.maxConcurrentJobs ?? 20,
        jobTimeoutMs: config.jobTimeoutMs ?? 5 * 60 * 1000,
        completedJobRetentionMs: config.completedJobRetentionMs ?? 5 * 60 * 1000,
    });
}

// Helper to reset mock config to defaults
async function resetMockJobConfig() {
    await setMockJobConfig({});
}

describe('Memory Background Job Provider', () => {
    beforeEach(() => {
        clearAllJobs();
        vi.useFakeTimers();
    });

    afterEach(() => {
        clearAllJobs();
        vi.restoreAllMocks();
    });

    describe('CRUD Operations', () => {
        it('should create a job and return a UUID', async () => {
            const params: CreateJobParams = {
                userId: 'user-1',
                threadId: 'thread-1',
                messageId: 'msg-1',
                model: 'test-model',
            };

            const jobId = await memoryJobProvider.createJob(params);

            expect(jobId).toBeTruthy();
            expect(typeof jobId).toBe('string');
            expect(jobId.length).toBeGreaterThan(0);
        });

        it('should retrieve a created job by ID with correct userId', async () => {
            const params: CreateJobParams = {
                userId: 'user-1',
                threadId: 'thread-1',
                messageId: 'msg-1',
                model: 'test-model',
            };

            const jobId = await memoryJobProvider.createJob(params);
            const job = await memoryJobProvider.getJob(jobId, 'user-1');

            expect(job).toBeTruthy();
            expect(job?.id).toBe(jobId);
            expect(job?.userId).toBe('user-1');
            expect(job?.threadId).toBe('thread-1');
            expect(job?.messageId).toBe('msg-1');
            expect(job?.model).toBe('test-model');
            expect(job?.status).toBe('streaming');
            expect(job?.content).toBe('');
            expect(job?.chunksReceived).toBe(0);
        });

        it('should return null for non-existent job', async () => {
            const job = await memoryJobProvider.getJob('non-existent', 'user-1');
            expect(job).toBeNull();
        });

        it('should return null when userId does not match (authorization)', async () => {
            const params: CreateJobParams = {
                userId: 'user-1',
                threadId: 'thread-1',
                messageId: 'msg-1',
                model: 'test-model',
            };

            const jobId = await memoryJobProvider.createJob(params);
            const job = await memoryJobProvider.getJob(jobId, 'user-2');

            expect(job).toBeNull();
        });

        it('should allow wildcard userId (*) to bypass authorization', async () => {
            const params: CreateJobParams = {
                userId: 'user-1',
                threadId: 'thread-1',
                messageId: 'msg-1',
                model: 'test-model',
            };

            const jobId = await memoryJobProvider.createJob(params);
            const job = await memoryJobProvider.getJob(jobId, '*');

            expect(job).toBeTruthy();
            expect(job?.userId).toBe('user-1');
        });

        it('should update job content with chunks', async () => {
            const params: CreateJobParams = {
                userId: 'user-1',
                threadId: 'thread-1',
                messageId: 'msg-1',
                model: 'test-model',
            };

            const jobId = await memoryJobProvider.createJob(params);

            await memoryJobProvider.updateJob(jobId, {
                contentChunk: 'Hello ',
                chunksReceived: 1,
            });

            let job = await memoryJobProvider.getJob(jobId, 'user-1');
            expect(job?.content).toBe('Hello ');
            expect(job?.chunksReceived).toBe(1);

            await memoryJobProvider.updateJob(jobId, {
                contentChunk: 'world!',
                chunksReceived: 2,
            });

            job = await memoryJobProvider.getJob(jobId, 'user-1');
            expect(job?.content).toBe('Hello world!');
            expect(job?.chunksReceived).toBe(2);
        });

        it('should not update non-streaming jobs', async () => {
            const params: CreateJobParams = {
                userId: 'user-1',
                threadId: 'thread-1',
                messageId: 'msg-1',
                model: 'test-model',
            };

            const jobId = await memoryJobProvider.createJob(params);
            await memoryJobProvider.completeJob(jobId, 'Final content');

            await memoryJobProvider.updateJob(jobId, {
                contentChunk: 'Should not appear',
                chunksReceived: 10,
            });

            const job = await memoryJobProvider.getJob(jobId, 'user-1');
            expect(job?.content).toBe('Final content');
            expect(job?.status).toBe('complete');
        });

        it('should complete a job with final content', async () => {
            const params: CreateJobParams = {
                userId: 'user-1',
                threadId: 'thread-1',
                messageId: 'msg-1',
                model: 'test-model',
            };

            const jobId = await memoryJobProvider.createJob(params);
            await memoryJobProvider.completeJob(jobId, 'Final content here');

            const job = await memoryJobProvider.getJob(jobId, 'user-1');
            expect(job?.status).toBe('complete');
            expect(job?.content).toBe('Final content here');
            expect(job?.completedAt).toBeTruthy();
        });

        it('should fail a job with error message', async () => {
            const params: CreateJobParams = {
                userId: 'user-1',
                threadId: 'thread-1',
                messageId: 'msg-1',
                model: 'test-model',
            };

            const jobId = await memoryJobProvider.createJob(params);
            await memoryJobProvider.failJob(jobId, 'Network error');

            const job = await memoryJobProvider.getJob(jobId, 'user-1');
            expect(job?.status).toBe('error');
            expect(job?.error).toBe('Network error');
            expect(job?.completedAt).toBeTruthy();
        });

        it('should abort a streaming job', async () => {
            const params: CreateJobParams = {
                userId: 'user-1',
                threadId: 'thread-1',
                messageId: 'msg-1',
                model: 'test-model',
            };

            const jobId = await memoryJobProvider.createJob(params);
            const aborted = await memoryJobProvider.abortJob(jobId, 'user-1');

            expect(aborted).toBe(true);

            const job = await memoryJobProvider.getJob(jobId, 'user-1');
            expect(job?.status).toBe('aborted');
            expect(job?.completedAt).toBeTruthy();
        });

        it('should not abort job with wrong userId', async () => {
            const params: CreateJobParams = {
                userId: 'user-1',
                threadId: 'thread-1',
                messageId: 'msg-1',
                model: 'test-model',
            };

            const jobId = await memoryJobProvider.createJob(params);
            const aborted = await memoryJobProvider.abortJob(jobId, 'user-2');

            expect(aborted).toBe(false);

            const job = await memoryJobProvider.getJob(jobId, 'user-1');
            expect(job?.status).toBe('streaming');
        });

        it('should not abort already completed job', async () => {
            const params: CreateJobParams = {
                userId: 'user-1',
                threadId: 'thread-1',
                messageId: 'msg-1',
                model: 'test-model',
            };

            const jobId = await memoryJobProvider.createJob(params);
            await memoryJobProvider.completeJob(jobId, 'Done');

            const aborted = await memoryJobProvider.abortJob(jobId, 'user-1');
            expect(aborted).toBe(false);

            const job = await memoryJobProvider.getJob(jobId, 'user-1');
            expect(job?.status).toBe('complete');
        });

        it('should return false when aborting non-existent job', async () => {
            const aborted = await memoryJobProvider.abortJob('non-existent', 'user-1');
            expect(aborted).toBe(false);
        });
    });

    describe('Max Jobs Limit', () => {
        it('should enforce max concurrent jobs limit', async () => {
            // Mock the config to return a low limit
            await setMockJobConfig({ maxConcurrentJobs: 2 });

            // Clear jobs
            clearAllJobs();

            const params: CreateJobParams = {
                userId: 'user-1',
                threadId: 'thread-1',
                messageId: 'msg-1',
                model: 'test-model',
            };

            // Create 2 jobs (at limit)
            await memoryJobProvider.createJob({ ...params, messageId: 'msg-1' });
            await memoryJobProvider.createJob({ ...params, messageId: 'msg-2' });

            // Third should fail
            await expect(
                memoryJobProvider.createJob({ ...params, messageId: 'msg-3' })
            ).rejects.toThrow(/Max concurrent/);

            // Restore defaults
            await resetMockJobConfig();
        });

        it('should allow new jobs after completing existing ones', async () => {
            // Mock the config to return a low limit
            await setMockJobConfig({ maxConcurrentJobs: 2 });

            clearAllJobs();

            const params: CreateJobParams = {
                userId: 'user-1',
                threadId: 'thread-1',
                messageId: 'msg-1',
                model: 'test-model',
            };

            const job1 = await memoryJobProvider.createJob({ ...params, messageId: 'msg-1' });
            const job2 = await memoryJobProvider.createJob({ ...params, messageId: 'msg-2' });

            // Complete one job
            await memoryJobProvider.completeJob(job1, 'Done');

            // Now we can create another
            const job3 = await memoryJobProvider.createJob({ ...params, messageId: 'msg-3' });
            expect(job3).toBeTruthy();

            // Restore defaults
            await resetMockJobConfig();
        });
    });

    describe('Timeout and Cleanup', () => {
        it('should timeout streaming jobs that exceed timeout', async () => {
            // Use real timers for Date.now() to work with job creation
            vi.useRealTimers();

            const params: CreateJobParams = {
                userId: 'user-1',
                threadId: 'thread-1',
                messageId: 'msg-1',
                model: 'test-model',
            };

            // Mock getJobConfig to return a very short timeout
            await setMockJobConfig({ jobTimeoutMs: 100 });

            const jobId = await memoryJobProvider.createJob(params);

            // Wait past timeout
            await new Promise((resolve) => setTimeout(resolve, 150));

            const cleaned = await memoryJobProvider.cleanupExpired();
            expect(cleaned).toBeGreaterThan(0);

            const job = await memoryJobProvider.getJob(jobId, 'user-1');
            expect(job?.status).toBe('error');
            expect(job?.error).toBe('Job timed out');

            // Restore
            vi.useFakeTimers();
            await resetMockJobConfig();
        });

        it('should clean up stale completed jobs', async () => {
            vi.useRealTimers();

            const params: CreateJobParams = {
                userId: 'user-1',
                threadId: 'thread-1',
                messageId: 'msg-1',
                model: 'test-model',
            };

            // Mock config to use short retention
            await setMockJobConfig({ completedJobRetentionMs: 100 });

            const jobId = await memoryJobProvider.createJob(params);
            await memoryJobProvider.completeJob(jobId, 'Done');

            // Wait past retention time
            await new Promise((resolve) => setTimeout(resolve, 150));

            const cleaned = await memoryJobProvider.cleanupExpired();
            expect(cleaned).toBeGreaterThan(0);

            const job = await memoryJobProvider.getJob(jobId, 'user-1');
            expect(job).toBeNull();

            // Restore
            vi.useFakeTimers();
            await resetMockJobConfig();
        });

        it('should not clean up recent completed jobs', async () => {
            vi.useRealTimers();

            const params: CreateJobParams = {
                userId: 'user-1',
                threadId: 'thread-1',
                messageId: 'msg-1',
                model: 'test-model',
            };

            // Use longer retention
            await setMockJobConfig({ completedJobRetentionMs: 1000 });

            const jobId = await memoryJobProvider.createJob(params);
            await memoryJobProvider.completeJob(jobId, 'Done');

            // Wait less than retention
            await new Promise((resolve) => setTimeout(resolve, 50));

            await memoryJobProvider.cleanupExpired();

            const job = await memoryJobProvider.getJob(jobId, 'user-1');
            expect(job).toBeTruthy();
            expect(job?.status).toBe('complete');

            // Restore
            vi.useFakeTimers();
            await resetMockJobConfig();
        });

        it('should not timeout active streaming jobs within timeout period', async () => {
            vi.useRealTimers();

            const params: CreateJobParams = {
                userId: 'user-1',
                threadId: 'thread-1',
                messageId: 'msg-1',
                model: 'test-model',
            };

            // Use longer timeout
            await setMockJobConfig({ jobTimeoutMs: 1000 });

            const jobId = await memoryJobProvider.createJob(params);

            // Wait less than timeout
            await new Promise((resolve) => setTimeout(resolve, 50));

            await memoryJobProvider.cleanupExpired();

            const job = await memoryJobProvider.getJob(jobId, 'user-1');
            expect(job?.status).toBe('streaming');

            // Restore
            vi.useFakeTimers();
            await resetMockJobConfig();
        });
    });

    describe('AbortController', () => {
        it('should provide AbortController for active jobs', async () => {
            const params: CreateJobParams = {
                userId: 'user-1',
                threadId: 'thread-1',
                messageId: 'msg-1',
                model: 'test-model',
            };

            const jobId = await memoryJobProvider.createJob(params);
            const ac = memoryJobProvider.getAbortController?.(jobId);

            expect(ac).toBeInstanceOf(AbortController);
            expect(ac?.signal.aborted).toBe(false);
        });

        it('should return aborted signal after abort', async () => {
            const params: CreateJobParams = {
                userId: 'user-1',
                threadId: 'thread-1',
                messageId: 'msg-1',
                model: 'test-model',
            };

            const jobId = await memoryJobProvider.createJob(params);
            const ac = memoryJobProvider.getAbortController?.(jobId);

            await memoryJobProvider.abortJob(jobId, 'user-1');

            expect(ac?.signal.aborted).toBe(true);
        });

        it('should return undefined for non-existent job', async () => {
            const ac = memoryJobProvider.getAbortController?.('non-existent');
            expect(ac).toBeUndefined();
        });
    });

    describe('Active Job Count', () => {
        it('should return correct active job count', async () => {
            const params: CreateJobParams = {
                userId: 'user-1',
                threadId: 'thread-1',
                messageId: 'msg-1',
                model: 'test-model',
            };

            let count = await memoryJobProvider.getActiveJobCount?.();
            expect(count).toBe(0);

            const job1 = await memoryJobProvider.createJob({ ...params, messageId: 'msg-1' });
            const job2 = await memoryJobProvider.createJob({ ...params, messageId: 'msg-2' });

            count = await memoryJobProvider.getActiveJobCount?.();
            expect(count).toBe(2);

            await memoryJobProvider.completeJob(job1, 'Done');

            count = await memoryJobProvider.getActiveJobCount?.();
            expect(count).toBe(1);

            await memoryJobProvider.abortJob(job2, 'user-1');

            count = await memoryJobProvider.getActiveJobCount?.();
            expect(count).toBe(0);
        });
    });
});
