import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    clearAllJobs,
    memoryJobProvider,
} from '../providers/memory';
import {
    decryptBackgroundCredential,
    encryptBackgroundCredential,
} from '../crypto';
import {
    reconcileBackgroundJobs,
    resetBackgroundJobLifecycleForTests,
    runClaimedBackgroundJob,
} from '../lifecycle';
import { startBackgroundStream } from '../stream-handler';

const config = vi.hoisted(() => ({
    maxConcurrentJobs: 2,
    maxConcurrentJobsPerUser: 2,
    jobTimeoutMs: 300_000,
    completedJobRetentionMs: 300_000,
}));

vi.mock('../store', () => ({
    getJobConfig: () => config,
    getJobProvider: async () => memoryJobProvider,
    getBackgroundJobEncryptionKey: () => secret,
    isBackgroundStreamingEnabled: () => true,
}));

const secret = 'background-lifecycle-test-secret-that-is-long-enough';

function execution(contentBase = '') {
    return {
        version: 1 as const,
        body: { model: 'test-model', messages: [] },
        workspaceId: 'workspace-1',
        referer: 'http://localhost:3000',
        apiKeyCiphertext: encryptBackgroundCredential('user-api-key', secret),
        contentBase,
        checkpointedToolCallIds: [],
    };
}

