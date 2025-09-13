import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exchangeOpenRouterCode } from '../openrouter-auth';

vi.mock('~/utils/errors', async (orig) => {
    const mod: any = await (orig as any)();
    return { ...mod, reportError: vi.fn(mod.reportError) };
});
import { reportError, err } from '~/utils/errors';

describe('openrouter auth exchange', () => {
    beforeEach(() => {
        (reportError as any).mockClear();
    });

    it('handles network error', async () => {
        const fetchImpl = vi.fn(async () => {
            throw new Error('boom');
        });
        const res = await exchangeOpenRouterCode({
            code: 'c',
            verifier: 'v',
            codeMethod: 'S256',
            fetchImpl,
        });
        expect(res.ok).toBe(false);
        const call = (reportError as any).mock.calls.find(
            (c: any[]) =>
                c[1]?.code === 'ERR_NETWORK' || c[0]?.code === 'ERR_NETWORK'
        );
        expect(call).toBeTruthy();
    });

    it('handles bad response (non-ok)', async () => {
        const fetchImpl = vi.fn(
            async () =>
                ({ ok: false, status: 500, json: async () => ({}) } as any)
        );
        const res = await exchangeOpenRouterCode({
            code: 'c',
            verifier: 'v',
            codeMethod: 'S256',
            fetchImpl,
        });
        expect(res.ok).toBe(false);
    });

    it('handles no key', async () => {
        const fetchImpl = vi.fn(
            async () =>
                ({
                    ok: true,
                    status: 200,
                    json: async () => ({ something: 'else' }),
                } as any)
        );
        const res = await exchangeOpenRouterCode({
            code: 'c',
            verifier: 'v',
            codeMethod: 'S256',
            fetchImpl,
        });
        expect(res.ok).toBe(false);
        const authCall = (reportError as any).mock.calls.find(
            (c: any[]) => c[0]?.code === 'ERR_AUTH'
        );
        expect(authCall).toBeTruthy();
    });

    it('returns success with key', async () => {
        const fetchImpl = vi.fn(
            async () =>
                ({
                    ok: true,
                    status: 200,
                    json: async () => ({ key: 'abc123' }),
                } as any)
        );
        const res = await exchangeOpenRouterCode({
            code: 'c',
            verifier: 'v',
            codeMethod: 'S256',
            fetchImpl,
        });
        expect(res.ok).toBe(true);
        // should not have reported an auth error
        const authCall = (reportError as any).mock.calls.find(
            (c: any[]) => c[0]?.code === 'ERR_AUTH'
        );
        expect(authCall).toBeFalsy();
    });
});
