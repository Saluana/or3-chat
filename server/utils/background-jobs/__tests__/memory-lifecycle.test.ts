import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllJobs, memoryJobProvider } from '../providers/memory';
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
import { backgroundJobClientToolIdentity } from '../client-tool-identity';
import { backgroundClientToolDigest } from '~~/shared/chat/background-client-tool-claim';
import { getChatJobExecution } from '../types';
import type { JobUpdate } from '../types';
import type { RequestUsage } from '~~/shared/chat/compaction';
import { createNormalizedStreamState } from '~~/shared/chat/normalized-stream-reducer';
import { registerSyncGatewayAdapter } from '~~/server/sync/gateway/registry';
import { registerAuthWorkspaceStore } from '~~/server/auth/store/registry';
import type { SyncGatewayAdapter } from '~~/server/sync/gateway/types';
import type { AuthWorkspaceStore } from '~~/server/auth/store/types';


const config = vi.hoisted(() => ({
    maxConcurrentJobs: 2,
    maxConcurrentJobsPerUser: 2,
    jobTimeoutMs: 300_000,
    completedJobRetentionMs: 300_000,
}));

vi.mock('#imports', () => ({
    useRuntimeConfig: () => ({
        public: { sync: { provider: 'memory' } },
    }),
}));

vi.mock('../store', () => ({
    getJobConfig: () => config,
    getJobProvider: async () => memoryJobProvider,
    getBackgroundJobEncryptionKey: () => secret,
    isBackgroundStreamingEnabled: () => true,
}));

