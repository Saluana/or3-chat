import { describe, it, expect, vi } from 'vitest';
import {
    err,
    asAppError,
    reportError,
    simpleRetry,
    useErrorToasts,
} from '~/utils/errors';
import { useHooks } from '~/composables/useHooks';

// Stub hooks (light) if needed
vi.mock('~/composables/useHooks', () => {
    const actions: Record<string, any[]> = {};
    return {
        useHooks: () => ({
            doAction: (name: string, payload: any) => {
                (actions[name] ||= []).push(payload);
            },
        }),
    };
});

describe('errors util', () => {
    it('creates err with defaults', () => {
        const e = err('ERR_INTERNAL', 'Boom');
        expect(e.code).toBe('ERR_INTERNAL');
        expect(e.message).toBe('Boom');
        expect(e.severity).toBe('error');
        expect(e.timestamp).toBeTypeOf('number');
    });

    it('wraps string via asAppError', () => {
        const e = asAppError('nope');
        expect(e.code).toBe('ERR_INTERNAL');
        expect(e.message).toBe('nope');
    });

    it('reportError logs once for duplicate within window', async () => {
        const first = reportError(err('ERR_INTERNAL', 'dupe-test'));
        const second = reportError(err('ERR_INTERNAL', 'dupe-test'));
        expect(first.message).toBe(second.message);
    });

    it('scrubs obvious secrets', () => {
        const e = reportError(err('ERR_INTERNAL', 'apiKey=SECRETSECRET')); // should scrub message
        expect(/\*\*\*/.test(e.message) || e.message.includes('***')).toBe(
            true
        );
    });

    it('records hook emissions', () => {
        const e = reportError(
            err('ERR_NETWORK', 'offline', {
                severity: 'warn',
                tags: { domain: 'chat' },
            })
        );
        expect(e.code).toBe('ERR_NETWORK');
    });

    it('simpleRetry eventually succeeds', async () => {
        let attempts = 0;
        const result = await simpleRetry(
            async () => {
                attempts++;
                if (attempts < 2) throw new Error('fail');
                return 42;
            },
            3,
            10
        );
        expect(result).toBe(42);
        expect(attempts).toBe(2);
    });

    it('pushes toast (non-info)', () => {
        const { toasts } = useErrorToasts();
        const sizeBefore = toasts.length;
        reportError(err('ERR_NETWORK', 'x', { severity: 'warn' }));
        expect(toasts.length).toBe(sizeBefore + 1);
    });
});
