import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundJob } from '../types';
import type { RequestUsage } from '../../../../shared/chat/compaction';
import {
    emitJobStatus,
    getJobLiveState,
    getJobReconcilerCount,
    initJobLiveState,
    registerJobReconciler,
    registerJobStream,
    resetJobViewersForTests,
} from '../viewers';

const usage: RequestUsage = {
    prompt_tokens: 42, completion_tokens: 7, model: 'model',
    request_id: 'request-1', iteration: 0, measured_at: 1,
    prefix_message_count: 1, prefix_hash: 'prefix', configuration_hash: 'config',
    input_estimate_tokens: 40,
};

const streamingJob = (): BackgroundJob => ({
    id: 'job-1', userId: 'user-1', threadId: 'thread-1', messageId: 'message-1',
    model: 'model', status: 'streaming', content: '', reasoning: '',
    chunksReceived: 0,
    startedAt: 1,
});

afterEach(() => {
    resetJobViewersForTests();
    vi.useRealTimers();
});

describe('job reconciliation', () => {
    // Failure modes: usage-only status loss, malformed metadata leaking onto the
    // wire, an unmeasured iteration erasing a measurement, and recovery reusing
    // a superseded attempt's measurement.
    it('retains and broadcasts normalized usage without requiring text progress', () => {
        const listener = vi.fn();
        registerJobStream('job-1', listener);
        emitJobStatus('job-1', 'streaming', {
            content: '', contentLength: 0, chunksReceived: 0, attempt: 0,
            usage: { ...usage, apiKey: 'must-not-leak' } as RequestUsage,
        });
        expect(getJobLiveState('job-1')?.usage).toEqual(usage);
        expect(listener.mock.lastCall?.[0].usage).toEqual(usage);
        emitJobStatus('job-1', 'complete', {
            content: '', contentLength: 0, chunksReceived: 0, attempt: 0,
        });
        expect(listener.mock.lastCall?.[0].usage).toEqual(usage);
    });

    it('ignores malformed usage without erasing an earlier valid measurement', () => {
        emitJobStatus('job-1', 'streaming', {
            content: '', contentLength: 0, chunksReceived: 0, usage,
        });
        emitJobStatus('job-1', 'complete', {
            content: 'answer', contentLength: 6, chunksReceived: 1,
            usage: { ...usage, prompt_tokens: -1 },
        });
        expect(getJobLiveState('job-1')?.usage).toEqual(usage);
        expect(getJobLiveState('job-1')?.content).toBe('answer');
    });

    it('clears usage on recovery and ignores stale-attempt measurements', () => {
        const listener = vi.fn();
        registerJobStream('job-1', listener);
        emitJobStatus('job-1', 'streaming', {
            content: '', contentLength: 0, chunksReceived: 0, attempt: 0, usage,
        });
        emitJobStatus('job-1', 'streaming', {
            content: '', contentLength: 0, chunksReceived: 0,
            attempt: 1, content_reset: true,
        });
        expect(getJobLiveState('job-1')?.usage).toBeUndefined();
        expect(listener.mock.lastCall?.[0].usage).toBeUndefined();
        const calls = listener.mock.calls.length;
        emitJobStatus('job-1', 'complete', {
            content: 'old', contentLength: 3, chunksReceived: 1, attempt: 0, usage,
        });
        expect(getJobLiveState('job-1')?.usage).toBeUndefined();
        expect(listener).toHaveBeenCalledTimes(calls);
    });

    it('restores only explicit checkpoint usage and replaces rather than sums iterations', () => {
        const listener = vi.fn();
        registerJobStream('job-1', listener);
        emitJobStatus('job-1', 'streaming', {
            content: '', contentLength: 0, chunksReceived: 0,
            attempt: 1, content_reset: true, usage,
        });
        const next = { ...usage, request_id: 'request-2', iteration: 1, prompt_tokens: 64 };
        for (let duplicate = 0; duplicate < 2; duplicate++) {
            emitJobStatus('job-1', 'streaming', {
                content: '', contentLength: 0, chunksReceived: 0, attempt: 1, usage: next,
            });
        }
        expect(getJobLiveState('job-1')?.usage).toEqual(next);
        expect(listener.mock.lastCall?.[0].usage).toEqual(next);
        emitJobStatus('job-1', 'streaming', {
            content: '', contentLength: 0, chunksReceived: 0, attempt: 1, usage,
        });
        expect(getJobLiveState('job-1')?.usage).toEqual(next);
        emitJobStatus('job-1', 'streaming', {
            content: '', contentLength: 0, chunksReceived: 0,
            attempt: 2, content_reset: true, usage,
        });
        expect(getJobLiveState('job-1')?.usage).toEqual(usage);
    });

    it('fences stale initialization and restores only explicit usage on a newer attempt', () => {
        emitJobStatus('job-1', 'streaming', {
            content: 'current', contentLength: 7, reasoning: 'current reasoning',
            chunksReceived: 1, attempt: 2, usage,
        });
        initJobLiveState('job-1', {
            contentBase: 'stale', reasoningBase: 'stale reasoning', attempt: 1,
            usage: { ...usage, prompt_tokens: 999 },
        });
        expect(getJobLiveState('job-1')).toMatchObject({
            content: 'current', reasoning: 'current reasoning', attempt: 2, usage,
        });
        initJobLiveState('job-1', {
            contentBase: 'recovered', reasoningBase: '', attempt: 3,
        });
        expect(getJobLiveState('job-1')).toMatchObject({ content: 'recovered', attempt: 3 });
        expect(getJobLiveState('job-1')?.usage).toBeUndefined();
        initJobLiveState('job-1', {
            contentBase: 'checkpoint', reasoningBase: '', attempt: 4, usage,
        });
        expect(getJobLiveState('job-1')).toMatchObject({ content: 'checkpoint', attempt: 4, usage });
    });

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
