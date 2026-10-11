import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Route files use Nuxt auto-import globals (no h3 import), so the test
// provides them on globalThis before importing the module under test.
const globalAny = globalThis as typeof globalThis & Record<string, unknown>;
globalAny.defineEventHandler = (handler: unknown) => handler;

const provider = { getJob: vi.fn(), abortJob: vi.fn(), updateJob: vi.fn() };
const emitMock = vi.fn();
vi.mock('../../../utils/background-jobs/store', () => ({ getJobProvider: async () => provider }));
vi.mock('../../../auth/session', () => ({ resolveSessionContext: async () => ({ authenticated: true, user: { id: 'user-1' } }) }));
vi.mock('../../../utils/auth/is-ssr-auth-enabled', () => ({ isSsrAuthEnabled: () => true }));
vi.mock('../../../utils/security/cloud-mutation', () => ({ requireCloudMutation: vi.fn() }));
vi.mock('../../../utils/background-jobs/access', () => ({ requireJobWorkspaceAccess: vi.fn() }));
vi.mock('../../../utils/background-jobs/viewers', () => ({ emitJobStatus: (...args: unknown[]) => emitMock(...args) }));
globalAny.getRouterParam = () => 'job-1';
globalAny.setResponseStatus = vi.fn();
globalAny.setHeader = vi.fn();

let abortModule: typeof import('../[id]/abort.post');

beforeAll(async () => {
    abortModule = await import('../[id]/abort.post');
});

describe('resolveAbortOutcome', () => {
    it('reports not_found when the job does not exist', () => {
        expect(abortModule.resolveAbortOutcome(null, 'rejected')).toEqual({
            state: 'not_found',
            httpStatus: 200,
        });
    });

    it('reports already_terminal when the job is not streaming', () => {
        for (const status of ['complete', 'error', 'aborted'] as const) {
            expect(
                abortModule.resolveAbortOutcome({ status }, 'rejected')
            ).toEqual({
                state: 'already_terminal',
                httpStatus: 200,
            });
        }
    });

    it('reports aborted only when the provider confirms the stop', () => {
        expect(
            abortModule.resolveAbortOutcome({ status: 'streaming' }, 'aborted')
        ).toEqual({ state: 'aborted', httpStatus: 200 });
    });

    it('reports abort_rejected when the provider refuses a streaming stop', () => {
        // The interface must not claim cancellation when the remote
        // execution may still be running.
        expect(
            abortModule.resolveAbortOutcome({ status: 'streaming' }, 'rejected')
        ).toEqual({ state: 'abort_rejected', httpStatus: 502 });
    });

    it('reports abort_error when the stop request itself fails', () => {
        // Remote state is unknown; the caller must see the uncertainty
        // explicitly instead of an opaque 500 with no machine-readable state.
        expect(
            abortModule.resolveAbortOutcome({ status: 'streaming' }, 'threw')
        ).toEqual({
            state: 'abort_error',
            httpStatus: 500,
        });
    });
});

describe('abort route workflow projection', () => {
    beforeEach(() => { vi.clearAllMocks(); });
    const job = () => ({ id: 'job-1', status: 'streaming', content: '', chunksReceived: 0,
        execution: { workspaceId: 'workspace-1' },
        workflow_state: { executionState: 'running', currentNodeId: 'node-1', version: 1 } });

    it.each(['rejected', 'throws', 'complete'] as const)(
        'does not persist or emit a stopped workflow when abort %s', async (outcome) => {
            const current = job();
            provider.getJob.mockResolvedValue(current);
            if (outcome === 'throws') provider.abortJob.mockRejectedValueOnce(new Error('unavailable'));
            else provider.abortJob.mockImplementationOnce(async () => {
                if (outcome === 'complete') current.status = 'complete';
                return false;
            });
            const result = await abortModule.default({} as never);
            expect(result).toMatchObject({ aborted: false,
                state: outcome === 'throws' ? 'abort_error' : outcome === 'complete' ? 'already_terminal' : 'abort_rejected' });
            expect(provider.updateJob).not.toHaveBeenCalled();
            expect(emitMock).not.toHaveBeenCalled();
            expect(current.workflow_state.executionState).toBe('running');
        }
    );

    it('projects stopped only after confirmed cancellation, without mutating the original snapshot', async () => {
        const current = job();
        provider.getJob.mockResolvedValue(current);
        provider.abortJob.mockImplementationOnce(async () => { current.status = 'aborted'; return true; });
        const result = await abortModule.default({} as never);
        expect(result).toMatchObject({ aborted: true, workflow_state: { executionState: 'stopped' } });
        expect(provider.updateJob).not.toHaveBeenCalled();
        expect(current.workflow_state.executionState).toBe('running');
        expect(emitMock).toHaveBeenCalledWith('job-1', 'aborted',
            expect.objectContaining({ workflow_state: expect.objectContaining({ executionState: 'stopped' }) }));
    });
});
