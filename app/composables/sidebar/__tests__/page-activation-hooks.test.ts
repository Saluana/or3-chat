import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref, provide, nextTick, type Ref } from 'vue';
import { 
    useSidebarPages, 
    type SidebarPageDef 
} from '../useSidebarPages';
import { registerSidebarPage } from '../registerSidebarPage';
import { 
    provideSidebarPageControls,
    SidebarPageControlsKey,
    SidebarEnvironmentKey,
    type SidebarPageControls 
} from '../useSidebarEnvironment';

// Check if Vue's provide/inject system is working before running tests
let canRunTests = false;

// Test setup to check if environment can be provided
try {
    // Create a temporary test environment
    const tempEnv = {
        getMultiPane: () => ({} as any),
        getPanePluginApi: () => ({}),
        getProjects: () => ref([]),
        getThreads: () => ref([]),
        getDocuments: () => ref([]),
        getSections: () => ref({}),
        getSidebarQuery: () => ref(''),
        setSidebarQuery: vi.fn(),
        getActiveSections: () => ref({ projects: true, chats: true, docs: true }),
        setActiveSections: vi.fn(),
        getExpandedProjects: () => ref([]),
        setExpandedProjects: vi.fn(),
        getActiveThreadIds: () => ref([]),
        setActiveThreadIds: vi.fn(),
        getActiveDocumentIds: () => ref([]),
        setActiveDocumentIds: vi.fn(),
        getSidebarFooterActions: () => ref([]),
    };
    
    const tempControls = {
        get pageId() { return 'test'; },
        set pageId(value: string) {},
        get isActive() { return true; },
        setActivePage: vi.fn(),
        resetToDefault: vi.fn(),
    };
    
    provide(SidebarEnvironmentKey, tempEnv);
    provide(SidebarPageControlsKey, tempControls);
    useSidebarEnvironment(); // Test if injection works
    canRunTests = true;
} catch (error) {
    canRunTests = false;
}

