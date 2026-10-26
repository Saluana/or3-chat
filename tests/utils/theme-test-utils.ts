/**
 * Test utilities for the refined theme system
 * Provides factories and helpers for testing themed components
 */

import type {
    CompiledTheme,
    CompiledOverride,
    OverrideProps,
} from '~/theme/_shared/types';

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
        cssVariables: '',
        overrides: [],
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