describe('memory background job admission and lifecycle', () => {
    beforeEach(() => {
        clearAllJobs();
        resetBackgroundJobLifecycleForTests();
        vi.unstubAllGlobals();
        config.maxConcurrentJobs = 2;
        config.maxConcurrentJobsPerUser = 2;
    });

    it('authenticates encrypted recovery credentials', () => {
        const encrypted = encryptBackgroundCredential('user-api-key', secret);
        expect(encrypted).not.toContain('user-api-key');
        expect(decryptBackgroundCredential(encrypted, secret)).toBe(
            'user-api-key'
        );
        expect(() =>
            decryptBackgroundCredential(`${encrypted}tampered`, secret)
        ).toThrow('Failed to decrypt background job credential');
    });

    it('admits concurrent jobs atomically at the configured cap', async () => {
        const results = await Promise.allSettled(
            Array.from({ length: 8 }, (_, index) =>
                memoryJobProvider.createJob({
                    userId: `user-${index}`,
                    threadId: `thread-${index}`,
                    messageId: `message-${index}`,
                    model: 'test-model',
                    idempotencyKey: `message-${index}`,
                    execution: execution(),
                })
            )
        );

        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
        expect(await memoryJobProvider.getActiveJobCount?.()).toBe(2);
    });

    it('returns one job for duplicate idempotency keys', async () => {
        const params = {
            userId: 'user-1',
            threadId: 'thread-1',
            messageId: 'message-1',
            model: 'test-model',
            idempotencyKey: 'message-1',
            execution: execution(),
        };
        const [first, second] = await Promise.all([
            memoryJobProvider.createJob(params),
            memoryJobProvider.createJob(params),
        ]);

        expect(second).toBe(first);
        expect(await memoryJobProvider.getActiveJobCount?.()).toBe(1);
    });

    it('returns the terminal job for a repeated admission and accepts a new retry key', async () => {
        const params = {
            userId: 'user-1',
            threadId: 'thread-1',
            messageId: 'message-1',
            model: 'test-model',
            idempotencyKey: 'message-1',
            execution: execution(),
        };
        const first = await memoryJobProvider.createJob(params);
        await memoryJobProvider.completeJob(first, 'done');
        const replay = await memoryJobProvider.createJob(params);
        const retry = await memoryJobProvider.createJob({
            ...params,
            idempotencyKey: 'message-1:user-retry-2',
        });

        expect(replay).toBe(first);
        expect(retry).not.toBe(first);
    });

    it('starts one model stream for duplicate background admissions', async () => {
        const encoder = new TextEncoder();
        const fetchMock = vi.fn(async () => new Response(
            new ReadableStream({
                start(controller) {
                    controller.enqueue(
                        encoder.encode(
                            'data: {"choices":[{"delta":{"content":"done"}}]}\n\n' +
                            'data: [DONE]\n\n'
                        )
                    );
                    controller.close();
                },
            })
        ));
        vi.stubGlobal('fetch', fetchMock);
        const params = {
            body: {
                _background: true,
                _threadId: 'thread-1',
                _messageId: 'message-1',
                model: 'test-model',
                messages: [],
                stream: true,
            },
            apiKey: 'user-api-key',
            userId: 'user-1',
            workspaceId: 'workspace-1',
            threadId: 'thread-1',
            messageId: 'message-1',
            referer: 'http://localhost:3000',
        };

        const [first, second] = await Promise.all([
            startBackgroundStream(params),
            startBackgroundStream(params),
        ]);
        expect(second.jobId).toBe(first.jobId);
        await vi.waitFor(async () => {
            expect(
                (await memoryJobProvider.getJob(first.jobId, 'user-1'))?.status
            ).toBe('complete');
        });
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('reclaims an expired lease, resets partial text, and fences the old worker', async () => {
        const jobId = await memoryJobProvider.createJob({
            userId: 'user-1',
            threadId: 'thread-1',
            messageId: 'message-1',
            model: 'test-model',
            execution: execution('checkpoint:'),
        });
        const now = Date.now();
        await memoryJobProvider.claimJob?.(jobId, 'worker-1', now, now + 10);
        await memoryJobProvider.updateJob(jobId, {
            contentChunk: 'partial',
            leaseOwner: 'worker-1',
        });

        const reclaimed = await memoryJobProvider.claimJob?.(
            jobId,
            'worker-2',
            now + 11,
            now + 100
        );
        expect(reclaimed).toMatchObject({
            content: 'checkpoint:',
            attempts: 2,
            leaseOwner: 'worker-2',
        });

        await expect(
            memoryJobProvider.updateJob(jobId, {
                contentChunk: 'stale',
                leaseOwner: 'worker-1',
            })
        ).rejects.toMatchObject({ name: 'BackgroundJobLeaseLostError' });
        await memoryJobProvider.updateJob(jobId, {
            contentChunk: 'resumed',
            leaseOwner: 'worker-2',
        });
        expect(await memoryJobProvider.getJob(jobId, 'user-1')).toMatchObject({
            content: 'checkpoint:resumed',
        });
    });

    it('decrypts and completes a reclaimed job through the lifecycle runner', async () => {
        const jobId = await memoryJobProvider.createJob({
            userId: 'user-1',
            threadId: 'thread-1',
            messageId: 'message-1',
            model: 'test-model',
            execution: execution('checkpoint:'),
        });
        const now = Date.now();
        await memoryJobProvider.claimJob?.(jobId, 'worker-1', now, now + 10);
        const reclaimed = await memoryJobProvider.claimJob?.(
            jobId,
            'worker-2',
            now + 11,
            now + 10_000
        );
        const execute = vi.fn(async (id, params, provider) => {
            expect(params.apiKey).toBe('user-api-key');
            expect(params.execution?.contentBase).toBe('checkpoint:');
            await provider.completeJob(id, 'checkpoint:resumed', params.leaseOwner);
        });

        await runClaimedBackgroundJob(reclaimed!, {
            provider: memoryJobProvider,
            encryptionKey: secret,
            execute,
            workerId: 'worker-2',
            now: () => now + 12,
            leaseMs: 10_000,
        });

        expect(execute).toHaveBeenCalledOnce();
        expect(await memoryJobProvider.getJob(jobId, 'user-1')).toMatchObject({
            status: 'complete',
            content: 'checkpoint:resumed',
        });
    });

    it('discovers and resumes an expired job during the startup reconciliation scan', async () => {
        const jobId = await memoryJobProvider.createJob({
            userId: 'user-1',
            threadId: 'thread-1',
            messageId: 'message-1',
            model: 'test-model',
            execution: execution(),
        });
        const now = Date.now();
        await memoryJobProvider.claimJob?.(
            jobId,
            'dead-worker',
            now,
            now + 10
        );
        const execute = vi.fn(async (id, params, provider) => {
            await provider.completeJob(id, 'recovered', params.leaseOwner);
        });

        await expect(
            reconcileBackgroundJobs({
                provider: memoryJobProvider,
                encryptionKey: secret,
                execute,
                workerId: 'new-process',
                now: () => now + 11,
                leaseMs: 10_000,
            })
        ).resolves.toBe(1);
        await vi.waitFor(async () => {
            expect(
                (await memoryJobProvider.getJob(jobId, 'user-1'))?.status
            ).toBe('complete');
        });
        expect(execute).toHaveBeenCalledOnce();
    });

    it('fails safely instead of replaying an uncheckpointed tool side effect', async () => {
        const jobId = await memoryJobProvider.createJob({
            userId: 'user-1',
            threadId: 'thread-1',
            messageId: 'message-1',
            model: 'test-model',
            execution: execution(),
            tool_calls: [
                { id: 'call-1', name: 'write_tool', status: 'loading' },
            ],
        });
        const now = Date.now();
        await memoryJobProvider.claimJob?.(jobId, 'worker-1', now, now + 10);
        const reclaimed = await memoryJobProvider.claimJob?.(
            jobId,
            'worker-2',
            now + 11,
            now + 10_000
        );
        const execute = vi.fn();

        await runClaimedBackgroundJob(reclaimed!, {
            provider: memoryJobProvider,
            encryptionKey: secret,
            execute,
            workerId: 'worker-2',
        });

        expect(execute).not.toHaveBeenCalled();
        expect(await memoryJobProvider.getJob(jobId, 'user-1')).toMatchObject({
            status: 'error',
            error: expect.stringContaining('avoid repeating a side effect'),
        });
    });
});
