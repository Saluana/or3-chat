import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHookEngine } from '../../utils/hooks';
import { useHooks } from '../useHooks';

// Provide a HookEngine for useHooks via #app mock
const hookEngine = createHookEngine();
vi.mock('#app', () => ({ useNuxtApp: () => ({ $hooks: hookEngine }) }));

describe('useHooks typed integration', () => {
    beforeEach(() => {
        hookEngine.removeAllCallbacks();
    });

    it('registers typed action and executes', async () => {
        const hooks = useHooks();
        const spy = vi.fn();
        hooks.addAction('ui.pane.blur:action', (payload) => spy(payload));
        await hooks.doAction('ui.pane.blur:action', {
            pane: {
                id: 'p1',
                mode: 'chat',
                threadId: '',
                messages: [],
                validating: false,
            },
            previousIndex: 0,
        });
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('enforces filter return type (compile-time)', async () => {
        const hooks = useHooks();
        hooks.addFilter('ui.chat.message:filter:outgoing', (v) => v.trim());
        const out = await hooks.applyFilters(
            'ui.chat.message:filter:outgoing',
            '  hi  '
        );
        expect(out).toBe('hi');
    });

    it('unified on() registration works for filter + disposer', async () => {
        const hooks = useHooks();
        const off = hooks.on('files.attach:filter:input', (p) => p);
        const payload = {
            file: new File(['x'], 'x.txt'),
            name: 'x.txt',
            mime: 'text/plain',
            size: 1,
            kind: 'image' as const,
        };
        const result = await hooks.applyFilters(
            'files.attach:filter:input',
            payload
        );
        expect(result).toBe(payload);
        off();
        const result2 = await hooks.applyFilters(
            'files.attach:filter:input',
            payload
        );
        expect(result2).toBe(payload); // no transforms
    });
});
