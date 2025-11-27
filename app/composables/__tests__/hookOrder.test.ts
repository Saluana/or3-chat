import { describe, it, expect, beforeEach } from 'vitest';
import { createHookEngine } from '~/core/hooks/hooks';

describe('Hook System - Execution Order', () => {
    let engine: ReturnType<typeof createHookEngine>;

    beforeEach(() => {
        engine = createHookEngine();
    });

    it('executes action hooks in priority order (before/during/after pattern)', async () => {
        const calls: string[] = [];

        // Register hooks with different priorities (lower number = earlier execution)
        engine.addAction('test.action', () => calls.push('priority-10'), 10);
        engine.addAction('test.action', () => calls.push('priority-20'), 20);
        engine.addAction('test.action', () => calls.push('priority-5'), 5);
        engine.addAction('test.action', () => calls.push('default')); // default is 10

        await engine.doAction('test.action');

        // Should execute in priority order: 5, 10 (both priority 10), 20
        expect(calls).toEqual([
            'priority-5',
            'priority-10',
            'default',
            'priority-20',
        ]);
    });

    it('executes filter hooks in sequence and transforms values', async () => {
        const operations: string[] = [];

        // Register filters that transform a value and track execution
        engine.addFilter(
            'test.filter',
            ((value: number) => {
                operations.push('double');
                return value * 2;
            }) as (v: unknown) => unknown,
            10
        );

        engine.addFilter(
            'test.filter',
            ((value: number) => {
                operations.push('add-10');
                return value + 10;
            }) as (v: unknown) => unknown,
            20
        );

        engine.addFilter(
            'test.filter',
            ((value: number) => {
                operations.push('square');
                return value * value;
            }) as (v: unknown) => unknown,
            5
        );

        const result = await engine.applyFilters('test.filter', 3);

        // Priority 5 (square): 3 * 3 = 9
        // Priority 10 (double): 9 * 2 = 18
        // Priority 20 (add-10): 18 + 10 = 28
        expect(result).toBe(28);
        expect(operations).toEqual(['square', 'double', 'add-10']);
    });
});

describe('Hook System - Typed Wrapper Integration', () => {
    let engine: ReturnType<typeof createHookEngine>;

    beforeEach(() => {
        engine = createHookEngine();
    });

    it('handles async action hooks with proper awaiting', async () => {
        const timeline: Array<{ event: string; time: number }> = [];
        const start = Date.now();

        engine.addAction('async.test', async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            timeline.push({ event: 'first', time: Date.now() - start });
        });

        engine.addAction('async.test', async () => {
            await new Promise((resolve) => setTimeout(resolve, 5));
            timeline.push({ event: 'second', time: Date.now() - start });
        });

        await engine.doAction('async.test');

        // Both should have executed
        expect(timeline).toHaveLength(2);
        expect(timeline[0]?.event).toBe('first');
        expect(timeline[1]?.event).toBe('second');
        // Second should execute after first completes
        expect(timeline[1]?.time).toBeGreaterThanOrEqual(
            timeline[0]?.time || 0
        );
    });

    it('supports removing hooks and prevents execution', async () => {
        const calls: string[] = [];

        const callback1 = () => {
            calls.push('callback1');
        };
        const callback2 = () => {
            calls.push('callback2');
        };
        const callback3 = () => {
            calls.push('callback3');
        };

        engine.addAction('removal.test', callback1);
        engine.addAction('removal.test', callback2);
        engine.addAction('removal.test', callback3);

        // First execution - all should run
        await engine.doAction('removal.test');
        expect(calls).toEqual(['callback1', 'callback2', 'callback3']);

        // Remove callback2
        calls.length = 0;
        engine.removeAction('removal.test', callback2);

        // Second execution - only 1 and 3
        await engine.doAction('removal.test');
        expect(calls).toEqual(['callback1', 'callback3']);
    });
});
