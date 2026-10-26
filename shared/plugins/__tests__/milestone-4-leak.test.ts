import { describe, expect, it } from 'vitest';
import { ActivationTable } from '../activation-table';
import { ContributionRegistry } from '../contribution-registry';

describe('Milestone 4 leak gate', () => {
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
