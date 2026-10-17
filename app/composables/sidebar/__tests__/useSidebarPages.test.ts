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
            image: '/icons/todo.webp',
            component: { name: 'TodoPage', template: '<div>todo page</div>' },
        };

        registerSidebarPage(def);

        const page = getSidebarPage('todo-page');
        expect(page).toBeDefined();
        expect(page?.id).toBe('todo-page');
        expect(page?.label).toBe('Todo Page');
        expect(page?.icon).toBe('pixelarticons:list');
        expect(page?.image).toBe('/icons/todo.webp');
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
