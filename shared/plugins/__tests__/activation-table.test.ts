import { describe, expect, it, vi } from 'vitest';
import { ActivationTable } from '../activation-table';

describe('ActivationTable', () => {
    it('publishes with a synchronous expected-owner compare-and-swap', () => {
        const table = new ActivationTable();
        const first = Symbol('first');
        const second = Symbol('second');
        const listener = vi.fn();
        table.subscribe(listener);

        expect(table.publish({ pluginId: 'alpha', expected: undefined, next: first })).toBe(true);
        expect(table.current('alpha')).toBe(first);
        expect(table.revision).toBe(1);
        expect(listener).toHaveBeenCalledWith({
            pluginId: 'alpha',
            previous: undefined,
            next: first,
            revision: 1,
        });

        expect(table.publish({ pluginId: 'alpha', expected: undefined, next: second })).toBe(false);
        expect(table.current('alpha')).toBe(first);
        expect(table.revision).toBe(1);
    });

    it('allows only the current owner to replace or clear the pointer', () => {
        const table = new ActivationTable();
        const stale = Symbol('stale');
        const current = Symbol('current');
        const next = Symbol('next');
        table.publish({ pluginId: 'alpha', expected: undefined, next: current });

        expect(table.publish({ pluginId: 'alpha', expected: stale, next })).toBe(false);
        expect(table.compareAndSwap({ pluginId: 'alpha', expected: stale, next: undefined })).toBe(false);
        expect(table.publish({ pluginId: 'alpha', expected: current, next })).toBe(true);
        expect(table.compareAndSwap({ pluginId: 'alpha', expected: next, next: undefined })).toBe(true);
        expect(table.current('alpha')).toBeUndefined();
        expect(table.revision).toBe(3);
    });

    it('returns immutable, stable-order inspection snapshots', () => {
        const table = new ActivationTable();
        table.publish({ pluginId: 'beta', expected: undefined, next: Symbol('beta') });
        table.publish({ pluginId: 'alpha', expected: undefined, next: Symbol('alpha') });

        const snapshot = table.snapshot();
        expect(snapshot.map((entry) => entry.pluginId)).toEqual(['alpha', 'beta']);
        expect(Object.isFrozen(snapshot)).toBe(true);
        expect(snapshot.every(Object.isFrozen)).toBe(true);
    });
});
