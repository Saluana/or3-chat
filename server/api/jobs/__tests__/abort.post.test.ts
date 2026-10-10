import { beforeAll, describe, expect, it } from 'vitest';

// Route files use Nuxt auto-import globals (no h3 import), so the test
// provides them on globalThis before importing the module under test.
const globalAny = globalThis as typeof globalThis & Record<string, unknown>;
globalAny.defineEventHandler = (handler: unknown) => handler;

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
