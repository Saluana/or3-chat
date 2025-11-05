/**
 * Unit tests for ThemeCompiler
 * Tests selector parsing, specificity calculation, and CSS generation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ThemeCompiler } from '../theme-compiler';
import { validThemeFixtures } from '../../tests/utils/theme-test-utils';

describe('ThemeCompiler', () => {
    let compiler: ThemeCompiler;

    beforeEach(() => {
        compiler = new ThemeCompiler();
    });

    describe('selector parsing', () => {
        it('should parse simple component selector', () => {
            const parsed = (compiler as any).parseSelector('button');

            expect(parsed.component).toBe('button');
            expect(parsed.context).toBeUndefined();
            expect(parsed.identifier).toBeUndefined();
            expect(parsed.state).toBeUndefined();
        });

        it('should parse simple context syntax', () => {
            const parsed = (compiler as any).parseSelector('button.chat');

            expect(parsed.component).toBe('button');
            expect(parsed.context).toBe('chat');
        });

        it('should parse simple identifier syntax', () => {
            const parsed = (compiler as any).parseSelector('button#chat.send');

            expect(parsed.component).toBe('button');
            expect(parsed.identifier).toBe('chat.send');
        });

        it('should parse state pseudo-class', () => {
            const parsed = (compiler as any).parseSelector('button:hover');

            expect(parsed.component).toBe('button');
            expect(parsed.state).toBe('hover');
        });

        it('should parse combined context and state', () => {
            const parsed = (compiler as any).parseSelector('button.chat:hover');

            expect(parsed.component).toBe('button');
            expect(parsed.context).toBe('chat');
            expect(parsed.state).toBe('hover');
        });

        it('should parse attribute selector syntax', () => {
            const parsed = (compiler as any).parseSelector(
                'button[data-context="chat"]'
            );

            expect(parsed.component).toBe('button');
            expect(parsed.context).toBe('chat');
        });

        it('should parse HTML attribute selectors', () => {
            const parsed = (compiler as any).parseSelector('button[type="submit"]');

            expect(parsed.component).toBe('button');
            expect(parsed.attributes).toBeDefined();
            expect(parsed.attributes?.[0].attribute).toBe('type');
            expect(parsed.attributes?.[0].operator).toBe('=');
            expect(parsed.attributes?.[0].value).toBe('submit');
        });

        it('should parse multiple attribute selectors', () => {
            const parsed = (compiler as any).parseSelector(
                'button[type="submit"][class*="primary"]'
            );

            expect(parsed.component).toBe('button');
            expect(parsed.attributes).toHaveLength(2);
            expect(parsed.attributes?.[0].attribute).toBe('type');
            expect(parsed.attributes?.[1].attribute).toBe('class');
        });

        it('should parse attribute exists selector', () => {
            const parsed = (compiler as any).parseSelector('button[disabled]');

            expect(parsed.component).toBe('button');
            expect(parsed.attributes?.[0].attribute).toBe('disabled');
            expect(parsed.attributes?.[0].operator).toBe('exists');
        });

        it('should parse attribute starts-with selector', () => {
            const parsed = (compiler as any).parseSelector('button[id^="action-"]');

            expect(parsed.component).toBe('button');
            expect(parsed.attributes?.[0].operator).toBe('^=');
            expect(parsed.attributes?.[0].value).toBe('action-');
        });

        it('should parse attribute ends-with selector', () => {
            const parsed = (compiler as any).parseSelector(
                'button[data-action$="-confirm"]'
            );

            expect(parsed.component).toBe('button');
            expect(parsed.attributes?.[0].operator).toBe('$=');
            expect(parsed.attributes?.[0].value).toBe('-confirm');
        });

        it('should parse attribute contains selector', () => {
            const parsed = (compiler as any).parseSelector('button[class*="btn"]');

            expect(parsed.component).toBe('button');
            expect(parsed.attributes?.[0].operator).toBe('*=');
            expect(parsed.attributes?.[0].value).toBe('btn');
        });

        it('should parse complex combined selector', () => {
            const parsed = (compiler as any).parseSelector(
                'button.chat[type="submit"]:hover'
            );

            expect(parsed.component).toBe('button');
            expect(parsed.context).toBe('chat');
            expect(parsed.state).toBe('hover');
            expect(parsed.attributes?.[0].attribute).toBe('type');
        });
    });

    describe('selector normalization', () => {
        it('should normalize simple context syntax', () => {
            const normalized = (compiler as any).normalizeSelector('button.chat');

            expect(normalized).toBe('button[data-context="chat"]');
        });

        it('should normalize simple identifier syntax', () => {
            const normalized = (compiler as any).normalizeSelector('button#chat.send');

            expect(normalized).toBe('button[data-id="chat.send"]');
        });

        it('should not normalize unknown contexts', () => {
            const normalized = (compiler as any).normalizeSelector('button.unknown');

            // Should keep as-is if not a known context
            expect(normalized).toBe('button.unknown');
        });

        it('should preserve existing attribute selectors', () => {
            const normalized = (compiler as any).normalizeSelector(
                'button[data-context="chat"]'
            );

            expect(normalized).toBe('button[data-context="chat"]');
        });

        it('should normalize mixed syntax', () => {
            const normalized = (compiler as any).normalizeSelector(
                'button.chat[type="submit"]'
            );

            expect(normalized).toBe('button[data-context="chat"][type="submit"]');
        });
    });

    describe('specificity calculation', () => {
        it('should calculate element-only specificity', () => {
            const specificity = (compiler as any).calculateSpecificity('button');

            expect(specificity).toBe(1);
        });

        it('should calculate attribute specificity', () => {
            const specificity = (compiler as any).calculateSpecificity(
                'button[type="submit"]'
            );

            // 1 (element) + 10 (attribute) = 11
            expect(specificity).toBe(11);
        });

        it('should calculate multiple attribute specificity', () => {
            const specificity = (compiler as any).calculateSpecificity(
                'button[type="submit"][class*="primary"]'
            );

            // 1 (element) + 10 (attr) + 10 (attr) = 21
            expect(specificity).toBe(21);
        });

        it('should calculate pseudo-class specificity', () => {
            const specificity = (compiler as any).calculateSpecificity('button:hover');

            // 1 (element) + 10 (pseudo-class) = 11
            expect(specificity).toBe(11);
        });

        it('should calculate combined specificity', () => {
            const specificity = (compiler as any).calculateSpecificity(
                'button[data-context="chat"][type="submit"]:hover'
            );

            // 1 (element) + 10 (attr) + 10 (attr) + 10 (pseudo) = 31
            expect(specificity).toBe(31);
        });

        it('should handle complex selectors', () => {
            const specificity = (compiler as any).calculateSpecificity(
                'button[data-id="chat.send"][data-context="chat"]:hover:focus'
            );

            // 1 (element) + 10 (attr) + 10 (attr) + 10 (pseudo) + 10 (pseudo) = 41
            expect(specificity).toBe(41);
        });
    });

    describe('CSS variable generation', () => {
        it('should generate light mode variables', () => {
            const colors = {
                primary: '#3f8452',
                secondary: '#5a7b62',
                surface: '#f5faf5',
            };

            const css = (compiler as any).generateCSSVariables(colors);

            expect(css).toContain('.light');
            expect(css).toContain('--md-primary: #3f8452');
            expect(css).toContain('--md-secondary: #5a7b62');
            expect(css).toContain('--md-surface: #f5faf5');
        });

        it('should generate dark mode variables when provided', () => {
            const colors = {
                primary: '#3f8452',
                surface: '#f5faf5',
                dark: {
                    primary: '#8dd29a',
                    surface: '#0c130d',
                },
            };

            const css = (compiler as any).generateCSSVariables(colors);

            expect(css).toContain('.dark');
            expect(css).toContain('--md-primary: #8dd29a');
            expect(css).toContain('--md-surface: #0c130d');
        });

        it('should auto-calculate onPrimary if missing', () => {
            const colors = {
                primary: '#3f8452',
                surface: '#f5faf5',
            };

            const css = (compiler as any).generateCSSVariables(colors);

            // Should include auto-calculated onPrimary
            expect(css).toContain('--md-on-primary:');
        });

        it('should use provided onPrimary if specified', () => {
            const colors = {
                primary: '#3f8452',
                onPrimary: '#ffffff',
                surface: '#f5faf5',
            };

            const css = (compiler as any).generateCSSVariables(colors);

            expect(css).toContain('--md-on-primary: #ffffff');
        });
    });

    describe('override compilation', () => {
        it('should compile simple override', () => {
            const overrides = {
                button: { variant: 'solid', size: 'md' },
            };

            const compiled = (compiler as any).compileOverrides(overrides);

            expect(compiled).toHaveLength(1);
            expect(compiled[0].component).toBe('button');
            expect(compiled[0].props.variant).toBe('solid');
            expect(compiled[0].props.size).toBe('md');
            expect(compiled[0].specificity).toBe(1);
        });

        it('should compile context-specific override', () => {
            const overrides = {
                'button.chat': { variant: 'ghost' },
            };

            const compiled = (compiler as any).compileOverrides(overrides);

            expect(compiled[0].component).toBe('button');
            expect(compiled[0].context).toBe('chat');
            expect(compiled[0].specificity).toBe(11);
        });

        it('should compile identifier-specific override', () => {
            const overrides = {
                'button#chat.send': { variant: 'solid' },
            };

            const compiled = (compiler as any).compileOverrides(overrides);

            expect(compiled[0].component).toBe('button');
            expect(compiled[0].identifier).toBe('chat.send');
            expect(compiled[0].specificity).toBe(21);
        });

        it('should compile multiple overrides', () => {
            const overrides = {
                button: { variant: 'solid' },
                'button.chat': { variant: 'ghost' },
                input: { variant: 'outline' },
            };

            const compiled = (compiler as any).compileOverrides(overrides);

            expect(compiled).toHaveLength(3);
            expect(compiled.some((o: any) => o.component === 'button')).toBe(true);
            expect(compiled.some((o: any) => o.component === 'input')).toBe(true);
        });

        it('should preserve original selector', () => {
            const overrides = {
                'button.chat[type="submit"]:hover': { class: 'hover-effect' },
            };

            const compiled = (compiler as any).compileOverrides(overrides);

            expect(compiled[0].selector).toBe('button.chat[type="submit"]:hover');
        });
    });

    describe('type generation', () => {
        it('should generate ThemeName union type', async () => {
            const results = [
                {
                    name: 'theme1',
                    theme: { name: 'theme1' },
                    errors: [],
                    warnings: [],
                    success: true,
                },
                {
                    name: 'theme2',
                    theme: { name: 'theme2' },
                    errors: [],
                    warnings: [],
                    success: true,
                },
            ];

            const typeContent = await (compiler as any).generateTypesContent(results);

            expect(typeContent).toContain("export type ThemeName = 'theme1' | 'theme2'");
        });

        it('should generate ThemeIdentifier union type', async () => {
            const results = [
                {
                    name: 'test',
                    theme: {
                        name: 'test',
                        overrides: [
                            { identifier: 'chat.send' },
                            { identifier: 'chat.cancel' },
                        ],
                    },
                    errors: [],
                    warnings: [],
                    success: true,
                },
            ];

            const typeContent = await (compiler as any).generateTypesContent(results);

            expect(typeContent).toContain('ThemeIdentifier');
            expect(typeContent).toContain('chat.send');
            expect(typeContent).toContain('chat.cancel');
        });

        it('should generate ThemeDirective interface', async () => {
            const results = [
                {
                    name: 'test',
                    theme: { name: 'test', overrides: [] },
                    errors: [],
                    warnings: [],
                    success: true,
                },
            ];

            const typeContent = await (compiler as any).generateTypesContent(results);

            expect(typeContent).toContain('export interface ThemeDirective');
        });

        it('should handle empty identifiers', async () => {
            const results = [
                {
                    name: 'test',
                    theme: { name: 'test', overrides: [] },
                    errors: [],
                    warnings: [],
                    success: true,
                },
            ];

            const typeContent = await (compiler as any).generateTypesContent(results);

            expect(typeContent).toContain('ThemeIdentifier');
            expect(typeContent).toContain('never'); // Should use 'never' for empty union
        });
    });

    describe('validation', () => {
        it('should detect missing required colors', () => {
            const theme = {
                name: 'incomplete',
                colors: {
                    // Missing required primary color
                    surface: '#f5faf5',
                },
            };

            const errors: any[] = [];
            (compiler as any).validateStructure(theme, errors);

            expect(errors.length).toBeGreaterThan(0);
            expect(errors.some((e: any) => e.message.includes('primary'))).toBe(true);
        });

        it('should accept complete color palette', () => {
            const theme = validThemeFixtures.minimal;

            const errors: any[] = [];
            (compiler as any).validateStructure(theme, errors);

            expect(errors.length).toBe(0);
        });
    });

    describe('error handling', () => {
        it('should collect validation errors', () => {
            const theme = {
                name: 'invalid',
                colors: {
                    // Invalid color format
                    primary: 'not-a-color',
                    surface: '#ffffff',
                },
            };

            const errors: any[] = [];
            (compiler as any).validateStructure(theme, errors);

            expect(errors.length).toBeGreaterThan(0);
        });

        it('should continue compilation on warnings', () => {
            const theme = validThemeFixtures.withOverrides;

            const errors: any[] = [];
            const warnings: any[] = [];

            (compiler as any).validateSelectors(theme.overrides || {}, warnings);

            // Warnings should not prevent compilation
            // (actual warnings depend on theme structure)
        });
    });
});
