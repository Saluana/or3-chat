import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHookEngine, type HookEngine } from '~/core/hooks/hooks';
import type { RequestUsage } from '~~/shared/chat/compaction';
import { backgroundClientToolDigest } from '~~/shared/chat/background-client-tool-claim';

const pollJobStatusMock = vi.fn();
const subscribeBackgroundJobStreamMock = vi.fn();
const abortBackgroundJobMock = vi.fn();
const claimBackgroundClientToolMock = vi.fn();
const validateBackgroundClientToolClaimMock = vi.fn();
const submitBackgroundClientToolResultMock = vi.fn();
const executeToolMock = vi.fn();
const getToolMock = vi.fn();
const refreshCachedSessionContextMock = vi.fn();
const upsertMessageMock = vi.fn();
const notificationCreateMock = vi.fn();
const BackgroundJobPollErrorMock = vi.hoisted(
    () =>
        class BackgroundJobPollErrorMock extends Error {
            constructor(
                message: string,
                readonly kind: string,
                readonly retryable: boolean
            ) {
                super(message);
            }
        }
);

let sessionValue: any = null;

async function makeClientToolClaim(name = 'client_tool', ttl = 30_000) {
    const call = {
        id: 'call-1', name, arguments: '{}',
        definition: { type: 'function' as const, runtime: 'client' as const,
            function: { name, description: 'Client tool', parameters: { type: 'object' as const, properties: {} } } },
    };
    const context = { workspaceId: 'workspace-1', threadId: 'thread-1', messageId: 'msg-1' };
    const claimDigest = await backgroundClientToolDigest({ jobId: 'job-1', userId: 'user-1', ...context, call });
    return { claimToken: `or3ct1.${claimDigest}.d00d76db-9bd0-49e8-974f-e6096b9c2137`, claimDigest,
        claimExpiresAt: Date.now() + ttl, call, context };
}

const dbMock = {
    name: 'or3-db-workspace-a',
    tables: [{ name: 'messages' }],
    transaction: vi.fn(
        async (
            _mode: string,
            _tables: unknown,
            operation: () => Promise<unknown>
        ) => await operation()
    ),
    messages: {
        get: vi.fn(),
        put: vi.fn(),
    },
    kv: {
        get: vi.fn(),
    },
};
let activeDbMock = dbMock;
const measurement = (iteration = 1): RequestUsage => ({
    prompt_tokens: 180000 + iteration, completion_tokens: 42, model: 'test-model',
    request_id: `request-${iteration}`, iteration, measured_at: iteration,
    prefix_message_count: iteration + 2, prefix_hash: `prefix-${iteration}`,
    configuration_hash: 'configuration', input_estimate_tokens: 180000,
});

function makeStatus(
    status: 'streaming' | 'complete' | 'error' | 'aborted',
    overrides: Partial<Record<string, unknown>> = {}
) {
    return {
        id: 'job-1',
        status,
        threadId: 'thread-1',
        messageId: 'msg-1',
        model: 'test-model',
        chunksReceived: 1,
        startedAt: Date.now(),
        completedAt: status === 'streaming' ? undefined : Date.now(),
        content: status === 'streaming' ? 'partial' : 'final',
        content_delta: undefined,
        content_length: status === 'streaming' ? 7 : 5,
        ...overrides,
    };
}

vi.mock('~/utils/chat/openrouterStream', () => ({
    pollJobStatus: (...args: unknown[]) => pollJobStatusMock(...args),
    subscribeBackgroundJobStream: (...args: unknown[]) =>
        subscribeBackgroundJobStreamMock(...args),
    abortBackgroundJob: (...args: unknown[]) => abortBackgroundJobMock(...args),
    claimBackgroundClientTool: (...args: unknown[]) =>
        claimBackgroundClientToolMock(...args),
    validateBackgroundClientToolClaim: (...args: unknown[]) =>
        validateBackgroundClientToolClaimMock(...args),
    submitBackgroundClientToolResult: (...args: unknown[]) =>
        submitBackgroundClientToolResultMock(...args),
    BackgroundJobPollError: BackgroundJobPollErrorMock,
}));

vi.mock('~/utils/chat/tool-registry', () => ({
    useToolRegistry: () => ({
        getTool: (...args: unknown[]) => getToolMock(...args),
        executeTool: executeToolMock,
    }),
}));

vi.mock('~/db', () => ({
    upsert: {
        message: (...args: unknown[]) => upsertMessageMock(...args),
    },
}));

vi.mock('~/db/client', () => ({
    getDb: () => activeDbMock,
    getActiveWorkspaceId: () => 'workspace-1',
}));

vi.mock('~/core/notifications/notification-service', () => ({
    NotificationService: class NotificationServiceMock {
        private readonly userId: string;
        constructor(_db: unknown, _hooks: unknown, userId: string) {
            this.userId = userId;
        }
        async create(payload: unknown) {
            notificationCreateMock(this.userId, payload);
            return null;
        }
    },
}));

vi.mock('~/composables/auth/useSessionContext', () => ({
    getCachedSessionContext: () => sessionValue,
    refreshCachedSessionContext: () => refreshCachedSessionContextMock(),
}));

