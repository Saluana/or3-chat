/**
 * Refined Theme System - Theme Compiler
 *
 * This module compiles theme definitions into optimized runtime configurations.
 * It handles CSS variable generation, selector parsing, specificity calculation,
 * and type generation.
 */

import type {
    ThemeDefinition,
    CompiledTheme,
    CompiledOverride,
    ParsedSelector,
    ThemeCompilationResult,
    CompilationResult,
    ValidationError,
    AttributeMatcher,
    AttributeOperator,
    ThemeFontSet,
} from '../app/theme/_shared/types';
import { validateThemeDefinition } from '../app/theme/_shared/validate-theme';
import { KNOWN_THEME_CONTEXTS } from '../app/theme/_shared/contexts';
import { DEFAULT_ICONS, type IconToken } from '../app/config/icon-tokens';
import {
    parseSelector,
    calculateSpecificity,
} from '../app/theme/_shared/compiler-core';

/**
 * Theme Compiler
 *
 * Transforms theme definitions into optimized runtime configs
 */
export class ThemeCompiler {
    private knownContexts = [...KNOWN_THEME_CONTEXTS];

    /**
     * Compile all themes in the app/theme directory
     */
    async compileAll(): Promise<CompilationResult> {
        const themes = await this.discoverThemes();
        const results: ThemeCompilationResult[] = [];

        for (const themePath of themes) {
            try {
                const result = await this.compileTheme(themePath);
                results.push(result);
            } catch (error) {
                console.error(
                    `[theme-compiler] Failed to compile theme at ${themePath}:`,
                    error
                );
                results.push({
                    name: themePath,
                    theme: {} as CompiledTheme,
                    errors: [
                        {
                            severity: 'error',
                            code: 'COMPILER_001',
                            message: `Failed to compile theme: ${error}`,
                            file: themePath,
                        },
                    ],
                    warnings: [],
                    success: false,
                });
            }
        }

        // Generate type definitions
        if (results.some((r) => r.success)) {
            await this.generateTypes(results.filter((r) => r.success));
        }

        const totalErrors = results.reduce(
            (sum, r) => sum + r.errors.length,
            0
        );
        const totalWarnings = results.reduce(
            (sum, r) => sum + r.warnings.length,
            0
        );

        return {
            themes: results,
            success: results.every((r) => r.success),
            totalErrors,
            totalWarnings,
        };
    }

    /**
     * Discover all theme files
     */
    private async discoverThemes(): Promise<string[]> {
        const { readdir, access } = await import('fs/promises');
        const { constants } = await import('fs');
        const { join } = await import('path');

        const themeDir = join(process.cwd(), 'app/theme');
        const entries = await readdir(themeDir, { withFileTypes: true });

        const themes: string[] = [];
        for (const entry of entries) {
            if (entry.isDirectory() && !entry.name.startsWith('_')) {
                const themePath = join(themeDir, entry.name, 'theme.ts');
                try {
                    await access(themePath, constants.F_OK);
                    themes.push(themePath);
                } catch (error) {
                    if (process.env.NODE_ENV !== 'test') {
                        console.warn(
                            `[theme-compiler] Skipping directory "${entry.name}" (no theme.ts)`
                        );
                    }
                }
            }
        }

        return themes;
    }

