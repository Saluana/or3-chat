import { describe, expect, it, vi } from 'vitest';
import { ActivationTable } from '../activation-table';
import { ContributionRegistry } from '../contribution-registry';
import { TransactionalPluginScope } from '../transactional-plugin-scope';

describe('Milestone 4 leak gate', () => {
    it('leaves zero managed records, activation owners, callbacks, or subscriptions after 1,000 cycles', async () => {
        const table = new ActivationTable();
        const registry = new ContributionRegistry<{
            id: string;
            generation: number;
        }>({
            activationTable: table,
            getId: (value) => value.id,
        });
        const projectionListener = vi.fn();
        const stopProjection = registry.subscribe(projectionListener);
        let cleanupCount = 0;

        for (let generation = 1; generation <= 1_000; generation++) {
            const scope = new TransactionalPluginScope({
                pluginId: 'leak-gate',
                generation,
                activationTable: table,
            });
            scope.stageContributions(registry, [
                { value: { id: 'contribution', generation } },
            ]);
            scope.onDispose(() => {
                cleanupCount += 1;
            });
            expect(await scope.validate()).toEqual({ ok: true });
            expect(await scope.preActivate()).toEqual({ ok: true });
            expect(scope.publish()).toEqual({ ok: true });
            expect(await scope.dispose()).toMatchObject({
                status: 'clean',
                disposedCount: 1,
            });
        }

        expect(cleanupCount).toBe(1_000);
        expect(registry.inspect()).toEqual([]);
        expect(registry.snapshot(undefined)).toEqual([]);
        expect(table.snapshot()).toEqual([]);
        expect(registry.subscriberCount).toBe(1);
        expect(table.subscriberCount).toBe(1);
        stopProjection();
        expect(registry.subscriberCount).toBe(0);
        registry.dispose();
        expect(table.subscriberCount).toBe(0);
    });

    it('leaves zero legacy records after 1,000 exact-owner register/dispose cycles', () => {
        const table = new ActivationTable();
        const registry = new ContributionRegistry<{ id: string }>({
            activationTable: table,
            getId: (value) => value.id,
        });

        for (let index = 0; index < 1_000; index++) {
            const handle = registry.registerLegacy({
                value: { id: `legacy-${index}` },
            });
            expect(handle.dispose()).toBe(true);
            expect(handle.dispose()).toBe(false);
        }

        expect(registry.inspect()).toEqual([]);
        expect(registry.listLegacyIds()).toEqual([]);
        registry.dispose();
        expect(table.subscriberCount).toBe(0);
    });
});
