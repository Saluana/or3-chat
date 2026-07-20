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
});
