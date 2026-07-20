import { describe, expect, it } from 'vitest';
import { createRegistry } from '../_registry';

describe('createRegistry exact-owner handles', () => {
    it('does not let a stale handle unregister a replaced contribution', () => {
        const key = `__or3_test_registry_${Date.now()}`;
        const registry = createRegistry<{ id: string; value: string }>(key);

        const first = registry.register({ id: 'item', value: 'a' });
        const second = registry.register({ id: 'item', value: 'b' });

        expect(registry.snapshot()).toEqual([{ id: 'item', value: 'b' }]);
        expect(first.dispose()).toBe(false);
        expect(registry.snapshot()).toEqual([{ id: 'item', value: 'b' }]);
        expect(second.dispose()).toBe(true);
        expect(registry.snapshot()).toEqual([]);
    });
});
