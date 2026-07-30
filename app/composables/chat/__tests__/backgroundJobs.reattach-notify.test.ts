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
    getDb: () => activeDbMock,
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
        expect(dbMock.messages.put).toHaveBeenCalledTimes(1);
        expect(backgroundJobTrackers.has('job-1')).toBe(false);
    });

    it('re-reads the message row for each persisted SSE status update', async () => {
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

        expect(dbMock.messages.get).toHaveBeenCalledTimes(2);
        expect(dbMock.messages.put).toHaveBeenCalledTimes(2);
        expect(backgroundJobTrackers.has('job-1')).toBe(false);
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
            })
        );
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(dbMock.messages.get).toHaveBeenCalledTimes(2);
        expect(dbMock.messages.put).toHaveBeenCalledTimes(2);
        expect(workspaceBDb.messages.get).not.toHaveBeenCalled();
        expect(workspaceBDb.messages.put).not.toHaveBeenCalled();
        expect(abortBackgroundJobMock).not.toHaveBeenCalled();
        expect(backgroundJobTrackers.has('job-1')).toBe(false);
    });
});
