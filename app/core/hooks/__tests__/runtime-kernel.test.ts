import { describe, expect, it, vi } from 'vitest';
import {
    createAppHookEngine,
    createSsrHookEngine,
    getOrCreateClientHookEngine,
    type ClientHookEngineGlobal,
} from '../runtime-kernel';

describe('app hook runtime kernel lifetimes', () => {
    it('keeps one selected V2 client engine across repeated HMR-style initialization', () => {
        const global: ClientHookEngineGlobal = {};

        const first = getOrCreateClientHookEngine(global, 'v2');
        const repeated = getOrCreateClientHookEngine(global, 'v1');

        expect(repeated).toBe(first);
        expect(global.__NUXT_HOOKS_VERSION__).toBe('v2');
        expect('_runtimeV2' in first).toBe(true);
    });

    it('creates request-local V2 engines for SSR', async () => {
        const first = createSsrHookEngine('v2');
        const second = createSsrHookEngine('v2');
        const callback = vi.fn();
        first.addAction('ssr.action', callback);

        await first.doAction('ssr.action');
        await second.doAction('ssr.action');

        expect(first).not.toBe(second);
        expect(callback).toHaveBeenCalledTimes(1);
        expect(first._diagnostics.callbacks()).toBe(1);
        expect(second._diagnostics.callbacks()).toBe(0);
    });

    it('retains V1 as the current production factory until startup cutover', () => {
        const selected = createAppHookEngine('v1');
        const available = createAppHookEngine('v2');

        expect('_runtimeV2' in selected).toBe(false);
        expect('_runtimeV2' in available).toBe(true);
    });
});
