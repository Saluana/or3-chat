import { describe, expect, it } from 'vitest';
import { createRegistry } from '../_registry';
import {
    registerDashboardPlugin,
    unregisterDashboardPlugin,
    listRegisteredDashboardPluginIds,
    useDashboardPlugins,
} from '../dashboard/useDashboardPlugins';
import { usePaneApps } from '../core/usePaneApps';
import { defineComponent } from 'vue';

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

    it('id-based unregister clears current owner and makes dispose a no-op', () => {
        const key = `__or3_test_registry_unregister_${Date.now()}`;
        const registry = createRegistry<{ id: string; value: string }>(key);
        const handle = registry.register({ id: 'item', value: 'a' });
        registry.unregister('item');
        expect(registry.snapshot()).toEqual([]);
        expect(handle.dispose()).toBe(false);
    });

    it('sorts by order then id for stable projection', () => {
        const key = `__or3_test_registry_sort_${Date.now()}`;
        const registry = createRegistry<{ id: string; order?: number }>(key);
        registry.register({ id: 'b', order: 10 });
        registry.register({ id: 'a', order: 10 });
        registry.register({ id: 'c', order: 5 });
        expect(registry.useItems().value.map((item) => item.id)).toEqual(['c', 'a', 'b']);
    });
});

describe('dashboard / pane exact-owner handles', () => {
    it('stale dashboard dispose cannot remove replacement', () => {
        for (const id of listRegisteredDashboardPluginIds()) {
            unregisterDashboardPlugin(id);
        }

        const first = registerDashboardPlugin({
            id: 'owner.plugin',
            icon: 'i-test',
            label: 'First',
        });
        const second = registerDashboardPlugin({
            id: 'owner.plugin',
            icon: 'i-test',
            label: 'Second',
        });

        expect(useDashboardPlugins().value.find((p) => p.id === 'owner.plugin')?.label).toBe(
            'Second'
        );
        expect(first.dispose()).toBe(false);
        expect(useDashboardPlugins().value.find((p) => p.id === 'owner.plugin')?.label).toBe(
            'Second'
        );
        expect(second.dispose()).toBe(true);
        expect(useDashboardPlugins().value.some((p) => p.id === 'owner.plugin')).toBe(false);
    });

    it('stale pane dispose cannot remove replacement', () => {
        const { registerPaneApp, getPaneApp, unregisterPaneApp } = usePaneApps();
        unregisterPaneApp('owner-pane');
        const Stub = defineComponent({ name: 'Stub', template: '<div />' });

        const first = registerPaneApp({
            id: 'owner-pane',
            label: 'First',
            component: Stub,
        });
        const second = registerPaneApp({
            id: 'owner-pane',
            label: 'Second',
            component: Stub,
        });

        expect(getPaneApp('owner-pane')?.label).toBe('Second');
        expect(first.dispose()).toBe(false);
        expect(getPaneApp('owner-pane')?.label).toBe('Second');
        expect(second.dispose()).toBe(true);
        expect(getPaneApp('owner-pane')).toBeUndefined();
    });
});
