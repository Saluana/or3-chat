import { describe, expect, it, vi } from 'vitest';
import { createHookEngine } from '../hook-engine-core';
import { createHookShadowFacade, HookShadowComparator } from '../hook-shadow';

describe('hook metadata/plan shadow', () => {
    it('compares exact/wildcard plans without executing callbacks twice', async () => {
        const comparator = new HookShadowComparator();
        const engine = createHookShadowFacade(createHookEngine(), comparator);
        let sideEffects = 0;
        engine.addAction('demo.*', () => {
            sideEffects += 1;
        });
        engine.addAction('demo.action', () => {
            sideEffects += 1;
        });

        await engine.doAction('demo.action');

        expect(sideEffects).toBe(2);
        expect(comparator.comparisonCount).toBe(1);
        expect(comparator.inspectDivergences()).toEqual([]);
    });

    it('reports metadata-only plan differences without invoking the shadow callback', async () => {
        const comparator = new HookShadowComparator({
            mutateShadowRegistration: (registration) => ({
                ...registration,
                priority: (registration.priority ?? 10) + 1,
            }),
        });
        const callback = vi.fn();
        const engine = createHookShadowFacade(createHookEngine(), comparator);
        engine.addAction('demo.action', callback, 5);

        await engine.doAction('demo.action');

        expect(callback).toHaveBeenCalledTimes(1);
        expect(comparator.inspectDivergences()).toEqual([
            {
                kind: 'action',
                name: 'demo.action',
                primary: [{ pattern: 'demo.action', priority: 5, sequence: 1 }],
                shadow: [{ pattern: 'demo.action', priority: 6, sequence: 1 }],
            },
        ]);
    });

    it('mirrors removals and once-action metadata while preserving execution semantics', async () => {
        const comparator = new HookShadowComparator();
        const engine = createHookShadowFacade(createHookEngine(), comparator);
        const removed = vi.fn();
        const once = vi.fn();
        engine.addAction('demo.action', removed);
        engine.removeAction('demo.action', removed);
        engine.onceAction('demo.action', once);

        await engine.doAction('demo.action');
        await engine.doAction('demo.action');

        expect(removed).not.toHaveBeenCalled();
        expect(once).toHaveBeenCalledTimes(1);
        expect(comparator.inspectDivergences()).toEqual([]);
    });

    it('bounds divergence history under repeated comparisons', () => {
        const comparator = new HookShadowComparator({
            mutateShadowRegistration: (registration) => ({
                ...registration,
                priority: 99,
            }),
        });
        const engine = createHookShadowFacade(createHookEngine(), comparator);
        engine.addAction('demo.action', vi.fn());
        for (let index = 0; index < 1_000; index++) {
            engine.doActionSync('demo.action');
        }
        expect(comparator.inspectDivergences()).toHaveLength(256);
        expect(Object.isFrozen(comparator.inspectDivergences())).toBe(true);
    });
});
