import { describe, expect, it, vi } from 'vitest';
import { ActivationTable } from '../activation-table';
import { ContributionRegistry } from '../contribution-registry';
import { TransactionalPluginScope } from '../transactional-plugin-scope';

type Item = { id: string; label: string };

function registry(table: ActivationTable) {
    return new ContributionRegistry<Item, void>({
        activationTable: table,
        getId: (value) => value.id,
    });
}

async function prepare(scope: TransactionalPluginScope) {
    expect(await scope.validate()).toEqual({ ok: true });
    expect(await scope.preActivate()).toEqual({ ok: true });
}

describe('TransactionalPluginScope', () => {
    it('leaves the old owner visible when validation fails before hidden insertion', async () => {
        const table = new ActivationTable();
        const contributions = registry(table);
        const oldOwner = Symbol('old');
        contributions.stage({
            owner: oldOwner,
            pluginId: 'alpha',
            generation: 1,
            values: [{ value: { id: 'same', label: 'old' } }],
        });
        table.publish({ pluginId: 'alpha', expected: undefined, next: oldOwner });
        const scope = new TransactionalPluginScope({
            pluginId: 'alpha',
            generation: 2,
            activationTable: table,
        });
        scope.stageContributions(contributions, [
            { value: { id: 'same', label: 'new' } },
            { value: { id: 'same', label: 'duplicate' } },
        ]);

        await expect(scope.validate()).resolves.toMatchObject({
            ok: false,
            error: { code: 'validation-failed', phase: 'validation' },
        });

        expect(table.current('alpha')).toBe(oldOwner);
        expect(contributions.get('same', undefined)?.label).toBe('old');
        expect(contributions.inspect()).toHaveLength(1);
    });

    it('pre-activates while the previous owner remains visible', async () => {
        const table = new ActivationTable();
        const contributions = registry(table);
        const oldOwner = Symbol('old');
        contributions.stage({
            owner: oldOwner,
            pluginId: 'alpha',
            generation: 1,
            values: [{ value: { id: 'same', label: 'old' } }],
        });
        table.publish({ pluginId: 'alpha', expected: undefined, next: oldOwner });
        const observed = vi.fn();
        const scope = new TransactionalPluginScope({
            pluginId: 'alpha',
            generation: 2,
            activationTable: table,
        });
        scope.stageContributions(contributions, [
            { value: { id: 'same', label: 'new' } },
        ]);
        scope.onPreActivate(() => {
            observed(contributions.get('same', undefined)?.label);
        });

        await prepare(scope);

        expect(observed).toHaveBeenCalledWith('old');
        expect(scope.state).toBe('prepared');
        expect(contributions.inspect()).toHaveLength(1);
    });

    it('publishes every staged registry through one activation CAS', async () => {
        const table = new ActivationTable();
        const actions = registry(table);
        const pages = registry(table);
        const actionListener = vi.fn();
        const pageListener = vi.fn();
        actions.subscribe(actionListener);
        pages.subscribe(pageListener);
        const scope = new TransactionalPluginScope({
            pluginId: 'alpha',
            generation: 1,
            activationTable: table,
        });
        scope.stageContributions(actions, [
            { value: { id: 'action', label: 'Action' } },
        ]);
        scope.stageContributions(pages, [
            { value: { id: 'page', label: 'Page' } },
        ]);
        await prepare(scope);

        expect(scope.publish()).toEqual({ ok: true });

        expect(scope.state).toBe('published');
        expect(actions.snapshot(undefined).map((item) => item.id)).toEqual(['action']);
        expect(pages.snapshot(undefined).map((item) => item.id)).toEqual(['page']);
        expect(actionListener).toHaveBeenCalledTimes(1);
        expect(pageListener).toHaveBeenCalledTimes(1);
        expect(table.revision).toBe(1);
    });

    it('removes hidden records when a newer generation wins the CAS', async () => {
        const table = new ActivationTable();
        const contributions = registry(table);
        const winner = Symbol('winner');
        table.publish({ pluginId: 'alpha', expected: undefined, next: winner });
        const scope = new TransactionalPluginScope({
            pluginId: 'alpha',
            generation: 2,
            activationTable: table,
        });
        scope.stageContributions(contributions, [
            { value: { id: 'new', label: 'loser' } },
        ]);
        await prepare(scope);

        expect(scope.publish()).toMatchObject({
            ok: false,
            error: { code: 'stale-generation' },
        });
        expect(table.current('alpha')).toBe(winner);
        expect(contributions.inspect()).toEqual([]);
    });

    it('restores the previous pointer before removing records after a synchronous publish fault', async () => {
        const table = new ActivationTable();
        const contributions = registry(table);
        const oldOwner = Symbol('old');
        contributions.stage({
            owner: oldOwner,
            pluginId: 'alpha',
            generation: 1,
            values: [{ value: { id: 'same', label: 'old' } }],
        });
        table.publish({ pluginId: 'alpha', expected: undefined, next: oldOwner });
        let newOwner!: symbol;
        const scope = new TransactionalPluginScope({
            pluginId: 'alpha',
            generation: 2,
            activationTable: table,
            afterPublish() {
                expect(table.current('alpha')).toBe(newOwner);
                throw new Error('forced finalization fault');
            },
        });
        newOwner = scope.owner;
        scope.stageContributions(contributions, [
            { value: { id: 'same', label: 'new' } },
        ]);
        await prepare(scope);

        expect(scope.publish(oldOwner)).toMatchObject({
            ok: false,
            error: { code: 'publication-failed' },
        });

        expect(table.current('alpha')).toBe(oldOwner);
        expect(contributions.get('same', undefined)?.label).toBe('old');
        expect(contributions.inspect().map((record) => record.owner)).toEqual([oldOwner]);
    });

    it('disposes sequentially in LIFO order and stale disposal cannot clear a newer owner', async () => {
        const table = new ActivationTable();
        const contributions = registry(table);
        const trace: string[] = [];
        const old = new TransactionalPluginScope({
            pluginId: 'alpha',
            generation: 1,
            activationTable: table,
        });
        old.stageContributions(contributions, [
            { value: { id: 'same', label: 'old' } },
        ]);
        old.onDispose(async () => {
            trace.push('first:start');
            await Promise.resolve();
            trace.push('first:end');
        });
        old.onDispose(async () => {
            trace.push('second:start');
            await Promise.resolve();
            trace.push('second:end');
        });
        await prepare(old);
        expect(old.publish()).toEqual({ ok: true });

        const next = new TransactionalPluginScope({
            pluginId: 'alpha',
            generation: 2,
            activationTable: table,
        });
        next.stageContributions(contributions, [
            { value: { id: 'same', label: 'next' } },
        ]);
        await prepare(next);
        expect(next.publish(old.owner)).toEqual({ ok: true });

        await expect(old.dispose()).resolves.toMatchObject({ status: 'clean', disposedCount: 2 });
        expect(trace).toEqual(['second:start', 'second:end', 'first:start', 'first:end']);
        expect(table.current('alpha')).toBe(next.owner);
        expect(contributions.get('same', undefined)?.label).toBe('next');
        expect(old.signal.aborted).toBe(true);
    });
});
