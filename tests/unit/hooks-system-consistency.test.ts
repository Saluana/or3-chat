/**
 * Tests for hook system consistency
 * 
 * Issue: useHooks() was creating fallback hook engines when the plugin engine
 * wasn't available, leading to split hook worlds where some listeners/emitters
 * used one engine and others used a different engine.
 * 
 * Fix: useHooks() now throws an error if the hook engine is not available,
 * ensuring all hooks go through the same centralized engine.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the nuxt app context
const mockNuxtApp = {
    $hooks: null as unknown,
};

vi.mock('nuxt/app', () => ({
    useNuxtApp: () => mockNuxtApp,
}));

describe('Hooks - System consistency', () => {
    beforeEach(() => {
        // Reset mock between tests
        mockNuxtApp.$hooks = null;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('useHooks() with available engine', () => {
        it('should return the provided hook engine', async () => {
            // Create a mock typed hook engine
            const mockEngine = {
                addAction: vi.fn(),
                doAction: vi.fn(),
                addFilter: vi.fn(),
                applyFilter: vi.fn(),
                removeAction: vi.fn(),
                removeFilter: vi.fn(),
            };

            mockNuxtApp.$hooks = mockEngine;

            const { useHooks } = await import('../../app/core/hooks/useHooks');
            const hooks = useHooks();

            expect(hooks).toBe(mockEngine);
        });
    });

    describe('useHooks() without available engine', () => {
        it('should throw error when hook engine not initialized', async () => {
            mockNuxtApp.$hooks = null;

            const { useHooks } = await import('../../app/core/hooks/useHooks');

            expect(() => useHooks()).toThrow('Hook engine not initialized');
        });

        it('should include helpful error message', async () => {
            mockNuxtApp.$hooks = undefined;

            const { useHooks } = await import('../../app/core/hooks/useHooks');

            try {
                useHooks();
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error instanceof Error).toBe(true);
                expect((error as Error).message).toContain('00-hooks plugin');
            }
        });
    });

    describe('Hook engine singleton behavior', () => {
        it('should use the same engine instance across multiple calls', async () => {
            const mockEngine = {
                addAction: vi.fn(),
                doAction: vi.fn(),
                addFilter: vi.fn(),
                applyFilter: vi.fn(),
                removeAction: vi.fn(),
                removeFilter: vi.fn(),
            };

            mockNuxtApp.$hooks = mockEngine;

            const { useHooks } = await import('../../app/core/hooks/useHooks');
            const hooks1 = useHooks();
            const hooks2 = useHooks();

            expect(hooks1).toBe(hooks2);
            expect(hooks1).toBe(mockEngine);
        });
    });

    describe('Hook lifecycle', () => {
        it('should support registering and calling actions', async () => {
            const { createHookEngine } = await import('../../app/core/hooks/hooks');
            const { createTypedHookEngine } = await import('../../app/core/hooks/typed-hooks');
            
            const engine = createHookEngine();
            const typed = createTypedHookEngine(engine);

            const callback = vi.fn();
            typed.addAction('sync.push:action:before', callback);

            await typed.doAction('sync.push:action:before', { 
                scope: { workspaceId: 'ws-1', deviceId: 'dev-1' }, 
                count: 5 
            });

            expect(callback).toHaveBeenCalledWith({
                scope: { workspaceId: 'ws-1', deviceId: 'dev-1' },
                count: 5,
            });
        });

        it('should support removing actions', async () => {
            const { createHookEngine } = await import('../../app/core/hooks/hooks');
            const { createTypedHookEngine } = await import('../../app/core/hooks/typed-hooks');
            
            const engine = createHookEngine();
            const typed = createTypedHookEngine(engine);

            const callback = vi.fn();
            typed.addAction('sync.push:action:before', callback);

            typed.removeAction('sync.push:action:before', callback);

            await typed.doAction('sync.push:action:before', { 
                scope: { workspaceId: 'ws-1', deviceId: 'dev-1' }, 
                count: 5 
            });

            expect(callback).not.toHaveBeenCalled();
        });
    });

    it('preserves raw defaults, typedOn forwarding, custom names and explicit action kind', async () => {
        const { createHookEngine } = await import('../../app/core/hooks/hooks');
        const { createTypedHookEngine } = await import('../../app/core/hooks/typed-hooks');
        const { typedOn } = await import('../../app/core/hooks/hook-keys');
        const raw = createHookEngine();
        const typed = createTypedHookEngine(raw);
        const rawCallback = vi.fn(() => 'raw transformed');
        const helperCallback = vi.fn(() => 'helper transformed');
        raw.on('raw.value:filter', rawCallback);
        typedOn(raw).on('ui.chat.message:filter:outgoing', helperCallback);

        expect(await raw.applyFilters('raw.value:filter', 'original')).toBe('original');
        expect(await raw.applyFilters('ui.chat.message:filter:outgoing', 'original')).toBe('original');
        await raw.doAction('raw.value:filter', 'original');
        await raw.doAction('ui.chat.message:filter:outgoing', 'original');
        expect(rawCallback).toHaveBeenCalledOnce();
        expect(helperCallback).toHaveBeenCalledOnce();

        const events: string[] = [];
        const offCustom = typed.on('plugin.custom', () => { events.push('custom'); });
        const offExplicit = typed.on('plugin.value:filter', () => { events.push('explicit'); }, { kind: 'action' });
        await typed.doAction('plugin.custom');
        await raw.doAction('plugin.value:filter');
        expect(events).toEqual(['custom', 'explicit']);
        offCustom();
        offExplicit();
        await typed.doAction('plugin.custom');
        await raw.doAction('plugin.value:filter');
        expect(events).toEqual(['custom', 'explicit']);
    });

    describe('Multiple hook listeners', () => {
        it('should call all registered listeners in order', async () => {
            const { createHookEngine } = await import('../../app/core/hooks/hooks');
            const { createTypedHookEngine } = await import('../../app/core/hooks/typed-hooks');
            
            const engine = createHookEngine();
            const typed = createTypedHookEngine(engine);

            const results: number[] = [];
            typed.addAction('sync.push:action:before', () => results.push(1));
            typed.addAction('sync.push:action:before', () => results.push(2));
            typed.addAction('sync.push:action:before', () => results.push(3));

            await typed.doAction('sync.push:action:before', { 
                scope: { workspaceId: 'ws-1', deviceId: 'dev-1' }, 
                count: 5 
            });

            expect(results).toEqual([1, 2, 3]);
        });
    });
});
