import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHookEngine, type HookEngine } from '~/core/hooks/hooks';

const pollJobStatusMock = vi.fn();
const subscribeBackgroundJobStreamMock = vi.fn();
const abortBackgroundJobMock = vi.fn();
const upsertMessageMock = vi.fn();
const notificationCreateMock = vi.fn();

let sessionValue: any = null;

const dbMock = {
    name: 'or3-db-workspace-a',
    messages: {
        get: vi.fn(),
    },
    kv: {
        get: vi.fn(),
    },
};

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
}));

vi.mock('~/db', () => ({
    upsert: {
        message: (...args: unknown[]) => upsertMessageMock(...args),
    },
}));

vi.mock('~/db/client', () => ({
    getDb: () => dbMock,
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
}));

describe('backgroundJobs reattach + notifications', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
        sessionValue = null;
        (
            globalThis as typeof globalThis & { __OR3_TEST_CLIENT?: boolean }
        ).__OR3_TEST_CLIENT = true;
        dbMock.name = 'or3-db-workspace-a';

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
        dbMock.kv.get.mockResolvedValue(undefined);
        upsertMessageMock.mockResolvedValue(undefined);
        notificationCreateMock.mockResolvedValue(null);

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
        expect(upsertMessageMock).toHaveBeenCalledTimes(1);
        expect(backgroundJobTrackers.has('job-1')).toBe(false);
    });

    it('reuses the cached message row across multiple SSE status updates', async () => {
        subscribeBackgroundJobStreamMock.mockImplementation(() => () => {});

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
        handlers?.onStatus?.(
            makeStatus('streaming', {
                content: 'ab',
                content_delta: 'b',
                content_length: 2,
            })
        );
        handlers?.onStatus?.(
            makeStatus('complete', {
                content: 'abc',
                content_delta: 'c',
                content_length: 3,
            })
        );

        await expect(tracker.completion).resolves.toMatchObject({
            status: 'complete',
            content: 'abc',
        });

        expect(dbMock.messages.get).toHaveBeenCalledTimes(1);
        expect(upsertMessageMock).toHaveBeenCalledTimes(2);
        expect(backgroundJobTrackers.has('job-1')).toBe(false);
    });

    it('re-reads the message row after the active workspace DB changes', async () => {
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

        dbMock.name = 'or3-db-workspace-b';
        handlers?.onStatus?.(
            makeStatus('complete', {
                content: 'ab',
                content_delta: 'b',
                content_length: 2,
            })
        );
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(dbMock.messages.get).toHaveBeenCalledTimes(2);
        expect(upsertMessageMock).toHaveBeenCalledTimes(1);
        expect(abortBackgroundJobMock).toHaveBeenCalledWith('job-1');
        expect(backgroundJobTrackers.has('job-1')).toBe(false);
    });
});
