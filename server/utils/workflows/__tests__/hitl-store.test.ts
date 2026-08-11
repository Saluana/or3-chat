import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getJobProviderMock = vi.hoisted(() => vi.fn());

vi.mock('../../background-jobs/store', () => ({
    getJobProvider: getJobProviderMock,
}));

vi.mock('../../background-jobs/viewers', () => ({
    emitJobStatus: vi.fn(),
}));

import { registerHitlRequest } from '../hitl-store';

const pendingContext = {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    jobId: 'job-1',
};

describe('HITL request lifecycle', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        getJobProviderMock.mockReset();
        getJobProviderMock.mockReturnValue(new Promise(() => {}));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('replaces duplicate request ids and expires the replacement absolutely', async () => {
        const first = registerHitlRequest('request-1', pendingContext);
        const firstRejection = expect(first).rejects.toThrow(
            'HITL request replaced: request-1'
        );

        const replacement = registerHitlRequest('request-1', pendingContext);
        const timeoutRejection = expect(replacement).rejects.toThrow(
            'HITL request timed out: request-1'
        );

        await firstRejection;
        await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
        await timeoutRejection;
    });
});
