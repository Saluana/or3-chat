import { describe, expect, it, vi } from 'vitest';
import {
    createSsrHookEngine,
} from '../runtime-kernel';

describe('app hook runtime kernel lifetimes', () => {
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

});