    /**
     * Compile a single theme
     */
    private async compileTheme(
        themePath: string
    ): Promise<ThemeCompilationResult> {
        // Dynamic import the theme definition
        const themeModule = await import(themePath);
        const definition: ThemeDefinition = themeModule.default || themeModule;

        const errors: ValidationError[] = [];
        const warnings: ValidationError[] = [];

        // Validate structure
        const validation = validateThemeDefinition(definition);
        errors.push(...validation.errors);
        warnings.push(...validation.warnings);

        if (!validation.valid) {
            return {
                name: definition.name || 'unknown',
                theme: {} as CompiledTheme,
                errors,
                warnings,
                success: false,
            };
        }

        // Load and validate icons.config.ts if present
        const { join, dirname } = await import('path');
        const { existsSync } = await import('fs');
        const themeDir = dirname(themePath);
        const iconConfigPath = join(themeDir, 'icons.config.ts');
        let themeIcons: Record<string, string> | undefined;

        if (existsSync(iconConfigPath)) {
            try {
                const iconModule = await import(iconConfigPath);
                const icons = iconModule.default || iconModule;

                // Validate icon tokens
                const validTokens = new Set(Object.keys(DEFAULT_ICONS));
                const invalidTokens: string[] = [];

                // Flatten nested structure if necessary, or assume flat map
                // The plan suggests a nested structure in icons.config.ts but the registry expects a flat map.
                // Let's support both or enforce one. The plan example showed:
                // { shell: { 'new-pane': '...' } }
                // But the registry expects 'shell.new-pane'.
                // We should flatten it here.

                const flattenedIcons: Record<string, string> = {};

                const flatten = (obj: any, prefix = '') => {
                    for (const key in obj) {
                        const value = obj[key];
                        const newKey = prefix ? `${prefix}.${key}` : key;
                        if (typeof value === 'string') {
                            flattenedIcons[newKey] = value;
                        } else if (
                            typeof value === 'object' &&
                            value !== null
                        ) {
                            flatten(value, newKey);
                        }
                    }
                };

                flatten(icons);

                for (const token of Object.keys(flattenedIcons)) {
                    if (!validTokens.has(token)) {
                        invalidTokens.push(token);
                    }
                }

                if (invalidTokens.length > 0) {
                    warnings.push({
                        severity: 'warning',
                        code: 'COMPILER_003',
                        message: `Invalid icon tokens found: ${invalidTokens.join(
                            ', '
                        )}`,
                        file: iconConfigPath,
                        suggestion:
                            'Check app/config/icon-tokens.ts for valid tokens',
                    });
                }

                themeIcons = flattenedIcons;
            } catch (e) {
                errors.push({
                    severity: 'error',
                    code: 'COMPILER_004',
                    message: `Failed to load icons.config.ts: ${e}`,
                    file: iconConfigPath,
                });
            }
        }

        // Generate CSS variables
        const cssVariables = this.generateCSSVariables(
            definition.colors,
            definition.borderWidth,
            definition.borderRadius,
            definition.fonts
        );

        // Compile overrides
        const compiledOverrides = this.compileOverrides(
            definition.overrides || {}
        );

        // Validate selectors
        this.validateSelectors(compiledOverrides, warnings);

        // Sort by specificity (descending)
        const sortedOverrides = compiledOverrides.sort(
            (a, b) => b.specificity - a.specificity
        );

        const compiledTheme: CompiledTheme = {
            name: definition.name,
            displayName: definition.displayName,
            description: definition.description,
            cssVariables,
            overrides: sortedOverrides,
            ui: definition.ui,
            propMaps: definition.propMaps,
            icons: themeIcons,
        };

        return {
            name: definition.name,
            theme: compiledTheme,
            errors,
            warnings,
            success: errors.length === 0,
        };
    }

    /**
     * Generate CSS variables from color palette
     */
    private generateCSSVariables(
        colors: ThemeDefinition['colors'],
        borderWidth?: string,
        borderRadius?: string,
        fonts?: ThemeDefinition['fonts']
    ): string {
        let css = '';

        // Light mode variables
        css += '.light {\n';
        css += this.generateColorVars(colors);
        css += this.generateFontVars(fonts);
        if (borderWidth) {
            css += `  --md-border-width: ${borderWidth};\n`;
        }
        if (borderRadius) {
            css += `  --md-border-radius: ${borderRadius};\n`;
        }
        css += '}\n\n';

        // Dark mode variables
        const hasDarkBlock = Boolean(colors.dark || fonts?.dark);
        if (hasDarkBlock) {
            css += '.dark {\n';
            // Create merged object without dark property
            const { dark, ...baseColors } = colors;
            const darkColors = { ...baseColors, ...dark };
            css += this.generateColorVars(darkColors);
            css += this.generateFontVars(fonts?.dark);
            if (borderWidth) {
                css += `  --md-border-width: ${borderWidth};\n`;
            }
            if (borderRadius) {
                css += `  --md-border-radius: ${borderRadius};\n`;
            }
            css += '}\n';
        }

        return css;
    }

    /**
     * Generate CSS variable declarations for a color palette
     */
    private generateColorVars(colors: Record<string, any>): string {
        let css = '';

        const colorMap: Record<string, string> = {
            primary: '--md-primary',
            onPrimary: '--md-on-primary',
            primaryContainer: '--md-primary-container',
            onPrimaryContainer: '--md-on-primary-container',
            secondary: '--md-secondary',
            onSecondary: '--md-on-secondary',
            secondaryContainer: '--md-secondary-container',
            onSecondaryContainer: '--md-on-secondary-container',
            tertiary: '--md-tertiary',
            onTertiary: '--md-on-tertiary',
            tertiaryContainer: '--md-tertiary-container',
            onTertiaryContainer: '--md-on-tertiary-container',
            error: '--md-error',
            onError: '--md-on-error',
            errorContainer: '--md-error-container',
            onErrorContainer: '--md-on-error-container',
            surface: '--md-surface',
            onSurface: '--md-on-surface',
            surfaceVariant: '--md-surface-variant',
            onSurfaceVariant: '--md-on-surface-variant',
            inverseSurface: '--md-inverse-surface',
            inverseOnSurface: '--md-inverse-on-surface',
            outline: '--md-outline',
            outlineVariant: '--md-outline-variant',
            borderColor: '--md-border-color',
            success: '--md-success',
            warning: '--md-warning',
            info: '--md-info',
        };

        const emittedKeys = new Set<string>();

        for (const [key, cssVar] of Object.entries(colorMap)) {
            const value = colors[key];
            if (typeof value === 'string') {
                css += `  ${cssVar}: ${value};\n`;
                emittedKeys.add(key);
            }
        }

        // Emit any additional custom tokens (camelCase → kebab-case)
        for (const [key, value] of Object.entries(colors)) {
            if (key === 'dark' || emittedKeys.has(key)) continue;
            if (typeof value !== 'string') continue;
            const cssVar = `--md-${this.toKebabCase(key)}`;
            css += `  ${cssVar}: ${value};\n`;
        }

        return css;
    }