vi.mock('../history', () => ({
    assertBackgroundHistoryProvider: vi.fn(),
    reconcileBackgroundJobHistory: vi.fn(async (provider, job) => {
        if (job.historyPhase === 'admission_pending') {
            await provider.setHistoryPhase(job.id, 'ready', {
                from: ['admission_pending'],
            });
            return 'ready';
        }
        if (job.historyPhase === 'finalization_pending') {
            await provider.setHistoryPhase(job.id, 'committed', {
                from: ['finalization_pending'],
            });
            return 'committed';
        }
        return 'unchanged';
    }),
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
        // Lifecycle cases execute an authorized, unowned canonical chat. The
        // scoped-provider suite owns project changes and permission failures.
        registerSyncGatewayAdapter({ id: 'memory', create: () => ({
            capabilities: { canonicalChatHistory: 'v1', projectOwnership: 'v1' },
            readChatHistory: async (_actor, query) => ({ status: 'ok', project_ownership: 'resolved',
                thread: query.kind === 'thread' ? { id: query.thread_id, clock: 1, project_id: null } : undefined }),
        } as SyncGatewayAdapter) });
        registerAuthWorkspaceStore({ id: 'memory', create: () => ({
            listUserWorkspaces: async () => [{ id: 'workspace-1', name: 'Fixture', role: 'owner' }],
        } as unknown as AuthWorkspaceStore) });
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

    it.each([true, false])('restores only checkpointed usage on reclaim (checkpoint=%s) and fences stale usage', async (checkpoint) => {
        const measurement = (prompt: number): RequestUsage => ({
            prompt_tokens: prompt, completion_tokens: 12, model: 'test-model', request_id: `request-${prompt}`,
            iteration: 1, measured_at: Date.now(), prefix_message_count: 1,
            prefix_hash: 'prefix', configuration_hash: 'configuration', input_estimate_tokens: 5,
        });
        const checkpointUsage = measurement(150);
        const jobId = await memoryJobProvider.createJob({
            userId: 'user-1', threadId: 'thread-1', messageId: 'message-1', model: 'test-model',
            execution: { ...execution('checkpoint:'), normalizedToolState: {
                ...createNormalizedStreamState(), ...(checkpoint ? { requestUsage: checkpointUsage } : {}),
            } },
        });
        const now = Date.now();
        await memoryJobProvider.claimJob!(jobId, 'worker-1', now, now + 10);
        await memoryJobProvider.updateJob(jobId, { usage: measurement(400), leaseOwner: 'worker-1' } as JobUpdate);
        expect((await memoryJobProvider.getJob(jobId, 'user-1') as unknown as { usage: RequestUsage }).usage).toMatchObject({ prompt_tokens: 400 });
        await memoryJobProvider.claimJob!(jobId, 'worker-2', now + 11, now + 60000);
        expect((await memoryJobProvider.getJob(jobId, 'user-1') as unknown as { usage?: RequestUsage }).usage).toEqual(checkpoint ? checkpointUsage : undefined);
        await expect(memoryJobProvider.updateJob(jobId, { usage: measurement(900), leaseOwner: 'worker-1' } as JobUpdate))
            .rejects.toMatchObject({ name: 'BackgroundJobLeaseLostError' });
        expect((await memoryJobProvider.getJob(jobId, 'user-1') as unknown as { usage?: RequestUsage }).usage).toEqual(checkpoint ? checkpointUsage : undefined);
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

        expect(
            results.filter((result) => result.status === 'fulfilled')
        ).toHaveLength(2);
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

    it('claims one browser tool executor and makes the settled job runnable', async () => {
        const pendingExecution = {
            ...execution(),
            pendingToolCalls: [
                {
                    id: 'call-1',
                    type: 'function' as const,
                    function: { name: 'client_tool', arguments: '{}' },
                },
            ],
            clientToolCall: {
                callId: 'call-1',
                name: 'client_tool',
                arguments: '{}',
                argumentFingerprint: 'fingerprint',
                definition: {
                    type: 'function' as const,
                    function: {
                        name: 'client_tool',
                        description: 'Client tool',
                        parameters: {
                            type: 'object' as const,
                            properties: {},
                        },
                    },
                    runtime: 'client' as const,
                },
            },
        };
        const jobId = await memoryJobProvider.createJob({
            userId: 'user-1',
            threadId: 'thread-1',
            messageId: 'message-1',
            model: 'test-model',
            execution: pendingExecution,
            tool_calls: [
                { id: 'call-1', name: 'client_tool', status: 'pending' },
            ],
        });

        await expect(
            memoryJobProvider.claimJob?.(jobId, 'worker', Date.now(), Date.now() + 30_000)
        ).resolves.toBeNull();
        const claimed = await memoryJobProvider.claimClientToolCall?.(
            jobId,
            'user-1',
            'call-1',
            'token-1',
            Date.now() + 30_000
        );
        expect(claimed && getChatJobExecution(claimed)?.clientToolCall?.claimToken).toBe('token-1');
        await expect(
            memoryJobProvider.claimClientToolCall?.(
                jobId,
                'user-1',
                'call-1',
                'token-2',
                Date.now() + 30_000
            )
        ).resolves.toBeNull();

        const settledExecution = {
            ...pendingExecution,
            pendingToolCalls: undefined,
            clientToolCall: undefined,
        };
        await expect(
            memoryJobProvider.settleClientToolCall?.(
                jobId,
                'user-1',
                'call-1',
                'token-1',
                settledExecution,
                [{ id: 'call-1', name: 'client_tool', status: 'complete', result: 'ok' }]
            )
        ).resolves.toBe(true);
        await expect(
            memoryJobProvider.claimJob?.(
                jobId,
                'worker',
                Date.now(),
                Date.now() + 30_000
            )
        ).resolves.toMatchObject({ execution: settledExecution });
    });

    it('binds approval settlement to the exact arguments reviewed at claim time', async () => {
        // Failure modes: approval identity mismatch (a result authorizing
        // arguments the user never reviewed) and the approval replacement
        // race (the pending call changing between claim and result).
        const toolDefinition = {
            type: 'function' as const,
            function: {
                name: 'client_tool',
                description: 'Client tool',
                parameters: { type: 'object' as const, properties: {} },
            },
            runtime: 'client' as const,
        };
        const jobId = await memoryJobProvider.createJob({
            userId: 'user-1',
            threadId: 'thread-1',
            messageId: 'message-1',
            model: 'test-model',
            execution: execution(),
            tool_calls: [
                { id: 'call-1', name: 'client_tool', status: 'pending' },
            ],
        });
        const now = Date.now();
        await memoryJobProvider.claimJob?.(jobId, 'worker', now, now + 30_000);
        await memoryJobProvider.updateJobExecution?.(
            jobId,
            {
                ...execution(),
                clientToolCall: {
                    callId: 'call-1',
                    name: 'client_tool',
                    arguments: '{"path":"a.txt"}',
                    argumentFingerprint: 'fingerprint-v1',
                    definition: toolDefinition,
                },
            },
            'worker'
        );

        const claimed = await memoryJobProvider.claimClientToolCall?.(
            jobId,
            'user-1',
            'call-1',
            'token-1',
            Date.now() + 30_000
        );
        // The claim snapshots the digest of the reviewed arguments.
        expect(
            (claimed ? getChatJobExecution(claimed) : undefined)?.clientToolCall?.claimFingerprint
        ).toBe('fingerprint-v1');

        // Simulate a re-park that carries the claim forward but swaps the
        // arguments (the dangerous case the digest binding must catch).
        const parkedJob = await memoryJobProvider.getJob(jobId, 'user-1');
        const parked = parkedJob ? getChatJobExecution(parkedJob) : undefined;
        await memoryJobProvider.updateJobExecution?.(
            jobId,
            {
                ...parked!,
                clientToolCall: {
                    ...parked!.clientToolCall!,
                    arguments: '{"path":"b.txt"}',
                    argumentFingerprint: 'fingerprint-v2',
                },
            },
            'worker'
        );

        // The stale approval must not authorize the new arguments.
        await expect(
            memoryJobProvider.settleClientToolCall?.(
                jobId,
                'user-1',
                'call-1',
                'token-1',
                { ...execution(), clientToolCall: undefined },
                [{ id: 'call-1', name: 'client_tool', status: 'complete' }]
            )
        ).resolves.toBe(false);
    });

    it('rejects a replaced approval and accepts a fresh claim on the new call', async () => {
        const toolDefinition = {
            type: 'function' as const,
            function: {
                name: 'client_tool',
                description: 'Client tool',
                parameters: { type: 'object' as const, properties: {} },
            },
            runtime: 'client' as const,
        };
        const park = (args: string, fingerprint: string) => ({
            ...execution(),
            clientToolCall: {
                callId: 'call-1',
                name: 'client_tool',
                arguments: args,
                argumentFingerprint: fingerprint,
                definition: toolDefinition,
            },
        });
        const jobId = await memoryJobProvider.createJob({
            userId: 'user-1',
            threadId: 'thread-1',
            messageId: 'message-1',
            model: 'test-model',
            execution: execution(),
            tool_calls: [
                { id: 'call-1', name: 'client_tool', status: 'pending' },
            ],
        });
        const now = Date.now();
        await memoryJobProvider.claimJob?.(jobId, 'worker', now, now + 30_000);
        await memoryJobProvider.updateJobExecution?.(
            jobId,
            park('{"path":"a.txt"}', 'fingerprint-v1'),
            'worker'
        );
        await memoryJobProvider.claimClientToolCall?.(
            jobId,
            'user-1',
            'call-1',
            'token-1',
            Date.now() + 30_000
        );

        // The worker re-parks the same call ID with new arguments (fresh
        // object, no claim) while the first approval is still outstanding.
        await memoryJobProvider.updateJobExecution?.(
            jobId,
            park('{"path":"b.txt"}', 'fingerprint-v2'),
            'worker'
        );

        // The old approval cannot settle the new call.
        await expect(
            memoryJobProvider.settleClientToolCall?.(
                jobId,
                'user-1',
                'call-1',
                'token-1',
                { ...execution(), clientToolCall: undefined },
                [{ id: 'call-1', name: 'client_tool', status: 'complete' }]
            )
        ).resolves.toBe(false);

        // A fresh claim on the current call works normally.
        await memoryJobProvider.claimClientToolCall?.(
            jobId,
            'user-1',
            'call-1',
            'token-2',
            Date.now() + 30_000
        );
        await expect(
            memoryJobProvider.settleClientToolCall?.(
                jobId,
                'user-1',
                'call-1',
                'token-2',
                { ...execution(), clientToolCall: undefined },
                [{ id: 'call-1', name: 'client_tool', status: 'complete' }]
            )
        ).resolves.toBe(true);
    });

    it('prevents duplicate and stale approval responses from authorizing work', async () => {
        // Failure modes: replay (same response submitted twice) and stale
        // (expired or wrong claim token).
        const toolDefinition = {
            type: 'function' as const,
            function: {
                name: 'client_tool',
                description: 'Client tool',
                parameters: { type: 'object' as const, properties: {} },
            },
            runtime: 'client' as const,
        };
        const makeJob = async (callId: string) => {
            const jobId = await memoryJobProvider.createJob({
                userId: 'user-1',
                threadId: 'thread-1',
                messageId: `message-${callId}`,
                model: 'test-model',
                execution: {
                    ...execution(),
                    clientToolCall: {
                        callId,
                        name: 'client_tool',
                        arguments: '{}',
                        argumentFingerprint: 'fingerprint',
                        definition: toolDefinition,
                    },
                },
                tool_calls: [
                    { id: callId, name: 'client_tool', status: 'pending' },
                ],
            });
            return jobId;
        };
        const settleWith = (jobId: string, callId: string, token: string) =>
            memoryJobProvider.settleClientToolCall?.(
                jobId,
                'user-1',
                callId,
                token,
                { ...execution(), clientToolCall: undefined },
                [{ id: callId, name: 'client_tool', status: 'complete' }]
            );

        // Replay: the second settlement with the same token must fail.
        const replayJob = await makeJob('call-replay');
        await memoryJobProvider.claimClientToolCall?.(
            replayJob,
            'user-1',
            'call-replay',
            'token-1',
            Date.now() + 30_000
        );
        await expect(
            settleWith(replayJob, 'call-replay', 'token-1')
        ).resolves.toBe(true);
        await expect(
            settleWith(replayJob, 'call-replay', 'token-1')
        ).resolves.toBe(false);

        // Stale: an already-expired claim cannot settle.
        const expiredJob = await makeJob('call-expired');
        await memoryJobProvider.claimClientToolCall?.(
            expiredJob,
            'user-1',
            'call-expired',
            'token-1',
            Date.now() - 1
        );
        await expect(
            settleWith(expiredJob, 'call-expired', 'token-1')
        ).resolves.toBe(false);

        // Wrong token: never authorizes.
        const wrongTokenJob = await makeJob('call-wrong');
        await memoryJobProvider.claimClientToolCall?.(
            wrongTokenJob,
            'user-1',
            'call-wrong',
            'token-1',
            Date.now() + 30_000
        );
        await expect(
            settleWith(wrongTokenJob, 'call-wrong', 'token-2')
        ).resolves.toBe(false);
    });

    it('keeps the aborted state when a late completion arrives after cancellation', async () => {
        // Failure mode: a remote run finishing after the bridge considers it
        // terminal must not resurrect or overwrite the recorded outcome. The
        // first terminal write wins; later ones are dropped and logged.
        const jobId = await memoryJobProvider.createJob({
            userId: 'user-1',
            threadId: 'thread-1',
            messageId: 'message-1',
            model: 'test-model',
            execution: execution(),
        });
        await expect(
            memoryJobProvider.abortJob(jobId, 'user-1')
        ).resolves.toBe(true);

        await memoryJobProvider.completeJob(jobId, 'late content');
        await memoryJobProvider.failJob(jobId, 'late error');
        await expect(
            memoryJobProvider.saveTerminalSnapshot?.(jobId, {
                status: 'complete',
                content: 'late snapshot',
                reasoning: '',
                completedAt: Date.now(),
            })
        ).resolves.toBe(false);

        expect(await memoryJobProvider.getJob(jobId, 'user-1')).toMatchObject({
            status: 'aborted',
        });
    });

    it('rejects abort of non-streaming, missing, and foreign jobs', async () => {
        const jobId = await memoryJobProvider.createJob({
            userId: 'user-1',
            threadId: 'thread-1',
            messageId: 'message-1',
            model: 'test-model',
            execution: execution(),
        });
        await memoryJobProvider.completeJob(jobId, 'done');
        await expect(
            memoryJobProvider.abortJob(jobId, 'user-1')
        ).resolves.toBe(false);
        await expect(
            memoryJobProvider.abortJob('missing-job', 'user-1')
        ).resolves.toBe(false);
        await expect(
            memoryJobProvider.abortJob(jobId, 'user-2')
        ).resolves.toBe(false);
    });

    it('isolates overlapping admissions: cancelling one leaves the other running', async () => {
        // Failure mode: concurrent runs must not cross-contaminate when
        // matched by admission/session identity.
        const toolDefinition = {
            type: 'function' as const,
            function: {
                name: 'client_tool',
                description: 'Client tool',
                parameters: { type: 'object' as const, properties: {} },
            },
            runtime: 'client' as const,
        };
        const jobA = await memoryJobProvider.createJob({
            userId: 'user-1',
            threadId: 'thread-1',
            messageId: 'message-a',
            model: 'test-model',
            idempotencyKey: 'admission-a',
            execution: execution(),
        });
        const jobB = await memoryJobProvider.createJob({
            userId: 'user-1',
            threadId: 'thread-1',
            messageId: 'message-b',
            model: 'test-model',
            idempotencyKey: 'admission-b',
            execution: {
                ...execution(),
                clientToolCall: {
                    callId: 'call-b',
                    name: 'client_tool',
                    arguments: '{}',
                    argumentFingerprint: 'fingerprint-b',
                    definition: toolDefinition,
                },
            },
            tool_calls: [
                { id: 'call-b', name: 'client_tool', status: 'pending' },
            ],
        });

        await expect(
            memoryJobProvider.cancelAdmission!('user-1', 'admission-a')
        ).resolves.toMatchObject({
            aborted: true,
            jobId: jobA,
            pending: false,
        });
        expect(
            (await memoryJobProvider.getJob(jobB, 'user-1'))?.status
        ).toBe('streaming');

        // The surviving run's approval flow is unaffected.
        const claimed = await memoryJobProvider.claimClientToolCall?.(
            jobB,
            'user-1',
            'call-b',
            'token-b',
            Date.now() + 30_000
        );
        expect((claimed ? getChatJobExecution(claimed) : undefined)?.clientToolCall?.claimToken).toBe('token-b');
        await expect(
            memoryJobProvider.settleClientToolCall?.(
                jobB,
                'user-1',
                'call-b',
                'token-b',
                { ...execution(), clientToolCall: undefined },
                [{ id: 'call-b', name: 'client_tool', status: 'complete' }]
            )
        ).resolves.toBe(true);
    });

    it.each(['arguments', 'name', 'definition'] as const)('atomically rejects changed %s even when diagnostic digest and token are retained', async (field) => {
        const jobId = await memoryJobProvider.createJob({ userId: 'user-1', threadId: 'thread-1',
            messageId: 'message-1', model: 'test-model', execution: execution() });
        const now = Date.now();
        await memoryJobProvider.claimJob!(jobId, 'worker', now, now + 30_000);
        await memoryJobProvider.updateJobExecution!(jobId, { ...execution(), clientToolCall: {
            callId: 'call-bound', name: 'client_tool', arguments: '{"path":"a"}', argumentFingerprint: 'unchanged-diagnostic',
            definition: { type: 'function', function: { name: 'client_tool', description: 'Original', parameters: { type: 'object' } } },
        } }, 'worker');
        const before = (await memoryJobProvider.getJob(jobId, 'user-1'))!;
        const digest = backgroundClientToolDigest(backgroundJobClientToolIdentity(before)!);
        const token = `or3ct1.${digest}.00000000-0000-4000-8000-000000000000`;
        const claimed = (await memoryJobProvider.claimClientToolCall!(jobId, 'user-1', 'call-bound', token, now + 30_000))!;
        const changed = getChatJobExecution(claimed)!;
        const call = changed.clientToolCall!;
        if (field === 'arguments') call.arguments = '{"path":"b"}';
        if (field === 'name') call.name = 'other_tool';
        if (field === 'definition') call.definition.function.description = 'Replaced';
        await memoryJobProvider.updateJobExecution!(jobId, changed, 'worker');
        await expect(memoryJobProvider.settleClientToolCall!(jobId, 'user-1', 'call-bound', token,
            { ...execution(), clientToolCall: undefined }, [])).resolves.toBe(false);
    });

    it('uses timeout as an inactivity watchdog rather than a runtime cap', async () => {
        vi.useFakeTimers();
        try {
            config.jobTimeoutMs = 1_000;
            vi.setSystemTime(new Date('2026-08-09T00:00:00.000Z'));
            const jobId = await memoryJobProvider.createJob({
                userId: 'user-1',
                threadId: 'thread-1',
                messageId: 'message-1',
                model: 'test-model',
                execution: execution(),
            });

            await vi.advanceTimersByTimeAsync(999);
            await memoryJobProvider.updateJob(jobId, {
                contentChunk: 'still working',
            });
            await vi.advanceTimersByTimeAsync(999);
            expect(await memoryJobProvider.cleanupExpired()).toBe(0);
            expect(
                (await memoryJobProvider.getJob(jobId, 'user-1'))?.status
            ).toBe('streaming');

            await vi.advanceTimersByTimeAsync(2);
            expect(await memoryJobProvider.cleanupExpired()).toBe(1);
            expect(
                await memoryJobProvider.getJob(jobId, 'user-1')
            ).toMatchObject({
                status: 'error',
                error: 'Job timed out',
            });
        } finally {
            clearAllJobs();
            vi.useRealTimers();
        }
    });

    it('aborts the upstream signal when a streaming job is stopped', async () => {
        const jobId = await memoryJobProvider.createJob({
            userId: 'user-1',
            threadId: 'thread-1',
            messageId: 'message-1',
            model: 'test-model',
            execution: execution(),
        });
        const abortSignal =
            memoryJobProvider.getAbortController?.(jobId)?.signal;

        expect(abortSignal?.aborted).toBe(false);
        await expect(memoryJobProvider.abortJob(jobId, 'user-1')).resolves.toBe(
            true
        );
        expect(abortSignal?.aborted).toBe(true);
        expect(await memoryJobProvider.getJob(jobId, 'user-1')).toMatchObject({
            status: 'aborted',
        });
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
        const fetchMock = vi.fn(
            async () =>
                new Response(
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
                )
        );
        vi.stubGlobal('fetch', fetchMock);
        const params = {
            body: {
                _background: true,
                _threadId: 'thread-1',
                _messageId: 'message-1',
                _backgroundAdmissionId: 'admission-1',
                _history: {
                    version: 1,
                    kind: 'new-turn',
                    admissionId: 'admission-1',
                    generationId: 'generation-1',
                    workspaceId: 'workspace-1',
                    threadId: 'thread-1',
                    messageId: 'message-1',
                    thread: { id: 'thread-1', clock: 1 },
                    userMessage: {
                        id: 'user-message-1',
                        thread_id: 'thread-1',
                        role: 'user',
                        clock: 1,
                    },
                    assistantMessage: {
                        id: 'message-1',
                        thread_id: 'thread-1',
                        role: 'assistant',
                        clock: 1,
                    },
                },
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
            await provider.completeJob(
                id,
                'checkpoint:resumed',
                params.leaseOwner
            );
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
        await memoryJobProvider.claimJob?.(jobId, 'dead-worker', now, now + 10);
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

    it('cancels an admission before its job commits so no work launches', async () => {
        await expect(
            memoryJobProvider.cancelAdmission!('user-1', 'admission-x')
        ).resolves.toMatchObject({ aborted: false, pending: true });

        await expect(
            memoryJobProvider.createJob({
                userId: 'user-1',
                threadId: 'thread-1',
                messageId: 'message-1',
                model: 'test-model',
                idempotencyKey: 'admission-x',
            })
        ).rejects.toMatchObject({ name: 'AdmissionCancelledError' });

        await expect(memoryJobProvider.getActiveJobCount!()).resolves.toBe(0);
    });

    it('cancels a committed streaming job and keeps replay idempotent', async () => {
        const jobId = await memoryJobProvider.createJob({
            userId: 'user-1',
            threadId: 'thread-1',
            messageId: 'message-1',
            model: 'test-model',
            idempotencyKey: 'admission-y',
        });

        await expect(
            memoryJobProvider.cancelAdmission!('user-1', 'admission-y')
        ).resolves.toMatchObject({ aborted: true, jobId, pending: false });
        await expect(
            memoryJobProvider.getJob(jobId, 'user-1')
        ).resolves.toMatchObject({
            status: 'aborted',
            error: 'Cancelled by user',
        });

        // A duplicate admission returns the same terminal row, not new work.
        await expect(
            memoryJobProvider.createJob({
                userId: 'user-1',
                threadId: 'thread-1',
                messageId: 'message-1',
                model: 'test-model',
                idempotencyKey: 'admission-y',
            })
        ).resolves.toBe(jobId);
    });
});