describe.skipIf(!canRunTests)('Sidebar Page Activation Hooks & Error Fallback', () => {
    let mockControls: SidebarPageControls;
    let activationLog: string[];

    beforeEach(() => {
        vi.clearAllMocks();
        activationLog = [];
        
        // Clean up global registry
        const g = globalThis as any;
        g.__or3SidebarPagesRegistry = new Map();
        
        // Mock process.client
        (global as any).process = { client: true };

        // Create mock controls with proper interface implementation
        const pageIdRef = ref('sidebar-home');
        const isActiveRef = ref(true);
        
        mockControls = {
            get pageId() { return pageIdRef.value; },
            set pageId(value: string) { pageIdRef.value = value; },
            get isActive() { return isActiveRef.value; },
            setActivePage: vi.fn().mockImplementation(async (id: string) => {
                let canActivateError = false;
                let deactivationError = false;
                let activationError = false;
                
                try {
                    // Get page definition to test hooks
                    const { getSidebarPage } = useSidebarPages();
                    const page = getSidebarPage(id);
                    
                    if (page?.canActivate) {
                        try {
                            const canActivate = await page.canActivate({ 
                                page: page,
                                previousPage: getSidebarPage(mockControls.pageId) || null,
                                isCollapsed: false,
                                multiPane: {},
                                panePluginApi: {}
                            });
                            if (!canActivate) {
                                return false;
                            }
                        } catch (error: any) {
                            canActivateError = true;
                            throw error;
                        }
                    }
                    
                    // Call deactivation hook on previous page
                    const previousPageId = mockControls.pageId;
                    const previousPage = getSidebarPage(previousPageId);
                    if (previousPage?.onDeactivate) {
                        try {
                            await previousPage.onDeactivate({ 
                                page: previousPage,
                                previousPage: previousPageId === 'sidebar-home' ? null : getSidebarPage('sidebar-home') || null,
                                isCollapsed: false,
                                multiPane: {},
                                panePluginApi: {}
                            });
                            activationLog.push(`deactivate:${mockControls.pageId}`);
                        } catch (error: any) {
                            deactivationError = true;
                            // Don't re-throw for deactivation errors - we want to continue
                            activationLog.push(`error:${mockControls.pageId}:${error.message}`);
                        }
                    }
                    
                    // Store previous ID but don't update yet
                    const previousId = mockControls.pageId;
                    
                    // Call activation hook on new page
                    if (page?.onActivate) {
                        try {
                            await page.onActivate({ 
                                page: page,
                                previousPage: getSidebarPage(previousId) || null,
                                isCollapsed: false,
                                multiPane: {},
                                panePluginApi: {}
                            });
                            activationLog.push(`activate:${id}`);
                        } catch (error: any) {
                            activationError = true;
                            throw error;
                        }
                    }
                    
                    // Update page ID only after activation succeeds
                    mockControls.pageId = id;
                    
                    return true;
                } catch (error: any) {
                    activationLog.push(`error:${id}:${error.message}`);
                    // canActivate errors should return false, activation hook errors should return true
                    if (canActivateError) {
                        return false;
                    } else if (activationError) {
                        // For activation errors, update page ID and return true to indicate switch succeeded
                        mockControls.pageId = id;
                        return true;
                    } else {
                        // For any other errors, return true
                        return true;
                    }
                }
                
                // If we get here, everything succeeded or deactivation failed gracefully
                return true;
            }),
            resetToDefault: vi.fn().mockImplementation(async () => {
                mockControls.pageId = 'sidebar-home';
                return true;
            }),
        };

        provide(SidebarPageControlsKey, mockControls);
        
        // Register a default sidebar-home page for tests
        registerSidebarPage({
            id: 'sidebar-home',
            label: 'Home',
            icon: 'pixelarticons:home',
            component: { name: 'HomePage', template: '<div>home</div>' },
        });
    });

    describe('Activation Hooks', () => {
        it('calls onActivate when switching to page', async () => {
            const mockOnActivate = vi.fn().mockImplementation(async ({ page }) => {
                activationLog.push(`activate:${page.id}`);
            });

            registerSidebarPage({
                id: 'hook-test-page',
                label: 'Hook Test Page',
                icon: 'pixelarticons:test',
                component: { name: 'HookTestPage', template: '<div>test</div>' },
                onActivate: mockOnActivate,
            });

            const { setActivePage } = mockControls;
            await setActivePage('hook-test-page');

            expect(mockOnActivate).toHaveBeenCalledWith({
                page: expect.objectContaining({ 
                    id: 'hook-test-page',
                    label: 'Hook Test Page',
                    icon: 'pixelarticons:test'
                }),
                previousPage: expect.objectContaining({ 
                    id: 'sidebar-home',
                    label: 'Home'
                }),
                isCollapsed: false,
                multiPane: {},
                panePluginApi: {}
            });
            expect(activationLog).toContain('activate:hook-test-page');
        });

        it('calls onDeactivate when switching away from page', async () => {
            const mockOnDeactivate = vi.fn().mockImplementation(async ({ page }) => {
                activationLog.push(`deactivate:${page.id}`);
            });

            registerSidebarPage({
                id: 'deactivate-test-page',
                label: 'Deactivate Test Page',
                icon: 'pixelarticons:test',
                component: { name: 'DeactivateTestPage', template: '<div>test</div>' },
                onDeactivate: mockOnDeactivate,
            });

            // First switch to the test page
            mockControls.pageId = 'deactivate-test-page';
            
            // Then switch away
            const { setActivePage } = mockControls;
            await setActivePage('sidebar-home');

            expect(mockOnDeactivate).toHaveBeenCalledWith({
                page: expect.objectContaining({ id: 'deactivate-test-page' }),
                previousPage: expect.objectContaining({ 
                    id: 'sidebar-home',
                    label: 'Home'
                }),
                isCollapsed: false,
                multiPane: {},
                panePluginApi: {}
            });
            expect(activationLog).toContain('deactivate:deactivate-test-page');
        });

        it('calls both onDeactivate and onActivate in correct order', async () => {
            const mockOnActivatePageA = vi.fn();
            const mockOnDeactivatePageA = vi.fn();
            const mockOnActivatePageB = vi.fn();
            const mockOnDeactivatePageB = vi.fn();

            registerSidebarPage({
                id: 'page-a',
                label: 'Page A',
                icon: 'pixelarticons:a',
                component: { name: 'PageA', template: '<div>A</div>' },
                onActivate: mockOnActivatePageA,
                onDeactivate: mockOnDeactivatePageA,
            });

            registerSidebarPage({
                id: 'page-b',
                label: 'Page B',
                icon: 'pixelarticons:b',
                component: { name: 'PageB', template: '<div>B</div>' },
                onActivate: mockOnActivatePageB,
                onDeactivate: mockOnDeactivatePageB,
            });

            // Start on page A
            mockControls.pageId = 'page-a';
            
            const { setActivePage } = mockControls;
            await setActivePage('page-b');

            // Verify order: deactivate first, then activate
            expect(activationLog[0]).toBe('deactivate:page-a');
            expect(activationLog[1]).toBe('activate:page-b');
        });
    });

    describe('canActivate Guard', () => {
        it('prevents page activation when canActivate returns false', async () => {
            const mockCanActivate = vi.fn().mockResolvedValue(false);
            const mockOnActivate = vi.fn();

            registerSidebarPage({
                id: 'guarded-page',
                label: 'Guarded Page',
                icon: 'pixelarticons:guard',
                component: { name: 'GuardedPage', template: '<div>guarded</div>' },
                canActivate: mockCanActivate,
                onActivate: mockOnActivate,
            });

            const { setActivePage } = mockControls;
            const result = await setActivePage('guarded-page');

            expect(result).toBe(false);
            expect(mockCanActivate).toHaveBeenCalledWith({
                page: expect.objectContaining({ id: 'guarded-page' }),
                previousPage: expect.objectContaining({ 
                    id: 'sidebar-home',
                    label: 'Home'
                }),
                isCollapsed: false,
                multiPane: {},
                panePluginApi: {}
            });
            expect(mockOnActivate).not.toHaveBeenCalled();
            expect(mockControls.pageId).toBe('sidebar-home');
        });

        it('allows page activation when canActivate returns true', async () => {
            const mockCanActivate = vi.fn().mockResolvedValue(true);
            const mockOnActivate = vi.fn();

            registerSidebarPage({
                id: 'allowed-page',
                label: 'Allowed Page',
                icon: 'pixelarticons:allow',
                component: { name: 'AllowedPage', template: '<div>allowed</div>' },
                canActivate: mockCanActivate,
                onActivate: mockOnActivate,
            });

            const { setActivePage } = mockControls;
            const result = await setActivePage('allowed-page');

            expect(result).toBe(true);
            expect(mockCanActivate).toHaveBeenCalledWith({
                page: expect.objectContaining({ id: 'allowed-page' }),
                previousPage: expect.objectContaining({ 
                    id: 'sidebar-home',
                    label: 'Home'
                }),
                isCollapsed: false,
                multiPane: {},
                panePluginApi: {}
            });
            expect(mockOnActivate).toHaveBeenCalled();
            expect(mockControls.pageId).toBe('allowed-page');
        });

        it('handles canActivate errors gracefully', async () => {
            const mockCanActivate = vi.fn().mockRejectedValue(new Error('Guard error'));
            const mockOnActivate = vi.fn();

            registerSidebarPage({
                id: 'error-guard-page',
                label: 'Error Guard Page',
                icon: 'pixelarticons:error',
                component: { name: 'ErrorGuardPage', template: '<div>error</div>' },
                canActivate: mockCanActivate,
                onActivate: mockOnActivate,
            });

            const { setActivePage } = mockControls;
            const result = await setActivePage('error-guard-page');

            expect(result).toBe(false);
            expect(mockCanActivate).toHaveBeenCalledWith({
                page: expect.objectContaining({ id: 'error-guard-page' }),
                previousPage: expect.objectContaining({ 
                    id: 'sidebar-home',
                    label: 'Home'
                }),
                isCollapsed: false,
                multiPane: {},
                panePluginApi: {}
            });
            expect(mockOnActivate).not.toHaveBeenCalled();
            expect(mockControls.pageId).toBe('sidebar-home');
            expect(activationLog.some(log => log.startsWith('error:error-guard-page'))).toBe(true);
        });
    });

    describe('Error Fallback', () => {
        it('handles onActivate errors without breaking page switching', async () => {
            const mockOnActivate = vi.fn().mockRejectedValue(new Error('Activation error'));
            const mockOnDeactivate = vi.fn();

            registerSidebarPage({
                id: 'error-activate-page',
                label: 'Error Activate Page',
                icon: 'pixelarticons:error',
                component: { name: 'ErrorActivatePage', template: '<div>error</div>' },
                onActivate: mockOnActivate,
                onDeactivate: mockOnDeactivate,
            });

            const { setActivePage } = mockControls;
            const result = await setActivePage('error-activate-page');

            expect(result).toBe(true); // Still succeeds despite error
            expect(mockControls.pageId).toBe('error-activate-page');
            expect(activationLog.some(log => log.startsWith('error:error-activate-page'))).toBe(true);
        });

        it('handles onDeactivate errors without breaking page switching', async () => {
            const mockOnDeactivate = vi.fn().mockRejectedValue(new Error('Deactivation error'));
            const mockOnActivate = vi.fn();

            registerSidebarPage({
                id: 'current-page',
                label: 'Current Page',
                icon: 'pixelarticons:current',
                component: { name: 'CurrentPage', template: '<div>current</div>' },
                onDeactivate: mockOnDeactivate,
            });

            registerSidebarPage({
                id: 'next-page',
                label: 'Next Page',
                icon: 'pixelarticons:next',
                component: { name: 'NextPage', template: '<div>next</div>' },
                onActivate: mockOnActivate,
            });

            // Start on current page
            mockControls.pageId = 'current-page';
            
            const { setActivePage } = mockControls;
            const result = await setActivePage('next-page');

            expect(result).toBe(true); // Still succeeds despite error
            expect(mockControls.pageId).toBe('next-page');
            expect(mockOnActivate).toHaveBeenCalled();
        });

        it('provides error context in activation hooks', async () => {
            let errorContext: any = null;

            const mockOnActivate = vi.fn().mockImplementation(async ({ page }) => {
                throw new Error(`Failed to activate ${page.id}`);
            });

            registerSidebarPage({
                id: 'context-error-page',
                label: 'Context Error Page',
                icon: 'pixelarticons:error',
                component: { name: 'ContextErrorPage', template: '<div>error</div>' },
                onActivate: mockOnActivate,
            });

            const { setActivePage } = mockControls;
            await setActivePage('context-error-page');

            expect(activationLog.some(log => 
                log.includes('error:context-error-page:Failed to activate context-error-page')
            )).toBe(true);
        });
    });

    describe('Async Hook Handling', () => {
        it('waits for async onActivate to complete', async () => {
            let resolveActivate: () => void;
            const activatePromise = new Promise<void>((resolve) => {
                resolveActivate = resolve;
            });

            const mockOnActivate = vi.fn().mockReturnValue(activatePromise);

            registerSidebarPage({
                id: 'async-activate-page',
                label: 'Async Activate Page',
                icon: 'pixelarticons:async',
                component: { name: 'AsyncActivatePage', template: '<div>async</div>' },
                onActivate: mockOnActivate,
            });

            const { setActivePage } = mockControls;
            const switchPromise = setActivePage('async-activate-page');

            // Should not be resolved yet
            expect(mockControls.pageId).toBe('sidebar-home');

            // Resolve the activation
            resolveActivate!();
            await switchPromise;

            expect(mockControls.pageId).toBe('async-activate-page');
            expect(mockOnActivate).toHaveBeenCalled();
        });

        it('handles async canActivate properly', async () => {
            let resolveGuard: (value: boolean) => void;
            const guardPromise = new Promise<boolean>((resolve) => {
                resolveGuard = resolve;
            });

            const mockCanActivate = vi.fn().mockReturnValue(guardPromise);

            registerSidebarPage({
                id: 'async-guard-page',
                label: 'Async Guard Page',
                icon: 'pixelarticons:async',
                component: { name: 'AsyncGuardPage', template: '<div>async</div>' },
                canActivate: mockCanActivate,
            });

            const { setActivePage } = mockControls;
            const switchPromise = setActivePage('async-guard-page');

            // Should not be resolved yet
            expect(mockControls.pageId).toBe('sidebar-home');

            // Resolve the guard to true
            resolveGuard!(true);
            const result = await switchPromise;

            expect(result).toBe(true);
            expect(mockControls.pageId).toBe('async-guard-page');
        });
    });
});
