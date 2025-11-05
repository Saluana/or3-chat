/**
 * Refined Theme System - Theme Definition Validation
 * 
 * This module provides runtime validation for theme definitions.
 * It checks for required fields, validates color formats, and ensures
 * selector syntax is correct.
 */

import type { ThemeDefinition, ValidationError } from './types';

/**
 * Validation result
 */
export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
    warnings: ValidationError[];
}

/**
 * Validate a theme definition
 * 
 * @param config - Theme definition to validate
 * @returns Validation result with any errors or warnings
 */
export function validateThemeDefinition(config: ThemeDefinition): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];
    
    // Check required fields
    if (!config.name) {
        errors.push({
            severity: 'error',
            code: 'THEME_001',
            message: 'Theme name is required',
            file: 'theme.ts',
            suggestion: 'Add a "name" field with a kebab-case identifier (e.g., "nature", "cyberpunk")',
        });
    } else if (!/^[a-z][a-z0-9-]*$/.test(config.name)) {
        errors.push({
            severity: 'error',
            code: 'THEME_002',
            message: `Theme name "${config.name}" must be kebab-case (lowercase letters, numbers, and hyphens only)`,
            file: 'theme.ts',
            suggestion: 'Use kebab-case format: "my-theme-name"',
        });
    }
    
    // Check colors object
    if (!config.colors) {
        errors.push({
            severity: 'error',
            code: 'THEME_003',
            message: 'Colors palette is required',
            file: 'theme.ts',
            suggestion: 'Add a "colors" object with at least primary, secondary, and surface colors',
        });
    } else {
        // Validate required colors
        const requiredColors = ['primary', 'secondary', 'surface'];
        for (const color of requiredColors) {
            if (!config.colors[color as keyof typeof config.colors]) {
                errors.push({
                    severity: 'error',
                    code: 'THEME_004',
                    message: `Required color "${color}" is missing`,
                    file: 'theme.ts',
                    suggestion: `Add ${color}: "#hexcolor" to the colors object`,
                });
            }
        }
        
        // Validate color formats
        for (const [key, value] of Object.entries(config.colors)) {
            if (key === 'dark') continue; // Skip dark mode object
            
            if (typeof value === 'string' && !isValidColor(value)) {
                warnings.push({
                    severity: 'warning',
                    code: 'THEME_005',
                    message: `Color "${key}" has invalid format: "${value}"`,
                    file: 'theme.ts',
                    suggestion: 'Use hex format (#rgb, #rrggbb, #rrggbbaa), rgb(), rgba(), hsl(), or hsla()',
                });
            }
        }
        
        // Validate dark mode colors if present
        if (config.colors.dark) {
            for (const [key, value] of Object.entries(config.colors.dark)) {
                if (typeof value === 'string' && !isValidColor(value)) {
                    warnings.push({
                        severity: 'warning',
                        code: 'THEME_006',
                        message: `Dark mode color "${key}" has invalid format: "${value}"`,
                        file: 'theme.ts',
                        suggestion: 'Use hex format (#rgb, #rrggbb, #rrggbbaa), rgb(), rgba(), hsl(), or hsla()',
                    });
                }
            }
        }
    }
    
    // Validate overrides
    if (config.overrides) {
        for (const [selector, props] of Object.entries(config.overrides)) {
            // Basic selector validation
            if (!selector || selector.trim() === '') {
                errors.push({
                    severity: 'error',
                    code: 'THEME_007',
                    message: 'Empty selector found in overrides',
                    file: 'theme.ts',
                    suggestion: 'Remove empty selectors or provide a valid CSS selector',
                });
                continue;
            }
            
            // Check for invalid characters that might cause issues
            if (selector.includes('>>') || selector.includes('>>>')) {
                warnings.push({
                    severity: 'warning',
                    code: 'THEME_008',
                    message: `Selector "${selector}" uses Vue-specific combinators which are not supported`,
                    file: 'theme.ts',
                    suggestion: 'Use standard CSS selectors instead',
                });
            }
            
            // Validate props object
            if (!props || typeof props !== 'object') {
                errors.push({
                    severity: 'error',
                    code: 'THEME_009',
                    message: `Invalid props for selector "${selector}"`,
                    file: 'theme.ts',
                    suggestion: 'Props must be an object with valid properties',
                });
            }
        }
    }
    
    // Validate propMaps if present
    if (config.propMaps) {
        for (const [propType, mappings] of Object.entries(config.propMaps)) {
            if (typeof mappings !== 'object' || mappings === null) {
                warnings.push({
                    severity: 'warning',
                    code: 'THEME_010',
                    message: `Invalid propMaps for "${propType}"`,
                    file: 'theme.ts',
                    suggestion: 'PropMaps must be objects with key-value pairs',
                });
            }
        }
    }
    
    return {
        valid: errors.length === 0,
        errors,
        warnings,
    };
}

/**
 * Check if a string is a valid CSS color
 */
function isValidColor(color: string): boolean {
    // Hex colors
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color)) {
        return true;
    }
    
    // RGB/RGBA
    if (/^rgba?\s*\(/.test(color)) {
        return true;
    }
    
    // HSL/HSLA
    if (/^hsla?\s*\(/.test(color)) {
        return true;
    }
    
    // CSS color keywords (basic check)
    const keywords = ['transparent', 'currentcolor', 'inherit', 'initial', 'unset'];
    if (keywords.includes(color.toLowerCase())) {
        return true;
    }
    
    return false;
}
