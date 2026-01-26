import { describe, it, expect, beforeEach, vi } from 'vitest';
import { memoryJobProvider, clearAllJobs } from '../providers/memory';

// Mock useRuntimeConfig globally
const mockRuntimeConfig = {
    backgroundJobs: {
        maxConcurrentJobs: 20,
        jobTimeoutMs: 1000,
        completedJobRetentionMs: 1000,
    },
};

vi.stubGlobal('useRuntimeConfig', () => mockRuntimeConfig);

describe('Memory Job Provider', () => {
    beforeEach(() => {
        clearAllJobs();
    });

    it('creates a job', async () => {
        const id = await memoryJobProvider.createJob({
            userId: 'user1',
            threadId: 'thread1',
            messageId: 'msg1',
            model: 'gpt-4',
        });
        expect(id).toBeDefined();

        const job = await memoryJobProvider.getJob(id, 'user1');
        expect(job).toBeDefined();
        expect(job?.id).toBe(id);
        expect(job?.status).toBe('streaming');
    });

    it('enforces authorization', async () => {
        const id = await memoryJobProvider.createJob({
            userId: 'user1',
            threadId: 'thread1',
            messageId: 'msg1',
            model: 'gpt-4',
        });

        const job = await memoryJobProvider.getJob(id, 'user2');
        expect(job).toBeNull();
    });

    it('updates a job', async () => {
        const id = await memoryJobProvider.createJob({
            userId: 'user1',
            threadId: 'thread1',
            messageId: 'msg1',
            model: 'gpt-4',
        });

        await memoryJobProvider.updateJob(id, {
            contentChunk: 'Hello',
            chunksReceived: 1,
        });

        const job = await memoryJobProvider.getJob(id, 'user1');
        expect(job?.content).toBe('Hello');
        expect(job?.chunksReceived).toBe(1);
    });

    it('completes a job', async () => {
        const id = await memoryJobProvider.createJob({
            userId: 'user1',
            threadId: 'thread1',
            messageId: 'msg1',
            model: 'gpt-4',
        });

        await memoryJobProvider.completeJob(id, 'Final content');

        const job = await memoryJobProvider.getJob(id, 'user1');
        expect(job?.status).toBe('complete');
        expect(job?.content).toBe('Final content');
        expect(job?.completedAt).toBeDefined();
    });

    it('aborts a job', async () => {
        const id = await memoryJobProvider.createJob({
            userId: 'user1',
            threadId: 'thread1',
            messageId: 'msg1',
            model: 'gpt-4',
        });

        const aborted = await memoryJobProvider.abortJob(id, 'user1');
        expect(aborted).toBe(true);

        const job = await memoryJobProvider.getJob(id, 'user1');
        expect(job?.status).toBe('aborted');
    });
});
