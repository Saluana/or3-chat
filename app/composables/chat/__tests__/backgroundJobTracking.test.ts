import { describe, it, expect, vi } from 'vitest';
import type { BackgroundJobStatus } from '~/utils/chat/openrouterStream';

describe('stopBackgroundJobTracking', () => {
    it('closes stream and resets tracking flags', async () => {
        vi.unmock('~/utils/chat/useAi-internal/backgroundJobs');
        const mod = await import('~/utils/chat/useAi-internal/backgroundJobs');
        const { stopBackgroundJobTracking } = mod;

        const close = vi.fn();
        const tracker: Parameters<typeof stopBackgroundJobTracking>[0] = {
            jobId: 'job-1',
            userId: 'user-1',
            threadId: 'thread-1',
            messageId: 'msg-1',
            status: 'streaming',
            lastContent: '',
            lastPersistedLength: 0,
            lastPersistAt: 0,
            polling: true,
            streaming: true,
            active: true,
            streamUnsubscribe: close,
            subscribers: new Set(),
            completion: Promise.resolve({} as BackgroundJobStatus),
            resolveCompletion: () => {},
        };

        stopBackgroundJobTracking(tracker);

        expect(close).toHaveBeenCalledTimes(1);
        expect(tracker.active).toBe(false);
        expect(tracker.polling).toBe(false);
        expect(tracker.streaming).toBe(false);
        expect(tracker.streamUnsubscribe).toBeUndefined();
    });
});