    private generateFontVars(fonts?: ThemeDefinition['fonts']): string {
        if (!fonts) return '';
        let css = '';
        const fontMap: Record<string, string> = {
            sans: '--font-sans',
            heading: '--font-heading',
            mono: '--font-mono',
        };
        const fontEntries = Object.entries(fontMap) as Array<
            [keyof ThemeFontSet, string]
        >;
        for (const [key, cssVar] of fontEntries) {
            const value = fonts[key];
            if (typeof value === 'string' && value.length > 0) {
                css += `  ${cssVar}: ${value};\n`;
            }
        }
        return css;
    }

    private toKebabCase(value: string): string {
        return value
            .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
            .replace(/[\s_]+/g, '-')
            .toLowerCase();
    }

    /**
     * Compile overrides from CSS selectors to runtime rules
     */
    private compileOverrides(
        overrides: Record<string, any>
    ): CompiledOverride[] {
        const compiled: CompiledOverride[] = [];

        for (const [selector, props] of Object.entries(overrides)) {
            const parsed = parseSelector(selector);
            const specificity = calculateSpecificity(selector, parsed);

            compiled.push({
                component: parsed.component,
                context: parsed.context,
                identifier: parsed.identifier,
                state: parsed.state,
                attributes: parsed.attributes,
                props,
                selector,
                specificity,
            });
        }

        return compiled;
    }



    /**
     * Validate compiled selectors
     */
    private validateSelectors(
        overrides: CompiledOverride[],
        warnings: ValidationError[]
    ): void {
        // Check for potential conflicts
        const selectorMap = new Map<string, CompiledOverride[]>();

        for (const override of overrides) {
            const key = `${override.component}:${override.context || ''}:${
                override.identifier || ''
            }`;
            const existing = selectorMap.get(key) || [];
            existing.push(override);
            selectorMap.set(key, existing);
        }

        // Warn about exact duplicates
        for (const [key, matches] of selectorMap.entries()) {
            if (matches.length > 1) {
                const selectors = matches.map((m) => m.selector).join(', ');
                warnings.push({
                    severity: 'warning',
                    code: 'COMPILER_002',
                    message: `Multiple overrides match "${key}": ${selectors}`,
                    file: 'theme.ts',
                    suggestion:
                        'Consider consolidating or adjusting specificity',
                });
            }
        }
    }

    /**
     * Generate TypeScript type definitions
     */
    private async generateTypes(
        results: ThemeCompilationResult[]
    ): Promise<void> {
        const { writeFile, mkdir } = await import('fs/promises');
        const { join } = await import('path');

        const identifiers = new Set<string>();
        const themeNames = new Set<string>();
        const contexts = new Set<string>();

        for (const result of results) {
            themeNames.add(result.name);

            for (const override of result.theme.overrides) {
                if (override.identifier) {
                    identifiers.add(override.identifier);
                }
                if (override.context) {
                    contexts.add(override.context);
                }
            }
        }

        // Add known contexts
        for (const ctx of this.knownContexts) {
            contexts.add(ctx);
        }

        const typeFile = `/**
 * Auto-generated by theme compiler
 * Do not edit manually - changes will be overwritten
 * Generated: ${new Date().toISOString()}
 */

/**
 * Available theme names
 */
export type ThemeName = ${
            Array.from(themeNames).length > 0
                ? Array.from(themeNames)
                      .map((n) => `'${n}'`)
                      .join(' | ')
                : 'string'
        };

/**
 * Available theme identifiers for v-theme directive
 */
export type ThemeIdentifier = ${
            Array.from(identifiers).length > 0
                ? Array.from(identifiers)
                      .map((id) => `'${id}'`)
                      .join(' | ')
                : 'string'
        };

/**
 * Available context names
 */
export type ThemeContext = ${
            Array.from(contexts).length > 0
                ? Array.from(contexts)
                      .map((ctx) => `'${ctx}'`)
                      .join(' | ')
                : 'string'
        };

/**
 * Theme directive value
 */
export interface ThemeDirective {
    /** Theme identifier */
    identifier?: ThemeIdentifier;
    
    /** Theme name to use */
    theme?: ThemeName;
    
    /** Context override */
    context?: ThemeContext;
}

/**
 * String shorthand for theme directive (just the identifier)
 */
export type ThemeDirectiveValue = ThemeIdentifier | ThemeDirective;
`;

        const typesDir = join(process.cwd(), 'types');
        await mkdir(typesDir, { recursive: true });

        const typesPath = join(typesDir, 'theme-generated.d.ts');
        await writeFile(typesPath, typeFile, 'utf-8');

        console.log(`[theme-compiler] Generated types at ${typesPath}`);
        console.log(`[theme-compiler] - ${themeNames.size} themes`);
        console.log(`[theme-compiler] - ${identifiers.size} identifiers`);
        console.log(`[theme-compiler] - ${contexts.size} contexts`);
    }
}
