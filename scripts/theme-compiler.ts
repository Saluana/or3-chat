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
    ThemeCompilationResult,
    CompilationResult,
    ValidationError,
    OverrideProps,
} from '../app/theme/_shared/types';
import { validateThemeDefinition } from '../app/theme/_shared/validate-theme';
import { KNOWN_THEME_CONTEXTS } from '../app/theme/_shared/contexts';
import { DEFAULT_ICONS } from '../app/config/icon-tokens';
import { compileThemeDefinition } from '../app/theme/_shared/compile-theme';
import { generateThemeCssVariables } from '../app/theme/_shared/generate-css-variables';
import { compileOverridesRuntime } from '../app/theme/_shared/runtime-compile';
import {
    discoverThemeSourceFiles,
    importThemeSourceModule,
} from './theme-discovery';

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
            const successful = results.filter((r) => r.success);
            await this.generateTypes(successful);
            await this.generateMetadataManifest(successful);
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
        return discoverThemeSourceFiles();
    }

    /**
     * Compile a single theme
     */
    private async compileTheme(
        themePath: string
    ): Promise<ThemeCompilationResult> {
        // Extension themes (and some core themes) import via Nuxt `~` aliases.
        // Plain dynamic import() cannot resolve those outside Vite.
        const themeModule = await importThemeSourceModule<
            { default?: ThemeDefinition } & Record<string, unknown>
        >(themePath);
        const definition: ThemeDefinition = themeModule.default ??
            (themeModule as unknown as ThemeDefinition);

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
                const iconModule = await importThemeSourceModule<
                    { default?: Record<string, unknown> } & Record<string, unknown>
                >(iconConfigPath);
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

                const flatten = (obj: Record<string, unknown>, prefix = '') => {
                    for (const key in obj) {
                        const value = obj[key];
                        const newKey = prefix ? `${prefix}.${key}` : key;
                        if (typeof value === 'string') {
                            flattenedIcons[newKey] = value;
                        } else if (
                            typeof value === 'object' &&
                            value !== null
                        ) {
                            flatten(value as Record<string, unknown>, newKey);
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

        const compiledTheme = compileThemeDefinition(definition, {
            icons: themeIcons,
        });
        this.validateSelectors(compiledTheme.overrides, warnings);

        return {
            name: definition.name,
            theme: compiledTheme,
            errors,
            warnings,
            success: errors.length === 0,
        };
    }

    /** Compatibility test seam; delegates to the canonical runtime generator. */
    private generateCSSVariables(
        colors: ThemeDefinition['colors'],
        borderWidth?: string,
        borderRadius?: string,
        fonts?: ThemeDefinition['fonts']
    ): string {
        return generateThemeCssVariables({
            name: 'compiler-test',
            colors,
            borderWidth,
            borderRadius,
            fonts,
        });
    }

    /** Compatibility test seam; delegates to the canonical selector compiler. */
    private compileOverrides(
        overrides: Record<string, OverrideProps>
    ): CompiledOverride[] {
        return compileOverridesRuntime(overrides);
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
            }:${override.state || ''}:${JSON.stringify(override.attributes ?? [])}`;
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
        const { writeFile, mkdir, readFile } = await import('fs/promises');
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
 */

/**
 * Available theme names
 */
export type ThemeName = ${
            Array.from(themeNames).length > 0
                ? Array.from(themeNames).sort()
                      .map((n) => `'${n}'`)
                      .join(' | ')
                : 'string'
        };

/**
 * Available theme identifiers for v-theme directive
 */
export type ThemeIdentifier = ${
            Array.from(identifiers).length > 0
                ? Array.from(identifiers).sort()
                      .map((id) => `'${id}'`)
                      .join(' | ')
                : 'string'
        };

/**
 * Available context names
 */
export type ThemeContext = ${
            Array.from(contexts).length > 0
                ? Array.from(contexts).sort()
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
        let previous = '';
        try {
            previous = await readFile(typesPath, 'utf-8');
        } catch {
            // File does not exist yet.
        }
        if (previous !== typeFile) {
            await writeFile(typesPath, typeFile, 'utf-8');
        }

        console.log(`[theme-compiler] Generated types at ${typesPath}`);
        console.log(`[theme-compiler] - ${themeNames.size} themes`);
        console.log(`[theme-compiler] - ${identifiers.size} identifiers`);
        console.log(`[theme-compiler] - ${contexts.size} contexts`);
    }

    /** Generate lightweight metadata consumed before any theme module is imported. */
    private async generateMetadataManifest(
        results: ThemeCompilationResult[]
    ): Promise<void> {
        const { writeFile, readFile } = await import('fs/promises');
        const { join } = await import('path');
        const metadata = results
            .map((result) => ({
                name: result.name,
                dirName: result.name,
                displayName: result.theme.displayName,
                description: result.theme.description,
                isDefault: Boolean(result.theme.isDefault),
                stylesheets: result.theme.stylesheets ?? [],
                hasCssSelectorStyles: Boolean(result.theme.hasStyleSelectors),
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
        const source = `/** Auto-generated metadata-only theme manifest. Do not edit manually. */
export interface GeneratedThemeMetadata {
    name: string;
    dirName: string;
    displayName?: string;
    description?: string;
    isDefault: boolean;
    stylesheets: readonly string[];
    hasCssSelectorStyles: boolean;
}

export const GENERATED_THEME_METADATA: readonly GeneratedThemeMetadata[] = ${JSON.stringify(metadata, null, 4)} as const;
`;
        const outputPath = join(
            process.cwd(),
            'app/theme/_shared/theme-manifest.generated.ts'
        );
        let previous = '';
        try {
            previous = await readFile(outputPath, 'utf8');
        } catch {
            // Generated file does not exist yet.
        }
        if (previous !== source) await writeFile(outputPath, source, 'utf8');
    }
}
