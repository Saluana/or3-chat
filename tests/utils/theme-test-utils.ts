/**
 * Test utilities for the refined theme system
 * Provides factories and helpers for testing themed components
 */

import { ref, type Ref, type App } from 'vue';
import type {
    ThemeDefinition,
    CompiledTheme,
    CompiledOverride,
    OverrideProps,
} from '~/theme/_shared/types';

/**
 * Mock theme plugin that provides theme context to components
 * @param themeName Name of the theme to mock
 * @returns Vue plugin object for use with mount()
 */
export function mockTheme(themeName: string = 'default') {
    return {
        install(app: App) {
            app.provide('theme', {
                activeTheme: ref(themeName),
                current: ref('light'),
                set: vi.fn(),
                toggle: vi.fn(),
                get: vi.fn(() => themeName),
                setActiveTheme: vi.fn(),
                getResolver: vi.fn(),
            });
        },
    };
}

/**
 * Mock theme overrides with debug information
 * Useful for testing useThemeOverrides composable
 * @param overrides Partial override props to mock
 * @returns Mock return value for useThemeOverrides
 */
export function mockThemeOverrides(overrides: Partial<OverrideProps> = {}) {
    return {
        overrides: ref({
            variant: 'solid',
            size: 'md',
            ...overrides,
        }),
        debug: ref({
            component: 'button',
            context: 'global',
            theme: 'default',
            mode: 'light' as const,
            state: 'default' as const,
            identifier: undefined,
            appliedRules: 0,
            cacheKey: 'mock',
        }),
    };
}

/**
 * Set the active theme in a mounted component wrapper
 * @param wrapper Vue wrapper from mount()
 * @param themeName Name of theme to activate
 */
export function setActiveTheme(wrapper: any, themeName: string) {
    if (wrapper.vm.$theme) {
        wrapper.vm.$theme.activeTheme.value = themeName;
    }
}

/**
 * Create a test theme definition
 * @param overrides Partial theme definition to merge with defaults
 * @returns Complete ThemeDefinition for testing
 */
export function createTestTheme(
    overrides: Partial<ThemeDefinition> = {}
): ThemeDefinition {
    return {
        name: 'test-theme',
        displayName: 'Test Theme',
        description: 'Theme for testing',
        colors: {
            primary: '#3f8452',
            secondary: '#5a7b62',
            tertiary: '#4a7c83',
            surface: '#f5faf5',
            success: '#4a9763',
            warning: '#c8931d',
            error: '#b5473c',
            ...overrides.colors,
        },
        overrides: overrides.overrides || {},
        ui: overrides.ui || {},
        ...overrides,
    };
}

/**
 * Create a compiled theme for runtime testing
 * @param overrides Partial compiled theme data
 * @returns CompiledTheme for testing RuntimeResolver
 */
export function createCompiledTheme(
    overrides: Partial<CompiledTheme> = {}
): CompiledTheme {
    return {
        name: 'test-theme',
        displayName: 'Test Theme',
        description: 'Compiled theme for testing',
        colors: {
            primary: '#3f8452',
            secondary: '#5a7b62',
            tertiary: '#4a7c83',
            surface: '#f5faf5',
            success: '#4a9763',
            warning: '#c8931d',
            error: '#b5473c',
        },
        overrides: [],
        cssVariables: '',
        ...overrides,
    };
}

/**
 * Create a compiled override for testing
 * @param selector CSS selector
 * @param props Override props
 * @param specificity Optional specificity (calculated if omitted)
 * @returns CompiledOverride for testing
 */
export function createCompiledOverride(
    selector: string,
    props: OverrideProps,
    specificity?: number
): CompiledOverride {
    // Parse basic selector for component
    const component = selector.match(/^(\w+)/)?.[1] || 'button';
    const context = selector.match(/\[data-context="([^"]+)"\]/)?.[1];
    const identifier = selector.match(/\[data-id="([^"]+)"\]/)?.[1];
    const state = selector.match(/:(\w+)/)?.[1];

    // Calculate specificity if not provided
    if (specificity === undefined) {
        specificity = 1; // element
        specificity += (selector.match(/\[/g) || []).length * 10; // attributes
        specificity += (selector.match(/:/g) || []).length * 10; // pseudo-classes
    }

    return {
        component,
        context,
        identifier,
        state,
        props,
        selector,
        specificity,
    };
}

/**
 * Create test fixtures for invalid theme definitions
 * Used for testing validation
 */
export const invalidThemeFixtures = {
    missingColors: {
        name: 'invalid-missing-colors',
        // Missing required colors
    },
    invalidColorFormat: {
        name: 'invalid-color-format',
        colors: {
            primary: 'not-a-hex-color',
            surface: '#ffffff',
        },
    },
    invalidSelector: {
        name: 'invalid-selector',
        colors: {
            primary: '#ff0000',
            surface: '#ffffff',
        },
        overrides: {
            '[[invalid]]': { variant: 'solid' },
        },
    },
    missingName: {
        colors: {
            primary: '#ff0000',
            surface: '#ffffff',
        },
    },
};

/**
 * Create test fixtures for valid theme definitions
 * Used for testing successful compilation
 */
export const validThemeFixtures = {
    minimal: {
        name: 'minimal',
        colors: {
            primary: '#3f8452',
            surface: '#f5faf5',
        },
    },
    withOverrides: {
        name: 'with-overrides',
        colors: {
            primary: '#3f8452',
            surface: '#f5faf5',
        },
        overrides: {
            button: { variant: 'solid' },
            'button.chat': { variant: 'ghost' },
            'button#chat.send': { variant: 'solid', color: 'primary' },
        },
    },
    withDarkMode: {
        name: 'with-dark-mode',
        colors: {
            primary: '#3f8452',
            surface: '#f5faf5',
            dark: {
                primary: '#8dd29a',
                surface: '#0c130d',
            },
        },
    },
    complex: {
        name: 'complex',
        displayName: 'Complex Test Theme',
        description: 'A complex theme with all features',
        colors: {
            primary: '#3f8452',
            secondary: '#5a7b62',
            tertiary: '#4a7c83',
            surface: '#f5faf5',
            success: '#4a9763',
            warning: '#c8931d',
            error: '#b5473c',
            dark: {
                primary: '#8dd29a',
                surface: '#0c130d',
            },
        },
        overrides: {
            button: { variant: 'solid', size: 'md' },
            'button.chat': { variant: 'ghost' },
            'button#chat.send': { variant: 'solid', color: 'primary' },
            'button:hover': { class: 'shadow-lg' },
            'input[type="text"]': { variant: 'outline' },
            'button[data-context="sidebar"][type="submit"]': {
                variant: 'solid',
                size: 'lg',
            },
        },
        ui: {
            button: {
                default: {
                    size: 'md',
                },
            },
        },
    },
};
