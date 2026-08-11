/**
 * @module app/theme/_shared/validate-theme
 *
 * Purpose:
 * Runtime validation for theme definitions.
 *
 * Behavior:
 * - Reports errors for missing required fields
 * - Reports warnings for suspicious values and selector patterns
 *
 * Constraints:
 * - Validation is best effort and does not guarantee semantic correctness
 *
 * Non-Goals:
 * - Automatic repair of invalid definitions
 */

import type {
    ThemeDefinition,
    ThemeBackgroundLayer,
    ValidationError,
} from './types';
import { THEME_COMPONENT_CONTRACT_VERSION } from './types';
import { WorkspaceProfileV1Schema } from '../../core/workspace-profiles/schema';

/**
 * `ValidationResult`
 *
 * Purpose:
 * Result structure for theme validation.
 */
export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
    warnings: ValidationError[];
}

/**
 * `validateThemeDefinition`
 *
 * Purpose:
 * Validates a theme definition and returns errors and warnings.
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
                errors.push({
                    severity: 'error',
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
                    errors.push({
                        severity: 'error',
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
            if (props.style) {
                validateStyleMap(props.style, `overrides["${selector}"].style`, errors);
            }
            for (const [propName, propValue] of Object.entries(props)) {
                if (/^on[A-Z]/.test(propName) || typeof propValue === 'function') {
                    errors.push({
                        severity: 'error',
                        code: 'THEME_022',
                        message: `Theme overrides cannot provide event handlers (${selector}.${propName})`,
                        file: 'theme.ts',
                    });
                }
            }
        }
    }

    if (config.cssSelectors) {
        for (const [selector, value] of Object.entries(config.cssSelectors)) {
            if (value.style) {
                validateStyleMap(value.style, `cssSelectors["${selector}"].style`, errors);
            }
        }
    }

    for (const [field, value] of [
        ['borderWidthSubtle', config.borderWidthSubtle],
        ['borderWidth', config.borderWidth],
        ['borderWidthStrong', config.borderWidthStrong],
        ['borderRadiusSmall', config.borderRadiusSmall],
        ['borderRadius', config.borderRadius],
        ['borderRadiusLarge', config.borderRadiusLarge],
    ] as const) {
        if (value !== undefined && !/^(?:0|\d*\.?\d+(?:px|rem|em|%))$/.test(value.trim())) {
            errors.push({
                severity: 'error',
                code: 'THEME_018',
                message: `${field} must be a safe CSS length`,
                file: 'theme.ts',
            });
        }
    }

    validateAppearanceTokens(config, errors);

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
            const fitValue = layer.fit as string | undefined;
            if (fitValue && fitValue !== 'cover' && fitValue !== 'contain') {
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

        validateLayer(
            config.backgrounds.dark?.content?.base,
            'backgrounds.dark.content.base'
        );
        validateLayer(
            config.backgrounds.dark?.content?.overlay,
            'backgrounds.dark.content.overlay'
        );
        validateLayer(
            config.backgrounds.dark?.sidebar,
            'backgrounds.dark.sidebar'
        );
        validateLayer(
            config.backgrounds.dark?.headerGradient,
            'backgrounds.dark.headerGradient'
        );
        validateLayer(
            config.backgrounds.dark?.bottomNavGradient,
            'backgrounds.dark.bottomNavGradient'
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
                } else if (
                    /^(?:[a-z]+:)?\/\//i.test(sheet.trim()) ||
                    /^(?:data|blob):/i.test(sheet.trim())
                ) {
                    errors.push({
                        severity: 'error',
                        code: 'THEME_017',
                        message: `External stylesheet URLs are not allowed: "${sheet}"`,
                        file: 'theme.ts',
                        suggestion: 'Package CSS as a local theme asset.',
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

    const bundledProfileIds = new Set<string>();
    if (config.workspaceProfiles !== undefined) {
        if (!Array.isArray(config.workspaceProfiles)) {
            errors.push({
                severity: 'error',
                code: 'THEME_023',
                message: 'workspaceProfiles must be an array',
                file: 'theme.ts',
            });
        } else {
            for (const [index, profile] of config.workspaceProfiles.entries()) {
                const parsed = WorkspaceProfileV1Schema.safeParse(profile);
                if (!parsed.success) {
                    errors.push({
                        severity: 'error',
                        code: 'THEME_023',
                        message: `Invalid workspace profile at index ${index}: ${parsed.error.issues[0]?.message ?? 'invalid profile'}`,
                        file: 'theme.ts',
                    });
                    continue;
                }
                if (bundledProfileIds.has(parsed.data.id)) {
                    errors.push({
                        severity: 'error',
                        code: 'THEME_023',
                        message: `Duplicate bundled workspace profile id "${parsed.data.id}"`,
                        file: 'theme.ts',
                    });
                }
                bundledProfileIds.add(parsed.data.id);
            }
        }
    }
    if (
        config.recommendedWorkspaceProfileId !== undefined &&
        !bundledProfileIds.has(config.recommendedWorkspaceProfileId)
    ) {
        errors.push({
            severity: 'error',
            code: 'THEME_024',
            message:
                'recommendedWorkspaceProfileId must reference a bundled workspace profile',
            file: 'theme.ts',
        });
    }

    if (config.customComponents && Object.keys(config.customComponents).length > 0) {
        if (config.componentContractVersion === undefined) {
            warnings.push({
                severity: 'warning',
                code: 'THEME_020',
                message: 'Trusted custom components should declare componentContractVersion',
                file: 'theme.ts',
                suggestion: `Set componentContractVersion: ${THEME_COMPONENT_CONTRACT_VERSION} after running the component conformance tests.`,
            });
        } else if (config.componentContractVersion !== THEME_COMPONENT_CONTRACT_VERSION) {
            errors.push({
                severity: 'error',
                code: 'THEME_021',
                message: `Unsupported component contract version ${config.componentContractVersion}; runtime requires ${THEME_COMPONENT_CONTRACT_VERSION}`,
                file: 'theme.ts',
            });
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
    };
}

function validateAppearanceTokens(
    config: ThemeDefinition,
    errors: ValidationError[]
): void {
    for (const [field, value] of [
        ['density.controlHeightSmall', config.density?.controlHeightSmall],
        ['density.controlHeightMedium', config.density?.controlHeightMedium],
        ['density.controlHeightLarge', config.density?.controlHeightLarge],
        ['density.spaceControl', config.density?.spaceControl],
        ['density.spaceSection', config.density?.spaceSection],
        ['focus.ringOffset', config.focus?.ringOffset],
    ] as const) {
        if (value !== undefined && !isSafeLength(value)) {
            errors.push({
                severity: 'error',
                code: 'THEME_025',
                message: `${field} must be a safe CSS length`,
                file: 'theme.ts',
            });
        }
    }

    const focusColor = config.focus?.ringColor;
    if (
        focusColor !== undefined &&
        !isValidColor(focusColor) &&
        !isSafeCssReference(focusColor)
    ) {
        errors.push({
            severity: 'error',
            code: 'THEME_026',
            message: 'focus.ringColor must be a safe CSS color or token reference',
            file: 'theme.ts',
        });
    }

    for (const [field, value] of [
        ['motion.durationFast', config.motion?.durationFast],
        ['motion.durationMedium', config.motion?.durationMedium],
        ['motion.durationSlow', config.motion?.durationSlow],
    ] as const) {
        if (value !== undefined && !/^(?:0|\d*\.?\d+(?:ms|s))$/.test(value.trim())) {
            errors.push({
                severity: 'error',
                code: 'THEME_027',
                message: `${field} must be a safe CSS duration`,
                file: 'theme.ts',
            });
        }
    }

    const easing = config.motion?.easingStandard;
    if (easing !== undefined && !isSafeCssValue(easing)) {
        errors.push({
            severity: 'error',
            code: 'THEME_028',
            message: 'motion.easingStandard must be a safe CSS timing function',
            file: 'theme.ts',
        });
    }

    for (const [field, value] of [
        ['elevation.low', config.elevation?.low],
        ['elevation.medium', config.elevation?.medium],
        ['elevation.high', config.elevation?.high],
    ] as const) {
        if (value !== undefined && !isSafeCssValue(value)) {
            errors.push({
                severity: 'error',
                code: 'THEME_029',
                message: `${field} must be a safe CSS shadow stack`,
                file: 'theme.ts',
            });
        }
    }
}

function isSafeLength(value: string): boolean {
    return /^(?:0|\d*\.?\d+(?:px|rem|em|%))$/.test(value.trim());
}

function isSafeCssReference(value: string): boolean {
    return /^var\(--[a-z0-9-]+(?:\s*,\s*[^;{}]+)?\)$/i.test(value.trim());
}

function isSafeCssValue(value: string): boolean {
    return (
        value.trim().length > 0 &&
        !/[;{}]|@import|expression\s*\(|javascript:|url\s*\(/i.test(value)
    );
}

function validateStyleMap(
    style: Record<string, string>,
    location: string,
    errors: ValidationError[]
): void {
    for (const [property, value] of Object.entries(style)) {
        if (
            !/^(?:--[a-z0-9-]+|[a-z][a-zA-Z0-9-]*)$/.test(property) ||
            /[;{}]|@import|expression\s*\(|javascript:|url\s*\(\s*['"]?(?:https?:|\/\/|data:|blob:)/i.test(value)
        ) {
            errors.push({
                severity: 'error',
                code: 'THEME_019',
                message: `Unsafe CSS declaration at ${location}.${property}`,
                file: 'theme.ts',
                suggestion: 'Use a single local, declaration-only CSS value.',
            });
        }
    }
}

/**
 * Check if a string is a valid CSS color
 * Note: This is a basic validation that covers common formats.
 * For production use, consider using a dedicated CSS color parsing library.
 */
function isValidColor(color: string): boolean {
    const trimmed = color.trim();
    const css = (globalThis as {
        CSS?: { supports?: (property: string, value: string) => boolean };
    }).CSS;

    if (
        typeof css?.supports === 'function' &&
        css.supports('color', trimmed)
    ) {
        return true;
    }

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