describe('backgroundJobs reattach + notifications', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
        localStorage.clear();
        sessionValue = null;
        (
            globalThis as typeof globalThis & { __OR3_TEST_CLIENT?: boolean }
        ).__OR3_TEST_CLIENT = true;
        dbMock.name = 'or3-db-workspace-a';
        activeDbMock = dbMock;

        dbMock.messages.get.mockResolvedValue({
            id: 'msg-1',
            role: 'assistant',
            thread_id: 'thread-1',
            data: { content: '' },
            pending: true,
            created_at: 1,
            updated_at: 1,
            clock: 1,
        });
        dbMock.messages.put.mockResolvedValue(undefined);
        dbMock.kv.get.mockResolvedValue(undefined);
        upsertMessageMock.mockResolvedValue(undefined);
        notificationCreateMock.mockResolvedValue(null);
        claimBackgroundClientToolMock.mockResolvedValue(null);
        validateBackgroundClientToolClaimMock.mockResolvedValue(undefined);
        submitBackgroundClientToolResultMock.mockResolvedValue(undefined);
        executeToolMock.mockResolvedValue({
            result: 'ok',
            toolName: 'client_tool',
            timedOut: false,
        });
        getToolMock.mockReturnValue({ definition: { runtime: 'client' } });

        const g = globalThis as typeof globalThis & {
            __NUXT_HOOKS__?: HookEngine;
        };
        g.__NUXT_HOOKS__ = createHookEngine();
    });

    afterEach(() => {
        (
            globalThis as typeof globalThis & { __OR3_TEST_CLIENT?: boolean }
        ).__OR3_TEST_CLIENT = undefined;
    });

    it('ignores stale streaming events after canonical finalization and completes without a missing-row warning', async () => {
        const { Or3DB } = await vi.importActual<typeof import('~/db/client')>('~/db/client');
        const db = new Or3DB(`background-finalized-${crypto.randomUUID()}`);
        await db.open();
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const workflowUpdate = vi.fn();
        (globalThis as typeof globalThis & { __NUXT_HOOKS__: HookEngine }).__NUXT_HOOKS__
            .addAction('workflow.execution:action:state_update', workflowUpdate);
        subscribeBackgroundJobStreamMock.mockImplementation(() => () => {});
        const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
        try {
            await db.messages.put({ id: 'msg-1', role: 'assistant', thread_id: 'thread-1', index: 1,
                pending: true, deleted: false, created_at: 1, updated_at: 1, clock: 1,
                data: { content: '', generation_id: 'generation-1', background_job_id: 'job-1' } });
            const tracker = mod.ensureBackgroundJobTracker({ jobId: 'job-1', userId: 'user-1', threadId: 'thread-1',
                messageId: 'msg-1', originDb: db, canonicalHistory: true, generationId: 'generation-1', useSse: true });
            const onUpdate = vi.fn(), onComplete = vi.fn();
            mod.subscribeBackgroundJob(tracker, { onUpdate, onComplete });
            const handlers = subscribeBackgroundJobStreamMock.mock.calls[0]![0] as { onStatus: (status: ReturnType<typeof makeStatus>) => void };
            const finalized = { id: 'msg-1', role: 'assistant' as const, thread_id: 'thread-1', index: 1,
                pending: false, deleted: false, created_at: 1, updated_at: 2, clock: 2,
                data: { content: 'finished', generation_id: 'generation-1', generation_state: 'complete',
                    background_job_id: 'job-1', background_job_status: 'complete' } };
            await db.messages.put(finalized);
            handlers.onStatus(makeStatus('streaming', { content: '', content_length: 0 }));
            await tracker.streamChain;
            handlers.onStatus(makeStatus('streaming', { content: 'outdated', content_length: 8 }));
            await tracker.streamChain;
            handlers.onStatus(makeStatus('streaming', { content: 'outdated', content_length: 8,
                tool_calls: [{ id: 'late-call', name: 'client_tool', runtime: 'client', status: 'pending' }] }));
            await tracker.streamChain;
            expect(onUpdate).not.toHaveBeenCalled();
            expect(claimBackgroundClientToolMock).not.toHaveBeenCalled();
            expect(executeToolMock).not.toHaveBeenCalled();
            expect(tracker.active).toBe(true);
            expect(await db.messages.get('msg-1')).toEqual(finalized);
            handlers.onStatus(makeStatus('complete', { content: 'original answer', content_length: 15,
                workflow_state: { type: 'workflow-execution', workflowId: 'wf', workflowName: 'Workflow', prompt: '',
                    executionState: 'completed', nodeStates: {}, executionOrder: [], currentNodeId: null,
                    finalOutput: 'original answer', version: 1 } }));
            await expect(tracker.completion).resolves.toMatchObject({ status: 'complete', content: 'original answer', canonicalFinalized: true });
            expect(onComplete).toHaveBeenCalledTimes(1);
            expect(onComplete.mock.calls[0]![0]).toMatchObject({ canonicalFinalized: true, content: 'original answer' });
            expect(onUpdate).not.toHaveBeenCalled();
            expect(workflowUpdate).not.toHaveBeenCalled();
            expect(await db.messages.get('msg-1')).toEqual(finalized);
            expect(JSON.stringify(warning.mock.calls)).not.toContain('status-terminal-persist-row-missing');
            expect(abortBackgroundJobMock).not.toHaveBeenCalled();
        } finally {
            mod.backgroundJobTrackers.forEach(mod.stopBackgroundJobTracking);
            mod.backgroundJobTrackers.clear();
            warning.mockRestore();
            db.close();
            await db.delete();
        }
    });

    it.each(['finalized', 'new generation', 'deleted'] as const)(
        'does not execute a claimed browser tool after its canonical row is %s',
        async (change) => {
            const { Or3DB } = await vi.importActual<typeof import('~/db/client')>('~/db/client');
            const db = new Or3DB(`background-claim-race-${crypto.randomUUID()}`);
            await db.open();
            sessionValue = { user: { id: 'user-1' } };
            subscribeBackgroundJobStreamMock.mockImplementation(() => () => {});
            let releaseClaim!: (claim: Awaited<ReturnType<typeof makeClientToolClaim>>) => void;
            claimBackgroundClientToolMock.mockReturnValue(new Promise((resolve) => { releaseClaim = resolve; }));
            const claim = await makeClientToolClaim();
            const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
            try {
                await db.messages.put({ id: 'msg-1', role: 'assistant', thread_id: 'thread-1', index: 1,
                    pending: true, deleted: false, created_at: 1, updated_at: 1, clock: 1,
                    data: { content: '', generation_id: 'generation-1', background_job_id: 'job-1' } });
                const tracker = mod.ensureBackgroundJobTracker({ jobId: 'job-1', userId: 'user-1', threadId: 'thread-1',
                    messageId: 'msg-1', workspaceId: 'workspace-1', originDb: db, canonicalHistory: true,
                    generationId: 'generation-1', useSse: true });
                const handlers = subscribeBackgroundJobStreamMock.mock.calls[0]![0] as { onStatus: (status: ReturnType<typeof makeStatus>) => void };
                handlers.onStatus(makeStatus('streaming', { tool_calls: [{ id: 'call-1', name: 'client_tool', status: 'pending', runtime: 'client' }] }));
                await vi.waitFor(() => expect(claimBackgroundClientToolMock).toHaveBeenCalledTimes(1));
                const row = (await db.messages.get('msg-1'))!;
                await db.messages.put(change === 'deleted' ? { ...row, deleted: true } : change === 'new generation'
                    ? { ...row, data: { ...(row.data as Record<string, unknown>), generation_id: 'generation-2' } }
                    : { ...row, pending: false });
                releaseClaim(claim);
                await new Promise((resolve) => setTimeout(resolve, 50));
                expect(executeToolMock).not.toHaveBeenCalled();
                expect(submitBackgroundClientToolResultMock).not.toHaveBeenCalled();
                expect(localStorage.getItem('or3:bg-client-tool:job-1:call-1')).toBeNull();
                expect(abortBackgroundJobMock).not.toHaveBeenCalled();
            } finally {
                mod.backgroundJobTrackers.forEach(mod.stopBackgroundJobTracking);
                mod.backgroundJobTrackers.clear();
                db.close();
                await db.delete();
            }
        }
    );

    it('does not dispatch an old pending tool from a workspace refresh after canonical completion', async () => {
        const { Or3DB } = await vi.importActual<typeof import('~/db/client')>('~/db/client');
        const db = new Or3DB(`background-refresh-race-${crypto.randomUUID()}`);
        await db.open();
        sessionValue = { user: { id: 'user-1' } };
        subscribeBackgroundJobStreamMock.mockImplementation(() => () => {});
        let releasePoll!: (status: ReturnType<typeof makeStatus>) => void;
        pollJobStatusMock.mockReturnValue(new Promise((resolve) => { releasePoll = resolve; }));
        const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
        try {
            await db.messages.put({ id: 'msg-1', role: 'assistant', thread_id: 'thread-1', index: 1,
                pending: true, deleted: false, created_at: 1, updated_at: 1, clock: 1,
                data: { content: '', generation_id: 'generation-1', background_job_id: 'job-1' } });
            mod.ensureBackgroundJobTracker({ jobId: 'job-1', userId: 'user-1', threadId: 'thread-1', messageId: 'msg-1',
                workspaceId: 'workspace-1', originDb: db, canonicalHistory: true, generationId: 'generation-1', useSse: true });
            mod.refreshPendingClientToolsForWorkspace('workspace-1');
            await vi.waitFor(() => expect(pollJobStatusMock).toHaveBeenCalledTimes(1));
            const row = (await db.messages.get('msg-1'))!;
            await db.messages.put({ ...row, pending: false });
            releasePoll(makeStatus('streaming', { tool_calls: [{ id: 'call-1', name: 'client_tool', status: 'pending', runtime: 'client' }] }));
            await new Promise((resolve) => setTimeout(resolve, 50));
            expect(claimBackgroundClientToolMock).not.toHaveBeenCalled();
            expect(executeToolMock).not.toHaveBeenCalled();
        } finally {
            mod.backgroundJobTrackers.forEach(mod.stopBackgroundJobTracking);
            mod.backgroundJobTrackers.clear();
            db.close();
            await db.delete();
        }
    });

    it('does not retry a pending browser tool after its canonical message completes', async () => {
        const { Or3DB } = await vi.importActual<typeof import('~/db/client')>('~/db/client');
        const db = new Or3DB(`background-retry-race-${crypto.randomUUID()}`);
        await db.open();
        sessionValue = { user: { id: 'user-1' } };
        getToolMock.mockReturnValue(undefined);
        subscribeBackgroundJobStreamMock.mockImplementation(() => () => {});
        const status = makeStatus('streaming', { tool_calls: [{ id: 'call-1', name: 'client_tool', status: 'pending', runtime: 'client' }] });
        pollJobStatusMock.mockResolvedValue(status);
        const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
        try {
            await db.messages.put({ id: 'msg-1', role: 'assistant', thread_id: 'thread-1', index: 1,
                pending: true, deleted: false, created_at: 1, updated_at: 1, clock: 1,
                data: { content: '', generation_id: 'generation-1', background_job_id: 'job-1' } });
            const tracker = mod.ensureBackgroundJobTracker({ jobId: 'job-1', userId: 'user-1', threadId: 'thread-1',
                messageId: 'msg-1', workspaceId: 'workspace-1', originDb: db, canonicalHistory: true,
                generationId: 'generation-1', useSse: true });
            const handlers = subscribeBackgroundJobStreamMock.mock.calls[0]![0] as { onStatus: (status: ReturnType<typeof makeStatus>) => void };
            handlers.onStatus(status);
            await tracker.streamChain;
            const row = (await db.messages.get('msg-1'))!;
            await db.messages.put({ ...row, pending: false });
            getToolMock.mockReturnValue({ definition: { runtime: 'client' } });
            await vi.waitFor(() => expect(pollJobStatusMock).toHaveBeenCalledTimes(1), { timeout: 4000 });
            await new Promise((resolve) => setTimeout(resolve, 50));
            expect(claimBackgroundClientToolMock).not.toHaveBeenCalled();
            expect(executeToolMock).not.toHaveBeenCalled();
        } finally {
            mod.backgroundJobTrackers.forEach(mod.stopBackgroundJobTracking);
            mod.backgroundJobTrackers.clear();
            db.close();
            await db.delete();
        }
    }, 6000);

    it.each(['streaming', 'complete'] as const)('does not let an old %s refresh interrupt a newer pending tool attempt', async (oldStatus) => {
        const { Or3DB } = await vi.importActual<typeof import('~/db/client')>('~/db/client');
        const db = new Or3DB(`background-tool-attempt-${crypto.randomUUID()}`);
        await db.open();
        sessionValue = { user: { id: 'user-1' } };
        subscribeBackgroundJobStreamMock.mockImplementation(() => () => {});
        let releaseClaim!: (claim: Awaited<ReturnType<typeof makeClientToolClaim>>) => void;
        claimBackgroundClientToolMock.mockReturnValue(new Promise((resolve) => { releaseClaim = resolve; }));
        const claim = await makeClientToolClaim();
        const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
        try {
            await db.messages.put({ id: 'msg-1', role: 'assistant', thread_id: 'thread-1', index: 1,
                pending: true, deleted: false, created_at: 1, updated_at: 1, clock: 1,
                data: { content: '', generation_id: 'generation-1', background_job_id: 'job-1', background_job_attempt: 2 } });
            const tracker = mod.ensureBackgroundJobTracker({ jobId: 'job-1', userId: 'user-1', threadId: 'thread-1',
                messageId: 'msg-1', workspaceId: 'workspace-1', originDb: db, canonicalHistory: true,
                generationId: 'generation-1', initialAttempt: 2, useSse: true });
            const handlers = subscribeBackgroundJobStreamMock.mock.calls[0]![0] as { onStatus: (status: ReturnType<typeof makeStatus>) => void };
            handlers.onStatus(makeStatus('streaming', { attempt: 2, tool_calls: [{ id: 'call-1', name: 'client_tool', status: 'pending', runtime: 'client' }] }));
            await vi.waitFor(() => expect(claimBackgroundClientToolMock).toHaveBeenCalledTimes(1));
            pollJobStatusMock.mockResolvedValue(makeStatus(oldStatus, { attempt: 1,
                tool_calls: [{ id: 'old-call', name: 'client_tool', status: 'pending', runtime: 'client' }] }));
            mod.refreshPendingClientToolsForWorkspace('workspace-1');
            await vi.waitFor(() => expect(pollJobStatusMock).toHaveBeenCalledTimes(1));
            await new Promise((resolve) => setTimeout(resolve, 50));
            expect(claimBackgroundClientToolMock).toHaveBeenCalledTimes(1);
            releaseClaim(claim);
            await vi.waitFor(() => expect(executeToolMock).toHaveBeenCalledTimes(1));
            await vi.waitFor(() => expect(submitBackgroundClientToolResultMock).toHaveBeenCalledTimes(1));
        } finally {
            mod.backgroundJobTrackers.forEach(mod.stopBackgroundJobTracking);
            mod.backgroundJobTrackers.clear();
            db.close();
            await db.delete();
        }
    });

    it('defers a browser tool on a temporary canonical read failure and retries it later', async () => {
        const { Or3DB } = await vi.importActual<typeof import('~/db/client')>('~/db/client');
        const db = new Or3DB(`background-tool-read-${crypto.randomUUID()}`);
        await db.open();
        sessionValue = { user: { id: 'user-1' } };
        subscribeBackgroundJobStreamMock.mockImplementation(() => () => {});
        const status = makeStatus('streaming', { tool_calls: [{ id: 'call-1', name: 'client_tool', status: 'pending', runtime: 'client' }] });
        pollJobStatusMock.mockResolvedValue(status);
        const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
        try {
            await db.messages.put({ id: 'msg-1', role: 'assistant', thread_id: 'thread-1', index: 1,
                pending: true, deleted: false, created_at: 1, updated_at: 1, clock: 1,
                data: { content: '', generation_id: 'generation-1', background_job_id: 'job-1' } });
            mod.ensureBackgroundJobTracker({ jobId: 'job-1', userId: 'user-1', threadId: 'thread-1', messageId: 'msg-1',
                workspaceId: 'workspace-1', originDb: db, canonicalHistory: true, generationId: 'generation-1', useSse: true });
            const reads = vi.spyOn(db.messages, 'get').mockRejectedValueOnce(new Error('temporary IndexedDB failure'));
            mod.refreshPendingClientToolsForWorkspace('workspace-1');
            await vi.waitFor(() => expect(reads).toHaveBeenCalledTimes(1));
            await new Promise((resolve) => setTimeout(resolve, 50));
            expect(claimBackgroundClientToolMock).not.toHaveBeenCalled();
            expect(submitBackgroundClientToolResultMock).not.toHaveBeenCalled();
            mod.refreshPendingClientToolsForWorkspace('workspace-1');
            await vi.waitFor(() => expect(claimBackgroundClientToolMock).toHaveBeenCalledTimes(1));
            reads.mockRestore();
        } finally {
            mod.backgroundJobTrackers.forEach(mod.stopBackgroundJobTracking);
            mod.backgroundJobTrackers.clear();
            db.close();
            await db.delete();
        }
    });

    it.each(['missing', 'malformed'] as const)('retains accepted usage after a failed write and %s later snapshots', async (laterUsage) => {
        subscribeBackgroundJobStreamMock.mockImplementation(() => () => {});
        const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
        const tracker = mod.ensureBackgroundJobTracker({ jobId: 'job-1', userId: 'user-1', threadId: 'thread-1',
            messageId: 'msg-1', initialAttempt: 2, useSse: true });
        const updates = vi.fn();
        mod.subscribeBackgroundJob(tracker, { onUpdate: updates });
        const handlers = subscribeBackgroundJobStreamMock.mock.calls[0]![0] as { onStatus: (status: ReturnType<typeof makeStatus>) => void };
        dbMock.messages.put.mockRejectedValueOnce(new Error('temporary local write failure'));
        handlers.onStatus(makeStatus('streaming', { content: '', content_length: 0, attempt: 2, usage: measurement(2) }));
        await tracker.streamChain;
        handlers.onStatus(makeStatus('streaming', { content: '', content_length: 0, attempt: 1, usage: measurement(1) }));
        await tracker.streamChain;
        handlers.onStatus(makeStatus('complete', { attempt: 2,
            ...(laterUsage === 'malformed' ? { usage: { ...measurement(3), completion_tokens: -1 } } : {}) }));
        await tracker.completion;
        expect(updates.mock.calls.map(([update]) => update.status.usage)).toEqual([measurement(2), measurement(2)]);
        expect(dbMock.messages.put.mock.lastCall?.[0]).toMatchObject({ data: { usage: measurement(2) } });
        expect(dbMock.messages.put).toHaveBeenCalledTimes(2);
        mod.stopBackgroundJobTracking(tracker);
        mod.backgroundJobTrackers.clear();
    });

    it('retains terminal usage when the full-content refetch has no measurement', async () => {
        subscribeBackgroundJobStreamMock.mockImplementation(() => () => {});
        pollJobStatusMock.mockResolvedValue(makeStatus('complete', { content: 'full answer', content_length: 11 }));
        const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
        const tracker = mod.ensureBackgroundJobTracker({ jobId: 'job-1', userId: 'user-1', threadId: 'thread-1',
            messageId: 'msg-1', useSse: true });
        const handlers = subscribeBackgroundJobStreamMock.mock.calls[0]![0] as { onStatus: (status: ReturnType<typeof makeStatus>) => void };
        handlers.onStatus(makeStatus('complete', { content: undefined, content_length: 11, usage: measurement(2) }));
        await expect(tracker.completion).resolves.toMatchObject({ content: 'full answer', usage: measurement(2) });
        expect(dbMock.messages.put.mock.lastCall?.[0]).toMatchObject({ data: { content: 'full answer', usage: measurement(2) } });
        mod.stopBackgroundJobTracking(tracker);
        mod.backgroundJobTrackers.clear();
    });

    it('does not regress the accepted iteration within one background attempt', async () => {
        subscribeBackgroundJobStreamMock.mockImplementation(() => () => {});
        const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
        const tracker = mod.ensureBackgroundJobTracker({ jobId: 'job-1', userId: 'user-1', threadId: 'thread-1',
            messageId: 'msg-1', initialAttempt: 1, useSse: true });
        const handlers = subscribeBackgroundJobStreamMock.mock.calls[0]![0] as { onStatus: (status: ReturnType<typeof makeStatus>) => void };
        handlers.onStatus(makeStatus('streaming', { attempt: 1, usage: measurement(2) }));
        await tracker.streamChain;
        handlers.onStatus(makeStatus('complete', { attempt: 1, usage: measurement(1) }));
        await expect(tracker.completion).resolves.toMatchObject({ usage: measurement(2) });
        expect(dbMock.messages.put.mock.lastCall?.[0]?.data.usage).toEqual(measurement(2));
        mod.stopBackgroundJobTracking(tracker);
        mod.backgroundJobTrackers.clear();
    });

    it.each([{ attempt: 2 }, { attempt: 1, content_reset: true }])('drops discarded usage after recovery even if its local write fails: %j', async (reset) => {
        subscribeBackgroundJobStreamMock.mockImplementation(() => () => {});
        const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
        const tracker = mod.ensureBackgroundJobTracker({ jobId: 'job-1', userId: 'user-1', threadId: 'thread-1',
            messageId: 'msg-1', initialAttempt: 1, useSse: true });
        const handlers = subscribeBackgroundJobStreamMock.mock.calls[0]![0] as { onStatus: (status: ReturnType<typeof makeStatus>) => void };
        handlers.onStatus(makeStatus('streaming', { attempt: 1, usage: measurement(1) }));
        await tracker.streamChain;
        const priorRow = dbMock.messages.put.mock.lastCall?.[0];
        dbMock.messages.get.mockResolvedValue(priorRow);
        dbMock.messages.put.mockRejectedValueOnce(new Error('temporary local write failure'));
        handlers.onStatus(makeStatus('streaming', { ...reset, content: '', content_length: 0 }));
        await tracker.streamChain;
        handlers.onStatus(makeStatus('complete', { attempt: reset.attempt }));
        await expect(tracker.completion).resolves.not.toHaveProperty('usage', measurement(1));
        expect(dbMock.messages.put.mock.lastCall?.[0]?.data).not.toHaveProperty('usage');
        mod.stopBackgroundJobTracking(tracker);
        mod.backgroundJobTrackers.clear();
    });

    it('does not attach an earlier terminal event measurement to a newer attempt refetch', async () => {
        subscribeBackgroundJobStreamMock.mockImplementation(() => () => {});
        pollJobStatusMock.mockResolvedValue(makeStatus('complete', { attempt: 2, content: 'recovered', content_length: 9 }));
        const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
        const tracker = mod.ensureBackgroundJobTracker({ jobId: 'job-1', userId: 'user-1', threadId: 'thread-1',
            messageId: 'msg-1', initialAttempt: 1, useSse: true });
        const handlers = subscribeBackgroundJobStreamMock.mock.calls[0]![0] as { onStatus: (status: ReturnType<typeof makeStatus>) => void };
        handlers.onStatus(makeStatus('complete', { attempt: 1, content: undefined, content_length: 11, usage: measurement(1) }));
        await tracker.completion;
        expect(dbMock.messages.put.mock.lastCall?.[0]?.data).not.toHaveProperty('usage');
        mod.stopBackgroundJobTracking(tracker);
        mod.backgroundJobTrackers.clear();
    });

    it('retains a same-attempt reset instruction across a full-content refetch', async () => {
        subscribeBackgroundJobStreamMock.mockImplementation(() => () => {});
        pollJobStatusMock.mockResolvedValue(makeStatus('complete', { attempt: 1, content: 'recovered', content_length: 9 }));
        const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
        const tracker = mod.ensureBackgroundJobTracker({ jobId: 'job-1', userId: 'user-1', threadId: 'thread-1',
            messageId: 'msg-1', initialAttempt: 1, useSse: true });
        const handlers = subscribeBackgroundJobStreamMock.mock.calls[0]![0] as { onStatus: (status: ReturnType<typeof makeStatus>) => void };
        handlers.onStatus(makeStatus('streaming', { attempt: 1, usage: measurement(1) }));
        await tracker.streamChain;
        dbMock.messages.get.mockResolvedValue(dbMock.messages.put.mock.lastCall?.[0]);
        handlers.onStatus(makeStatus('complete', { attempt: 1, content_reset: true, content: undefined, content_length: 9 }));
        await tracker.completion;
        expect(dbMock.messages.put.mock.lastCall?.[0]?.data).not.toHaveProperty('usage');
        mod.stopBackgroundJobTracking(tracker);
        mod.backgroundJobTrackers.clear();
    });

    it('ignores a terminal full-content refetch from an older attempt', async () => {
        subscribeBackgroundJobStreamMock.mockImplementation(() => () => {});
        pollJobStatusMock.mockResolvedValue(makeStatus('complete', { attempt: 1, usage: measurement(1) }));
        const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
        const tracker = mod.ensureBackgroundJobTracker({ jobId: 'job-1', userId: 'user-1', threadId: 'thread-1',
            messageId: 'msg-1', initialAttempt: 1, useSse: true });
        const handlers = subscribeBackgroundJobStreamMock.mock.calls[0]![0] as { onStatus: (status: ReturnType<typeof makeStatus>) => void };
        handlers.onStatus(makeStatus('complete', { attempt: 2, content: undefined, content_length: 9, usage: measurement(2) }));
        await tracker.streamChain;
        expect(dbMock.messages.put).not.toHaveBeenCalled();
        expect(tracker.active).toBe(true);
        handlers.onStatus(makeStatus('complete', { attempt: 2, content: 'recovered', content_length: 9, usage: measurement(2) }));
        await tracker.completion;
        expect(dbMock.messages.put.mock.lastCall?.[0]?.data.usage).toEqual(measurement(2));
        mod.stopBackgroundJobTracking(tracker);
        mod.backgroundJobTrackers.clear();
    });

    it('restarts SSE when a detached polling job is reattached', async () => {
        pollJobStatusMock.mockResolvedValue(makeStatus('streaming'));
        subscribeBackgroundJobStreamMock.mockImplementation(() => () => {});

        const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
        const {
            ensureBackgroundJobTracker,
            subscribeBackgroundJob,
            stopBackgroundJobTracking,
            backgroundJobTrackers,
        } = mod;

        const tracker = ensureBackgroundJobTracker({
            jobId: 'job-1',
            userId: 'user-1',
            threadId: 'thread-1',
            messageId: 'msg-1',
            useSse: true,
        });

        const unsubscribeA = subscribeBackgroundJob(tracker, {});
        unsubscribeA();

        await new Promise((resolve) => setTimeout(resolve, 0));

        subscribeBackgroundJob(tracker, {});

        expect(subscribeBackgroundJobStreamMock).toHaveBeenCalledTimes(2);

        stopBackgroundJobTracking(tracker);
        backgroundJobTrackers.clear();
    });

    it.each([false, true])('executes a claimed client tool while detached with expired session cache=%s', async (expired) => {
        sessionValue = { user: { id: 'user-1' }, expiresAt: new Date(Date.now() + (expired ? -1000 : 60_000)).toISOString() };
        refreshCachedSessionContextMock.mockImplementation(async () => {
            sessionValue = { ...sessionValue, expiresAt: new Date(Date.now() + 60_000).toISOString() };
        });
        executeToolMock.mockImplementation(async () => {
            if (Date.parse(sessionValue.expiresAt) <= Date.now()) return { result: null, error: 'Workspace access changed.', timedOut: false };
            return { result: 'ok', timedOut: false };
        });
        let streamParams: { onStatus: (status: any) => void } | null = null;
        subscribeBackgroundJobStreamMock.mockImplementation((params) => {
            streamParams = params;
            return () => {};
        });
        const claim = await makeClientToolClaim();
        claimBackgroundClientToolMock.mockResolvedValue(claim);
        const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
        const tracker = mod.ensureBackgroundJobTracker({
            jobId: 'job-1',
            userId: 'user-1',
            threadId: 'thread-1',
            messageId: 'msg-1',
            workspaceId: 'workspace-1',
            useSse: true,
        });

        streamParams!.onStatus(
            makeStatus('streaming', {
                tool_calls: [
                    {
                        id: 'call-1',
                        name: 'client_tool',
                        status: 'pending',
                        runtime: 'client',
                        args: '{}',
                    },
                ],
            })
        );
        await vi.waitFor(() => {
            expect(submitBackgroundClientToolResultMock).toHaveBeenCalledWith({
                jobId: 'job-1',
                callId: 'call-1',
                claimToken: claim.claimToken,
                result: 'ok',
                error: undefined,
            });
        });
        expect(executeToolMock).toHaveBeenCalledWith(
            'client_tool',
            '{}',
            expect.objectContaining({ workspaceId: 'workspace-1' }),
            expect.objectContaining({
                definition: expect.objectContaining({ runtime: 'client' }),
            })
        );
        expect(refreshCachedSessionContextMock).toHaveBeenCalledTimes(expired ? 1 : 0);

        mod.stopBackgroundJobTracking(tracker);
        mod.backgroundJobTrackers.clear();
    });

    it.each(['arguments', 'name', 'callId', 'threadId', 'messageId'] as const)(
        'refuses a claimed tool whose %s changed without a new binding', async (changed) => {
            sessionValue = { user: { id: 'user-1' } };
            const claim = await makeClientToolClaim();
            if (changed === 'arguments') claim.call.arguments = '{"destination":"unexpected"}';
            if (changed === 'name') claim.call.name = 'unexpected_tool';
            if (changed === 'callId') claim.call.id = 'other-call';
            if (changed === 'threadId') claim.context.threadId = 'other-thread';
            if (changed === 'messageId') claim.context.messageId = 'other-message';
            claimBackgroundClientToolMock.mockResolvedValue(claim);
            let streamParams: any;
            subscribeBackgroundJobStreamMock.mockImplementation((params) => { streamParams = params; return () => {}; });
            const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
            const tracker = mod.ensureBackgroundJobTracker({ jobId: 'job-1', userId: 'user-1',
                threadId: 'thread-1', messageId: 'msg-1', workspaceId: 'workspace-1', useSse: true });
            streamParams.onStatus(makeStatus('streaming', { tool_calls: [
                { id: 'call-1', name: 'client_tool', status: 'pending', runtime: 'client', args: '{}' },
            ] }));
            await vi.waitFor(() => expect(claimBackgroundClientToolMock).toHaveBeenCalledTimes(1));
            // Digest validation is asynchronous; drain its promise chain before
            // asserting that no registry handler or result was authorized.
            await new Promise((resolve) => setTimeout(resolve, 30));
            expect(executeToolMock).not.toHaveBeenCalled();
            expect(submitBackgroundClientToolResultMock).not.toHaveBeenCalled();
            mod.stopBackgroundJobTracking(tracker);
            mod.backgroundJobTrackers.clear();
        }
    );

    it.each([
        ['running', undefined], ['settled', undefined],
        ['running', 'different-digest'], ['settled', 'different-digest'],
        ['corrupt-json', undefined], ['invalid-shape', undefined],
        ['expired-running', undefined], ['expired-settled', undefined],
    ] as const)('does not replay a %s journal bound to %s', async (state, claimDigest) => {
        sessionValue = { user: { id: 'user-1' } };
        claimBackgroundClientToolMock.mockResolvedValue(await makeClientToolClaim());
        localStorage.setItem('or3:bg-client-tool:job-1:call-1', state === 'corrupt-json' ? '{' : state === 'invalid-shape' ? 'null' : JSON.stringify({
            state: state.replace('expired-', ''), claimDigest, result: 'result-for-old-arguments',
            createdAt: Date.now() - (state.startsWith('expired-') ? 25 * 60 * 60 * 1000 : 0),
        }));
        let streamParams: any;
        subscribeBackgroundJobStreamMock.mockImplementation((params) => { streamParams = params; return () => {}; });
        const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
        const tracker = mod.ensureBackgroundJobTracker({ jobId: 'job-1', userId: 'user-1',
            threadId: 'thread-1', messageId: 'msg-1', workspaceId: 'workspace-1', useSse: true });
        streamParams.onStatus(makeStatus('streaming', { tool_calls: [
            { id: 'call-1', name: 'client_tool', status: 'pending', runtime: 'client', args: '{}' },
        ] }));
        await vi.waitFor(() => expect(submitBackgroundClientToolResultMock).toHaveBeenCalledTimes(1));
        expect(executeToolMock).not.toHaveBeenCalled();
        expect(submitBackgroundClientToolResultMock).toHaveBeenCalledWith(expect.objectContaining({
            result: undefined, error: expect.any(String),
        }));
        mod.stopBackgroundJobTracking(tracker);
        mod.backgroundJobTrackers.clear();
    });

    it('keeps a durable running journal when pre-execution revalidation fails', async () => {
        sessionValue = { user: { id: 'user-1' } };
        const claim = await makeClientToolClaim();
        claimBackgroundClientToolMock.mockResolvedValue(claim);
        validateBackgroundClientToolClaimMock.mockRejectedValue(new Error('Tool claim replaced'));
        executeToolMock.mockImplementation(async (_name, _args, _context, admission) => {
            try { await admission.beforeExecute(); }
            catch (error) { return { result: null, error: (error as Error).message, timedOut: false }; }
            throw new Error('Rejected revalidation must not reach the tool handler');
        });
        let streamParams: any;
        subscribeBackgroundJobStreamMock.mockImplementation((params) => { streamParams = params; return () => {}; });
        const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
        const tracker = mod.ensureBackgroundJobTracker({ jobId: 'job-1', userId: 'user-1',
            threadId: 'thread-1', messageId: 'msg-1', workspaceId: 'workspace-1', useSse: true });
        streamParams.onStatus(makeStatus('streaming', { tool_calls: [
            { id: 'call-1', name: 'client_tool', status: 'pending', runtime: 'client', args: '{}' },
        ] }));
        await vi.waitFor(() => expect(validateBackgroundClientToolClaimMock).toHaveBeenCalledTimes(1));
        await Promise.resolve();
        expect(JSON.parse(localStorage.getItem('or3:bg-client-tool:job-1:call-1')!))
            .toMatchObject({ state: 'running', claimDigest: claim.claimDigest });
        expect(submitBackgroundClientToolResultMock).not.toHaveBeenCalled();
        mod.stopBackgroundJobTracking(tracker);
        mod.backgroundJobTrackers.clear();
    });

    it('refreshes a waiting delegation and delivers its result after 30 seconds', async () => {
        sessionValue = { user: { id: 'user-1' } };
        const claim = { ...await makeClientToolClaim('delegate_chat', 120_000),
            parentModel: { model: 'test/sol', thinking: true, reasoningEffort: 'medium' } };
        claimBackgroundClientToolMock.mockResolvedValue(claim);
        let finish!: (value: unknown) => void;
        executeToolMock.mockImplementation(async (_name, _args, _context, admission) => {
            await admission.beforeExecute();
            return new Promise(resolve => { finish = resolve; });
        });
        let streamParams: any;
        subscribeBackgroundJobStreamMock.mockImplementation((params) => { streamParams = params; return () => {}; });
        const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
        const tracker = mod.ensureBackgroundJobTracker({ jobId: 'job-1', userId: 'user-1',
            threadId: 'thread-1', messageId: 'msg-1', workspaceId: 'workspace-1', useSse: true });
        try {
            streamParams.onStatus(makeStatus('streaming', { tool_calls: [
                { id: 'call-1', name: 'delegate_chat', status: 'pending', runtime: 'client', args: '{}' },
            ] }));
            await vi.waitFor(() => expect(validateBackgroundClientToolClaimMock).toHaveBeenCalledTimes(1));
            await vi.advanceTimersByTimeAsync(31_000);
            expect(validateBackgroundClientToolClaimMock).toHaveBeenCalledTimes(2);
            expect(submitBackgroundClientToolResultMock).not.toHaveBeenCalled();
            expect(executeToolMock.mock.calls[0]?.[2]).toMatchObject({ parentModel: claim.parentModel });
            finish({ result: 'child completed', timedOut: false });
            await vi.waitFor(() => expect(submitBackgroundClientToolResultMock).toHaveBeenCalledWith(expect.objectContaining({ result: 'child completed' })));
        } finally { mod.stopBackgroundJobTracking(tracker); mod.backgroundJobTrackers.clear(); vi.useRealTimers(); }
    });

    it('does not report completion when delegation heartbeat validation is lost', async () => {
        sessionValue = { user: { id: 'user-1' } };
        const claim = await makeClientToolClaim('delegate_chat', 120_000);
        claimBackgroundClientToolMock.mockResolvedValue(claim);
        validateBackgroundClientToolClaimMock.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Network unavailable'));
        let signal: AbortSignal | undefined;
        executeToolMock.mockImplementation(async (_name, _args, context, admission) => {
            signal = context.abortSignal;
            await admission.beforeExecute();
            return new Promise(resolve => signal!.addEventListener('abort', () => resolve({ error: 'cancelled', timedOut: false }), { once: true }));
        });
        let streamParams: any;
        subscribeBackgroundJobStreamMock.mockImplementation((params) => { streamParams = params; return () => {}; });
        const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
        const tracker = mod.ensureBackgroundJobTracker({ jobId: 'job-1', userId: 'user-1',
            threadId: 'thread-1', messageId: 'msg-1', workspaceId: 'workspace-1', useSse: true });
        try {
            streamParams.onStatus(makeStatus('streaming', { tool_calls: [
                { id: 'call-1', name: 'delegate_chat', status: 'pending', runtime: 'client', args: '{}' },
            ] }));
            await vi.waitFor(() => expect(validateBackgroundClientToolClaimMock).toHaveBeenCalledTimes(1));
            await vi.advanceTimersByTimeAsync(20_000);
            expect(signal?.aborted).toBe(true);
            expect(submitBackgroundClientToolResultMock).not.toHaveBeenCalled();
            expect(JSON.parse(localStorage.getItem('or3:bg-client-tool:job-1:call-1')!)).toMatchObject({ state: 'running' });
        } finally { mod.stopBackgroundJobTracking(tracker); mod.backgroundJobTrackers.clear(); vi.useRealTimers(); }
    });

    it('does not restore a late private result after logout scrubbed the journal', async () => {
        sessionValue = { user: { id: 'user-1' } };
        claimBackgroundClientToolMock.mockResolvedValue(await makeClientToolClaim());
        let finish!: (value: any) => void;
        executeToolMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
        let streamParams: any;
        subscribeBackgroundJobStreamMock.mockImplementation((params) => { streamParams = params; return () => {}; });
        const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
        const tracker = mod.ensureBackgroundJobTracker({ jobId: 'job-1', userId: 'user-1',
            threadId: 'thread-1', messageId: 'msg-1', workspaceId: 'workspace-1', useSse: true });
        streamParams.onStatus(makeStatus('streaming', { tool_calls: [
            { id: 'call-1', name: 'client_tool', status: 'pending', runtime: 'client', args: '{}' },
        ] }));
        await vi.waitFor(() => expect(executeToolMock).toHaveBeenCalledOnce());
        sessionValue = null;
        const key = 'or3:bg-client-tool:job-1:call-1';
        localStorage.setItem(key, JSON.stringify({ state: 'running' }));
        finish({ result: 'private late result', error: undefined });
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ state: 'running' });
        expect(submitBackgroundClientToolResultMock).not.toHaveBeenCalled();
        mod.stopBackgroundJobTracking(tracker);
        mod.backgroundJobTrackers.clear();
    });

    it.each(['streaming', 'complete'] as const)('replaces a pre-restart measured partial response with an unmeasured %s attempt', async (status) => {
        let streamParams: {
            onStatus: (status: ReturnType<typeof makeStatus>) => void;
        } | null = null;
        subscribeBackgroundJobStreamMock.mockImplementation((params) => {
            streamParams = params;
            return () => {};
        });
        const {
            ensureBackgroundJobTracker,
            subscribeBackgroundJob,
            stopBackgroundJobTracking,
            backgroundJobTrackers,
        } = await import('~/utils/chat/useAi-internal/backgroundJobs');
        const tracker = ensureBackgroundJobTracker({
            jobId: 'job-1',
            userId: 'user-1',
            threadId: 'thread-1',
            messageId: 'msg-1',
            initialContent: 'old partial response',
            initialAttempt: 1,
            useSse: true,
        });
        const onUpdate = vi.fn();
        subscribeBackgroundJob(tracker, { onUpdate });

        streamParams!.onStatus(makeStatus('streaming', {
            content: 'old partial response', content_length: 20, attempt: 1, usage: measurement(1),
        }));
        await tracker.streamChain;
        dbMock.messages.get.mockResolvedValue(dbMock.messages.put.mock.lastCall?.[0]);
        onUpdate.mockClear();

        streamParams!.onStatus(
            makeStatus(status, {
                content: 'new',
                content_length: 3,
                content_reset: true,
                attempt: 2,
            })
        );

        await vi.waitFor(() => {
            expect(tracker.lastContent).toBe('new');
            expect(onUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: 'new',
                    delta: '',
                    replace: true,
                })
            );
        });
        expect(dbMock.messages.put).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    content: 'new',
                    background_job_attempt: 2,
                }),
            })
        );
        expect(tracker.lastUsage).toBeUndefined();
        expect(dbMock.messages.put.mock.lastCall?.[0]?.data).not.toHaveProperty('usage');
        expect(dbMock.messages.put.mock.lastCall?.[0]?.pending).toBe(status === 'streaming');
        if (status === 'complete') {
            await expect(tracker.completion).resolves.toMatchObject({ status: 'complete', attempt: 2, content: 'new' });
        }

        stopBackgroundJobTracking(tracker);
        backgroundJobTrackers.clear();
    });

    it('replaces a longer reused tracker when storage has a newer shorter attempt', async () => {
        subscribeBackgroundJobStreamMock.mockImplementation(() => () => {});
        const {
            ensureBackgroundJobTracker,
            stopBackgroundJobTracking,
            backgroundJobTrackers,
        } = await import('~/utils/chat/useAi-internal/backgroundJobs');
        const tracker = ensureBackgroundJobTracker({
            jobId: 'job-1', userId: 'user-1', threadId: 'thread-1',
            messageId: 'msg-1', initialContent: 'old long response',
            initialAttempt: 1, useSse: true,
        });

        const reused = ensureBackgroundJobTracker({
            jobId: 'job-1', userId: 'user-1', threadId: 'thread-1',
            messageId: 'msg-1', initialContent: 'new', initialAttempt: 2,
            useSse: true,
        });

        expect(reused).toBe(tracker);
        expect(reused.lastAttempt).toBe(2);
        expect(reused.lastContent).toBe('new');
        stopBackgroundJobTracking(reused);
        backgroundJobTrackers.clear();
    });

    it('drops a stale transport status from an older attempt', async () => {
        let streamParams: {
            onStatus: (status: ReturnType<typeof makeStatus>) => void;
        } | null = null;
        subscribeBackgroundJobStreamMock.mockImplementation((params) => {
            streamParams = params;
            return () => {};
        });
        const {
            ensureBackgroundJobTracker,
            subscribeBackgroundJob,
            stopBackgroundJobTracking,
            backgroundJobTrackers,
        } = await import('~/utils/chat/useAi-internal/backgroundJobs');
        const tracker = ensureBackgroundJobTracker({
            jobId: 'job-1', userId: 'user-1', threadId: 'thread-1',
            messageId: 'msg-1', initialContent: 'new', initialAttempt: 2,
            useSse: true,
        });
        const onUpdate = vi.fn();
        const onComplete = vi.fn();
        subscribeBackgroundJob(tracker, { onUpdate, onComplete });

        streamParams!.onStatus(makeStatus('streaming', {
            content: 'stale old response', content_length: 18,
            content_reset: true, attempt: 1,
        }));
        streamParams!.onStatus(
            makeStatus('complete', {
                content: 'stale completed response',
                content_length: 24,
                attempt: 1,
            })
        );
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(tracker.lastAttempt).toBe(2);
        expect(tracker.lastContent).toBe('new');
        expect(onUpdate).not.toHaveBeenCalled();
        expect(onComplete).not.toHaveBeenCalled();
        stopBackgroundJobTracking(tracker);
        backgroundJobTrackers.clear();
    });

    it('honors a same-attempt content reset while priming', async () => {
        subscribeBackgroundJobStreamMock.mockImplementation(() => () => {});
        pollJobStatusMock.mockResolvedValue(makeStatus('streaming', {
            content: 'new', content_length: 3, content_reset: true, attempt: 2,
        }));
        const {
            ensureBackgroundJobTracker,
            primeBackgroundJobUpdate,
            stopBackgroundJobTracking,
            backgroundJobTrackers,
        } = await import('~/utils/chat/useAi-internal/backgroundJobs');
        const tracker = ensureBackgroundJobTracker({
            jobId: 'job-1', userId: 'user-1', threadId: 'thread-1',
            messageId: 'msg-1', initialContent: 'stale longer response',
            initialAttempt: 2, useSse: true,
        });

        await primeBackgroundJobUpdate(tracker);

        expect(tracker.lastContent).toBe('new');
        stopBackgroundJobTracking(tracker);
        backgroundJobTrackers.clear();
    });

    it.each(['running', 'settled', 'delivery-failed', 'plugin-startup'] as const)
    ('reconciles a client execution journal without replay after %s', async mode => {
        sessionValue = { user: { id: 'user-1' } };
        let streamParams: { onStatus: (status: ReturnType<typeof makeStatus>) => void };
        subscribeBackgroundJobStreamMock.mockImplementation(params => { streamParams = params; return () => {}; });
        const claim = await makeClientToolClaim();
        claimBackgroundClientToolMock.mockResolvedValue(claim);
        const journalKey = 'or3:bg-client-tool:job-1:call-1';
        if (mode === 'running' || mode === 'settled') localStorage.setItem(journalKey, JSON.stringify({
            state: mode, claimDigest: claim.claimDigest, createdAt: Date.now(), ...(mode === 'settled' ? { result: 'saved result' } : {}),
        }));
        if (mode === 'plugin-startup') getToolMock.mockReturnValue(undefined);
        if (mode === 'delivery-failed') submitBackgroundClientToolResultMock.mockRejectedValueOnce(new Error('disconnected'));
        const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
        const tracker = mod.ensureBackgroundJobTracker({ jobId: 'job-1', userId: 'user-1', threadId: 'thread-1',
            messageId: 'msg-1', workspaceId: 'workspace-1', useSse: true });
        const status = makeStatus('streaming', { tool_calls: [{ id: 'call-1', name: 'client_tool',
            status: 'pending', runtime: 'client', args: '{}' }] });
        streamParams!.onStatus(status);
        await tracker.streamChain;
        if (mode === 'plugin-startup') {
            expect(claimBackgroundClientToolMock).not.toHaveBeenCalled();
            expect(executeToolMock).not.toHaveBeenCalled();
            getToolMock.mockReturnValue({ definition: { runtime: 'client' } });
            streamParams!.onStatus(status);
        }
        await vi.waitFor(() => expect(submitBackgroundClientToolResultMock).toHaveBeenCalled());
        if (mode === 'delivery-failed') {
            await vi.waitFor(() => expect(JSON.parse(localStorage.getItem(journalKey)!)).toMatchObject({ state: 'settled', result: 'ok' }));
            streamParams!.onStatus(status);
            await vi.waitFor(() => expect(submitBackgroundClientToolResultMock).toHaveBeenCalledTimes(2));
        }
        await vi.waitFor(() => expect(localStorage.getItem(journalKey)).toBeNull());
        expect(executeToolMock).toHaveBeenCalledTimes(mode === 'running' || mode === 'settled' ? 0 : 1);
        expect(submitBackgroundClientToolResultMock.mock.lastCall?.[0]).toMatchObject({
            jobId: 'job-1', callId: 'call-1', claimToken: claim.claimToken,
            ...(mode === 'running' ? { error: expect.stringMatching(/outcome is unknown/) }
                : { result: mode === 'settled' ? 'saved result' : 'ok', error: undefined }),
        });
        mod.stopBackgroundJobTracking(tracker);
        mod.backgroundJobTrackers.clear();
    });

    it('does not publish an old terminal snapshot after another tab persisted a newer attempt', async () => {
        let streamParams: { onStatus: (status: any) => void } | undefined;
        subscribeBackgroundJobStreamMock.mockImplementation((params) => {
            streamParams = params;
            return () => {};
        });
        dbMock.messages.get.mockResolvedValue({
            id: 'msg-1', role: 'assistant', thread_id: 'thread-1', pending: true,
            data: { content: 'new partial', background_job_id: 'job-1', background_job_attempt: 2 },
        });
        const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
        const tracker = mod.ensureBackgroundJobTracker({
            jobId: 'job-1', userId: 'user-1', threadId: 'thread-1', messageId: 'msg-1',
            initialContent: 'old partial', initialAttempt: 1, useSse: true,
        });
        const onUpdate = vi.fn();
        const onComplete = vi.fn();
        mod.subscribeBackgroundJob(tracker, { onUpdate, onComplete });
        const journalKey = 'or3:bg-client-tool:job-1:current-call';
        const journal = JSON.stringify({ state: 'running', createdAt: Date.now() });
        localStorage.setItem(journalKey, journal);
        streamParams!.onStatus(makeStatus('complete', {
            content: 'old terminal answer', content_length: 19, attempt: 1,
            workflow_state: {
                type: 'workflow-execution', workflowId: 'old-workflow', workflowName: 'Old workflow',
                prompt: 'old prompt', executionState: 'completed', nodeStates: {}, executionOrder: [],
                currentNodeId: null, finalOutput: 'old output', version: 1,
            },
        }));
        await tracker.streamChain;
        expect(onUpdate).not.toHaveBeenCalled();
        expect(onComplete).not.toHaveBeenCalled();
        expect(tracker.active).toBe(true);
        expect(localStorage.getItem(journalKey)).toBe(journal);

        streamParams!.onStatus(makeStatus('complete', {
            content: 'new terminal answer', content_length: 19, content_reset: true, attempt: 2,
        }));
        await tracker.streamChain;
        expect(onComplete).toHaveBeenCalledTimes(1);
        expect(onComplete.mock.lastCall?.[0]).toMatchObject({ content: 'new terminal answer' });
        expect(onComplete.mock.lastCall?.[0].status.workflow_state).toBeUndefined();
        expect(localStorage.getItem(journalKey)).toBeNull();
        expect(mod.backgroundJobTrackers.has('job-1')).toBe(false);
        mod.stopBackgroundJobTracking(tracker);
    });

    it('clears stale persisted error fields when a job resumes streaming', async () => {
        let streamParams: {
            onStatus: (status: ReturnType<typeof makeStatus>) => void;
        } | null = null;
        subscribeBackgroundJobStreamMock.mockImplementation((params) => {
            streamParams = params;
            return () => {};
        });
        dbMock.messages.get.mockResolvedValue({
            id: 'msg-1', role: 'assistant', thread_id: 'thread-1',
            data: {
                content: 'old', error: 'old error',
                background_job_error: 'old error',
            },
            error: 'old error', pending: false, created_at: 1,
            updated_at: 1, clock: 1,
        });
        const {
            ensureBackgroundJobTracker,
            subscribeBackgroundJob,
            stopBackgroundJobTracking,
            backgroundJobTrackers,
        } = await import('~/utils/chat/useAi-internal/backgroundJobs');
        const tracker = ensureBackgroundJobTracker({
            jobId: 'job-1', userId: 'user-1', threadId: 'thread-1',
            messageId: 'msg-1', initialContent: 'old', initialAttempt: 1,
            useSse: true,
        });
        subscribeBackgroundJob(tracker, {});

        streamParams!.onStatus(makeStatus('streaming', {
            content: '', content_length: 0, content_reset: true, attempt: 2,
        }));
        await vi.waitFor(() => expect(dbMock.messages.put).toHaveBeenCalled());

        expect(dbMock.messages.put).toHaveBeenLastCalledWith(
            expect.objectContaining({
                error: null,
                data: expect.objectContaining({
                    error: null,
                    background_job_error: null,
                }),
            })
        );
        stopBackgroundJobTracking(tracker);
        backgroundJobTrackers.clear();
    });

    it('closes the live transport and resets tracking flags when stopped', async () => {
        const close = vi.fn();
        subscribeBackgroundJobStreamMock.mockImplementation(() => close);
        const {
            ensureBackgroundJobTracker,
            stopBackgroundJobTracking,
            backgroundJobTrackers,
        } = await import('~/utils/chat/useAi-internal/backgroundJobs');
        const tracker = ensureBackgroundJobTracker({
            jobId: 'job-1',
            userId: 'user-1',
            threadId: 'thread-1',
            messageId: 'msg-1',
            useSse: true,
        });

        stopBackgroundJobTracking(tracker);

        expect(close).toHaveBeenCalledTimes(1);
        expect(tracker).toMatchObject({
            active: false,
            polling: false,
            streaming: false,
            streamUnsubscribe: undefined,
        });
        backgroundJobTrackers.clear();
    });

    it('delivers primed abort state while isolating a throwing subscriber', async () => {
        subscribeBackgroundJobStreamMock.mockImplementation(() => () => {});
        pollJobStatusMock.mockResolvedValue(
            makeStatus('aborted', {
                content: 'partial',
                content_length: 7,
            })
        );
        const {
            ensureBackgroundJobTracker,
            stopBackgroundJobTracking,
            primeBackgroundJobUpdate,
            backgroundJobTrackers,
        } = await import('~/utils/chat/useAi-internal/backgroundJobs');
        const tracker = ensureBackgroundJobTracker({
            jobId: 'job-1',
            userId: 'user-1',
            threadId: 'thread-1',
            messageId: 'msg-1',
            useSse: true,
        });
        stopBackgroundJobTracking(tracker);
        const throwing = vi.fn(() => {
            throw new Error('subscriber failed');
        });
        const delivered = vi.fn();
        tracker.subscribers.add({ onAbort: throwing });
        tracker.subscribers.add({ onAbort: delivered });
        tracker.polling = true;

        await primeBackgroundJobUpdate(tracker);

        expect(throwing).toHaveBeenCalledTimes(1);
        expect(delivered).toHaveBeenCalledWith(
            expect.objectContaining({
                status: expect.objectContaining({ status: 'aborted' }),
                content: 'partial',
            })
        );
        expect(tracker.active).toBe(false);
        expect(tracker.polling).toBe(false);
        expect(backgroundJobTrackers.has('job-1')).toBe(false);
    });

    it('projects an abort without a server workflow snapshot into the stored card state', async () => {
        subscribeBackgroundJobStreamMock.mockImplementation(() => () => {});
        pollJobStatusMock.mockResolvedValue(
            makeStatus('aborted', {
                content: 'partial',
                content_length: 7,
                workflow_state: undefined
            })
        );
        dbMock.messages.get.mockResolvedValue({
            id: 'msg-1',
            role: 'assistant',
            thread_id: 'thread-1',
            pending: true,
            created_at: 1,
            updated_at: 1,
            clock: 1,
            data: {
                type: 'workflow-execution',
                workflowId: 'wf-1',
                workflowName: 'Workflow',
                prompt: 'run it',
                executionState: 'running',
                nodeStates: {},
                executionOrder: [],
                currentNodeId: 'writer',
                finalOutput: '',
                version: 4
            }
        });

        const {
            ensureBackgroundJobTracker,
            primeBackgroundJobUpdate,
            stopBackgroundJobTracking,
            backgroundJobTrackers
        } = await import('~/utils/chat/useAi-internal/backgroundJobs');
        const tracker = ensureBackgroundJobTracker({
            jobId: 'job-1',
            userId: 'user-1',
            threadId: 'thread-1',
            messageId: 'msg-1',
            useSse: true
        });
        stopBackgroundJobTracking(tracker);

        await primeBackgroundJobUpdate(tracker);

        expect(dbMock.messages.put).toHaveBeenCalledWith(
            expect.objectContaining({
                pending: false,
                data: expect.objectContaining({
                    executionState: 'stopped',
                    currentNodeId: null,
                    background_job_status: 'aborted'
                })
            })
        );
        expect(backgroundJobTrackers.has('job-1')).toBe(false);
    });

    it('does not cancel or drop a live server job when local persistence fails', async () => {
        let streamParams: {
            onStatus: (status: ReturnType<typeof makeStatus>) => void;
        } | null = null;
        subscribeBackgroundJobStreamMock.mockImplementation((params) => {
            streamParams = params;
            return () => {};
        });
        dbMock.messages.put.mockRejectedValueOnce(new Error('sync write failed'));

        const { ensureBackgroundJobTracker, subscribeBackgroundJob, stopBackgroundJobTracking, backgroundJobTrackers } =
            await import('~/utils/chat/useAi-internal/backgroundJobs');
        const tracker = ensureBackgroundJobTracker({
            jobId: 'job-1',
            userId: 'user-1',
            threadId: 'thread-1',
            messageId: 'msg-1',
            useSse: true
        });
        const onUpdate = vi.fn();
        subscribeBackgroundJob(tracker, { onUpdate });

        streamParams!.onStatus(
            makeStatus('streaming', {
                content: 'live content',
                content_length: 12
            })
        );

        await vi.waitFor(() => expect(onUpdate).toHaveBeenCalled());
        expect(backgroundJobTrackers.has('job-1')).toBe(true);
        expect(abortBackgroundJobMock).not.toHaveBeenCalled();

        stopBackgroundJobTracking(tracker);
        backgroundJobTrackers.clear();
    });

    it('uses one live reconciliation transport for multiple viewers of one job', async () => {
        subscribeBackgroundJobStreamMock.mockImplementation(() => () => {});
        const {
            ensureBackgroundJobTracker,
            subscribeBackgroundJob,
        } = await import('~/utils/chat/useAi-internal/backgroundJobs');
        const first = ensureBackgroundJobTracker({
            jobId: 'job-1', userId: 'user-1', threadId: 'thread-1',
            messageId: 'msg-1', useSse: true,
        });
        const second = ensureBackgroundJobTracker({
            jobId: 'job-1', userId: 'user-1', threadId: 'thread-1',
            messageId: 'msg-1', useSse: true,
        });
        subscribeBackgroundJob(first, {});
        subscribeBackgroundJob(second, {});

        expect(second).toBe(first);
        expect(first.subscribers.size).toBe(2);
        expect(subscribeBackgroundJobStreamMock).toHaveBeenCalledTimes(1);
        expect(pollJobStatusMock).not.toHaveBeenCalled();
    });

    it('does not fallback to polling when SSE closes after tracker reached terminal state', async () => {
        pollJobStatusMock.mockResolvedValue(makeStatus('streaming'));
        subscribeBackgroundJobStreamMock.mockImplementation(() => () => {});

        const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
        const { ensureBackgroundJobTracker, backgroundJobTrackers } = mod;

        const tracker = ensureBackgroundJobTracker({
            jobId: 'job-1',
            userId: 'user-1',
            threadId: 'thread-1',
            messageId: 'msg-1',
            useSse: true,
        });

        tracker.status = 'complete';
        tracker.active = false;
        const onErrorHandler = (
            subscribeBackgroundJobStreamMock.mock.calls[0]?.[0] as
                | { onError?: (error: Error) => void }
                | undefined
        )?.onError;
        onErrorHandler?.(new Error('SSE closed after completion'));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(pollJobStatusMock).not.toHaveBeenCalled();
        backgroundJobTrackers.clear();
    });

    it('stores one notification when the same job completes in concurrent or recreated trackers', async () => {
        vi.doUnmock('~/core/notifications/notification-service');
        const { Or3DB } = await vi.importActual<typeof import('~/db/client')>('~/db/client');
        const db = new Or3DB(`background-notification-${crypto.randomUUID()}`);
        await db.open();
        const otherTab = new Or3DB(db.name);
        await otherTab.open();
        try {
            const { emitBackgroundComplete } = await import('~/utils/chat/useAi-internal/backgroundJobNotifications');
            const tracker = { jobId: 'job-1', userId: 'user-1', workspaceId: 'workspace-1',
                threadId: 'thread-1', messageId: 'msg-1', originDb: db, subscribers: new Set() } as any;
            await Promise.all([emitBackgroundComplete(tracker, makeStatus('complete')),
                emitBackgroundComplete({ ...tracker, originDb: otherTab }, makeStatus('complete'))]);
            expect(await db.notifications.count()).toBe(1);
            const notification = (await db.notifications.toArray())[0]!;
            await db.notifications.update(notification.id, { deleted: true });
            await emitBackgroundComplete({ ...tracker }, makeStatus('complete'));
            expect(await db.notifications.count()).toBe(1);
            await emitBackgroundComplete({ ...tracker, jobId: 'job-2' }, makeStatus('complete'));
            await emitBackgroundComplete({ ...tracker, userId: 'user-2' }, makeStatus('complete'));
            expect(await db.notifications.count()).toBe(3);
        } finally {
            otherTab.close();
            await db.delete();
            vi.doMock('~/core/notifications/notification-service', () => ({
                NotificationService: class {
                    private readonly userId: string;
                    constructor(_db: unknown, _hooks: unknown, userId: string) { this.userId = userId; }
                    async create(payload: unknown) { notificationCreateMock(this.userId, payload); return null; }
                },
            }));
        }
    });

    it('uses tracker user scope for fallback completion notifications when session is unavailable', async () => {
        pollJobStatusMock.mockResolvedValue(
            makeStatus('complete', { content: 'done', content_length: 4 })
        );
        subscribeBackgroundJobStreamMock.mockImplementation(() => () => {});
        sessionValue = null;

        const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
        const { ensureBackgroundJobTracker, backgroundJobTrackers } = mod;

        const tracker = ensureBackgroundJobTracker({
            jobId: 'job-1',
            userId: 'real-user-123',
            threadId: 'thread-1',
            messageId: 'msg-1',
            useSse: false,
        });

        await tracker.completion;

        expect(notificationCreateMock).toHaveBeenCalledTimes(1);
        expect(notificationCreateMock.mock.calls[0]?.[0]).toBe('real-user-123');

        backgroundJobTrackers.clear();
    });

    it.each([
        ['fallback', 'before'], ['hook', 'before'],
        ['fallback', 'during mute read'], ['hook', 'during mute read'],
        ['fallback', 'during logout'], ['hook', 'during logout'],
    ] as const)('does not deliver a former account completion through %s after account access changes %s', async (delivery, timing) => {
        subscribeBackgroundJobStreamMock.mockImplementation(() => () => {});
        sessionValue = { authenticated: true, user: { id: 'origin-user' }, workspace: { id: 'workspace-1' } };
        const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
        const tracker = mod.ensureBackgroundJobTracker({ jobId: 'job-1', userId: 'origin-user',
            workspaceId: 'workspace-1', threadId: 'thread-1', messageId: 'msg-1', useSse: true });
        mod.stopBackgroundJobTracking(tracker);
        const hookDelivery = vi.fn();
        if (delivery === 'hook') {
            (globalThis as typeof globalThis & { __NUXT_HOOKS__: HookEngine }).__NUXT_HOOKS__
                .addAction('notify:action:push', hookDelivery);
        }
        const changeAccount = () => { sessionValue = timing === 'during logout' ? null : { authenticated: true, user: { id: 'next-user' }, workspace: { id: 'workspace-1' } }; };
        if (timing === 'before') changeAccount();
        else dbMock.kv.get.mockImplementationOnce(async () => { changeAccount(); return undefined; });
        const { emitBackgroundComplete } = await import('~/utils/chat/useAi-internal/backgroundJobNotifications');
        await emitBackgroundComplete(tracker, makeStatus('error', { error: 'origin-account-synthetic-private-detail' }));
        expect(hookDelivery).not.toHaveBeenCalled();
        expect(notificationCreateMock).not.toHaveBeenCalled();
        mod.backgroundJobTrackers.clear();
    });

    for (const delivery of ['fallback', 'hook'] as const) {
        it.each(['matching-conversation', 'foreign-conversation'] as const)(`retains the admitted tracker account before ${delivery} delivery when reuse requests a %s`, async conversation => {
            subscribeBackgroundJobStreamMock.mockImplementation(() => () => {});
            sessionValue = { authenticated: true, user: { id: 'origin-user' }, workspace: { id: 'workspace-1' } };
            const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
            const tracker = mod.ensureBackgroundJobTracker({ jobId: 'job-1', userId: 'origin-user', workspaceId: 'workspace-1',
                threadId: 'thread-1', messageId: 'msg-1', useSse: true });
            const hookDelivery = vi.fn();
            if (delivery === 'hook') {
                (globalThis as typeof globalThis & { __NUXT_HOOKS__: HookEngine }).__NUXT_HOOKS__.addAction('notify:action:push', hookDelivery);
            }
            sessionValue = { authenticated: true, user: { id: 'next-user' }, workspace: { id: 'workspace-2' } };
            try {
                mod.ensureBackgroundJobTracker({ jobId: 'job-1', userId: 'next-user', workspaceId: 'workspace-2',
                    threadId: conversation === 'matching-conversation' ? 'thread-1' : 'foreign-thread',
                    messageId: conversation === 'matching-conversation' ? 'msg-1' : 'foreign-message', useSse: true });
                const { emitBackgroundComplete } = await import('~/utils/chat/useAi-internal/backgroundJobNotifications');
                await emitBackgroundComplete(tracker, makeStatus('error', { error: 'synthetic-origin-account-private-detail' }));
                expect(hookDelivery).not.toHaveBeenCalled();
                expect(notificationCreateMock).not.toHaveBeenCalled();
                expect(tracker.userId).toBe('origin-user');
            } finally { mod.stopBackgroundJobTracking(tracker); mod.backgroundJobTrackers.clear(); }
        });
    }

    it.each(['same-account', 'late-account-binding'] as const)('retains admitted tracker account controls for %s', async binding => {
        subscribeBackgroundJobStreamMock.mockImplementation(() => () => {});
        const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
        const tracker = mod.ensureBackgroundJobTracker({ jobId: 'job-1', userId: binding === 'same-account' ? 'origin-user' : '',
            workspaceId: 'workspace-1', threadId: 'thread-1', messageId: 'msg-1', useSse: true });
        try {
            const reused = mod.ensureBackgroundJobTracker({ jobId: 'job-1', userId: 'origin-user', workspaceId: 'workspace-1',
                threadId: 'thread-1', messageId: 'msg-1', useSse: true });
            expect(reused).toBe(tracker);
            expect(tracker.userId).toBe('origin-user');
            expect(subscribeBackgroundJobStreamMock).toHaveBeenCalledTimes(1);
        } finally { mod.stopBackgroundJobTracking(tracker); mod.backgroundJobTrackers.clear(); }
    });

    it('does not mutate a tracker when reuse names a different conversation', async () => {
        subscribeBackgroundJobStreamMock.mockImplementation(() => () => {});
        const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
        const tracker = mod.ensureBackgroundJobTracker({ jobId: 'job-1', userId: '', workspaceId: 'workspace-1',
            threadId: 'thread-1', messageId: 'msg-1', initialAttempt: 1, initialContent: 'original', useSse: true });
        try {
            mod.ensureBackgroundJobTracker({ jobId: 'job-1', userId: 'other-user', workspaceId: 'workspace-1',
                threadId: 'other-thread', messageId: 'other-message', initialAttempt: 9,
                initialContent: 'different content that must not replace the original', useSse: true });
            expect(tracker).toMatchObject({ userId: '', threadId: 'thread-1', messageId: 'msg-1',
                lastAttempt: 1, lastContent: 'original' });
        } finally { mod.stopBackgroundJobTracking(tracker); mod.backgroundJobTrackers.clear(); }
    });

    it('skips local completion notifications when server notifications are preferred', async () => {
        pollJobStatusMock.mockResolvedValue(
            makeStatus('complete', { content: 'done', content_length: 4 })
        );
        subscribeBackgroundJobStreamMock.mockImplementation(() => () => {});
        sessionValue = null;

        const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
        const { ensureBackgroundJobTracker, backgroundJobTrackers } = mod;

        const tracker = ensureBackgroundJobTracker({
            jobId: 'job-1',
            userId: 'real-user-123',
            threadId: 'thread-1',
            messageId: 'msg-1',
            preferServerNotifications: true,
            useSse: false,
        });

        await tracker.completion;

        expect(notificationCreateMock).not.toHaveBeenCalled();
        backgroundJobTrackers.clear();
    });

    for (const delivery of ['fallback', 'hook'] as const) {
        it.each([[true, false], [false, true], [true, true], [false, false]] as const)(`uses originating workspace mute preferences through ${delivery} when origin=%s and current=%s`, async (originMuted, currentMuted) => {
            subscribeBackgroundJobStreamMock.mockImplementation(() => () => {});
            sessionValue = { authenticated: true, user: { id: 'origin-user' }, workspace: { id: 'workspace-1' } };
            const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
            const tracker = mod.ensureBackgroundJobTracker({ jobId: 'job-1', userId: 'origin-user', originDb: dbMock as never,
                workspaceId: 'workspace-1', threadId: 'thread-1', messageId: 'msg-1', useSse: true });
            mod.stopBackgroundJobTracking(tracker);
            const originLookup = dbMock.kv.get.mockImplementation(async key => key === 'notification_muted_threads:origin-user'
                ? { value: JSON.stringify(originMuted ? ['thread-1'] : []) } : undefined);
            const currentLookup = vi.fn(async () => ({ value: JSON.stringify(currentMuted ? ['thread-1'] : []) }));
            activeDbMock = { ...dbMock, name: 'or3-db-workspace-b', kv: { get: currentLookup } };
            sessionValue = { authenticated: true, user: { id: 'origin-user' }, workspace: { id: 'workspace-2' } };
            const hookDelivery = vi.fn();
            if (delivery === 'hook') {
                (globalThis as typeof globalThis & { __NUXT_HOOKS__: HookEngine }).__NUXT_HOOKS__.addAction('notify:action:push', hookDelivery);
            }
            try {
                const { emitBackgroundComplete } = await import('~/utils/chat/useAi-internal/backgroundJobNotifications');
                await emitBackgroundComplete(tracker, makeStatus('complete'));
                expect(notificationCreateMock).toHaveBeenCalledTimes(originMuted ? 0 : 1);
                expect(hookDelivery).not.toHaveBeenCalled();
                if (originMuted !== currentMuted) {
                    expect(originLookup).toHaveBeenCalledWith('notification_muted_threads:origin-user');
                    expect(currentLookup).not.toHaveBeenCalled();
                }
            } finally { mod.backgroundJobTrackers.clear(); }
        });
    }

    it('recovers originating mute preferences after a read failure without borrowing current-workspace preferences', async () => {
        subscribeBackgroundJobStreamMock.mockImplementation(() => () => {});
        sessionValue = { authenticated: true, user: { id: 'origin-user' }, workspace: { id: 'workspace-1' } };
        const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
        const tracker = mod.ensureBackgroundJobTracker({ jobId: 'job-1', userId: 'origin-user', originDb: dbMock as never,
            workspaceId: 'workspace-1', threadId: 'thread-1', messageId: 'msg-1', useSse: true });
        mod.stopBackgroundJobTracking(tracker);
        dbMock.kv.get.mockRejectedValueOnce(new Error('synthetic-origin-store-unavailable'))
            .mockResolvedValue({ value: JSON.stringify(['thread-1']) });
        const currentLookup = vi.fn(async () => ({ value: JSON.stringify(['thread-1']) }));
        activeDbMock = { ...dbMock, name: 'or3-db-workspace-b', kv: { get: currentLookup } };
        sessionValue = { authenticated: true, user: { id: 'origin-user' }, workspace: { id: 'workspace-2' } };
        try {
            const { emitBackgroundComplete } = await import('~/utils/chat/useAi-internal/backgroundJobNotifications');
            await emitBackgroundComplete(tracker, makeStatus('complete'));
            expect(notificationCreateMock).toHaveBeenCalledOnce(); // Preserve best-effort delivery on lookup failure.
            await emitBackgroundComplete(tracker, makeStatus('complete'));
            expect(notificationCreateMock).toHaveBeenCalledOnce(); // Recovered origin mute suppresses the retry.
            expect(currentLookup).not.toHaveBeenCalled();
        } finally { mod.backgroundJobTrackers.clear(); }
    });

    it.each(['origin-legacy-key', 'missing-origin-db'] as const)('preserves mute compatibility for %s', async compatibility => {
        subscribeBackgroundJobStreamMock.mockImplementation(() => () => {});
        sessionValue = { authenticated: true, user: { id: 'origin-user' }, workspace: { id: 'workspace-1' } };
        const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
        const tracker = mod.ensureBackgroundJobTracker({ jobId: 'job-1', userId: 'origin-user', originDb: dbMock as never,
            workspaceId: 'workspace-1', threadId: 'thread-1', messageId: 'msg-1', useSse: true });
        mod.stopBackgroundJobTracking(tracker);
        dbMock.kv.get.mockImplementation(async key => key === 'notification_muted_threads'
            ? { value: JSON.stringify(['thread-1']) } : undefined);
        const currentLookup = vi.fn(async () => ({ value: JSON.stringify(['thread-1']) }));
        activeDbMock = { ...dbMock, name: 'or3-db-workspace-b', kv: { get: currentLookup } };
        sessionValue = { authenticated: true, user: { id: 'origin-user' }, workspace: { id: 'workspace-2' } };
        try {
            const { emitBackgroundComplete } = await import('~/utils/chat/useAi-internal/backgroundJobNotifications');
            await emitBackgroundComplete(compatibility === 'missing-origin-db' ? { ...tracker, originDb: undefined } : tracker, makeStatus('complete'));
            expect(notificationCreateMock).not.toHaveBeenCalled();
            if (compatibility === 'origin-legacy-key') {
                expect(dbMock.kv.get).toHaveBeenCalledWith('notification_muted_threads');
                expect(currentLookup).not.toHaveBeenCalled();
            } else expect(currentLookup).toHaveBeenCalledWith('notification_muted_threads:origin-user');
        } finally { mod.backgroundJobTrackers.clear(); }
    });

    it('preserves detached completion notifications after the same account switches workspaces', async () => {
        subscribeBackgroundJobStreamMock.mockImplementation(() => () => {});
        const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
        const tracker = mod.ensureBackgroundJobTracker({ jobId: 'job-1', userId: 'origin-user',
            workspaceId: 'workspace-1', threadId: 'thread-1', messageId: 'msg-1', useSse: true });
        mod.stopBackgroundJobTracking(tracker);
        sessionValue = { authenticated: true, user: { id: 'origin-user' }, workspace: { id: 'workspace-2' } };
        const { emitBackgroundComplete } = await import('~/utils/chat/useAi-internal/backgroundJobNotifications');
        await emitBackgroundComplete(tracker, makeStatus('complete'));
        expect(notificationCreateMock).toHaveBeenCalledTimes(1);
        expect(notificationCreateMock.mock.calls[0]?.[0]).toBe('origin-user');
        mod.backgroundJobTrackers.clear();
    });

    it('runs terminal cleanup when priming a stopped tracker during reattach', async () => {
        subscribeBackgroundJobStreamMock.mockImplementation(() => () => {});
        pollJobStatusMock.mockResolvedValueOnce(
            makeStatus('complete', { content: 'done', content_length: 4 })
        );

        const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
        const {
            ensureBackgroundJobTracker,
            stopBackgroundJobTracking,
            primeBackgroundJobUpdate,
            backgroundJobTrackers,
        } = mod;

        const tracker = ensureBackgroundJobTracker({
            jobId: 'job-1',
            userId: 'real-user-123',
            threadId: 'thread-1',
            messageId: 'msg-1',
            useSse: true,
        });

        stopBackgroundJobTracking(tracker);
        await primeBackgroundJobUpdate(tracker);

        await expect(tracker.completion).resolves.toMatchObject({
            status: 'complete',
        });
        expect(dbMock.messages.put).toHaveBeenCalledTimes(1);
        expect(backgroundJobTrackers.has('job-1')).toBe(false);
    });

    it('keeps reconciling an active job after a transient transport outage', async () => {
        vi.useFakeTimers();
        const random = vi.spyOn(Math, 'random').mockReturnValue(0);
        try {
            pollJobStatusMock
                .mockRejectedValueOnce(
                    new BackgroundJobPollErrorMock(
                        'network temporarily unavailable',
                        'transport',
                        true
                    )
                )
                .mockResolvedValueOnce(
                    makeStatus('complete', {
                        content: 'done',
                        content_length: 4,
                    })
                );

            const {
                ensureBackgroundJobTracker,
                backgroundJobTrackers,
            } = await import('~/utils/chat/useAi-internal/backgroundJobs');
            const tracker = ensureBackgroundJobTracker({
                jobId: 'job-1',
                userId: 'user-1',
                threadId: 'thread-1',
                messageId: 'msg-1',
                useSse: false,
            });

            await vi.advanceTimersByTimeAsync(1_000);

            await expect(tracker.completion).resolves.toMatchObject({
                status: 'complete',
                content: 'done',
            });
            expect(pollJobStatusMock).toHaveBeenCalledTimes(2);
            expect(backgroundJobTrackers.has('job-1')).toBe(false);
        } finally {
            random.mockRestore();
            vi.useRealTimers();
        }
    });

    it('replays reconnecting state to reattached viewers and removes connectivity listeners on completion', async () => {
        subscribeBackgroundJobStreamMock.mockImplementation(() => () => {});
        let resolvePoll!: (value: ReturnType<typeof makeStatus>) => void;
        pollJobStatusMock.mockReturnValue(new Promise(resolve => { resolvePoll = resolve; }));
        const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
        const tracker = mod.ensureBackgroundJobTracker({ jobId: 'job-1', userId: 'user-1',
            threadId: 'thread-1', messageId: 'msg-1', useSse: true });
        const first = vi.fn(), reattached = vi.fn();
        mod.subscribeBackgroundJob(tracker, { onReconnecting: first });
        const handlers = subscribeBackgroundJobStreamMock.mock.calls[0]![0] as { onError: (error: Error) => void };
        handlers.onError(new Error('connection lost'));
        await vi.waitFor(() => expect(pollJobStatusMock).toHaveBeenCalledTimes(1));
        mod.subscribeBackgroundJob(tracker, { onReconnecting: reattached });
        expect(first.mock.calls.map(([value]) => value)).toEqual([false, true]);
        expect(reattached.mock.calls.map(([value]) => value)).toEqual([true]);
        expect(subscribeBackgroundJobStreamMock).toHaveBeenCalledTimes(2);
        const resumed = subscribeBackgroundJobStreamMock.mock.calls[1]![0] as { onStatus: (status: ReturnType<typeof makeStatus>) => void };
        resolvePoll(makeStatus('streaming'));
        resumed.onStatus(makeStatus('complete', { content: 'done', content_length: 4 }));
        await tracker.completion;
        expect(first.mock.calls.map(([value]) => value)).toEqual([false, true, false]);
        expect(reattached.mock.calls.map(([value]) => value)).toEqual([true, false]);
        window.dispatchEvent(new Event('offline'));
        expect(first).toHaveBeenCalledTimes(3);
        expect(pollJobStatusMock).toHaveBeenCalledTimes(1);
    });

    it('drains an accepted stream update before reconnecting after a rapid offline/online transition', async () => {
        subscribeBackgroundJobStreamMock.mockImplementation(() => () => {});
        pollJobStatusMock.mockReturnValue(new Promise(() => {}));
        let releaseWrite!: () => void;
        dbMock.messages.put.mockReturnValueOnce(new Promise<void>(resolve => { releaseWrite = resolve; }));
        const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
        const listeners = vi.spyOn(window, 'addEventListener');
        const tracker = mod.ensureBackgroundJobTracker({ jobId: 'job-1', userId: 'user-1',
            threadId: 'thread-1', messageId: 'msg-1', useSse: true });
        mod.subscribeBackgroundJob(tracker, {});
        const initial = subscribeBackgroundJobStreamMock.mock.calls[0]![0] as { onStatus: (status: ReturnType<typeof makeStatus>) => void };
        initial.onStatus(makeStatus('streaming', { content: 'first update', content_length: 12 }));
        await vi.waitFor(() => expect(dbMock.messages.put).toHaveBeenCalledTimes(1));
        const offline = listeners.mock.calls.find(([type]) => type === 'offline')![1] as EventListener;
        const online = listeners.mock.calls.find(([type]) => type === 'online')![1] as EventListener;
        offline(new Event('offline'));
        online(new Event('online'));
        await Promise.resolve();
        expect(subscribeBackgroundJobStreamMock).toHaveBeenCalledTimes(1);
        releaseWrite();
        await vi.waitFor(() => expect(subscribeBackgroundJobStreamMock).toHaveBeenCalledTimes(2));
        const resumed = subscribeBackgroundJobStreamMock.mock.calls[1]![0] as { onStatus: (status: ReturnType<typeof makeStatus>) => void };
        resumed.onStatus(makeStatus('complete', { content: 'first update and final', content_length: 22 }));
        await expect(tracker.completion).resolves.toMatchObject({ content: 'first update and final' });
        listeners.mockRestore();
    });

    it('preserves metadata written between background status updates', async () => {
        subscribeBackgroundJobStreamMock.mockImplementation(() => () => {});
        dbMock.messages.get
            .mockResolvedValueOnce({
                id: 'msg-1',
                role: 'assistant',
                thread_id: 'thread-1',
                data: { content: '' },
                pending: true,
                created_at: 1,
                updated_at: 1,
                clock: 1,
            })
            .mockResolvedValueOnce({
                id: 'msg-1',
                role: 'assistant',
                thread_id: 'thread-1',
                data: {
                    content: 'a',
                    plugin_metadata: { retained: true },
                },
                pending: true,
                created_at: 1,
                updated_at: 2,
                clock: 1,
            });

        const {
            ensureBackgroundJobTracker,
            subscribeBackgroundJob,
        } = await import('~/utils/chat/useAi-internal/backgroundJobs');
        const tracker = ensureBackgroundJobTracker({
            jobId: 'job-1',
            userId: 'user-1',
            threadId: 'thread-1',
            messageId: 'msg-1',
            useSse: true,
        });
        subscribeBackgroundJob(tracker, {});
        const handlers = subscribeBackgroundJobStreamMock.mock.calls[0]?.[0] as
            | { onStatus?: (status: ReturnType<typeof makeStatus>) => void }
            | undefined;

        handlers?.onStatus?.(
            makeStatus('streaming', {
                content: 'a',
                content_delta: 'a',
                content_length: 1,
            })
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        handlers?.onStatus?.(
            makeStatus('complete', {
                content: 'ab',
                content_delta: 'b',
                content_length: 2,
            })
        );
        await tracker.completion;

        expect(dbMock.messages.put.mock.calls.at(-1)?.[0]?.data).toMatchObject({
            content: 'ab',
            plugin_metadata: { retained: true },
        });
    });

    it('persists tool-only state transitions once per distinct fingerprint', async () => {
        subscribeBackgroundJobStreamMock.mockImplementation(() => () => {});
        const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
        const { ensureBackgroundJobTracker, subscribeBackgroundJob } = mod;
        const tracker = ensureBackgroundJobTracker({
            jobId: 'job-1', userId: 'user-1', threadId: 'thread-1',
            messageId: 'msg-1', useSse: true,
        });
        subscribeBackgroundJob(tracker, {});
        const handlers = subscribeBackgroundJobStreamMock.mock.calls[0]?.[0] as
            | { onStatus?: (status: ReturnType<typeof makeStatus>) => void }
            | undefined;
        const loading = makeStatus('streaming', {
            content: '', content_length: 0,
            tool_calls: [{ id: 'call-1', name: 'search', status: 'loading' }],
        });
        const complete = makeStatus('streaming', {
            content: '', content_length: 0,
            tool_calls: [{ id: 'call-1', name: 'search', status: 'complete', result: 'ok' }],
        });

        handlers?.onStatus?.(loading);
        await new Promise((resolve) => setTimeout(resolve, 0));
        handlers?.onStatus?.(complete);
        await new Promise((resolve) => setTimeout(resolve, 0));
        handlers?.onStatus?.(complete);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(dbMock.messages.put).toHaveBeenCalledTimes(2);
    });

    it('keeps persistence pinned to the originating DB after workspace changes', async () => {
        subscribeBackgroundJobStreamMock.mockImplementation(() => () => {});
        dbMock.messages.get.mockImplementation(async () =>
            dbMock.name === 'or3-db-workspace-a'
                ? {
                      id: 'msg-1',
                      role: 'assistant',
                      thread_id: 'thread-1',
                      data: { content: '' },
                      pending: true,
                      created_at: 1,
                      updated_at: 1,
                      clock: 1,
                  }
                : undefined
        );

        const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
        const {
            ensureBackgroundJobTracker,
            subscribeBackgroundJob,
            backgroundJobTrackers,
        } = mod;

        const tracker = ensureBackgroundJobTracker({
            jobId: 'job-1',
            userId: 'user-1',
            threadId: 'thread-1',
            messageId: 'msg-1',
            useSse: true,
        });

        subscribeBackgroundJob(tracker, {});

        const handlers = subscribeBackgroundJobStreamMock.mock.calls[0]?.[0] as
            | { onStatus?: (status: ReturnType<typeof makeStatus>) => void }
            | undefined;

        handlers?.onStatus?.(
            makeStatus('streaming', {
                content: 'a',
                content_delta: 'a',
                content_length: 1,
            })
        );
        await new Promise((resolve) => setTimeout(resolve, 0));

        const workspaceBDb = {
            name: 'or3-db-workspace-b',
            tables: [{ name: 'messages' }],
            transaction: vi.fn(
                async (
                    _mode: string,
                    _tables: unknown,
                    operation: () => Promise<unknown>
                ) => await operation()
            ),
            messages: { get: vi.fn(), put: vi.fn() },
            kv: { get: vi.fn() },
        };
        activeDbMock = workspaceBDb as typeof dbMock;
        handlers?.onStatus?.(
            makeStatus('complete', {
                content: 'ab',
                content_delta: 'b',
                content_length: 2,
                usage: measurement(2),
            })
        );
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(dbMock.messages.get).toHaveBeenCalledTimes(2);
        expect(dbMock.messages.put).toHaveBeenCalledTimes(2);
        expect(dbMock.messages.put.mock.lastCall?.[0]).toMatchObject({ data: { usage: measurement(2) } });
        expect(workspaceBDb.messages.get).not.toHaveBeenCalled();
        expect(workspaceBDb.messages.put).not.toHaveBeenCalled();
        expect(abortBackgroundJobMock).not.toHaveBeenCalled();
        expect(backgroundJobTrackers.has('job-1')).toBe(false);
    });

    it('stops tracking on a protocol failure without failing the generation', async () => {
        pollJobStatusMock.mockRejectedValue(
            new BackgroundJobPollErrorMock('malformed', 'protocol', false)
        );
        const { ensureBackgroundJobTracker, backgroundJobTrackers } =
            await import('~/utils/chat/useAi-internal/backgroundJobs');

        const tracker = ensureBackgroundJobTracker({
            jobId: 'job-1',
            userId: 'user-1',
            threadId: 'thread-1',
            messageId: 'msg-1',
        });

        await expect(tracker.completion).resolves.toMatchObject({
            trackingInterrupted: true,
            trackingInterruptedKind: 'protocol',
        });
        expect(backgroundJobTrackers.has('job-1')).toBe(false);
        // A protocol failure must not rewrite the assistant message.
        expect(dbMock.messages.put).not.toHaveBeenCalled();
    });

    it.each(['final reasoning', ''])('retains the full terminal snapshot including reasoning %j when the final write fails', async (reasoning) => {
        vi.useFakeTimers();
        try {
            const {
                ensureBackgroundJobTracker,
                primeBackgroundJobUpdate,
                backgroundJobTrackers,
            } = await import('~/utils/chat/useAi-internal/backgroundJobs');
            pollJobStatusMock.mockResolvedValue(makeStatus('complete', {
                content: 'final answer',
                content_length: 12,
                reasoning_text: reasoning,
                reasoning_reset: true,
                usage: measurement(2),
            }));
            subscribeBackgroundJobStreamMock.mockImplementation(() => () => {});
            dbMock.messages.put.mockRejectedValueOnce(
                new Error('indexeddb unavailable')
            );

            const tracker = ensureBackgroundJobTracker({
                jobId: 'job-1',
                userId: 'user-1',
                threadId: 'thread-1',
                messageId: 'msg-1',
                initialContent: 'partial',
                initialReasoning: 'old reasoning',
                useSse: true,
            });

            await primeBackgroundJobUpdate(tracker);

            // The generation is complete, but the failed local write must not
            // discard the final snapshot or the tracker.
            await expect(tracker.completion).resolves.toMatchObject({
                status: 'complete',
                usage: measurement(2),
            });
            expect(backgroundJobTrackers.has('job-1')).toBe(true);

            dbMock.messages.put.mockResolvedValue(undefined);
            await vi.advanceTimersByTimeAsync(2_000);

            expect(backgroundJobTrackers.has('job-1')).toBe(false);
            expect(dbMock.messages.put).toHaveBeenCalledTimes(2);
            expect(dbMock.messages.put.mock.lastCall?.[0]).toMatchObject({
                pending: false,
                data: { content: 'final answer', reasoning_text: reasoning, usage: measurement(2) },
            });
        } finally {
            vi.useRealTimers();
        }
    });
});
