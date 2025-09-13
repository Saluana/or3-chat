import { describe, expect, it, vi, beforeEach } from 'vitest';
import { dbTry } from '../dbTry';
import { useHooks } from '~/composables/useHooks';

vi.mock('#imports', () => ({ useToast: () => ({ add: vi.fn() }) }));
vi.mock('~/composables/useHooks', async () => {
    const hooks: any = { doAction: vi.fn() };
    return { useHooks: () => hooks };
});

describe('dbTry', () => {
    beforeEach(() => {
        (useHooks() as any).doAction.mockClear();
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
        const calls = (useHooks() as any).doAction.mock.calls;
        const raised = calls.find((c: any[]) => c[0] === 'error:raised');
        expect(raised).toBeTruthy();
        const errorObj = raised[1];
        expect(errorObj.code).toBe('ERR_DB_QUOTA_EXCEEDED');
        expect(errorObj.tags.entity).toBe('messages');
    });

    it('reports generic write failure', async () => {
        const res = await dbTry(
            () => {
                throw new Error('boom');
            },
            { op: 'write', entity: 'threads' }
        );
        expect(res).toBeUndefined();
        const calls = (useHooks() as any).doAction.mock.calls;
        const errorObj = calls
            .filter((c: any[]) => c[0] === 'error:raised')
            .pop()[1];
        expect(errorObj.code).toBe('ERR_DB_WRITE_FAILED');
        expect(errorObj.tags.entity).toBe('threads');
    });
});
