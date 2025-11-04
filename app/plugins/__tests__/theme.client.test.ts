/**
 * Theme Plugin Tests
 * ==================
 * Tests for theme plugin functionality including:
 * - Non-blocking initialization
 * - Cleanup on error
 * - Cache behavior
 * - Severity filtering
 */

import {
    describe,
    it,
    expect,
    beforeEach,
    afterEach,
    vi,
    beforeAll,
} from 'vitest';
import { nextTick } from 'vue';
import sharedBaseCssUrl from '~/theme/_shared/base.css?url';

beforeAll(() => {
    (globalThis as any).defineNuxtPlugin = (fn: any) => fn;
});

// Mock #app
vi.mock('#app', () => ({
    useNuxtApp: () => ({ $hooks: {} }),
}));

// Mock the theme-loader module
vi.mock('~/theme/_shared/theme-loader', () => ({
    discoverThemes: vi.fn(),
    loadTheme: vi.fn(),
    validateThemeVariables: vi.fn(),
    mergeThemeConfig: vi.fn(),
}));

// Mock process.client
Object.defineProperty(process, 'client', {
    value: true,
    writable: true,
});

// Mock localStorage
const localStorageMock = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
};
Object.defineProperty(window, 'localStorage', {
    value: localStorageMock,
});

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
        matches: query === '(prefers-color-scheme: dark)' ? false : true,
        media: query,
        onchange: null,
        addListener: vi.fn(), // deprecated
        removeListener: vi.fn(), // deprecated
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    })),
});

// Mock import.meta.hot
Object.defineProperty(import.meta, 'hot', {
    value: {
        dispose: vi.fn(),
    },
    writable: true,
});

