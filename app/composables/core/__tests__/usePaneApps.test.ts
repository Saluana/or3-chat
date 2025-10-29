import { describe, it, expect, beforeEach } from 'vitest';
import { usePaneApps, type PaneAppDef } from '../usePaneApps';

describe('usePaneApps', () => {
    beforeEach(() => {
        // Clean up global registry before each test
        const g = globalThis as any;
        g.__or3PaneAppsRegistry = new Map();
    });

    it('registers a pane app', () => {
        const { registerPaneApp, getPaneApp } = usePaneApps();

        const def: PaneAppDef = {
            id: 'todo',
            label: 'Todo App',
            icon: 'check',
            component: { name: 'TodoPane', template: '<div>todo</div>' },
        };

        registerPaneApp(def);

        const app = getPaneApp('todo');
        expect(app).toBeDefined();
        expect(app?.id).toBe('todo');
        expect(app?.label).toBe('Todo App');
    });

    it('overwrites existing app with same id', () => {
        const { registerPaneApp, getPaneApp } = usePaneApps();

        registerPaneApp({
            id: 'app1',
            label: 'Version 1',
            component: { name: 'V1', template: '<div>v1</div>' },
        });

        let app = getPaneApp('app1');
        expect(app?.label).toBe('Version 1');

        registerPaneApp({
            id: 'app1',
            label: 'Version 2',
            component: { name: 'V2', template: '<div>v2</div>' },
        });

        app = getPaneApp('app1');
        expect(app?.label).toBe('Version 2');
    });

    it('unregisters a pane app', () => {
        const { registerPaneApp, unregisterPaneApp, getPaneApp } =
            usePaneApps();

        registerPaneApp({
            id: 'todo',
            label: 'Todo',
            component: { name: 'Todo', template: '<div>todo</div>' },
        });

        expect(getPaneApp('todo')).toBeDefined();

        unregisterPaneApp('todo');

        expect(getPaneApp('todo')).toBeUndefined();
    });

    it('returns undefined for missing app', () => {
        const { getPaneApp } = usePaneApps();
        expect(getPaneApp('nonexistent')).toBeUndefined();
    });

    it('lists all registered apps sorted by order', () => {
        const { registerPaneApp, listPaneApps } = usePaneApps();

        registerPaneApp({
            id: 'app1',
            label: 'First',
            component: { name: 'A1', template: '<div>a1</div>' },
            order: 300,
        });

        registerPaneApp({
            id: 'app2',
            label: 'Second',
            component: { name: 'A2', template: '<div>a2</div>' },
            order: 100,
        });

        registerPaneApp({
            id: 'app3',
            label: 'Third',
            component: { name: 'A3', template: '<div>a3</div>' },
            // no order, should default to 200
        });

        const list = listPaneApps.value;
        expect(list).toHaveLength(3);
        expect(list[0]?.id).toBe('app2'); // order 100
        expect(list[1]?.id).toBe('app3'); // order 200 (default)
        expect(list[2]?.id).toBe('app1'); // order 300
    });

    it('applies default order when not specified', () => {
        const { registerPaneApp, getPaneApp } = usePaneApps();

        registerPaneApp({
            id: 'no-order',
            label: 'No Order App',
            component: { name: 'NoOrder', template: '<div>no order</div>' },
        });

        const app = getPaneApp('no-order');
        expect(app?.order).toBe(200);
    });

    it('handles async components', () => {
        const { registerPaneApp, getPaneApp } = usePaneApps();

        const asyncFactory = async () => ({
            name: 'Async',
            template: '<div>async</div>',
        });

        registerPaneApp({
            id: 'async-app',
            label: 'Async App',
            component: asyncFactory,
        });

        const app = getPaneApp('async-app');
        expect(app?.component).toBe(asyncFactory);
    });

    it('preserves createInitialRecord callback', () => {
        const { registerPaneApp, getPaneApp } = usePaneApps();

        const mockCallback = async () => ({ id: 'mock-id' });

        registerPaneApp({
            id: 'with-callback',
            label: 'With Callback',
            component: {
                name: 'WithCallback',
                template: '<div>callback</div>',
            },
            createInitialRecord: mockCallback,
        });

        const app = getPaneApp('with-callback');
        expect(app?.createInitialRecord).toBe(mockCallback);
    });

    it('preserves postType override', () => {
        const { registerPaneApp, getPaneApp } = usePaneApps();

        registerPaneApp({
            id: 'custom-type',
            label: 'Custom Type',
            component: { name: 'CustomType', template: '<div>custom</div>' },
            postType: 'special_post_type',
        });

        const app = getPaneApp('custom-type');
        expect(app?.postType).toBe('special_post_type');
    });

    it('component is marked raw to avoid reactivity overhead', () => {
        const { registerPaneApp, getPaneApp } = usePaneApps();

        const component = { name: 'Test', template: '<div>test</div>' };

        registerPaneApp({
            id: 'raw-test',
            label: 'Raw Test',
            component,
        });

        const app = getPaneApp('raw-test');
        // markRaw should prevent Vue reactivity on the component
        expect(app?.component).toBe(component);
    });

    it('computed listPaneApps updates reactively after registration', () => {
        // This test verifies that the computed properly triggers on registration
        // Note: prior tests may have left entries in the registry, so we just
        // verify that registration increments the list
        const { registerPaneApp, listPaneApps } = usePaneApps();

        const initialLength = listPaneApps.value.length;

        registerPaneApp({
            id: 'reactive-test-first',
            label: 'First',
            component: { name: 'First', template: '<div>first</div>' },
        });

        expect(listPaneApps.value).toHaveLength(initialLength + 1);

        registerPaneApp({
            id: 'reactive-test-second',
            label: 'Second',
            component: { name: 'Second', template: '<div>second</div>' },
        });

        expect(listPaneApps.value).toHaveLength(initialLength + 2);
    });

    it('handles empty icon gracefully', () => {
        const { registerPaneApp, getPaneApp } = usePaneApps();

        registerPaneApp({
            id: 'no-icon',
            label: 'No Icon App',
            component: { name: 'NoIcon', template: '<div>no icon</div>' },
        });

        const app = getPaneApp('no-icon');
        expect(app?.icon).toBeUndefined();
    });
});
