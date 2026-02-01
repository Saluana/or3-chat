import { beforeAll, describe, expect, it } from 'vitest';

let SESSION_CACHE_CONTROL: string;

beforeAll(async () => {
    const globalAny = globalThis as typeof globalThis & {
        defineEventHandler?: (handler: unknown) => unknown;
    };

    if (!globalAny.defineEventHandler) {
        globalAny.defineEventHandler = (handler) => handler;
    }

    const mod = await import('../session.get');
    SESSION_CACHE_CONTROL = mod.SESSION_CACHE_CONTROL;
});

describe('GET /api/auth/session', () => {
    it('never allows caching session responses', () => {
        expect(SESSION_CACHE_CONTROL).toBe('no-store');
    });
});