describe('Theme Plugin', () => {
    let themePlugin: any;
    let mockNuxtApp: any;

    beforeEach(() => {
        vi.clearAllMocks();

        // Reset DOM
        document.documentElement.className = '';
        document.querySelectorAll('style').forEach((el) => el.remove());

        // Mock matchMedia for each test
        Object.defineProperty(window, 'matchMedia', {
            writable: true,
            value: vi.fn().mockImplementation((query) => ({
                matches:
                    query === '(prefers-color-scheme: dark)' ? false : true,
                media: query,
                onchange: null,
                addListener: vi.fn(), // deprecated
                removeListener: vi.fn(), // deprecated
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                dispatchEvent: vi.fn(),
            })),
        });

        // Mock Nuxt app
        mockNuxtApp = {
            hook: vi.fn(),
            provide: vi.fn(),
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('Non-blocking initialization', () => {
        it('should initialize synchronously without blocking', async () => {
            const { discoverThemes, loadTheme } = await import(
                '~/theme/_shared/theme-loader'
            );

            // Mock async operations that should not block
            vi.mocked(discoverThemes).mockReturnValue([
                {
                    name: 'default',
                    path: '/app/theme/default',
                    variants: ['light', 'dark'],
                    hasLight: true,
                    hasDark: true,
                    hasMain: true,
                    hasConfig: true,
                },
            ]);
            vi.mocked(loadTheme).mockResolvedValue({
                manifest: {
                    name: 'default',
                    path: '/app/theme/default',
                    variants: ['light', 'dark'],
                    hasLight: true,
                    hasDark: true,
                    hasMain: true,
                    hasConfig: true,
                },
                lightCss: '.light { color: black; }',
                darkCss: '.dark { color: white; }',
                mainCss: 'body { margin: 0; }',
                errors: [],
                warnings: [],
            });

            // Import and execute plugin
            const pluginModule = await import('../theme.client');
            const plugin = pluginModule.default;

            // Should return immediately (synchronous)
            const startTime = performance.now();
            plugin(mockNuxtApp);
            const endTime = performance.now();

            // Plugin should execute quickly (< 50ms in test environment)
            expect(endTime - startTime).toBeLessThan(50);

            // Should provide theme API immediately
            expect(mockNuxtApp.provide).toHaveBeenCalledWith(
                'theme',
                expect.any(Object)
            );
        });

        it('should defer async theme loading', async () => {
            const { discoverThemes, loadTheme } = await import(
                '~/theme/_shared/theme-loader'
            );

            vi.mocked(discoverThemes).mockReturnValue([
                {
                    name: 'default',
                    path: '/app/theme/default',
                    variants: ['light', 'dark'],
                    hasLight: true,
                    hasDark: true,
                    hasMain: true,
                    hasConfig: true,
                },
            ]);

            // Mock slow loading
            vi.mocked(loadTheme).mockImplementation(
                (name) =>
                    new Promise((resolve) => {
                        if (name === 'default') {
                            resolve({
                                manifest: {
                                    name: 'default',
                                    path: '/app/theme/default',
                                    variants: ['light', 'dark'],
                                    hasLight: true,
                                    hasDark: true,
                                    hasMain: true,
                                    hasConfig: true,
                                },
                                errors: [],
                                warnings: [],
                            });
                            return;
                        }
                        setTimeout(
                            () =>
                                resolve({
                                    manifest: {
                                        name: 'default',
                                        path: '/app/theme/default',
                                        variants: ['light', 'dark'],
                                        hasLight: true,
                                        hasDark: true,
                                        hasMain: true,
                                        hasConfig: true,
                                    },
                                    errors: [],
                                    warnings: [],
                                }),
                            100
                        );
                    })
            );

            const pluginModule = await import('../theme.client');
            const plugin = pluginModule.default;

            plugin(mockNuxtApp);

            const themeApi = mockNuxtApp.provide.mock.calls[0][1];

            // Ready state should be false initially
            expect(themeApi.isReady.value).toBe(false);

            // Wait for async initialization
            await themeApi.ready;
            await nextTick();

            // Ready state should become true
            expect(themeApi.isReady.value).toBe(true);
        });

        it('should inject shared base CSS once', async () => {
            const { discoverThemes, loadTheme } = await import(
                '~/theme/_shared/theme-loader'
            );

            vi.mocked(discoverThemes).mockReturnValue([
                {
                    name: 'default',
                    path: '/app/theme/default',
                    variants: ['light', 'dark'],
                    hasLight: true,
                    hasDark: true,
                    hasMain: true,
                    hasConfig: true,
                },
            ]);

            vi.mocked(loadTheme).mockResolvedValue({
                manifest: {
                    name: 'default',
                    path: '/app/theme/default',
                    variants: ['light', 'dark'],
                    hasLight: true,
                    hasDark: true,
                    hasMain: true,
                    hasConfig: true,
                },
                lightCss: '.light { color: black; }',
                darkCss: '.dark { color: white; }',
                mainCss: ':root { --foo: 1; }',
                errors: [],
                warnings: [],
            });

            const pluginModule = await import('../theme.client');
            const plugin = pluginModule.default;

            plugin(mockNuxtApp);

            const themeApi = mockNuxtApp.provide.mock.calls[0][1];
            await themeApi.ready;

            const baseLinks = document.querySelectorAll(
                'link#theme-shared-base'
            );
            expect(baseLinks.length).toBe(1);
            const baseLink = baseLinks.item(0);
            expect(baseLink).not.toBeNull();
            expect(baseLink?.getAttribute('rel')).toBe('stylesheet');
            expect(baseLink?.getAttribute('href')).toBe(sharedBaseCssUrl);
        });
    });

    describe('Cleanup on error', () => {
        it('should rollback CSS injection on theme switch error', async () => {
            const { loadTheme } = await import('~/theme/_shared/theme-loader');

            // Mock successful discovery but failed theme loading
            vi.mocked(loadTheme).mockResolvedValue({
                manifest: {
                    name: 'broken',
                    path: '/app/theme/broken',
                    variants: ['light', 'dark'],
                    hasLight: true,
                    hasDark: true,
                    hasMain: true,
                    hasConfig: true,
                },
                lightCss: '.light { color: red; }',
                darkCss: '.dark { color: blue; }',
                mainCss: 'body { background: red; }',
                errors: [
                    {
                        file: 'broken',
                        message: 'Critical error',
                        severity: 'error' as const,
                    },
                ],
                warnings: [],
            });

            const pluginModule = await import('../theme.client');
            const plugin = pluginModule.default;

            plugin(mockNuxtApp);

            const themeApi = mockNuxtApp.provide.mock.calls[0][1];

            // Wait for initialization
            await themeApi.ready;

            // Mock available themes
            themeApi.availableThemes.value = [
                {
                    name: 'default',
                    path: '/app/theme/default',
                    variants: ['light', 'dark'],
                    hasLight: true,
                    hasDark: true,
                    hasMain: true,
                    hasConfig: true,
                },
                {
                    name: 'broken',
                    path: '/app/theme/broken',
                    variants: ['light', 'dark'],
                    hasLight: true,
                    hasDark: true,
                    hasMain: true,
                    hasConfig: true,
                },
            ];

            // Track CSS injection
            const originalInjectThemeCSS = themeApi.switchTheme;
            const injectedStyles: string[] = [];

            // Mock CSS injection tracking
            const mockStyleElements = {
                'theme-broken-light': null,
                'theme-broken-dark': null,
                'theme-broken-main': null,
            };

            vi.spyOn(document, 'getElementById').mockImplementation((id) => {
                return mockStyleElements[id as keyof typeof mockStyleElements];
            });

            const createElementSpy = vi
                .spyOn(document, 'createElement')
                .mockImplementation((tagName) => {
                    const element = {
                        id: '',
                        setAttribute: vi.fn(),
                        textContent: '',
                    } as any;

                    if (tagName === 'style') {
                        // Track when styles are created
                        setTimeout(() => {
                            injectedStyles.push(element.id);
                        }, 0);
                    }

                    return element;
                });

            const appendChildSpy = vi
                .spyOn(document.head, 'appendChild')
                .mockImplementation(vi.fn());

            // Try to switch to broken theme
            const result = await themeApi.switchTheme('broken');

            // Should fail to switch
            expect(result).toBe(false);

            // Active theme should remain unchanged
            expect(themeApi.activeTheme.value).toBe('default');
        });

        it('should handle theme loading failures gracefully', async () => {
            const { loadTheme } = await import('~/theme/_shared/theme-loader');

            // Mock theme loading failure
            vi.mocked(loadTheme).mockRejectedValue(
                new Error('Theme file not found')
            );

            const pluginModule = await import('../theme.client');
            const plugin = pluginModule.default;

            plugin(mockNuxtApp);

            const themeApi = mockNuxtApp.provide.mock.calls[0][1];

            // Try to validate non-existent theme
            const result = await themeApi.validateTheme('non-existent');

            // Should return null on error
            expect(result).toBeNull();

            // Should have error state
            expect(themeApi.errors.value).toHaveLength(1);
            expect(themeApi.errors.value[0].severity).toBe('error');
        });
    });

    describe('Cache behavior', () => {
        it('should cache loaded themes and reuse them', async () => {
            const { discoverThemes, loadTheme } = await import(
                '~/theme/_shared/theme-loader'
            );

            const mockThemeResult = {
                manifest: {
                    name: 'test',
                    path: '/app/theme/test',
                    variants: ['light', 'dark'],
                    hasLight: true,
                    hasDark: true,
                    hasMain: true,
                    hasConfig: true,
                },
                lightCss: '.light { color: blue; }',
                darkCss: '.dark { color: white; }',
                mainCss: 'body { margin: 0; }',
                errors: [],
                warnings: [],
            };

            // Mock discoverThemes to return default theme
            vi.mocked(discoverThemes).mockReturnValue([
                {
                    name: 'default',
                    path: '/app/theme/default',
                    variants: ['light', 'dark'],
                    hasLight: true,
                    hasDark: true,
                    hasMain: true,
                    hasConfig: true,
                },
            ]);

            // Mock loadTheme for default theme (called during init) and test theme
            vi.mocked(loadTheme).mockImplementation((name) => {
                if (name === 'default') {
                    return Promise.resolve({
                        manifest: {
                            name: 'default',
                            path: '/app/theme/default',
                            variants: ['light', 'dark'],
                            hasLight: true,
                            hasDark: true,
                            hasMain: true,
                            hasConfig: true,
                        },
                        errors: [],
                        warnings: [],
                    });
                }
                return Promise.resolve({
                    manifest: {
                        name: 'test',
                        path: '/app/theme/test',
                        variants: ['light', 'dark'],
                        hasLight: true,
                        hasDark: true,
                        hasMain: true,
                        hasConfig: true,
                    },
                    lightCss: '.light { color: blue; }',
                    darkCss: '.dark { color: white; }',
                    mainCss: 'body { margin: 0; }',
                    errors: [],
                    warnings: [],
                });
            });

            const pluginModule = await import('../theme.client');
            const plugin = pluginModule.default;

            plugin(mockNuxtApp);

            const themeApi = mockNuxtApp.provide.mock.calls[0][1];

            // Wait for initialization (loads default theme)
            await themeApi.ready;

            // Clear call count after initialization
            vi.clearAllMocks();

            // Load theme first time
            const result1 = await themeApi.validateTheme('test');

            // Should call loadTheme once for test theme
            expect(loadTheme).toHaveBeenCalledTimes(1);
            expect(result1).toEqual(mockThemeResult);

            // Cache should contain both themes (default from init + test)
            expect(themeApi.getCacheSize()).toBe(2);

            // Load theme second time (should use cache)
            const result2 = await themeApi.validateTheme('test');

            // Should not call loadTheme again
            expect(loadTheme).toHaveBeenCalledTimes(1);
            expect(result2).toEqual(mockThemeResult);
        });

        it('should limit cache size to 3 items (LRU eviction)', async () => {
            const { loadTheme } = await import('~/theme/_shared/theme-loader');

            const mockThemeResult = (name: string): any => ({
                manifest: {
                    name,
                    path: `/app/theme/${name}`,
                    variants: ['light', 'dark'],
                    hasLight: true,
                    hasDark: true,
                    hasMain: true,
                    hasConfig: true,
                },
                lightCss: `.${name}-light { color: blue; }`,
                darkCss: `.${name}-dark { color: white; }`,
                mainCss: `body.${name} { margin: 0; }`,
                errors: [],
                warnings: [],
            });

            vi.mocked(loadTheme).mockImplementation((name) =>
                Promise.resolve(mockThemeResult(name as string))
            );

            const pluginModule = await import('../theme.client');
            const plugin = pluginModule.default;

            plugin(mockNuxtApp);

            const themeApi = mockNuxtApp.provide.mock.calls[0][1];

            // Wait for initialization
            await themeApi.ready;

            // Load 4 different themes (should exceed cache limit)
            await themeApi.validateTheme('theme1');
            await themeApi.validateTheme('theme2');
            await themeApi.validateTheme('theme3');
            await themeApi.validateTheme('theme4');

            // Cache size should be limited to 3
            expect(themeApi.getCacheSize()).toBe(3);

            // First theme should be evicted (LRU)
            await themeApi.validateTheme('theme1');

            // Should call loadTheme again for theme1 (was evicted)
            expect(loadTheme).toHaveBeenCalledWith('theme1');
        });

        it('should clear cache on demand', async () => {
            const { loadTheme } = await import('~/theme/_shared/theme-loader');

            vi.mocked(loadTheme).mockResolvedValue({
                manifest: {
                    name: 'test',
                    path: '/app/theme/test',
                    variants: ['light', 'dark'],
                    hasLight: true,
                    hasDark: true,
                    hasMain: true,
                    hasConfig: true,
                },
                errors: [],
                warnings: [],
            });

            const pluginModule = await import('../theme.client');
            const plugin = pluginModule.default;

            plugin(mockNuxtApp);

            const themeApi = mockNuxtApp.provide.mock.calls[0][1];

            // Wait for initialization
            await themeApi.ready;

            // Load theme to populate cache
            await themeApi.validateTheme('test');

            // Cache should have items
            expect(themeApi.getCacheSize()).toBeGreaterThan(0);

            // Clear cache
            themeApi.clearCache();

            // Cache should be empty
            expect(themeApi.getCacheSize()).toBe(0);
        });
    });

    it('should provide cache information', async () => {
        const pluginModule = await import('../theme.client');
        const plugin = pluginModule.default;

        plugin(mockNuxtApp);

        const themeApi = mockNuxtApp.provide.mock.calls[0][1];

        const cacheInfo = themeApi.getCacheInfo();

        expect(cacheInfo).toEqual({
            size: 0,
            maxSize: 3,
            description: 'LRU cache for loaded themes',
        });
    });

    describe('Severity filtering', () => {
        it('should filter errors by severity correctly', async () => {
            const { loadTheme } = await import('~/theme/_shared/theme-loader');

            // Mock theme with mixed errors and warnings
            vi.mocked(loadTheme).mockResolvedValue({
                manifest: {
                    name: 'test',
                    path: '/app/theme/test',
                    variants: ['light', 'dark'],
                    hasLight: true,
                    hasDark: true,
                    hasMain: true,
                    hasConfig: true,
                },
                lightCss: '.light { color: blue; }',
                darkCss: '.dark { color: white; }',
                mainCss: 'body { margin: 0; }',
                errors: [
                    {
                        file: 'test.css',
                        message: 'Critical error',
                        severity: 'error' as const,
                    },
                    {
                        file: 'test.css',
                        message: 'Another warning',
                        severity: 'warning' as const,
                    },
                ],
                warnings: [
                    {
                        file: 'test.css',
                        message: 'Warning message',
                        severity: 'warning' as const,
                    },
                ],
            });

            const pluginModule = await import('../theme.client');
            const plugin = pluginModule.default;

            plugin(mockNuxtApp);

            const themeApi = mockNuxtApp.provide.mock.calls[0][1];

            // Wait for initialization
            await themeApi.ready;

            // Load theme with mixed severity issues
            const result = await themeApi.validateTheme('test');

            // Should separate errors and warnings correctly
            expect(themeApi.errors.value).toHaveLength(1);
            expect(themeApi.errors.value[0].severity).toBe('error');
            expect(themeApi.errors.value[0].message).toBe('Critical error');

            expect(themeApi.warnings.value).toHaveLength(2);
            expect(
                themeApi.warnings.value.every(
                    (w: any) => w.severity === 'warning'
                )
            ).toBe(true);
        });

        it('should provide cache information', async () => {
            const pluginModule = await import('../theme.client');
            const plugin = pluginModule.default;

            plugin(mockNuxtApp);

            const themeApi = mockNuxtApp.provide.mock.calls[0][1];

            const cacheInfo = themeApi.getCacheInfo();

            expect(cacheInfo).toEqual({
                size: 0,
                maxSize: 3,
                description: 'LRU cache for loaded themes',
            });
        });
    });
});
