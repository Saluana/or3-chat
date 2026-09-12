import { describe, expect, it, vi } from 'vitest';
import { createHookEngine as createV1HookEngine } from '../hook-engine-core';
import { createHookEngineV2 } from '../hook-engine-v2';

describe.each([
    ['V1', createV1HookEngine],
    ['V2', createHookEngineV2],
] as const)('hook-engine-core (%s)', (_runtime, createHookEngine) => {
    it('rejects thenables from synchronous filters and keeps prior value', () => {
        const engine = createHookEngine();
        engine.addFilter(
            'demo:filter:value',
            () => Promise.resolve('async') as unknown as string,
        );

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
        engine.addFilter(
            'demo:filter:chain',
            (value) => `${String(value)}-a`,
            5,
        );
        engine.addFilter(
            'demo:filter:chain',
            () => Promise.resolve('async') as unknown as string,
            10,
        );
        engine.addFilter(
            'demo:filter:chain',
            (value) => `${String(value)}-b`,
            15,
        );

        const result = engine.applyFiltersSync('demo:filter:chain', 'x');
        expect(result).toBe('x-a-b');
        expect(engine._diagnostics.errors['demo:filter:chain']).toBe(1);
    });

    it('continues sync filter chain after a throwing callback', () => {
        const engine = createHookEngine();
        engine.addFilter(
            'demo:filter:throw',
            (value) => `${String(value)}-ok`,
            5,
        );
        engine.addFilter(
            'demo:filter:throw',
            () => {
                throw new Error('boom');
            },
            10,
        );
        engine.addFilter(
            'demo:filter:throw',
            (value) => `${String(value)}-after`,
            15,
        );

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

        await expect(
            engine.doAction('demo:action:fail'),
        ).resolves.toBeUndefined();
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
        engine.addFilter(
            'demo:filter:async',
            async (value) => `${String(value)}-async`,
        );
        await expect(
            engine.applyFilters('demo:filter:async', 'x'),
        ).resolves.toBe('x-async');
    });

    it('merges exact and wildcard callbacks by priority then registration order', async () => {
        const engine = createHookEngine();
        const calls: string[] = [];
        engine.addAction('demo.*', () => calls.push('wildcard-first'), 10);
        engine.addAction(
            'demo.action.order',
            () => calls.push('exact-second'),
            10,
        );
        engine.addAction('demo.action.order', () => calls.push('exact-low'), 5);
        engine.addAction(
            '*.action.order',
            () => calls.push('wildcard-high'),
            20,
        );

        await engine.doAction('demo.action.order');

        expect(calls).toEqual([
            'exact-low',
            'wildcard-first',
            'exact-second',
            'wildcard-high',
        ]);
    });

    it('applies acceptedArgs by limiting the arguments per callback', async () => {
        const engine = createHookEngine();
        const action = vi.fn();
        const filter = vi.fn((value, ...args) => [value, ...args].join(':'));
        engine.addAction('demo:action:args', action, 10, 1);
        engine.addFilter('demo:filter:args', filter, 10, 1);

        await engine.doAction('demo:action:args', 'a', 'b', 'c');
        const filtered = await engine.applyFilters(
            'demo:filter:args',
            'start',
            'a',
            'b',
        );

        expect(action).toHaveBeenCalledWith('a');
        expect(filter).toHaveBeenCalledWith('start');
        expect(filtered).toBe('start');
    });

    it('forwards every argument when acceptedArgs is omitted and slices to zero when zero', async () => {
        const engine = createHookEngine();
        const actionAll = vi.fn();
        const actionNone = vi.fn();
        engine.addAction('demo:action:all', actionAll, 10);
        engine.addAction('demo:action:none', actionNone, 10, 0);

        await engine.doAction('demo:action:all', 'a', 'b');
        await engine.doAction('demo:action:none', 'a', 'b');

        expect(actionAll).toHaveBeenCalledWith('a', 'b');
        expect(actionNone).toHaveBeenCalledWith();
    });

    it('forwards acceptedArgs through on() for both kinds', async () => {
        const engine = createHookEngine();
        const action = vi.fn();
        const filter = vi.fn((value, ...args) => [value, ...args].join(':'));
        engine.on('demo:action:on', action, { kind: 'action', acceptedArgs: 1 });
        engine.on('demo:filter:on', filter, { kind: 'filter', acceptedArgs: 2 });

        await engine.doAction('demo:action:on', 'a', 'b');
        const filtered = await engine.applyFilters(
            'demo:filter:on',
            'start',
            'a',
            'b',
        );

        expect(action).toHaveBeenCalledWith('a');
        expect(filter).toHaveBeenCalledWith('start', 'a');
        expect(filtered).toBe('start:a');
    });

    it('consumes late rejections from sync callbacks without unhandled failures', async () => {
        const engine = createHookEngine({
            logCallbackError: () => {},
        });
        let rejectAction!: (error: unknown) => void;
        let rejectFilter!: (error: unknown) => void;
        engine.addAction(
            'demo:action:sync-reject',
            () =>
                new Promise<void>((_resolve, reject) => {
                    rejectAction = reject;
                })
        );
        engine.addFilter(
            'demo:filter:sync-reject',
            (value) =>
                new Promise<string>((_resolve, reject) => {
                    rejectFilter = reject;
                    return undefined as never;
                }) as unknown as string
        );

        engine.doActionSync('demo:action:sync-reject');
        const filtered = engine.applyFiltersSync(
            'demo:filter:sync-reject',
            'keep'
        );
        expect(filtered).toBe('keep');

        rejectAction(new Error('late action failure'));
        rejectFilter(new Error('late filter failure'));
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(engine._diagnostics.errors['demo:action:sync-reject']).toBe(2);
        expect(engine._diagnostics.errors['demo:filter:sync-reject']).toBe(2);
    });

    it('isolates currentPriority across concurrent async dispatches', async () => {
        const engine = createHookEngine();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const observed: Record<string, Array<number | false>> = {
            a: [],
            b: [],
        };
        engine.addAction(
            'demo:action:iso-a',
            async () => {
                observed.a!.push(engine.currentPriority());
                await gate;
                observed.a!.push(engine.currentPriority());
            },
            10
        );
        engine.addAction(
            'demo:action:iso-b',
            async () => {
                observed.b!.push(engine.currentPriority());
                await gate;
                observed.b!.push(engine.currentPriority());
            },
            20
        );

        const first = engine.doAction('demo:action:iso-a');
        const second = engine.doAction('demo:action:iso-b');
        await Promise.resolve();
        await Promise.resolve();
        release();
        await Promise.all([first, second]);

        expect(observed.a).toEqual([10, 10]);
        expect(observed.b).toEqual([20, 20]);
        expect(engine.currentPriority()).toBe(false);
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

    it('removes all callbacks or only callbacks at the requested priority', async () => {
        const engine = createHookEngine();
        const low = vi.fn();
        const normal = vi.fn();
        engine.addAction('demo:action:all', low, 5);
        engine.addAction('demo:action:all', normal, 10);
        engine.addFilter('demo:filter:all', (value) => value, 5);

        engine.removeAllCallbacks(5);
        await engine.doAction('demo:action:all');
        expect(low).not.toHaveBeenCalled();
        expect(normal).toHaveBeenCalledTimes(1);
        expect(engine.hasFilter()).toBe(false);

        engine.removeAllCallbacks();
        expect(engine.hasAction()).toBe(false);
        expect(engine._diagnostics.callbacks()).toBe(0);
    });

    it('restores currentPriority across nested dispatch and resets it afterward', () => {
        const engine = createHookEngine();
        const observed: Array<number | false> = [];
        engine.addAction(
            'demo:action:inner',
            () => {
                observed.push(engine.currentPriority());
            },
            5,
        );
        engine.addAction(
            'demo:action:outer',
            () => {
                observed.push(engine.currentPriority());
                engine.doActionSync('demo:action:inner');
                observed.push(engine.currentPriority());
            },
            20,
        );

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
        expect(() =>
            engine.off(() => {
                throw error;
            }),
        ).not.toThrow();

        expect(callback).not.toHaveBeenCalled();
        expect(onOffError).toHaveBeenCalledWith(error);
    });
});
