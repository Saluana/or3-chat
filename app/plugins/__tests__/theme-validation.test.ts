/**
 * Theme Plugin Validation Integration Tests
 * ==========================================
 * Tests the validation integration in the theme plugin.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateComponentOverrides, logValidationErrors } from '~/theme/_shared/override-validator';

describe('Theme Plugin Validation Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should validate theme config during initialization', () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        // Mock invalid theme config
        const invalidConfig = {
            componentOverrides: {
                global: {
                    button: 'not an array', // Invalid
                },
            },
        };

        // Simulate theme plugin validation
        const validation = validateComponentOverrides(invalidConfig.componentOverrides);
        
        expect(validation.valid).toBe(false);
        expect(validation.errors).toHaveLength(1);
        
        // Log validation errors (as theme plugin would)
        logValidationErrors(validation, 'test-theme');

        // Check that validation errors are logged
        expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining('❌ 1 validation error(s):')
        );
        expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining('componentOverrides.global.button: button global overrides must be an array')
        );

        errorSpy.mockRestore();
    });

    it('should proceed with valid theme config', () => {
        const consoleSpy = vi.spyOn(console, 'group').mockImplementation(() => {});
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        // Mock valid theme config
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

        // Simulate theme plugin validation
        const validation = validateComponentOverrides(validConfig.componentOverrides);
        
        expect(validation.valid).toBe(true);
        expect(validation.errors).toHaveLength(0);
        
        // Log validation results (as theme plugin would)
        logValidationErrors(validation, 'test-theme');

        // Should not log errors for valid config
        expect(errorSpy).not.toHaveBeenCalled();

        consoleSpy.mockRestore();
        errorSpy.mockRestore();
    });

    it('should handle warnings gracefully', () => {
        const consoleSpy = vi.spyOn(console, 'group').mockImplementation(() => {});
        const warningSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        // Mock config with warnings
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

        // Simulate theme plugin validation
        const validation = validateComponentOverrides(configWithWarnings.componentOverrides);
        
        expect(validation.valid).toBe(true);
        expect(validation.errors).toHaveLength(0);
        expect(validation.warnings).toHaveLength(1);
        
        // Log validation results (as theme plugin would)
        logValidationErrors(validation, 'test-theme');

        // Should log warnings but still proceed
        expect(warningSpy).toHaveBeenCalledWith(
            expect.stringContaining('1 validation warning(s)')
        );
        // Should not log errors for warnings
        expect(errorSpy).not.toHaveBeenCalledWith(
            expect.stringContaining('validation error(s)')
        );

        consoleSpy.mockRestore();
        warningSpy.mockRestore();
        errorSpy.mockRestore();
    });

    it('should provide detailed error paths', () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        // Mock complex invalid config
        const complexInvalidConfig = {
            componentOverrides: {
                global: {
                    button: [
                        {
                            // Missing component property
                            props: { variant: 'solid' as const },
                        },
                    ],
                },
                contexts: {
                    chat: 'not an object', // Invalid context
                },
            },
        };

        // Simulate theme plugin validation
        const validation = validateComponentOverrides(complexInvalidConfig.componentOverrides);
        
        expect(validation.valid).toBe(false);
        expect(validation.errors).toHaveLength(2);
        
        // Check specific error paths
        const errorPaths = validation.errors.map(e => e.path);
        expect(errorPaths).toContain('componentOverrides.global.button[0].component');
        expect(errorPaths).toContain('componentOverrides.contexts.chat');

        consoleSpy.mockRestore();
    });
});
