import { describe, expect, it, vi } from 'vitest';
import { createHookEngine } from '../hook-engine-core';

describe('hook-engine-core', () => {
    it('rejects thenables from synchronous filters and keeps prior value', () => {
        const engine = createHookEngine();
        engine.addFilter('demo:filter:value', () => Promise.resolve('async') as unknown as string);

        const result = engine.applyFiltersSync('demo:filter:value', 'sync');
        expect(result).toBe('sync');
        expect(engine._diagnostics.errors['demo:filter:value']).toBe(1);
    });

    it('rejects thenables from synchronous actions and continues the chain', () => {
        const engine = createHookEngine();
        const later = vi.fn();
        engine.addAction('demo:action:sync', () => Promise.resolve('nope'));
        engine.addAction('demo:action:sync', later, 20);

        expect(() => engine.doActionSync('demo:action:sync')).not.toThrow();
        expect(later).toHaveBeenCalledTimes(1);
        expect(engine._diagnostics.errors['demo:action:sync']).toBe(1);
    });

    it('keeps earlier filter value when a later sync filter returns a thenable', () => {
        const engine = createHookEngine();
        engine.addFilter('demo:filter:chain', (value) => `${String(value)}-a`, 5);
        engine.addFilter(
            'demo:filter:chain',
            () => Promise.resolve('async') as unknown as string,
            10
        );
        engine.addFilter('demo:filter:chain', (value) => `${String(value)}-b`, 15);

        const result = engine.applyFiltersSync('demo:filter:chain', 'x');
        expect(result).toBe('x-a-b');
        expect(engine._diagnostics.errors['demo:filter:chain']).toBe(1);
    });

    it('continues sync filter chain after a throwing callback', () => {
        const engine = createHookEngine();
        engine.addFilter('demo:filter:throw', (value) => `${String(value)}-ok`, 5);
        engine.addFilter(
            'demo:filter:throw',
            () => {
                throw new Error('boom');
            },
            10
        );
        engine.addFilter('demo:filter:throw', (value) => `${String(value)}-after`, 15);

        const result = engine.applyFiltersSync('demo:filter:throw', 'start');
        expect(result).toBe('start-ok-after');
        expect(engine._diagnostics.errors['demo:filter:throw']).toBe(1);
    });

    it('awaits onceAction callbacks during doAction and removes them after first run', async () => {
        const engine = createHookEngine();
        let calls = 0;
        engine.onceAction('demo:action:once', async () => {
            calls += 1;
            await Promise.resolve();
        });

        await engine.doAction('demo:action:once');
        await engine.doAction('demo:action:once');
        expect(calls).toBe(1);
    });

    it('records onceAction async rejection without leaving unhandled failures', async () => {
        const engine = createHookEngine();
        engine.onceAction('demo:action:fail', async () => {
            throw new Error('boom');
        });

        await expect(engine.doAction('demo:action:fail')).resolves.toBeUndefined();
        expect(engine._diagnostics.errors['demo:action:fail']).toBe(1);
        expect(engine.hasAction('demo:action:fail')).toBe(false);
    });

    it('allows disposing onceAction before it fires', async () => {
        const engine = createHookEngine();
        const fn = vi.fn();
        const dispose = engine.onceAction('demo:action:dispose', fn);
        dispose();
        await engine.doAction('demo:action:dispose');
        expect(fn).not.toHaveBeenCalled();
    });

    it('runs onceAction only once even under overlapping async doAction calls', async () => {
        const engine = createHookEngine();
        let calls = 0;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });

        engine.onceAction('demo:action:race', async () => {
            calls += 1;
            await gate;
        });

        const first = engine.doAction('demo:action:race');
        const second = engine.doAction('demo:action:race');
        release();
        await Promise.all([first, second]);
        expect(calls).toBe(1);
    });

    it('awaited applyFilters accepts async filter results', async () => {
        const engine = createHookEngine();
        engine.addFilter('demo:filter:async', async (value) => `${String(value)}-async`);
        await expect(engine.applyFilters('demo:filter:async', 'x')).resolves.toBe('x-async');
    });

    it('merges exact and wildcard callbacks by priority then registration order', async () => {
        const engine = createHookEngine();
        const calls: string[] = [];
        engine.addAction('demo.*', () => calls.push('wildcard-first'), 10);
        engine.addAction('demo.action.order', () => calls.push('exact-second'), 10);
        engine.addAction('demo.action.order', () => calls.push('exact-low'), 5);
        engine.addAction('*.action.order', () => calls.push('wildcard-high'), 20);

        await engine.doAction('demo.action.order');

        expect(calls).toEqual([
            'exact-low',
            'wildcard-first',
            'exact-second',
            'wildcard-high',
        ]);
    });

    it('preserves the V1 acceptedArgs behavior of forwarding every argument', async () => {
        const engine = createHookEngine();
        const action = vi.fn();
        const filter = vi.fn((value, ...args) => [value, ...args].join(':'));
        engine.addAction('demo:action:args', action, 10, 1);
        engine.addFilter('demo:filter:args', filter, 10, 1);

        await engine.doAction('demo:action:args', 'a', 'b', 'c');
        const filtered = await engine.applyFilters('demo:filter:args', 'start', 'a', 'b');

        expect(action).toHaveBeenCalledWith('a', 'b', 'c');
        expect(filter).toHaveBeenCalledWith('start', 'a', 'b');
        expect(filtered).toBe('start:a:b');
    });

    it('freezes hasAction and hasFilter boolean and priority return values', () => {
        const engine = createHookEngine();
        const exactAction = vi.fn();
        const wildcardAction = vi.fn();
        const filter = vi.fn((value) => value);
        engine.addAction('demo:action:has', exactAction, 0);
        engine.addAction('demo:action:*', wildcardAction, 25);
        engine.addFilter('demo:filter:has', filter, 15);

        expect(engine.hasAction()).toBe(true);
        expect(engine.hasAction('demo:action:has')).toBe(true);
        expect(engine.hasAction('demo:action:has', exactAction)).toBe(0);
        expect(engine.hasAction('demo:action:*', wildcardAction)).toBe(25);
        expect(engine.hasAction('demo:action:missing')).toBe(true);
        expect(engine.hasAction('demo:other:missing')).toBe(false);
        expect(engine.hasFilter()).toBe(true);
        expect(engine.hasFilter('demo:filter:has', filter)).toBe(15);
        expect(engine.hasFilter('demo:filter:missing')).toBe(false);
    });

    it('preserves exact removal of all matches and wildcard removal of the first match', async () => {
        const engine = createHookEngine();
        const exact = vi.fn();
        const wildcard = vi.fn();
        engine.addAction('demo:action:remove', exact, 10);
        engine.addAction('demo:action:remove', exact, 20);
        engine.addAction('demo:action:*', wildcard, 10);
        engine.addAction('demo:action:*', wildcard, 10);

        engine.removeAction('demo:action:remove', exact);
        engine.removeAction('demo:action:*', wildcard);
        await engine.doAction('demo:action:remove');

        expect(exact).not.toHaveBeenCalled();
        expect(wildcard).toHaveBeenCalledTimes(1);
        expect(engine.hasAction('demo:action:remove', exact)).toBe(false);
        expect(engine.hasAction('demo:action:*', wildcard)).toBe(10);
    });

    it('restores currentPriority across nested dispatch and resets it afterward', () => {
        const engine = createHookEngine();
        const observed: Array<number | false> = [];
        engine.addAction('demo:action:inner', () => {
            observed.push(engine.currentPriority());
        }, 5);
        engine.addAction('demo:action:outer', () => {
            observed.push(engine.currentPriority());
            engine.doActionSync('demo:action:inner');
            observed.push(engine.currentPriority());
        }, 20);

        expect(engine.currentPriority()).toBe(false);
        engine.doActionSync('demo:action:outer');
        expect(observed).toEqual([20, 5, 20]);
        expect(engine.currentPriority()).toBe(false);
    });

    it('off invokes disposers and reports disposer errors through the configured callback', async () => {
        const onOffError = vi.fn();
        const engine = createHookEngine({ onOffError });
        const callback = vi.fn();
        const disposer = engine.on('demo:action:off', callback);

        engine.off(disposer);
        await engine.doAction('demo:action:off');
        const error = new Error('dispose failed');
        expect(() => engine.off(() => { throw error; })).not.toThrow();

        expect(callback).not.toHaveBeenCalled();
        expect(onOffError).toHaveBeenCalledWith(error);
    });
});
