import { describe, it, expect, vi } from 'vitest';

vi.mock('~/utils/chat/openrouterStream', async () => {
    const actual = await vi.importActual<typeof import('~/utils/chat/openrouterStream')>(
        '~/utils/chat/openrouterStream'
    );
    return {
        ...actual,
        pollJobStatus: vi.fn().mockResolvedValue({
            id: 'job-1',
            status: 'aborted',
            threadId: 'thread-1',
            messageId: 'msg-1',
            model: 'model-1',
            chunksReceived: 2,
            startedAt: Date.now(),
            completedAt: Date.now(),
            content: 'partial',
            content_length: 7,
        }),
    };
});

describe('primeBackgroundJobUpdate', () => {
    it('passes update payload to onAbort subscribers', async () => {
        vi.resetModules();
        vi.doUnmock('~/composables/chat/useAi');
        const { primeBackgroundJobUpdate } = await import('../useAi');
        const onAbort = vi.fn();
        const tracker = {
            jobId: 'job-1',
            userId: 'user-1',
            threadId: 'thread-1',
            messageId: 'msg-1',
            status: 'streaming',
            lastContent: '',
            lastPersistedLength: 0,
            lastPersistAt: 0,
            polling: false,
            streaming: false,
            active: true,
            subscribers: new Set([{ onAbort }]),
            completion: Promise.resolve({} as any),
            resolveCompletion: () => {},
        };

        await primeBackgroundJobUpdate(tracker as any);

        expect(onAbort).toHaveBeenCalledTimes(1);
        const updateArg = onAbort.mock.calls[0]?.[0];
        expect(updateArg.status.status).toBe('aborted');
        expect(updateArg.content).toBe('partial');
    });
});
