/**
 * Unit tests for RuntimeResolver
 * Tests override resolution, matching, and merging logic
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RuntimeResolver } from '../runtime-resolver';
import {
    createCompiledTheme,
    createCompiledOverride,
} from '../../../../tests/utils/theme-test-utils';
import type { CompiledTheme, CompiledOverride } from '../types';

describe('RuntimeResolver', () => {
    describe('constructor', () => {
        it('should initialize with a compiled theme', () => {
            const theme = createCompiledTheme();
            const resolver = new RuntimeResolver(theme);

            expect(resolver).toBeInstanceOf(RuntimeResolver);
        });

        it('should sort overrides by specificity (descending)', () => {
            const overrides: CompiledOverride[] = [
                createCompiledOverride('button', { variant: 'solid' }, 1),
                createCompiledOverride('button.chat', { variant: 'ghost' }, 11),
                createCompiledOverride(
                    'button#chat.send',
                    { variant: 'solid' },
                    21
                ),
            ];

            const theme = createCompiledTheme({ overrides });
            const resolver = new RuntimeResolver(theme);

            // Access private property for testing
            const sortedOverrides = (resolver as any).overrides;

            // Should be sorted highest to lowest
            expect(sortedOverrides[0].specificity).toBe(21);
            expect(sortedOverrides[1].specificity).toBe(11);
            expect(sortedOverrides[2].specificity).toBe(1);
        });
    });

    describe('resolve()', () => {
        it('should return empty props when no overrides match', () => {
            const theme = createCompiledTheme({ overrides: [] });
            const resolver = new RuntimeResolver(theme);

            const result = resolver.resolve({
                component: 'button',
                context: 'chat',
            });

            expect(result.props).toEqual({});
        });

        it('should resolve global component override', () => {
            const overrides: CompiledOverride[] = [
                createCompiledOverride('button', { variant: 'solid' }),
            ];

            const theme = createCompiledTheme({ overrides });
            const resolver = new RuntimeResolver(theme);

            const result = resolver.resolve({
                component: 'button',
                isNuxtUI: true, // Treat as Nuxt UI to get props directly
            });

            expect(result.props.variant).toBe('solid');
        });

        it('should resolve context-specific override', () => {
            const overrides: CompiledOverride[] = [
                createCompiledOverride('button', { variant: 'solid' }, 1),
                createCompiledOverride(
                    'button[data-context="chat"]',
                    { variant: 'ghost' },
                    11
                ),
            ];

            const theme = createCompiledTheme({ overrides });
            const resolver = new RuntimeResolver(theme);

            const result = resolver.resolve({
                component: 'button',
                context: 'chat',
                isNuxtUI: true,
            });

            // Context-specific should win over global
            expect(result.props.variant).toBe('ghost');
        });

        it('should resolve identifier-specific override', () => {
            const overrides: CompiledOverride[] = [
                createCompiledOverride('button', { variant: 'solid' }, 1),
                createCompiledOverride(
                    'button[data-context="chat"]',
                    { variant: 'ghost' },
                    11
                ),
                createCompiledOverride(
                    'button[data-id="chat.send"]',
                    { variant: 'outline' },
                    21
                ),
            ];

            const theme = createCompiledTheme({ overrides });
            const resolver = new RuntimeResolver(theme);

            const result = resolver.resolve({
                component: 'button',
                context: 'chat',
                identifier: 'chat.send',
                isNuxtUI: true,
            });

            // Identifier should win over context and global
            expect(result.props.variant).toBe('outline');
        });

        it('should resolve state-specific override', () => {
            const overrides: CompiledOverride[] = [
                createCompiledOverride('button', { class: 'base' }, 1),
                createCompiledOverride(
                    'button:hover',
                    { class: 'hover-effect' },
                    11
                ),
            ];

            const theme = createCompiledTheme({ overrides });
            const resolver = new RuntimeResolver(theme);

            const result = resolver.resolve({
                component: 'button',
                state: 'hover',
                isNuxtUI: true,
            });

            // Classes should concatenate
            expect(result.props.class).toContain('hover-effect');
            expect(result.props.class).toContain('base');
        });

        it('should merge multiple matching overrides', () => {
            const overrides: CompiledOverride[] = [
                createCompiledOverride('button', { variant: 'solid', size: 'md' }, 1),
                createCompiledOverride(
                    'button[data-context="chat"]',
                    { color: 'primary' },
                    11
                ),
            ];

            const theme = createCompiledTheme({ overrides });
            const resolver = new RuntimeResolver(theme);

            const result = resolver.resolve({
                component: 'button',
                context: 'chat',
                isNuxtUI: true,
            });

            // Should merge all matching overrides
            expect(result.props.variant).toBe('solid');
            expect(result.props.size).toBe('md');
            expect(result.props.color).toBe('primary');
        });

        it('should not match wrong component type', () => {
            const overrides: CompiledOverride[] = [
                createCompiledOverride('button', { variant: 'solid' }),
            ];

            const theme = createCompiledTheme({ overrides });
            const resolver = new RuntimeResolver(theme);

            const result = resolver.resolve({
                component: 'input',
            });

            expect(result.props).toEqual({});
        });

        it('should not match wrong context', () => {
            const overrides: CompiledOverride[] = [
                createCompiledOverride(
                    'button[data-context="chat"]',
                    { variant: 'solid' }
                ),
            ];

            const theme = createCompiledTheme({ overrides });
            const resolver = new RuntimeResolver(theme);

            const result = resolver.resolve({
                component: 'button',
                context: 'sidebar',
            });

            expect(result.props).toEqual({});
        });

        it('should not match wrong identifier', () => {
            const overrides: CompiledOverride[] = [
                createCompiledOverride(
                    'button[data-id="chat.send"]',
                    { variant: 'solid' }
                ),
            ];

            const theme = createCompiledTheme({ overrides });
            const resolver = new RuntimeResolver(theme);

            const result = resolver.resolve({
                component: 'button',
                identifier: 'chat.cancel',
            });

            expect(result.props).toEqual({});
        });
    });

    describe('class concatenation', () => {
        it('should concatenate classes from multiple overrides', () => {
            const overrides: CompiledOverride[] = [
                createCompiledOverride('button', { class: 'base' }, 1),
                createCompiledOverride(
                    'button[data-context="chat"]',
                    { class: 'context' },
                    11
                ),
                createCompiledOverride(
                    'button[data-id="chat.send"]',
                    { class: 'identifier' },
                    21
                ),
            ];

            const theme = createCompiledTheme({ overrides });
            const resolver = new RuntimeResolver(theme);

            const result = resolver.resolve({
                component: 'button',
                context: 'chat',
                identifier: 'chat.send',
                isNuxtUI: true,
            });

            // Classes should be concatenated in specificity order (highest first)
            const classes = result.props.class as string;
            expect(classes).toContain('identifier');
            expect(classes).toContain('context');
            expect(classes).toContain('base');
        });

        it('should handle empty classes gracefully', () => {
            const overrides: CompiledOverride[] = [
                createCompiledOverride('button', { variant: 'solid' }, 1),
                createCompiledOverride(
                    'button[data-context="chat"]',
                    { class: 'chat-btn' },
                    11
                ),
            ];

            const theme = createCompiledTheme({ overrides });
            const resolver = new RuntimeResolver(theme);

            const result = resolver.resolve({
                component: 'button',
                context: 'chat',
                isNuxtUI: true,
            });

            expect(result.props.class).toBe('chat-btn');
            expect(result.props.variant).toBe('solid');
        });
    });

    describe('prop-to-class mapping', () => {
        it('should map variant to class for non-Nuxt UI components', () => {
            const overrides: CompiledOverride[] = [
                createCompiledOverride('button', { variant: 'solid' }),
            ];

            const theme = createCompiledTheme({ overrides });
            const resolver = new RuntimeResolver(theme);

            const result = resolver.resolve({
                component: 'button',
                isNuxtUI: false, // Custom component
            });

            // Should convert variant to class
            expect(result.props.class).toContain('variant-solid');
            expect(result.props.variant).toBeUndefined();
        });

        it('should map size to class for non-Nuxt UI components', () => {
            const overrides: CompiledOverride[] = [
                createCompiledOverride('button', { size: 'lg' }),
            ];

            const theme = createCompiledTheme({ overrides });
            const resolver = new RuntimeResolver(theme);

            const result = resolver.resolve({
                component: 'button',
                isNuxtUI: false,
            });

            expect(result.props.class).toBeDefined();
            expect(result.props.size).toBeUndefined();
        });

        it('should map color to class for non-Nuxt UI components', () => {
            const overrides: CompiledOverride[] = [
                createCompiledOverride('button', { color: 'primary' }),
            ];

            const theme = createCompiledTheme({ overrides });
            const resolver = new RuntimeResolver(theme);

            const result = resolver.resolve({
                component: 'button',
                isNuxtUI: false,
            });

            expect(result.props.class).toBeDefined();
            expect(result.props.color).toBeUndefined();
        });

        it('should NOT map props for Nuxt UI components', () => {
            const overrides: CompiledOverride[] = [
                createCompiledOverride('button', { variant: 'solid', size: 'lg' }),
            ];

            const theme = createCompiledTheme({ overrides });
            const resolver = new RuntimeResolver(theme);

            const result = resolver.resolve({
                component: 'button',
                isNuxtUI: true, // Nuxt UI component
            });

            // Props should remain as-is, not converted to classes
            expect(result.props.variant).toBe('solid');
            expect(result.props.size).toBe('lg');
        });

        it('should preserve non-semantic props like class', () => {
            const overrides: CompiledOverride[] = [
                createCompiledOverride('button', { 
                    variant: 'solid',
                    class: 'custom-class'
                }),
            ];

            const theme = createCompiledTheme({ overrides });
            const resolver = new RuntimeResolver(theme);

            const result = resolver.resolve({
                component: 'button',
                isNuxtUI: false,
            });

            // Custom class should be preserved along with mapped class
            expect(result.props.class).toContain('custom-class');
            expect(result.props.class).toContain('variant-solid');
        });
    });

    describe('ui object merging', () => {
        it('should deep merge ui objects', () => {
            const overrides: CompiledOverride[] = [
                createCompiledOverride(
                    'button',
                    {
                        ui: {
                            base: 'btn-base',
                            variants: { solid: 'btn-solid' },
                        },
                    },
                    1
                ),
                createCompiledOverride(
                    'button[data-context="chat"]',
                    {
                        ui: {
                            variants: { ghost: 'btn-ghost' },
                            size: { md: 'btn-md' },
                        },
                    },
                    11
                ),
            ];

            const theme = createCompiledTheme({ overrides });
            const resolver = new RuntimeResolver(theme);

            const result = resolver.resolve({
                component: 'button',
                context: 'chat',
                isNuxtUI: true,
            });

            const ui = result.props.ui as any;
            expect(ui.base).toBe('btn-base');
            expect(ui.variants.solid).toBe('btn-solid');
            expect(ui.variants.ghost).toBe('btn-ghost');
            expect(ui.size.md).toBe('btn-md');
        });
    });

    describe('attribute matching', () => {
        it('should match exact attribute value', () => {
            const overrides: CompiledOverride[] = [
                {
                    component: 'button',
                    props: { variant: 'solid' },
                    selector: 'button[type="submit"]',
                    specificity: 11,
                    attributes: [
                        {
                            attribute: 'type',
                            operator: '=',
                            value: 'submit',
                        },
                    ],
                },
            ];

            const theme = createCompiledTheme({ overrides });
            const resolver = new RuntimeResolver(theme);

            // Create mock element with type="submit"
            const element = document.createElement('button');
            element.setAttribute('type', 'submit');

            const result = resolver.resolve({
                component: 'button',
                element,
                isNuxtUI: true,
            });

            expect(result.props.variant).toBe('solid');
        });

        it('should match attribute exists', () => {
            const overrides: CompiledOverride[] = [
                {
                    component: 'button',
                    props: { variant: 'solid' },
                    selector: 'button[disabled]',
                    specificity: 11,
                    attributes: [
                        {
                            attribute: 'disabled',
                            operator: 'exists',
                        },
                    ],
                },
            ];

            const theme = createCompiledTheme({ overrides });
            const resolver = new RuntimeResolver(theme);

            const element = document.createElement('button');
            element.setAttribute('disabled', '');

            const result = resolver.resolve({
                component: 'button',
                element,
                isNuxtUI: true,
            });

            expect(result.props.variant).toBe('solid');
        });

        it('should match attribute contains substring', () => {
            const overrides: CompiledOverride[] = [
                {
                    component: 'button',
                    props: { variant: 'solid' },
                    selector: 'button[class*="primary"]',
                    specificity: 11,
                    attributes: [
                        {
                            attribute: 'class',
                            operator: '*=',
                            value: 'primary',
                        },
                    ],
                },
            ];

            const theme = createCompiledTheme({ overrides });
            const resolver = new RuntimeResolver(theme);

            const element = document.createElement('button');
            element.setAttribute('class', 'btn btn-primary large');

            const result = resolver.resolve({
                component: 'button',
                element,
                isNuxtUI: true,
            });

            expect(result.props.variant).toBe('solid');
        });

        it('should match attribute starts with', () => {
            const overrides: CompiledOverride[] = [
                {
                    component: 'button',
                    props: { variant: 'solid' },
                    selector: 'button[id^="action-"]',
                    specificity: 11,
                    attributes: [
                        {
                            attribute: 'id',
                            operator: '^=',
                            value: 'action-',
                        },
                    ],
                },
            ];

            const theme = createCompiledTheme({ overrides });
            const resolver = new RuntimeResolver(theme);

            const element = document.createElement('button');
            element.setAttribute('id', 'action-submit');

            const result = resolver.resolve({
                component: 'button',
                element,
                isNuxtUI: true,
            });

            expect(result.props.variant).toBe('solid');
        });

        it('should match attribute ends with', () => {
            const overrides: CompiledOverride[] = [
                {
                    component: 'button',
                    props: { variant: 'solid' },
                    selector: 'button[data-action$="-confirm"]',
                    specificity: 11,
                    attributes: [
                        {
                            attribute: 'data-action',
                            operator: '$=',
                            value: '-confirm',
                        },
                    ],
                },
            ];

            const theme = createCompiledTheme({ overrides });
            const resolver = new RuntimeResolver(theme);

            const element = document.createElement('button');
            element.setAttribute('data-action', 'delete-confirm');

            const result = resolver.resolve({
                component: 'button',
                element,
                isNuxtUI: true,
            });

            expect(result.props.variant).toBe('solid');
        });

        it('should not match when attribute value is wrong', () => {
            const overrides: CompiledOverride[] = [
                {
                    component: 'button',
                    props: { variant: 'solid' },
                    selector: 'button[type="submit"]',
                    specificity: 11,
                    attributes: [
                        {
                            attribute: 'type',
                            operator: '=',
                            value: 'submit',
                        },
                    ],
                },
            ];

            const theme = createCompiledTheme({ overrides });
            const resolver = new RuntimeResolver(theme);

            const element = document.createElement('button');
            element.setAttribute('type', 'button');

            const result = resolver.resolve({
                component: 'button',
                element,
                isNuxtUI: true,
            });

            expect(result.props).toEqual({});
        });
    });

    describe('performance', () => {
        it('should handle many overrides efficiently', () => {
            // Create 100 overrides
            const overrides: CompiledOverride[] = [];
            for (let i = 0; i < 100; i++) {
                overrides.push(
                    createCompiledOverride(`button[data-id="test.${i}"]`, {
                        variant: `variant-${i}`,
                    })
                );
            }

            const theme = createCompiledTheme({ overrides });
            const resolver = new RuntimeResolver(theme);

            const startTime = performance.now();

            // Resolve 1000 times
            for (let i = 0; i < 1000; i++) {
                resolver.resolve({
                    component: 'button',
                    identifier: 'test.50',
                    isNuxtUI: true,
                });
            }

            const endTime = performance.now();
            const avgTime = (endTime - startTime) / 1000;

            // Should be less than 1ms per resolution
            expect(avgTime).toBeLessThan(1);
        });
    });
});
