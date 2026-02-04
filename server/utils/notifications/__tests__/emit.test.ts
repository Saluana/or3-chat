/**
 * @module server/utils/notifications/__tests__/emit.test
 *
 * Purpose:
 * Validate server notification emission helpers.
 *
 * Behavior:
 * - Emits completion and error notifications through the registered emitter.
 * - Throws when the emitter is missing.
 *
 * Non-Goals:
 * - Integration with realtime delivery or subscriptions.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { emitBackgroundJobComplete, emitBackgroundJobError } from '../emit';
import { registerNotificationEmitter, _resetNotificationEmitters } from '../registry';

const mocks = vi.hoisted(() => ({
    config: { sync: { convexUrl: 'https://convex.test' } } as any
}));

vi.mock('#imports', () => ({
    useRuntimeConfig: () => mocks.config,
}));

describe('notification emit helpers', () => {
    beforeEach(() => {
        mocks.config = { sync: { provider: 'convex' } };
        _resetNotificationEmitters();
    });

    it('throws when emitter is missing', async () => {
        mocks.config = { sync: { provider: 'missing' } };

        await expect(
            emitBackgroundJobComplete('ws-1', 'user-1', 'thread-1', 'job-1')
        ).rejects.toThrow('No emitter registered');
    });

    it('emits background completion notifications', async () => {
        const emitComplete = vi.fn().mockResolvedValue('notif-1');
        const emitError = vi.fn();
        registerNotificationEmitter({
            id: 'convex',
            create: () => ({
                id: 'convex',
                emitBackgroundJobComplete: emitComplete,
                emitBackgroundJobError: emitError,
            }),
        });

        const result = await emitBackgroundJobComplete(
            'ws-1',
            'user-1',
            'thread-1',
            'job-1'
        );

        expect(result).toBe('notif-1');
        expect(emitComplete).toHaveBeenCalledWith({
            workspaceId: 'ws-1',
            userId: 'user-1',
            threadId: 'thread-1',
            jobId: 'job-1',
        });
    });

    it('emits background error notifications', async () => {
        const emitComplete = vi.fn();
        const emitError = vi.fn().mockResolvedValue('notif-1');
        registerNotificationEmitter({
            id: 'convex',
            create: () => ({
                id: 'convex',
                emitBackgroundJobComplete: emitComplete,
                emitBackgroundJobError: emitError,
            }),
        });

        const result = await emitBackgroundJobError(
            'ws-1',
            'user-1',
            'thread-2',
            'job-2',
            'boom'
        );

        expect(result).toBe('notif-1');
        expect(emitError).toHaveBeenCalledWith({
            workspaceId: 'ws-1',
            userId: 'user-1',
            threadId: 'thread-2',
            jobId: 'job-2',
            error: 'boom',
        });
    });
});
