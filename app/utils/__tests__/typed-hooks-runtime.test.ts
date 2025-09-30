import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHookEngine } from '../hooks';
import { createTypedHookEngine } from '../typed-hooks';

describe('typed-hooks runtime', () => {
    const engine = createHookEngine();
    const hooks = createTypedHookEngine(engine);

    beforeEach(() => {
        engine.removeAllCallbacks();
    });

    it('proxies addAction/doAction correctly', async () => {
        const spy = vi.fn();
        hooks.addAction('ui.pane.active:action', () => spy());
        await hooks.doAction('ui.pane.active:action', {
            pane: { id: 'p', mode: 'chat', messages: [] },
            index: 0,
            previousIndex: undefined,
        });
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('proxies addFilter/applyFilters correctly', async () => {
        hooks.addFilter('ui.chat.message:filter:outgoing', (v) => v.trim());
        const out = await hooks.applyFilters(
            'ui.chat.message:filter:outgoing',
            '  ok  '
        );
        expect(out).toBe('ok');
    });
});
