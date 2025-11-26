/**
 * Refined Theme System - Theme Definition Validation
 *
 * This module provides runtime validation for theme definitions.
 * It checks for required fields, validates color formats, and ensures
 * selector syntax is correct.
 */

import type {
    ThemeDefinition,
    ThemeBackgroundLayer,
    ValidationError,
} from './types';

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
export function validateThemeDefinition(
    config: ThemeDefinition
): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    // Cast to partial for validation checks (runtime may have missing fields)
    const partialConfig = config as Partial<ThemeDefinition>;

    // Check required fields
    if (!partialConfig.name) {
        errors.push({
            severity: 'error',
            code: 'THEME_001',
            message: 'Theme name is required',
            file: 'theme.ts',
            suggestion:
                'Add a "name" field with a kebab-case identifier (e.g., "nature", "cyberpunk")',
        });
    } else if (!/^[a-z][a-z0-9-]*$/.test(partialConfig.name)) {
        errors.push({
            severity: 'error',
            code: 'THEME_002',
            message: `Theme name "${partialConfig.name}" must be kebab-case (lowercase letters, numbers, and hyphens only)`,
            file: 'theme.ts',
            suggestion: 'Use kebab-case format: "my-theme-name"',
        });
    }

    // Check colors object
    if (!partialConfig.colors || typeof partialConfig.colors !== 'object') {
        errors.push({
            severity: 'error',
            code: 'THEME_003',
            message: 'Colors palette is required',
            file: 'theme.ts',
            suggestion:
                'Add a "colors" object with at least primary, secondary, and surface colors',
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
                    suggestion:
                        'Use hex format (#rgb, #rrggbb, #rrggbbaa), rgb(), rgba(), hsl(), or hsla()',
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
                        suggestion:
                            'Use hex format (#rgb, #rrggbb, #rrggbbaa), rgb(), rgba(), hsl(), or hsla()',
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
                    suggestion:
                        'Remove empty selectors or provide a valid CSS selector',
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
        }
    }

    // Validate background definitions if present
    if (config.backgrounds) {
        const repeatOptions = new Set([
            'repeat',
            'no-repeat',
            'repeat-x',
            'repeat-y',
        ]);
        const validateLayer = (
            layer: ThemeBackgroundLayer | undefined,
            location: string
        ) => {
            if (!layer) return;
            if (layer.opacity !== undefined) {
                if (layer.opacity < 0 || layer.opacity > 1) {
                    warnings.push({
                        severity: 'warning',
                        code: 'THEME_011',
                        message: `Background layer "${location}" uses opacity ${layer.opacity}, which should be between 0 and 1`,
                        file: 'theme.ts',
                        suggestion: 'Use a value between 0 and 1 (e.g., 0.25)',
                    });
                }
            }
            if (layer.repeat && !repeatOptions.has(layer.repeat)) {
                warnings.push({
                    severity: 'warning',
                    code: 'THEME_012',
                    message: `Background layer "${location}" uses an unsupported repeat value "${layer.repeat}"`,
                    file: 'theme.ts',
                    suggestion: `Use one of: ${[...repeatOptions].join(', ')}`,
                });
            }
            if (layer.fit && layer.fit !== 'cover' && layer.fit !== ('contain' as string)) {
                const fitValue: string = layer.fit;
                warnings.push({
                    severity: 'warning',
                    code: 'THEME_013',
                    message: `Background layer "${location}" uses an unsupported fit value "${fitValue}"`,
                    file: 'theme.ts',
                    suggestion: 'Use either "cover" or "contain"',
                });
            }
        };

        validateLayer(
            config.backgrounds.content?.base,
            'backgrounds.content.base'
        );
        validateLayer(
            config.backgrounds.content?.overlay,
            'backgrounds.content.overlay'
        );
        validateLayer(config.backgrounds.sidebar, 'backgrounds.sidebar');
        validateLayer(
            config.backgrounds.headerGradient,
            'backgrounds.headerGradient'
        );
        validateLayer(
            config.backgrounds.bottomNavGradient,
            'backgrounds.bottomNavGradient'
        );
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

    if (config.stylesheets !== undefined) {
        if (!Array.isArray(config.stylesheets)) {
            errors.push({
                severity: 'error',
                code: 'THEME_014',
                message: 'stylesheets must be an array of paths',
                file: 'theme.ts',
                suggestion:
                    'Provide stylesheets as an array, e.g. stylesheets: ["~/theme/my-theme/styles.css"]',
            });
        } else {
            for (const sheet of config.stylesheets) {
                if (typeof sheet !== 'string' || sheet.trim().length === 0) {
                    warnings.push({
                        severity: 'warning',
                        code: 'THEME_015',
                        message:
                            'stylesheets entries should be non-empty strings',
                        file: 'theme.ts',
                        suggestion:
                            'Remove empty entries or provide a valid path string',
                    });
                }
            }
        }
    }

    if (
        config.isDefault !== undefined &&
        typeof config.isDefault !== 'boolean'
    ) {
        warnings.push({
            severity: 'warning',
            code: 'THEME_016',
            message: 'isDefault should be a boolean',
            file: 'theme.ts',
            suggestion: 'Set isDefault to true or false, or omit the property',
        });
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
    };
}

/**
 * Check if a string is a valid CSS color
 * Note: This is a basic validation that covers common formats.
 * For production use, consider using a dedicated CSS color parsing library.
 */
function isValidColor(color: string): boolean {
    const trimmed = color.trim();

    // Hex colors: #rgb, #rrggbb, #rrggbbaa, #rgba
    if (
        /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(
            trimmed
        )
    ) {
        return true;
    }

    // RGB/RGBA with proper format validation
    // Matches: rgb(0, 0, 0), rgba(0, 0, 0, 0.5), rgb(0 0 0), rgb(0 0 0 / 50%)
    if (
        /^rgba?\s*\(\s*[\d.%]+\s*[,\s]\s*[\d.%]+\s*[,\s]\s*[\d.%]+\s*(?:[,/]\s*[\d.%]+)?\s*\)$/i.test(
            trimmed
        )
    ) {
        return true;
    }

    // HSL/HSLA with proper format validation
    // Matches: hsl(0, 0%, 0%), hsla(0, 0%, 0%, 0.5), hsl(0 0% 0%), hsl(0 0% 0% / 50%)
    if (
        /^hsla?\s*\(\s*[\d.]+(?:deg|grad|rad|turn)?\s*[,\s]\s*[\d.%]+\s*[,\s]\s*[\d.%]+\s*(?:[,/]\s*[\d.%]+)?\s*\)$/i.test(
            trimmed
        )
    ) {
        return true;
    }

    // CSS color keywords (comprehensive list of common keywords)
    const keywords = [
        'transparent',
        'currentcolor',
        'inherit',
        'initial',
        'unset',
        'black',
        'white',
        'red',
        'green',
        'blue',
        'yellow',
        'cyan',
        'magenta',
        'gray',
        'grey',
        'silver',
        'maroon',
        'olive',
        'lime',
        'aqua',
        'teal',
        'navy',
        'fuchsia',
        'purple',
        'orange',
        'pink',
        'brown',
    ];
    if (keywords.includes(trimmed.toLowerCase())) {
        return true;
    }

    // If none match, it might still be valid (e.g., newer CSS color functions)
    // Return false to trigger a warning, but allow compilation to continue
    return false;
}
