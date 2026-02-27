import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHookEngine, type HookEngine } from '~/core/hooks/hooks';

const pollJobStatusMock = vi.fn();
const subscribeBackgroundJobStreamMock = vi.fn();
const abortBackgroundJobMock = vi.fn();
const upsertMessageMock = vi.fn();
const notificationCreateMock = vi.fn();

let sessionValue: any = null;

const dbMock = {
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
        let onErrorHandler: ((error: Error) => void) | null = null;
        subscribeBackgroundJobStreamMock.mockImplementation((params: unknown) => {
            onErrorHandler = (params as { onError?: (error: Error) => void }).onError ?? null;
            return () => {};
        });

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
});
