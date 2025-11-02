import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';

// Mock the base registerSidebarPage before importing
const mockUnregister = vi.fn();
const mockBaseRegisterSidebarPage = vi.fn().mockReturnValue(mockUnregister);

vi.mock('../useSidebarPages', () => ({
    useSidebarPages: () => ({
        listSidebarPages: ref([]),
        registerSidebarPage: mockBaseRegisterSidebarPage,
    }),
}));

// Import after mocking
import { registerSidebarPage, registerSidebarPageWithPosts } from '../registerSidebarPage';

describe('registerSidebarPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset process.client mock
        Object.defineProperty(process, 'client', { value: true, configurable: true });
    });

    it('registers page with default options', () => {
        const pageDef = {
            id: 'test-page',
            label: 'Test Page',
            icon: 'pixelarticons:test',
            component: vi.fn(),
        };

        const unregister = registerSidebarPage(pageDef);

        expect(mockBaseRegisterSidebarPage).toHaveBeenCalledWith(pageDef);
        expect(unregister).toBe(mockUnregister);
    });

    it('returns no-op unregister when clientOnly is true and not on client', () => {
        Object.defineProperty(process, 'client', { value: false, configurable: true });

        const pageDef = {
            id: 'test-page',
            label: 'Test Page',
            icon: 'pixelarticons:test',
            component: vi.fn(),
        };

        const unregister = registerSidebarPage(pageDef, { clientOnly: true });

        expect(mockBaseRegisterSidebarPage).not.toHaveBeenCalled();
        expect(typeof unregister).toBe('function');
        
        // Should be a no-op function
        unregister();
        expect(mockUnregister).not.toHaveBeenCalled();
    });

    it('registers on server when clientOnly is false', () => {
        Object.defineProperty(process, 'client', { value: false, configurable: true });

        const pageDef = {
            id: 'test-page',
            label: 'Test Page',
            icon: 'pixelarticons:test',
            component: vi.fn(),
        };

        registerSidebarPage(pageDef, { clientOnly: false });

        expect(mockBaseRegisterSidebarPage).toHaveBeenCalledWith(pageDef);
    });

    describe('registerSidebarPageWithPosts', () => {
        it('registers page with posts integration', () => {
            const pageDef = {
                id: 'test-page',
                label: 'Test Page',
                icon: 'pixelarticons:test',
                component: vi.fn(),
            };

            const options = {
                postType: 'test-post',
                onPostSelect: vi.fn(),
            };

            registerSidebarPageWithPosts(pageDef, options);

            expect(mockBaseRegisterSidebarPage).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: 'test-page',
                    label: 'Test Page',
                    icon: 'pixelarticons:test',
                    component: pageDef.component,
                    provideContext: expect.any(Function),
                })
            );
        });

        it('provides context with posts helpers', () => {
            const mockExpose = vi.fn();
            const mockCtx = { expose: mockExpose };
            const onPostSelect = vi.fn();

            const pageDef = {
                id: 'test-page',
                label: 'Test Page',
                icon: 'pixelarticons:test',
                component: vi.fn(),
            };

            const options = {
                postType: 'test-post',
                onPostSelect,
            };

            registerSidebarPageWithPosts(pageDef, options);

            expect(mockBaseRegisterSidebarPage).toHaveBeenCalled();
            const firstCall = mockBaseRegisterSidebarPage.mock.calls[0];
            expect(firstCall).toBeDefined();
            const registeredDef = firstCall![0];
            expect(registeredDef).toBeDefined();
            const provideContext = registeredDef.provideContext;
            expect(provideContext).toBeDefined();
            
            provideContext(mockCtx);

            expect(mockExpose).toHaveBeenCalledWith({
                postType: 'test-post',
                selectPost: expect.any(Function),
            });
        });

        it('calls original provideContext if present', () => {
            const mockExpose = vi.fn();
            const mockCtx = { expose: mockExpose };
            const originalProvideContext = vi.fn();

            const pageDef = {
                id: 'test-page',
                label: 'Test Page',
                icon: 'pixelarticons:test',
                component: vi.fn(),
                provideContext: originalProvideContext,
            };

            const options = {
                postType: 'test-post',
                onPostSelect: vi.fn(),
            };

            registerSidebarPageWithPosts(pageDef, options);

            expect(mockBaseRegisterSidebarPage).toHaveBeenCalled();
            const firstCall = mockBaseRegisterSidebarPage.mock.calls[0];
            expect(firstCall).toBeDefined();
            const registeredDef = firstCall![0];
            expect(registeredDef).toBeDefined();
            const provideContext = registeredDef.provideContext;
            expect(provideContext).toBeDefined();
            provideContext(mockCtx);

            expect(originalProvideContext).toHaveBeenCalledWith(mockCtx);
            expect(mockExpose).toHaveBeenCalled();
        });
    });
});
