import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dbTry } from '../dbTry';
import { reportError } from '~/utils/errors';

vi.mock('~/utils/errors', async () => {
    const actual = await vi.importActual<any>('~/utils/errors');
    return {
        ...actual,
        reportError: vi.fn(),
    };
});

const mockedReportError = reportError as unknown as Mock;

describe('dbTry', () => {
    beforeEach(() => {
        mockedReportError.mockReset();
    });

    it('reports quota exceeded', async () => {
        const quotaErr = {
            name: 'QuotaExceededError',
            message: 'Quota exceeded',
        };
        const res = await dbTry(
            () => {
                throw quotaErr;
            },
            { op: 'write', entity: 'messages' }
        );
        expect(res).toBeUndefined();
        const calls = mockedReportError.mock.calls;
        expect(calls.length).toBeGreaterThan(0);
        const [errorObj, opts] = calls[calls.length - 1] as [any, any];
        expect(errorObj.code).toBe('ERR_DB_QUOTA_EXCEEDED');
        expect(errorObj.tags.entity).toBe('messages');
        expect(errorObj.tags.rw).toBe('write');
        expect(opts.toast).toBe(true);
    });

    it('reports generic write failure', async () => {
        const res = await dbTry(
            () => {
                throw new Error('boom');
            },
            { op: 'write', entity: 'threads' }
        );
        expect(res).toBeUndefined();
        const calls = mockedReportError.mock.calls;
        expect(calls.length).toBeGreaterThan(0);
        const [errorObj, opts] = calls[calls.length - 1] as [any, any];
        expect(errorObj.code).toBe('ERR_DB_WRITE_FAILED');
        expect(errorObj.tags.entity).toBe('threads');
        expect(errorObj.tags.rw).toBe('write');
        expect(opts.toast).toBe(true);
    });
});
