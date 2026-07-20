import { describe, expect, it, vi } from 'vitest';
import { ActivationTable } from '../../plugins/activation-table';
import { HookRecordStore } from '../hook-record-store';

function createStore() {
    const activationTable = new ActivationTable();
    return {
        activationTable,
        store: new HookRecordStore({ activationTable }),
    };
}

describe('HookRecordStore', () => {
    it('merges sorted exact and wildcard legacy records by priority and global sequence', () => {
        const { store } = createStore();
        const wildcardFirst = vi.fn();
        const exactSecond = vi.fn();
        const exactLow = vi.fn();
        const wildcardHigh = vi.fn();

        store.registerLegacy({
            kind: 'action',
            name: 'demo.*',
            fn: wildcardFirst,
        });
        store.registerLegacy({
            kind: 'action',
            name: 'demo.action.order',
            fn: exactSecond,
        });
        store.registerLegacy({
            kind: 'action',
            name: 'demo.action.order',
            fn: exactLow,
            priority: 5,
        });
        store.registerLegacy({
            kind: 'action',
            name: '*.action.order',
            fn: wildcardHigh,
            priority: 20,
        });

        expect(
            store.matching('action', 'demo.action.order').map(({ fn }) => fn),
        ).toEqual([exactLow, wildcardFirst, exactSecond, wildcardHigh]);
    });

    it('keeps managed records hidden until their exact owner is current', () => {
        const { activationTable, store } = createStore();
        const oldOwner = Symbol('old');
        const nextOwner = Symbol('next');
        const legacy = vi.fn();
        const oldManaged = vi.fn();
        const nextManaged = vi.fn();

        store.registerLegacy({
            kind: 'filter',
            name: 'demo.filter',
            fn: legacy,
        });
        store.registerManaged({
            kind: 'filter',
            name: 'demo.*',
            fn: oldManaged,
            owner: oldOwner,
            pluginId: 'plugin.demo',
            generation: 1,
        });
        store.registerManaged({
            kind: 'filter',
            name: 'demo.filter',
            fn: nextManaged,
            owner: nextOwner,
            pluginId: 'plugin.demo',
            generation: 2,
        });

        expect(
            store.matching('filter', 'demo.filter').map(({ fn }) => fn),
        ).toEqual([legacy]);
        expect(
            activationTable.publish({
                pluginId: 'plugin.demo',
                expected: undefined,
                next: oldOwner,
            }),
        ).toBe(true);
        expect(
            store.matching('filter', 'demo.filter').map(({ fn }) => fn),
        ).toEqual([legacy, oldManaged]);
        expect(
            activationTable.publish({
                pluginId: 'plugin.demo',
                expected: oldOwner,
                next: nextOwner,
            }),
        ).toBe(true);
        expect(
            store.matching('filter', 'demo.filter').map(({ fn }) => fn),
        ).toEqual([legacy, nextManaged]);
        expect(
            store.inspect().map(({ lifecycleState }) => lifecycleState),
        ).toEqual(['legacy-visible', 'managed-hidden', 'managed-current']);
    });

    it('removes only records belonging to the exact owner', () => {
        const { activationTable, store } = createStore();
        const staleOwner = Symbol('stale');
        const currentOwner = Symbol('current');
        const stale = vi.fn();
        const current = vi.fn();

        store.registerManaged({
            kind: 'action',
            name: 'demo.action',
            fn: stale,
            owner: staleOwner,
            pluginId: 'plugin.demo',
            generation: 1,
        });
        store.registerManaged({
            kind: 'action',
            name: 'demo.action',
            fn: current,
            owner: currentOwner,
            pluginId: 'plugin.demo',
            generation: 2,
        });
        activationTable.publish({
            pluginId: 'plugin.demo',
            expected: undefined,
            next: currentOwner,
        });

        expect(store.removeOwner(staleOwner)).toBe(1);
        expect(
            store.matching('action', 'demo.action').map(({ fn }) => fn),
        ).toEqual([current]);
        expect(store.removeOwner(staleOwner)).toBe(0);
        expect(store.count()).toBe(1);
    });

    it('preserves exact-all and wildcard-first legacy removal asymmetry', () => {
        const { store } = createStore();
        const exact = vi.fn();
        const wildcard = vi.fn();
        store.registerLegacy({
            kind: 'action',
            name: 'demo.action',
            fn: exact,
            priority: 10,
        });
        store.registerLegacy({
            kind: 'action',
            name: 'demo.action',
            fn: exact,
            priority: 20,
        });
        store.registerLegacy({
            kind: 'action',
            name: 'demo.*',
            fn: wildcard,
            priority: 20,
        });
        store.registerLegacy({
            kind: 'action',
            name: 'demo.*',
            fn: wildcard,
            priority: 5,
        });

        expect(
            store.removeLegacy({
                kind: 'action',
                name: 'demo.action',
                fn: exact,
            }),
        ).toBe(2);
        expect(
            store.removeLegacy({
                kind: 'action',
                name: 'demo.*',
                fn: wildcard,
            }),
        ).toBe(1);
        expect(
            store
                .matching('action', 'demo.action')
                .map(({ priority }) => priority),
        ).toEqual([5]);
    });

    it('keeps action/filter buckets isolated and returns immutable inspection snapshots', () => {
        const { store } = createStore();
        const action = vi.fn();
        const filter = vi.fn();
        const actionRecord = store.registerLegacy({
            kind: 'action',
            name: 'demo.hook',
            fn: action,
            acceptedArgs: 1,
        });
        store.registerLegacy({ kind: 'filter', name: 'demo.hook', fn: filter });

        expect(actionRecord.acceptedArgs).toBe(1);
        expect(
            store.matching('action', 'demo.hook').map(({ fn }) => fn),
        ).toEqual([action]);
        expect(
            store.matching('filter', 'demo.hook').map(({ fn }) => fn),
        ).toEqual([filter]);
        expect(store.count('action')).toBe(1);
        expect(store.count('filter')).toBe(1);
        expect(Object.isFrozen(store.inspect())).toBe(true);
        expect(Object.isFrozen(store.inspect()[0])).toBe(true);
    });

    it('invalidates only the affected exact plan and preserves unrelated cached plans', () => {
        const { store } = createStore();
        store.registerLegacy({ kind: 'action', name: 'demo.a', fn: vi.fn() });
        store.registerLegacy({ kind: 'action', name: 'demo.b', fn: vi.fn() });
        store.matching('action', 'demo.a');
        store.matching('action', 'demo.b');

        store.registerLegacy({ kind: 'action', name: 'demo.a', fn: vi.fn() });

        expect(store.inspectPlanCache().map(({ name }) => name)).toEqual([
            'demo.b',
        ]);
        store.matching('action', 'demo.a');
        expect(store.inspectPlanCache().map(({ name }) => name)).toEqual([
            'demo.b',
            'demo.a',
        ]);
        expect(store.inspectGenerations().exact).toEqual([
            { kind: 'action', name: 'demo.a', generation: 2 },
            { kind: 'action', name: 'demo.b', generation: 1 },
        ]);
    });

    it('invalidates kind plans on wildcard changes and all plans on activation changes', () => {
        const { activationTable, store } = createStore();
        store.matching('action', 'demo.action');
        store.matching('filter', 'demo.filter');

        store.registerLegacy({ kind: 'action', name: 'demo.*', fn: vi.fn() });
        expect(store.inspectPlanCache().map(({ kind }) => kind)).toEqual([
            'filter',
        ]);
        expect(store.inspectGenerations().actionWildcards).toBe(1);

        const owner = Symbol('managed');
        activationTable.publish({
            pluginId: 'plugin.demo',
            expected: undefined,
            next: owner,
        });
        expect(store.planCacheSize).toBe(0);
        expect(store.inspectGenerations().activationRevision).toBe(1);
    });

    it('uses LRU recency and hard-bounds high-cardinality plans at 1,024', () => {
        const { store } = createStore();
        expect(store.planCacheCapacity).toBe(1_024);

        for (let index = 0; index < 1_024; index++) {
            store.matching('action', `demo.${index}`);
        }
        store.matching('action', 'demo.0');
        store.matching('action', 'demo.1024');

        const names = store.inspectPlanCache().map(({ name }) => name);
        expect(store.planCacheSize).toBe(1_024);
        expect(names).toContain('demo.0');
        expect(names).not.toContain('demo.1');
        expect(names).toContain('demo.1024');
        expect(Object.isFrozen(store.inspectPlanCache())).toBe(true);
    });

    it('caps custom cache capacity and releases activation subscriptions on dispose', () => {
        const activationTable = new ActivationTable();
        const store = new HookRecordStore({
            activationTable,
            planCacheCapacity: 10_000,
        });
        expect(store.planCacheCapacity).toBe(1_024);
        expect(activationTable.subscriberCount).toBe(1);
        store.matching('action', 'demo.action');

        store.dispose();

        expect(store.planCacheSize).toBe(0);
        expect(activationTable.subscriberCount).toBe(0);
    });
});
