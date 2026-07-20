import { describe, expect, it, vi } from 'vitest';
import { ActivationTable } from '../activation-table';
import { ContributionRegistry } from '../contribution-registry';

type Item = { id: string; order: number; label: string };

function registry(table = new ActivationTable()) {
    return new ContributionRegistry<Item, { allowed: boolean }, { surface: string }>({
        activationTable: table,
        getId: (value) => value.id,
        normalize: (value) => Object.freeze({ ...value }),
        isVisible: (_value, context) => context.allowed,
        compare: (left, right) => left.order - right.order || left.id.localeCompare(right.id),
        defaultMetadata: () => ({ surface: 'test' }),
        now: () => 123,
    });
}

describe('ContributionRegistry', () => {
    it('keeps managed staging hidden until its owner is current', () => {
        const table = new ActivationTable();
        const contributions = registry(table);
        const owner = Symbol('alpha:1');
        expect(
            contributions.stage({
                owner,
                pluginId: 'alpha',
                generation: 1,
                values: [
                    { value: { id: 'action', order: 10, label: 'Action' } },
                ],
            })
        ).toEqual({ ok: true, count: 1 });

        expect(contributions.snapshot({ allowed: true })).toEqual([]);
        expect(contributions.inspect()[0]).toMatchObject({
            owner,
            pluginId: 'alpha',
            generation: 1,
            visibility: 'managed',
            lifecycleState: 'managed-hidden',
            registeredAt: 123,
        });

        table.publish({ pluginId: 'alpha', expected: undefined, next: owner });
        expect(contributions.snapshot({ allowed: true })).toEqual([
            { id: 'action', order: 10, label: 'Action' },
        ]);
        expect(contributions.inspect()[0]?.lifecycleState).toBe('managed-current');
        expect(contributions.snapshot({ allowed: false })).toEqual([]);
    });

    it('rejects staged conflicts without inserting partial records', () => {
        const contributions = registry();
        const owner = Symbol('owner');
        expect(
            contributions.stage({
                owner,
                pluginId: 'alpha',
                generation: 1,
                values: [
                    { value: { id: 'same', order: 1, label: 'A' } },
                    { value: { id: 'same', order: 2, label: 'B' } },
                ],
            })
        ).toEqual({ ok: false, code: 'duplicate-id', id: 'same' });
        expect(contributions.inspect()).toEqual([]);
    });

    it('keeps legacy records immediately visible and stale handles exact-owner safe', () => {
        const contributions = registry();
        const first = contributions.registerLegacy({
            value: { id: 'same', order: 2, label: 'first' },
        });
        const second = contributions.registerLegacy({
            value: { id: 'same', order: 1, label: 'second' },
        });

        expect(first.dispose()).toBe(false);
        expect(contributions.get('same', { allowed: true })?.label).toBe('second');
        expect(second.dispose()).toBe(true);
        expect(contributions.snapshot({ allowed: true })).toEqual([]);
    });

    it('removing an old owner cannot remove the current same-id generation', () => {
        const table = new ActivationTable();
        const contributions = registry(table);
        const oldOwner = Symbol('old');
        const newOwner = Symbol('new');
        for (const [owner, generation, label] of [
            [oldOwner, 1, 'old'],
            [newOwner, 2, 'new'],
        ] as const) {
            contributions.stage({
                owner,
                pluginId: 'alpha',
                generation,
                values: [{ value: { id: 'same', order: 1, label } }],
            });
        }
        table.publish({ pluginId: 'alpha', expected: undefined, next: oldOwner });
        table.publish({ pluginId: 'alpha', expected: oldOwner, next: newOwner });

        expect(contributions.removeOwner(oldOwner)).toBe(1);
        expect(contributions.get('same', { allowed: true })?.label).toBe('new');
        expect(contributions.inspect()).toHaveLength(1);
    });

    it('emits one surface publication for a 100-record activation', () => {
        const table = new ActivationTable();
        const contributions = registry(table);
        const owner = Symbol('bulk');
        const listener = vi.fn();
        contributions.subscribe(listener);
        contributions.stage({
            owner,
            pluginId: 'bulk',
            generation: 1,
            values: Array.from({ length: 100 }, (_, index) => ({
                value: { id: `item-${index}`, order: index, label: String(index) },
            })),
        });

        expect(listener).not.toHaveBeenCalled();
        table.publish({ pluginId: 'bulk', expected: undefined, next: owner });

        expect(listener).toHaveBeenCalledTimes(1);
        expect(contributions.projectionRevision).toBe(1);
        expect(contributions.activationRevision).toBe(1);
        expect(contributions.snapshot({ allowed: true })).toHaveLength(100);
    });

    it('returns immutable inspection arrays and record wrappers', () => {
        const contributions = registry();
        contributions.registerLegacy({ value: { id: 'alpha', order: 1, label: 'A' } });

        const inspected = contributions.inspect();
        expect(Object.isFrozen(inspected)).toBe(true);
        expect(inspected.every(Object.isFrozen)).toBe(true);
    });
});
