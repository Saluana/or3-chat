import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSidebarPages, type SidebarPageDef } from '../useSidebarPages';

// Mock process.client for testing
const originalProcess = process;

describe('useSidebarPages', () => {
    beforeEach(() => {
        // Clean up global registry before each test
        const g = globalThis as any;
        // Clear existing entries or create new Map
        if (g.__or3SidebarPagesRegistry) {
            g.__or3SidebarPagesRegistry.clear();
        } else {
            g.__or3SidebarPagesRegistry = new Map();
        }

        // Mock process.client
        (global as any).process = { ...originalProcess, client: true };
    });

    it('registers a sidebar page', () => {
        const { registerSidebarPage, getSidebarPage } = useSidebarPages();

        const def: SidebarPageDef = {
            id: 'todo-page',
            label: 'Todo Page',
            icon: 'pixelarticons:list',
            component: { name: 'TodoPage', template: '<div>todo page</div>' },
        };

        registerSidebarPage(def);

        const page = getSidebarPage('todo-page');
        expect(page).toBeDefined();
        expect(page?.id).toBe('todo-page');
        expect(page?.label).toBe('Todo Page');
        expect(page?.icon).toBe('pixelarticons:list');
    });

    it('overwrites existing page with same id', () => {
        const { registerSidebarPage, getSidebarPage } = useSidebarPages();

        registerSidebarPage({
            id: 'page1',
            label: 'Version 1',
            icon: 'pixelarticons:home',
            component: { name: 'V1', template: '<div>v1</div>' },
        });

        let page = getSidebarPage('page1');
        expect(page?.label).toBe('Version 1');

        registerSidebarPage({
            id: 'page1',
            label: 'Version 2',
            icon: 'pixelarticons:home',
            component: { name: 'V2', template: '<div>v2</div>' },
        });

        page = getSidebarPage('page1');
        expect(page?.label).toBe('Version 2');
    });

    it('unregisters a sidebar page', () => {
        const { registerSidebarPage, unregisterSidebarPage, getSidebarPage } =
            useSidebarPages();

        registerSidebarPage({
            id: 'test-page',
            label: 'Test Page',
            icon: 'pixelarticons:test',
            component: { name: 'TestPage', template: '<div>test</div>' },
        });

        expect(getSidebarPage('test-page')).toBeDefined();

        unregisterSidebarPage('test-page');

        expect(getSidebarPage('test-page')).toBeUndefined();
    });

    it('returns undefined for missing page', () => {
        const { getSidebarPage } = useSidebarPages();
        expect(getSidebarPage('nonexistent')).toBeUndefined();
    });

    it('lists all registered pages sorted by order', () => {
        const { registerSidebarPage, listSidebarPages } = useSidebarPages();

        registerSidebarPage({
            id: 'page1',
            label: 'First',
            icon: 'pixelarticons:first',
            component: { name: 'P1', template: '<div>p1</div>' },
            order: 300,
        });

        registerSidebarPage({
            id: 'page2',
            label: 'Second',
            icon: 'pixelarticons:second',
            component: { name: 'P2', template: '<div>p2</div>' },
            order: 100,
        });

        registerSidebarPage({
            id: 'page3',
            label: 'Third',
            icon: 'pixelarticons:third',
            component: { name: 'P3', template: '<div>p3</div>' },
            // no order, should default to 200
        });

        const list = listSidebarPages.value;
        expect(list).toHaveLength(3);
        expect(list[0]?.id).toBe('page2'); // order 100
        expect(list[1]?.id).toBe('page3'); // order 200 (default)
        expect(list[2]?.id).toBe('page1'); // order 300
    });

    it('applies default order when not specified', () => {
        const { registerSidebarPage, getSidebarPage } = useSidebarPages();

        registerSidebarPage({
            id: 'no-order',
            label: 'No Order Page',
            icon: 'pixelarticons:no-order',
            component: { name: 'NoOrder', template: '<div>no order</div>' },
        });

        const page = getSidebarPage('no-order');
        expect(page?.order).toBe(200);
    });

    it('wraps async components with defineAsyncComponent', () => {
        const { registerSidebarPage, getSidebarPage } = useSidebarPages();

        const asyncFactory = async () => ({
            name: 'AsyncPage',
            template: '<div>async page</div>',
        });

        registerSidebarPage({
            id: 'async-page',
            label: 'Async Page',
            icon: 'pixelarticons:async',
            component: asyncFactory,
        });

        const page = getSidebarPage('async-page');
        expect(page?.component).toBeDefined();
        // Component should be wrapped with defineAsyncComponent
        expect(typeof page?.component).toBe('object');
        expect(page?.component).not.toBe(asyncFactory); // Should be wrapped
    });

    it('passes through Vue components without wrapping', () => {
        const { registerSidebarPage, getSidebarPage } = useSidebarPages();

        const vueComponent = {
            name: 'VueComponent',
            template: '<div>vue component</div>',
            setup: () => ({}),
        };

        registerSidebarPage({
            id: 'vue-component',
            label: 'Vue Component',
            icon: 'pixelarticons:vue',
            component: vueComponent,
        });

        const page = getSidebarPage('vue-component');
        expect(page?.component).toBe(vueComponent); // Should not be wrapped
    });

    it('preserves optional properties', () => {
        const { registerSidebarPage, getSidebarPage } = useSidebarPages();

        const mockProvideContext = vi.fn();
        const mockCanActivate = vi.fn().mockResolvedValue(true);
        const mockOnActivate = vi.fn();
        const mockOnDeactivate = vi.fn();

        registerSidebarPage({
            id: 'full-page',
            label: 'Full Page',
            icon: 'pixelarticons:full',
            component: { name: 'FullPage', template: '<div>full</div>' },
            order: 50,
            keepAlive: true,
            usesDefaultHeader: false,
            provideContext: mockProvideContext,
            canActivate: mockCanActivate,
            onActivate: mockOnActivate,
            onDeactivate: mockOnDeactivate,
        });

        const page = getSidebarPage('full-page');
        expect(page?.order).toBe(50);
        expect(page?.keepAlive).toBe(true);
        expect(page?.usesDefaultHeader).toBe(false);
        expect(page?.provideContext).toBe(mockProvideContext);
        expect(page?.canActivate).toBe(mockCanActivate);
        expect(page?.onActivate).toBe(mockOnActivate);
        expect(page?.onDeactivate).toBe(mockOnDeactivate);
    });

    it('defaults usesDefaultHeader to true for sidebar-home', () => {
        const { registerSidebarPage, getSidebarPage } = useSidebarPages();

        registerSidebarPage({
            id: 'sidebar-home',
            label: 'Home',
            icon: 'pixelarticons:home',
            component: { name: 'HomePage', template: '<div>home</div>' },
        });

        const page = getSidebarPage('sidebar-home');
        expect(page?.usesDefaultHeader).toBe(true);
    });

    it('defaults usesDefaultHeader to false for non-home pages', () => {
        const { registerSidebarPage, getSidebarPage } = useSidebarPages();

        registerSidebarPage({
            id: 'custom-page',
            label: 'Custom',
            icon: 'pixelarticons:custom',
            component: { name: 'CustomPage', template: '<div>custom</div>' },
        });

        const page = getSidebarPage('custom-page');
        expect(page?.usesDefaultHeader).toBe(false);
    });

    it('component is marked raw to avoid reactivity overhead', () => {
        const { registerSidebarPage, getSidebarPage } = useSidebarPages();

        const component = {
            name: 'TestPage',
            template: '<div>test page</div>',
        };

        registerSidebarPage({
            id: 'raw-test',
            label: 'Raw Test',
            icon: 'pixelarticons:raw',
            component,
        });

        const page = getSidebarPage('raw-test');
        // markRaw should prevent Vue reactivity on the component
        expect(page?.component).toBe(component);
    });

    it('computed listSidebarPages updates reactively after registration', () => {
        const { registerSidebarPage, listSidebarPages } = useSidebarPages();

        const initialLength = listSidebarPages.value.length;

        registerSidebarPage({
            id: 'reactive-test-first',
            label: 'First',
            icon: 'pixelarticons:first',
            component: { name: 'First', template: '<div>first</div>' },
        });

        expect(listSidebarPages.value).toHaveLength(initialLength + 1);

        registerSidebarPage({
            id: 'reactive-test-second',
            label: 'Second',
            icon: 'pixelarticons:second',
            component: { name: 'Second', template: '<div>second</div>' },
        });

        expect(listSidebarPages.value).toHaveLength(initialLength + 2);
    });

    it('returns no-op unregister function on server side', () => {
        // Mock server side
        (global as any).process = { ...originalProcess, client: false };

        const { registerSidebarPage, getSidebarPage } = useSidebarPages();

        const def: SidebarPageDef = {
            id: 'server-test',
            label: 'Server Test',
            icon: 'pixelarticons:server',
            component: { name: 'ServerTest', template: '<div>server</div>' },
        };

        const unregister = registerSidebarPage(def);

        // Should not register on server side
        expect(getSidebarPage('server-test')).toBeUndefined();

        // Unregister should be a no-op but not throw
        expect(() => unregister()).not.toThrow();
    });

    it('registerSidebarPage returns unregister function', () => {
        const { registerSidebarPage, getSidebarPage } = useSidebarPages();

        const unregister = registerSidebarPage({
            id: 'unregister-test',
            label: 'Unregister Test',
            icon: 'pixelarticons:unregister',
            component: { name: 'UnregisterTest', template: '<div>test</div>' },
        });

        expect(getSidebarPage('unregister-test')).toBeDefined();

        unregister();

        expect(getSidebarPage('unregister-test')).toBeUndefined();
    });

    it('throws error for invalid id (uppercase)', () => {
        const { registerSidebarPage } = useSidebarPages();

        expect(() => {
            registerSidebarPage({
                id: 'TodoPage',
                label: 'Todo Page',
                icon: 'pixelarticons:list',
                component: { name: 'TodoPage', template: '<div>todo</div>' },
            });
        }).toThrow(/lowercase/);
    });

    it('throws error for invalid id (with spaces)', () => {
        const { registerSidebarPage } = useSidebarPages();

        expect(() => {
            registerSidebarPage({
                id: 'todo page',
                label: 'Todo Page',
                icon: 'pixelarticons:list',
                component: { name: 'TodoPage', template: '<div>todo</div>' },
            });
        }).toThrow(/lowercase/);
    });

    it('throws error for empty label', () => {
        const { registerSidebarPage } = useSidebarPages();

        expect(() => {
            registerSidebarPage({
                id: 'todo',
                label: '',
                icon: 'pixelarticons:list',
                component: { name: 'TodoPage', template: '<div>todo</div>' },
            });
        }).toThrow(/Label is required/);
    });

    it('throws error for missing icon', () => {
        const { registerSidebarPage } = useSidebarPages();

        expect(() => {
            registerSidebarPage({
                id: 'todo',
                label: 'Todo',
                icon: '',
                component: { name: 'TodoPage', template: '<div>todo</div>' },
            });
        }).toThrow(/Icon is required/);
    });

    it('throws error for label too long', () => {
        const { registerSidebarPage } = useSidebarPages();

        expect(() => {
            registerSidebarPage({
                id: 'todo',
                label: 'A'.repeat(101),
                icon: 'pixelarticons:list',
                component: { name: 'TodoPage', template: '<div>todo</div>' },
            });
        }).toThrow(/100 characters/);
    });

    it('throws error for order out of range', () => {
        const { registerSidebarPage } = useSidebarPages();

        expect(() => {
            registerSidebarPage({
                id: 'todo',
                label: 'Todo',
                icon: 'pixelarticons:list',
                component: { name: 'TodoPage', template: '<div>todo</div>' },
                order: 1001,
            });
        }).toThrow(/between 0 and 1000/);
    });
});
