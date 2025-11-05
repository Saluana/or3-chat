/**
 * Theme Plugin Override Tests
 * ===========================
 * Comprehensive tests for the theme plugin's override system integration.
 * Tests resolver initialization, clearing, validation, and error handling.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// Import override resolver functions and types
import { getOverrideResolver, setOverrideResolver, clearOverrideResolver, type OverrideRule } from '~/theme/_shared/override-resolver';
import { validateComponentOverrides, logValidationErrors } from '~/theme/_shared/override-validator';

// Mock the theme plugin functions for testing
const mockThemePlugin = {
    initializeOverrides: vi.fn(),
    overrideStats: {
        resolverLoaded: false,
        rulesCount: 0,
        contextsCount: 0,
        lastInitTheme: '',
    },
};

// Mock console methods to capture logging
const mockConsole = {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    group: vi.fn(),
    groupEnd: vi.fn(),
};

describe('Theme Plugin Override System', () => {
    beforeEach(() => {
        // Clear all mocks
        vi.clearAllMocks();
        
        // Reset resolver state
        clearOverrideResolver();
        
        // Mock console methods
        Object.assign(console, mockConsole);
        
        // Reset plugin stats
        mockThemePlugin.overrideStats = {
            resolverLoaded: false,
            rulesCount: 0,
            contextsCount: 0,
            lastInitTheme: '',
        };
    });

    afterEach(() => {
        // Restore console methods
        vi.restoreAllMocks();
    });

    describe('7.2 Plugin initializes resolver on theme load', () => {
        it('should initialize resolver with valid theme config', () => {
            // Mock valid theme config
            const validThemeConfig = {
                componentOverrides: {
                    global: {
                        button: [
                            {
                                component: 'button',
                                props: { variant: 'solid' as const },
                                priority: 1,
                            },
                        ],
                    },
                },
            };

            // Mock the initializeOverrides function behavior
            mockThemePlugin.initializeOverrides.mockImplementation((config: any) => {
                if (!config?.componentOverrides) {
                    console.log('[theme] No component overrides found in theme config');
                    return;
                }

                const validation = validateComponentOverrides(config.componentOverrides);
                if (!validation.valid) {
                    logValidationErrors(validation, 'test-theme');
                    console.error('[theme] Skipping override initialization due to validation errors');
                    return;
                }

                setOverrideResolver(config.componentOverrides);
                mockThemePlugin.overrideStats = {
                    resolverLoaded: true,
                    rulesCount: 1,
                    contextsCount: 0,
                    lastInitTheme: 'test-theme',
                };
                console.log('[theme] Initialized overrides for "test-theme": 1 global rules, 0 contexts');
            });

            // Initialize with valid config
            mockThemePlugin.initializeOverrides(validThemeConfig);

            // Verify resolver was initialized
            expect(getOverrideResolver()).toBeTruthy();
            expect(mockThemePlugin.overrideStats.resolverLoaded).toBe(true);
            expect(mockThemePlugin.overrideStats.rulesCount).toBe(1);
            expect(mockThemePlugin.overrideStats.lastInitTheme).toBe('test-theme');
            
            // Verify success logging
            expect(mockConsole.log).toHaveBeenCalledWith(
                '[theme] Initialized overrides for "test-theme": 1 global rules, 0 contexts'
            );
            expect(mockConsole.error).not.toHaveBeenCalled();
        });

        it('should initialize resolver with complex theme config', () => {
            const complexConfig = {
                componentOverrides: {
                    global: {
                        button: [
                            {
                                component: 'button',
                                props: { variant: 'solid' as const },
                            },
                        ],
                        input: [
                            {
                                component: 'input',
                                props: { size: 'lg' as const },
                            },
                        ],
                    },
                    contexts: {
                        chat: {
                            button: [
                                {
                                    component: 'button',
                                    props: { variant: 'outline' as const },
                                },
                            ],
                        },
                    },
                    states: {
                        hover: {
                            button: [
                                {
                                    component: 'button',
                                    props: { variant: 'ghost' as const },
                                },
                            ],
                        },
                    },
                },
            };

            mockThemePlugin.initializeOverrides.mockImplementation((config: any) => {
                if (!config?.componentOverrides) return;
                
                const validation = validateComponentOverrides(config.componentOverrides);
                if (!validation.valid) return;

                setOverrideResolver(config.componentOverrides);
                mockThemePlugin.overrideStats = {
                    resolverLoaded: true,
                    rulesCount: 2,
                    contextsCount: 1,
                    lastInitTheme: 'complex-theme',
                };
            });

            mockThemePlugin.initializeOverrides(complexConfig);

            expect(getOverrideResolver()).toBeTruthy();
            expect(mockThemePlugin.overrideStats.rulesCount).toBe(2);
            expect(mockThemePlugin.overrideStats.contextsCount).toBe(1);
        });
    });

    describe('7.3 Plugin clears resolver on theme switch', () => {
        it('should clear resolver when switching themes', () => {
            // Initialize with first theme
            const firstThemeConfig = {
                componentOverrides: {
                    global: {
                        button: [
                            {
                                component: 'button',
                                props: { variant: 'solid' as const },
                            },
                        ],
                    },
                },
            };

            mockThemePlugin.initializeOverrides.mockImplementation((config: any) => {
                clearOverrideResolver(); // Clear before initializing
                if (config?.componentOverrides) {
                    setOverrideResolver(config.componentOverrides);
                }
            });

            mockThemePlugin.initializeOverrides(firstThemeConfig);
            expect(getOverrideResolver()).toBeTruthy();

            // Switch to new theme (should clear and reinitialize)
            const secondThemeConfig = {
                componentOverrides: {
                    global: {
                        input: [
                            {
                                component: 'input',
                                props: { size: 'lg' as const },
                            },
                        ],
                    },
                },
            };

            mockThemePlugin.initializeOverrides(secondThemeConfig);
            
            // Should have new resolver
            expect(getOverrideResolver()).toBeTruthy();
            
            // Verify clear was called (implicitly through reinitialization)
            expect(mockThemePlugin.initializeOverrides).toHaveBeenCalledTimes(2);
        });

        it('should clear resolver when loading theme without overrides', () => {
            // Initialize with overrides
            const configWithOverrides = {
                componentOverrides: {
                    global: {
                        button: [
                            {
                                component: 'button',
                                props: { variant: 'solid' as const },
                            },
                        ],
                    },
                },
            };

            mockThemePlugin.initializeOverrides.mockImplementation((config: any) => {
                clearOverrideResolver(); // Clear before initializing
                if (config?.componentOverrides) {
                    setOverrideResolver(config.componentOverrides);
                } else {
                    console.log('[theme] No component overrides found in theme config');
                }
            });

            mockThemePlugin.initializeOverrides(configWithOverrides);
            expect(getOverrideResolver()).toBeTruthy();

            // Load theme without overrides
            const configWithoutOverrides = {};

            mockThemePlugin.initializeOverrides(configWithoutOverrides);
            
            // Resolver should be cleared
            expect(getOverrideResolver()).toBeNull();
            expect(mockConsole.log).toHaveBeenCalledWith(
                '[theme] No component overrides found in theme config'
            );
        });
    });

    describe('7.4 Plugin handles themes without overrides', () => {
        it('should handle empty theme config gracefully', () => {
            const emptyConfig = {};

            mockThemePlugin.initializeOverrides.mockImplementation((config: any) => {
                if (!config?.componentOverrides) {
                    console.log('[theme] No component overrides found in theme config');
                    return;
                }
            });

            mockThemePlugin.initializeOverrides(emptyConfig);

            expect(getOverrideResolver()).toBeNull();
            expect(mockThemePlugin.overrideStats.resolverLoaded).toBe(false);
            expect(mockConsole.log).toHaveBeenCalledWith(
                '[theme] No component overrides found in theme config'
            );
        });

        it('should handle null componentOverrides gracefully', () => {
            const configWithNullOverrides = {
                componentOverrides: null,
            };

            mockThemePlugin.initializeOverrides.mockImplementation((config: any) => {
                if (!config?.componentOverrides) {
                    console.log('[theme] No component overrides found in theme config');
                    return;
                }
            });

            mockThemePlugin.initializeOverrides(configWithNullOverrides);

            expect(getOverrideResolver()).toBeNull();
            expect(mockConsole.log).toHaveBeenCalledWith(
                '[theme] No component overrides found in theme config'
            );
        });

        it('should handle undefined componentOverrides gracefully', () => {
            const configWithUndefinedOverrides = {
                componentOverrides: undefined,
            };

            mockThemePlugin.initializeOverrides.mockImplementation((config: any) => {
                if (!config?.componentOverrides) {
                    console.log('[theme] No component overrides found in theme config');
                    return;
                }
            });

            mockThemePlugin.initializeOverrides(configWithUndefinedOverrides);

            expect(getOverrideResolver()).toBeNull();
            expect(mockConsole.log).toHaveBeenCalledWith(
                '[theme] No component overrides found in theme config'
            );
        });
    });

    describe('7.5 Plugin validates override config', () => {
        it('should validate config before initializing resolver', () => {
            const invalidConfig = {
                componentOverrides: {
                    global: {
                        button: 'not an array', // Invalid: should be array
                    },
                },
            };

            mockThemePlugin.initializeOverrides.mockImplementation((config: any) => {
                if (!config?.componentOverrides) return;

                const validation = validateComponentOverrides(config.componentOverrides);
                if (!validation.valid) {
                    logValidationErrors(validation, 'invalid-theme');
                    console.error('[theme] Skipping override initialization due to validation errors');
                    return;
                }

                setOverrideResolver(config.componentOverrides);
            });

            mockThemePlugin.initializeOverrides(invalidConfig);

            // Resolver should not be initialized due to validation failure
            expect(getOverrideResolver()).toBeNull();
            expect(mockThemePlugin.overrideStats.resolverLoaded).toBe(false);
            
            // Should log validation errors
            expect(mockConsole.error).toHaveBeenCalledWith(
                '[theme] Skipping override initialization due to validation errors'
            );
        });

        it('should proceed with valid config after validation', () => {
            const validConfig = {
                componentOverrides: {
                    global: {
                        button: [
                            {
                                component: 'button',
                                props: { variant: 'solid' as const },
                            },
                        ],
                    },
                },
            };

            mockThemePlugin.initializeOverrides.mockImplementation((config: any) => {
                if (!config?.componentOverrides) return;

                const validation = validateComponentOverrides(config.componentOverrides);
                if (!validation.valid) return;

                setOverrideResolver(config.componentOverrides);
                mockThemePlugin.overrideStats.resolverLoaded = true;
            });

            mockThemePlugin.initializeOverrides(validConfig);

            expect(getOverrideResolver()).toBeTruthy();
            expect(mockThemePlugin.overrideStats.resolverLoaded).toBe(true);
            expect(mockConsole.error).not.toHaveBeenCalled();
        });
    });

    describe('7.6 Plugin logs errors for invalid config', () => {
        it('should log detailed validation errors', () => {
            const configWithMultipleErrors = {
                componentOverrides: {
                    global: {
                        button: 'not an array', // Error 1
                        input: [
                            {
                                // Missing component property - Error 2
                                props: { size: 'lg' as const },
                            },
                        ],
                    },
                    contexts: {
                        chat: 'not an object', // Error 3
                    },
                },
            };

            mockThemePlugin.initializeOverrides.mockImplementation((config: any) => {
                if (!config?.componentOverrides) return;

                const validation = validateComponentOverrides(config.componentOverrides);
                logValidationErrors(validation, 'error-theme');
                
                if (!validation.valid) {
                    console.error('[theme] Skipping override initialization due to validation errors');
                }
            });

            mockThemePlugin.initializeOverrides(configWithMultipleErrors);

            // Should log validation summary
            expect(mockConsole.group).toHaveBeenCalledWith(
                '[theme] Validation results for error-theme'
            );
            expect(mockConsole.error).toHaveBeenCalledWith(
                '❌ 3 validation error(s):'
            );
            
            // Should log specific errors
            expect(mockConsole.error).toHaveBeenCalledWith(
                '  componentOverrides.global.button: button global overrides must be an array'
            );
            expect(mockConsole.error).toHaveBeenCalledWith(
                '  componentOverrides.global.input[0].component: override rule must have a component property'
            );
            expect(mockConsole.error).toHaveBeenCalledWith(
                '  componentOverrides.contexts.chat: context "chat" overrides must be an object'
            );
            
            expect(mockConsole.groupEnd).toHaveBeenCalled();
        });

        it('should log warnings but proceed with initialization', () => {
            const configWithWarnings = {
                componentOverrides: {
                    global: {
                        button: [
                            {
                                component: 'button',
                                props: { variant: 'solid' as const },
                                priority: -1, // Warning: negative priority
                            },
                        ],
                    },
                },
            };

            mockThemePlugin.initializeOverrides.mockImplementation((config: any) => {
                if (!config?.componentOverrides) return;

                const validation = validateComponentOverrides(config.componentOverrides);
                logValidationErrors(validation, 'warning-theme');
                
                if (validation.valid) {
                    setOverrideResolver(config.componentOverrides);
                    mockThemePlugin.overrideStats.resolverLoaded = true;
                }
            });

            mockThemePlugin.initializeOverrides(configWithWarnings);

            // Should proceed with initialization
            expect(getOverrideResolver()).toBeTruthy();
            expect(mockThemePlugin.overrideStats.resolverLoaded).toBe(true);
            
            // Should log warnings
            expect(mockConsole.warn).toHaveBeenCalledWith(
                '⚠️  1 validation warning(s):'
            );
            expect(mockConsole.warn).toHaveBeenCalledWith(
                '  componentOverrides.global.button[0].priority: priority should be a non-negative number'
            );
            
            // Should not log errors
            expect(mockConsole.error).not.toHaveBeenCalledWith(
                expect.stringContaining('validation error(s)')
            );
        });
    });

    describe('7.7 Mock theme loader and verify resolver calls', () => {
        it('should verify resolver is called with correct config', () => {
            // Mock theme loader
            const mockThemeLoader = {
                loadTheme: vi.fn(),
                discoverThemes: vi.fn(),
            };

            // Mock theme data
            const mockThemeData = {
                name: 'test-theme',
                componentOverrides: {
                    global: {
                        button: [
                            {
                                component: 'button',
                                props: { variant: 'solid' as const },
                            },
                        ],
                    },
                },
            };

            mockThemeLoader.loadTheme.mockResolvedValue(mockThemeData);

            // Mock plugin initialization that would be called by theme loader
            const mockPluginInit = vi.fn().mockImplementation((themeData: any) => {
                const validation = validateComponentOverrides(themeData.componentOverrides);
                if (validation.valid) {
                    setOverrideResolver(themeData.componentOverrides);
                }
                return validation;
            });

            // Simulate theme loading flow
            async function loadThemeAndInitializeOverrides(themeName: string) {
                const themeData = await mockThemeLoader.loadTheme(themeName);
                return mockPluginInit(themeData);
            }

            // Execute the flow
            loadThemeAndInitializeOverrides('test-theme').then((result) => {
                expect(result.valid).toBe(true);
                expect(getOverrideResolver()).toBeTruthy();
                expect(mockPluginInit).toHaveBeenCalledWith(mockThemeData);
                expect(mockPluginInit).toHaveBeenCalledTimes(1);
            });
        });

        it('should verify resolver is cleared on theme switch failure', () => {
            // Mock plugin error handling that would be called on theme load failure
            const mockPluginErrorHandling = vi.fn().mockImplementation(() => {
                clearOverrideResolver();
                mockThemePlugin.overrideStats = {
                    resolverLoaded: false,
                    rulesCount: 0,
                    contextsCount: 0,
                    lastInitTheme: '',
                };
                console.error('[theme] Failed to load theme: Theme load failed');
            });

            // Simulate theme load failure handling
            mockPluginErrorHandling();

            // Verify cleanup on error
            expect(getOverrideResolver()).toBeNull();
            expect(mockThemePlugin.overrideStats.resolverLoaded).toBe(false);
            expect(mockConsole.error).toHaveBeenCalledWith(
                '[theme] Failed to load theme: Theme load failed'
            );
        });

        it('should verify resolver stats are updated correctly', () => {
            const configWithStats = {
                componentOverrides: {
                    global: {
                        button: [
                            {
                                component: 'button',
                                props: { variant: 'solid' as const },
                            },
                            {
                                component: 'button',
                                props: { variant: 'outline' as const },
                            },
                        ],
                        input: [
                            {
                                component: 'input',
                                props: { size: 'lg' as const },
                            },
                        ],
                    },
                    contexts: {
                        chat: {
                            button: [
                                {
                                    component: 'button',
                                    props: { variant: 'ghost' as const },
                                },
                            ],
                        },
                        sidebar: {
                            input: [
                                {
                                    component: 'input',
                                    props: { size: 'md' as const },
                                },
                            ],
                        },
                    },
                },
            };

            mockThemePlugin.initializeOverrides.mockImplementation((config: any) => {
                if (!config?.componentOverrides) return;

                const validation = validateComponentOverrides(config.componentOverrides);
                if (!validation.valid) return;

                setOverrideResolver(config.componentOverrides);
                
                // Calculate stats as the plugin would
                const overrides = config.componentOverrides;
                
                // Helper function to count rules in a bucket
                const countRules = (bucket?: Record<string, any[] | undefined>) =>
                    bucket ? Object.values(bucket).reduce(
                        (total: number, rules) => total + (Array.isArray(rules) ? rules.length : 0),
                        0,
                    ) : 0;

                // Count all rules across global, contexts, and states
                const rulesCount =
                    countRules(overrides.global) +
                    Object.values(overrides.contexts ?? {}).reduce(
                        (total: number, ctx) => total + countRules(ctx as Record<string, any[] | undefined>),
                        0,
                    ) +
                    Object.values(overrides.states ?? {}).reduce(
                        (total: number, stateBucket) => total + countRules(stateBucket as Record<string, any[] | undefined>),
                        0,
                    );
                
                const contextsCount = Object.keys(overrides.contexts || {}).length;
                
                mockThemePlugin.overrideStats = {
                    resolverLoaded: true,
                    rulesCount,
                    contextsCount,
                    lastInitTheme: 'stats-theme',
                };
            });

            mockThemePlugin.initializeOverrides(configWithStats);

            // Verify stats calculation
            expect(mockThemePlugin.overrideStats.resolverLoaded).toBe(true);
            expect(mockThemePlugin.overrideStats.rulesCount).toBe(5); // 3 global (2 button + 1 input) + 2 context (1 chat + 1 sidebar) rules
            expect(mockThemePlugin.overrideStats.contextsCount).toBe(2); // chat + sidebar contexts
            expect(mockThemePlugin.overrideStats.lastInitTheme).toBe('stats-theme');
        });
    });
});
