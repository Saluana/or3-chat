/**
 * Override Validator Tests
 * ========================
 * Tests the validation system for component override configurations.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    validateComponentOverrides,
    logValidationErrors,
    isValidComponentType,
    type ValidationResult,
    type ValidationError
} from '../override-validator';

describe('Override Validator', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('validateComponentOverrides', () => {
        it('should validate empty config', () => {
            const result = validateComponentOverrides({});
            
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
            expect(result.warnings).toHaveLength(0);
        });

        it('should reject non-object config', () => {
            const result = validateComponentOverrides(null);
            
            expect(result.valid).toBe(false);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]).toMatchObject({
                path: 'componentOverrides',
                message: 'componentOverrides must be an object',
                severity: 'error',
            });
        });

        it('should validate valid global overrides', () => {
            const config = {
                global: {
                    button: [
                        {
                            component: 'button',
                            props: { variant: 'solid' as const },
                            priority: 1,
                        },
                    ],
                },
            };

            const result = validateComponentOverrides(config);
            
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should reject invalid global overrides (not array)', () => {
            const config = {
                global: {
                    button: 'not an array',
                },
            };

            const result = validateComponentOverrides(config);
            
            expect(result.valid).toBe(false);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]).toMatchObject({
                path: 'componentOverrides.global.button',
                message: 'button global overrides must be an array',
                severity: 'error',
            });
        });

        it('should validate valid context overrides', () => {
            const config = {
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
            };

            const result = validateComponentOverrides(config);
            
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should reject invalid context overrides (not object)', () => {
            const config = {
                contexts: {
                    chat: 'not an object',
                },
            };

            const result = validateComponentOverrides(config);
            
            expect(result.valid).toBe(false);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]).toMatchObject({
                path: 'componentOverrides.contexts.chat',
                message: 'context "chat" overrides must be an object',
                severity: 'error',
            });
        });

        it('should validate valid state overrides', () => {
            const config = {
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
            };

            const result = validateComponentOverrides(config);
            
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should reject invalid state overrides', () => {
            const config = {
                states: {
                    hover: 'not an object',
                },
            };

            const result = validateComponentOverrides(config);
            
            expect(result.valid).toBe(false);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]).toMatchObject({
                path: 'componentOverrides.states.hover',
                message: 'state "hover" overrides must be an object',
                severity: 'error',
            });
        });

        it('should validate rule structure', () => {
            const config = {
                global: {
                    button: [
                        {
                            // Missing component property
                            props: { variant: 'solid' as const },
                        },
                    ],
                },
            };

            const result = validateComponentOverrides(config);
            
            expect(result.valid).toBe(false);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]).toMatchObject({
                path: 'componentOverrides.global.button[0].component',
                message: 'override rule must have a component property',
                severity: 'error',
            });
        });

        it('should reject invalid component property', () => {
            const config = {
                global: {
                    button: [
                        {
                            component: 123, // Not a string
                            props: { variant: 'solid' as const },
                        },
                    ],
                },
            };

            const result = validateComponentOverrides(config);
            
            expect(result.valid).toBe(false);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]).toMatchObject({
                path: 'componentOverrides.global.button[0].component',
                message: 'component property must be a string',
                severity: 'error',
            });
        });

        it('should reject missing props property', () => {
            const config = {
                global: {
                    button: [
                        {
                            component: 'button',
                            // Missing props property
                        },
                    ],
                },
            };

            const result = validateComponentOverrides(config);
            
            expect(result.valid).toBe(false);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]).toMatchObject({
                path: 'componentOverrides.global.button[0].props',
                message: 'override rule must have a props property',
                severity: 'error',
            });
        });

        it('should reject invalid props property', () => {
            const config = {
                global: {
                    button: [
                        {
                            component: 'button',
                            props: 'not an object',
                        },
                    ],
                },
            };

            const result = validateComponentOverrides(config);
            
            expect(result.valid).toBe(false);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]).toMatchObject({
                path: 'componentOverrides.global.button[0].props',
                message: 'props property must be an object',
                severity: 'error',
            });
        });

        it('should warn about negative priority', () => {
            const config = {
                global: {
                    button: [
                        {
                            component: 'button',
                            props: { variant: 'solid' as const },
                            priority: -1,
                        },
                    ],
                },
            };

            const result = validateComponentOverrides(config);
            
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
            expect(result.warnings).toHaveLength(1);
            expect(result.warnings[0]).toMatchObject({
                path: 'componentOverrides.global.button[0].priority',
                message: 'priority should be a non-negative number',
                severity: 'warning',
            });
        });

        it('should reject invalid priority property', () => {
            const config = {
                global: {
                    button: [
                        {
                            component: 'button',
                            props: { variant: 'solid' as const },
                            priority: 'not a number',
                        },
                    ],
                },
            };

            const result = validateComponentOverrides(config);
            
            expect(result.valid).toBe(false);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]).toMatchObject({
                path: 'componentOverrides.global.button[0].priority',
                message: 'priority property must be a number',
                severity: 'error',
            });
        });

        it('should reject invalid condition property', () => {
            const config = {
                global: {
                    button: [
                        {
                            component: 'button',
                            props: { variant: 'solid' as const },
                            condition: 'not a function',
                        },
                    ],
                },
            };

            const result = validateComponentOverrides(config);
            
            expect(result.valid).toBe(false);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]).toMatchObject({
                path: 'componentOverrides.global.button[0].condition',
                message: 'condition property must be a function',
                severity: 'error',
            });
        });

        it('should validate complex nested configuration', () => {
            const config = {
                global: {
                    button: [
                        {
                            component: 'button',
                            props: { variant: 'solid' as const },
                            priority: 1,
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
                                priority: 10,
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
            };

            const result = validateComponentOverrides(config);
            
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
            expect(result.warnings).toHaveLength(0);
        });
    });

    describe('logValidationErrors', () => {
        it('should not log anything for valid results', () => {
            const consoleSpy = vi.spyOn(console, 'group').mockImplementation(() => {});
            const result: ValidationResult = {
                valid: true,
                errors: [],
                warnings: [],
            };

            logValidationErrors(result, 'test-theme');

            expect(consoleSpy).not.toHaveBeenCalled();
            consoleSpy.mockRestore();
        });

        it('should log errors and warnings', () => {
            const consoleSpy = vi.spyOn(console, 'group').mockImplementation(() => {});
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const warningSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const groupEndSpy = vi.spyOn(console, 'groupEnd').mockImplementation(() => {});

            const result: ValidationResult = {
                valid: false,
                errors: [
                    {
                        path: 'test.path',
                        message: 'test error',
                        severity: 'error',
                    },
                ],
                warnings: [
                    {
                        path: 'test.warning',
                        message: 'test warning',
                        severity: 'warning',
                    },
                ],
            };

            logValidationErrors(result, 'test-theme');

            expect(consoleSpy).toHaveBeenCalledWith('[theme] Validation results for test-theme');
            expect(errorSpy).toHaveBeenCalledWith('❌ 1 validation error(s):');
            expect(errorSpy).toHaveBeenCalledWith('  test.path: test error');
            expect(warningSpy).toHaveBeenCalledWith('⚠️  1 validation warning(s):');
            expect(warningSpy).toHaveBeenCalledWith('  test.warning: test warning');
            expect(groupEndSpy).toHaveBeenCalled();

            consoleSpy.mockRestore();
            errorSpy.mockRestore();
            warningSpy.mockRestore();
            groupEndSpy.mockRestore();
        });
    });

    describe('isValidComponentType', () => {
        it('should validate known component types', () => {
            expect(isValidComponentType('button')).toBe(true);
            expect(isValidComponentType('input')).toBe(true);
            expect(isValidComponentType('modal')).toBe(true);
            expect(isValidComponentType('card')).toBe(true);
        });

        it('should validate custom component names', () => {
            expect(isValidComponentType('customButton')).toBe(true);
            expect(isValidComponentType('myComponent')).toBe(true);
        });

        it('should reject invalid component names', () => {
            expect(isValidComponentType('123invalid')).toBe(false);
            expect(isValidComponentType('invalid-name')).toBe(false);
            expect(isValidComponentType('invalid name')).toBe(false);
            expect(isValidComponentType('')).toBe(false);
        });
    });
});
