/**
 * Unit tests for defineTheme() DSL function
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineTheme } from '../define-theme';
import type { ThemeDefinition } from '../types';

describe('defineTheme', () => {
    let originalEnv: string | undefined;

    beforeEach(() => {
        originalEnv = import.meta.env.DEV;
    });

    afterEach(() => {
        if (originalEnv !== undefined) {
            (import.meta.env as any).DEV = originalEnv;
        }
    });

    describe('valid themes', () => {
        it('should accept a valid minimal theme definition', () => {
            const theme = defineTheme({
                name: 'test',
                colors: {
                    primary: '#3f8452',
                    surface: '#f5faf5',
                },
            });

            expect(theme.name).toBe('test');
            expect(theme.colors.primary).toBe('#3f8452');
            expect(theme.colors.surface).toBe('#f5faf5');
        });

        it('should accept a theme with all color properties', () => {
            const theme = defineTheme({
                name: 'complete',
                colors: {
                    primary: '#3f8452',
                    onPrimary: '#ffffff',
                    primaryContainer: '#c3e6cd',
                    onPrimaryContainer: '#002106',
                    secondary: '#5a7b62',
                    tertiary: '#4a7c83',
                    error: '#b5473c',
                    surface: '#f5faf5',
                    surfaceVariant: '#e0e8e1',
                    onSurface: '#191c19',
                    inverseSurface: '#2e312e',
                    outline: '#71796f',
                    success: '#4a9763',
                    warning: '#c8931d',
                },
            });

            expect(theme.colors.primary).toBe('#3f8452');
            expect(theme.colors.onPrimary).toBe('#ffffff');
            expect(theme.colors.success).toBe('#4a9763');
        });

        it('should accept a theme with dark mode overrides', () => {
            const theme = defineTheme({
                name: 'with-dark',
                colors: {
                    primary: '#3f8452',
                    surface: '#f5faf5',
                    dark: {
                        primary: '#8dd29a',
                        surface: '#0c130d',
                    },
                },
            });

            expect(theme.colors.dark?.primary).toBe('#8dd29a');
            expect(theme.colors.dark?.surface).toBe('#0c130d');
        });

        it('should accept a theme with overrides', () => {
            const theme = defineTheme({
                name: 'with-overrides',
                colors: {
                    primary: '#3f8452',
                    surface: '#f5faf5',
                },
                overrides: {
                    button: { variant: 'solid', size: 'md' },
                    'button.chat': { variant: 'ghost' },
                    'button#chat.send': { color: 'primary' },
                },
            });

            expect(theme.overrides).toBeDefined();
            expect(theme.overrides?.button).toEqual({
                variant: 'solid',
                size: 'md',
            });
        });

        it('should accept a theme with UI config', () => {
            const theme = defineTheme({
                name: 'with-ui',
                colors: {
                    primary: '#3f8452',
                    surface: '#f5faf5',
                },
                ui: {
                    button: {
                        default: { size: 'md' },
                    },
                },
            });

            expect(theme.ui).toBeDefined();
            expect(theme.ui?.button).toBeDefined();
        });

        it('should accept a theme with display name and description', () => {
            const theme = defineTheme({
                name: 'documented',
                displayName: 'Documented Theme',
                description: 'A theme with documentation',
                colors: {
                    primary: '#3f8452',
                    surface: '#f5faf5',
                },
            });

            expect(theme.displayName).toBe('Documented Theme');
            expect(theme.description).toBe('A theme with documentation');
        });
    });

    describe('development mode validation', () => {
        beforeEach(() => {
            // Enable dev mode
            (import.meta.env as any).DEV = true;
        });

        it('should validate in development mode', () => {
            // Mock console.error to catch validation errors
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

            // This should trigger validation
            defineTheme({
                name: 'test',
                colors: {
                    primary: '#3f8452',
                    surface: '#f5faf5',
                },
            });

            // Should not have errors for valid theme
            expect(consoleError).not.toHaveBeenCalled();

            consoleError.mockRestore();
        });
    });

    describe('type safety', () => {
        it('should maintain type information', () => {
            const theme = defineTheme({
                name: 'typed',
                colors: {
                    primary: '#3f8452',
                    surface: '#f5faf5',
                },
                overrides: {
                    button: { variant: 'solid' },
                },
            });

            // TypeScript should allow accessing properties
            const _name: string = theme.name;
            const _primary: string = theme.colors.primary;
            const _overrides = theme.overrides;

            expect(_name).toBe('typed');
            expect(_primary).toBe('#3f8452');
            expect(_overrides).toBeDefined();
        });

        it('should allow optional properties', () => {
            const theme = defineTheme({
                name: 'minimal',
                colors: {
                    primary: '#3f8452',
                    surface: '#f5faf5',
                },
                // These should all be optional
            });

            expect(theme.displayName).toBeUndefined();
            expect(theme.description).toBeUndefined();
            expect(theme.overrides).toBeUndefined();
            expect(theme.ui).toBeUndefined();
        });
    });

    describe('return value', () => {
        it('should return the same object passed in', () => {
            const input = {
                name: 'test',
                colors: {
                    primary: '#3f8452',
                    surface: '#f5faf5',
                },
            };

            const output = defineTheme(input);

            // Should be the same object (not a copy)
            expect(output).toBe(input);
        });

        it('should preserve all properties', () => {
            const input = {
                name: 'test',
                displayName: 'Test Theme',
                description: 'A test theme',
                colors: {
                    primary: '#3f8452',
                    surface: '#f5faf5',
                },
                overrides: {
                    button: { variant: 'solid' },
                },
                ui: {
                    button: { default: { size: 'md' } },
                },
            };

            const output = defineTheme(input);

            expect(output.name).toBe(input.name);
            expect(output.displayName).toBe(input.displayName);
            expect(output.description).toBe(input.description);
            expect(output.colors).toBe(input.colors);
            expect(output.overrides).toBe(input.overrides);
            expect(output.ui).toBe(input.ui);
        });
    });
});
