import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundJob } from '../types';
import {
    emitJobStatus,
    getJobReconcilerCount,
    initJobLiveState,
    registerJobReconciler,
    registerJobStream,
    resetJobViewersForTests,
} from '../viewers';

const streamingJob = (): BackgroundJob => ({
    id: 'job-1', userId: 'user-1', threadId: 'thread-1', messageId: 'message-1',
    model: 'model', status: 'streaming', content: '', chunksReceived: 0,
    startedAt: 1,
});

afterEach(() => {
    resetJobViewersForTests();
    vi.useRealTimers();
});

describe('job reconciliation', () => {
    it('broadcasts an authoritative attempt reset to already-open streams', () => {
        const listener = vi.fn();
        const dispose = registerJobStream('job-1', listener);

        emitJobStatus('job-1', 'streaming', {
            content: '', contentLength: 0, chunksReceived: 0,
            attempt: 2, content_reset: true,
        });

        expect(listener).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'status', attempt: 2, content_reset: true, content: '',
            })
        );
        dispose();
    });

    it('shares one adaptive provider poller across all viewers', async () => {
        vi.useFakeTimers();
        initJobLiveState('job-1');
        const poll = vi.fn(async () => streamingJob());
        const first = vi.fn();
        const second = vi.fn();
        const disposeFirst = registerJobReconciler('job-1', poll, first);
        const disposeSecond = registerJobReconciler('job-1', poll, second);

        await vi.advanceTimersByTimeAsync(0);
        expect(getJobReconcilerCount()).toBe(1);
        expect(poll).toHaveBeenCalledTimes(1);
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(999);
        expect(poll).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(poll).toHaveBeenCalledTimes(2);

        disposeFirst();
        disposeSecond();
        expect(getJobReconcilerCount()).toBe(0);
    });
});
