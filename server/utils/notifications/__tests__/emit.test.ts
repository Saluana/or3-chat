import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    emitBackgroundJobComplete,
    emitBackgroundJobError,
} from '../emit';

const mutationMock = vi.hoisted(() => vi.fn().mockResolvedValue('notif-1'));
const ConvexHttpClientMock = vi.hoisted(() =>
    vi.fn(() => ({ mutation: mutationMock }))
);

vi.mock('convex/browser', () => ({
    ConvexHttpClient: ConvexHttpClientMock,
}));

vi.mock('~~/convex/_generated/api', () => ({
    api: { notifications: { create: 'notifications.create' } },
}));

const mocks = vi.hoisted(() => ({
    config: { public: { sync: { convexUrl: 'https://convex.test' } } } as any
}));

vi.mock('#imports', () => ({
    useRuntimeConfig: () => mocks.config,
}));

describe('notification emit helpers', () => {
    beforeEach(() => {
        mutationMock.mockClear();
        ConvexHttpClientMock.mockClear();
        mocks.config = { public: { sync: { convexUrl: 'https://convex.test' } } };
    });

    it('throws when convex url is missing', async () => {
        mocks.config = { public: { sync: {} } };

        await expect(
            emitBackgroundJobComplete('ws-1', 'user-1', 'thread-1', 'job-1')
        ).rejects.toThrow('CONVEX_URL is not defined in runtime config');
    });

    it('emits background completion notifications', async () => {
        const result = await emitBackgroundJobComplete(
            'ws-1',
            'user-1',
            'thread-1',
            'job-1'
        );

        expect(result).toBe('notif-1');
        expect(mutationMock).toHaveBeenCalledWith('notifications.create', {
            workspace_id: 'ws-1',
            user_id: 'user-1',
            thread_id: 'thread-1',
            type: 'ai.background.complete',
            title: 'Background response completed',
            body: 'Your background AI response is ready in thread thread-1',
        });
    });

    it('emits background error notifications', async () => {
        const result = await emitBackgroundJobError(
            'ws-1',
            'user-1',
            'thread-2',
            'job-2',
            'boom'
        );

        expect(result).toBe('notif-1');
        expect(mutationMock).toHaveBeenCalledWith('notifications.create', {
            workspace_id: 'ws-1',
            user_id: 'user-1',
            thread_id: 'thread-2',
            type: 'ai.background.error',
            title: 'Background response failed',
            body: 'Failed: boom',
        });
    });
});
