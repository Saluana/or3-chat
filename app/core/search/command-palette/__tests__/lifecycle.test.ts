import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaletteCoordinator } from '../coordinator';

const actions = new Map<string, (payload?: unknown) => void>();
const addAction = vi.fn((name: string, fn: (payload?: unknown) => void) => {
    actions.set(name, fn);
});
const removeAction = vi.fn((name: string, fn: (payload?: unknown) => void) => {
    if (actions.get(name) === fn) actions.delete(name);
});

vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => ({ addAction, removeAction }),
}));

vi.mock('../registry', () => ({
    listPaletteSources: () => [
        { id: 'chat' },
        { id: 'document' },
        { id: 'todo-source', pluginId: 'todo-plugin' },
    ],
}));

describe('bindPaletteLifecycle', () => {
    beforeEach(() => {
        actions.clear();
        addAction.mockClear();
        removeAction.mockClear();
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('coalesces affected conversations and lets unknown mutations or sync require a full refresh', async () => {
        const refreshSources = vi.fn(async () => undefined);
        const { bindPaletteLifecycle } = await import('../lifecycle');
        const dispose = bindPaletteLifecycle({ refreshSources } as unknown as PaletteCoordinator);
        try {
            actions.get('db.messages.append:action:after')?.({ thread_id: 'a' });
            actions.get('db.messages.upsert:action:after')?.({ entity: { thread_id: 'b' } });
            actions.get('db.messages.append:action:after')?.({ thread_id: 'a' });
            await vi.advanceTimersByTimeAsync(250);
            expect(refreshSources).toHaveBeenLastCalledWith(['chat'], new Map([['chat', ['a', 'b']]]));
            actions.get('db.messages.append:action:after')?.({ thread_id: 'a' });
            actions.get('db.messages.move:action:after')?.({ messageId: 'm', toThreadId: 'b' });
            await vi.advanceTimersByTimeAsync(250);
            expect(refreshSources).toHaveBeenLastCalledWith(['chat']);
            actions.get('db.messages.append:action:after')?.({ thread_id: 'a' });
            actions.get('sync.pull:action:applied')?.();
            await vi.advanceTimersByTimeAsync(250);
            expect(refreshSources).toHaveBeenLastCalledWith(undefined);
        } finally { dispose(); }
    });

    it('binds real mutation hooks and refreshes only affected sources', async () => {
        const refreshSources = vi.fn(async () => undefined);
        const coordinator = { refreshSources } as unknown as PaletteCoordinator;
        const { bindPaletteLifecycle } = await import('../lifecycle');
        const dispose = bindPaletteLifecycle(coordinator);

        expect(actions.has('db.messages.append:action:after')).toBe(true);
        expect(actions.has('db.messages.update:action:after')).toBe(false);
        actions.get('db.messages.append:action:after')?.();
        await vi.advanceTimersByTimeAsync(250);
        expect(refreshSources).toHaveBeenLastCalledWith(['chat']);

        actions.get('db.posts.upsert:action:after')?.();
        await vi.advanceTimersByTimeAsync(250);
        expect(refreshSources).toHaveBeenLastCalledWith([
            'document',
            'file',
            'todo-source',
        ]);

        actions.get('db.prompts.update:action:after')?.();
        await vi.advanceTimersByTimeAsync(250);
        expect(refreshSources).toHaveBeenLastCalledWith(['prompt']);

        actions.get('sync.pull:action:applied')?.();
        await vi.advanceTimersByTimeAsync(250);
        expect(refreshSources).toHaveBeenLastCalledWith(undefined);

        dispose();
        expect(actions.size).toBe(0);
    });
});
