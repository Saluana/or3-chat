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
} from '../app/theme/_shared/types';
import { validateThemeDefinition } from '../app/theme/_shared/validate-theme';

/**
 * Theme Compiler
 * 
 * Transforms theme definitions into optimized runtime configs
 */
export class ThemeCompiler {
    private knownContexts = ['chat', 'sidebar', 'dashboard', 'header', 'global'];
    
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
                console.error(`[theme-compiler] Failed to compile theme at ${themePath}:`, error);
                results.push({
                    name: themePath,
                    theme: {} as CompiledTheme,
                    errors: [{
                        severity: 'error',
                        code: 'COMPILER_001',
                        message: `Failed to compile theme: ${error}`,
                        file: themePath,
                    }],
                    warnings: [],
                    success: false,
                });
            }
        }
        
        // Generate type definitions
        if (results.some(r => r.success)) {
            await this.generateTypes(results.filter(r => r.success));
        }
        
        const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);
        const totalWarnings = results.reduce((sum, r) => sum + r.warnings.length, 0);
        
        return {
            themes: results,
            success: results.every(r => r.success),
            totalErrors,
            totalWarnings,
        };
    }
    
    /**
     * Discover all theme files
     */
    private async discoverThemes(): Promise<string[]> {
        const { readdir } = await import('fs/promises');
        const { join } = await import('path');
        
        const themeDir = join(process.cwd(), 'app/theme');
        const entries = await readdir(themeDir, { withFileTypes: true });
        
        const themes: string[] = [];
        for (const entry of entries) {
            if (entry.isDirectory() && !entry.name.startsWith('_')) {
                const themePath = join(themeDir, entry.name, 'theme.ts');
                themes.push(themePath);
            }
        }
        
        return themes;
    }
    
    /**
     * Compile a single theme
     */
    private async compileTheme(themePath: string): Promise<ThemeCompilationResult> {
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
        
        // Generate CSS variables
        const cssVariables = this.generateCSSVariables(definition.colors);
        
        // Compile overrides
        const compiledOverrides = this.compileOverrides(definition.overrides || {});
        
        // Validate selectors
        this.validateSelectors(compiledOverrides, warnings);
        
        // Sort by specificity (descending)
        const sortedOverrides = compiledOverrides.sort((a, b) => b.specificity - a.specificity);
        
        const compiledTheme: CompiledTheme = {
            name: definition.name,
            displayName: definition.displayName,
            description: definition.description,
            cssVariables,
            overrides: sortedOverrides,
            ui: definition.ui,
            propMaps: definition.propMaps,
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
    private generateCSSVariables(colors: ThemeDefinition['colors']): string {
        let css = '';
        
        // Light mode variables
        css += '.light {\n';
        css += this.generateColorVars(colors);
        css += '}\n\n';
        
        // Dark mode variables
        if (colors.dark) {
            css += '.dark {\n';
            // Create merged object without dark property
            const { dark, ...baseColors } = colors;
            const darkColors = { ...baseColors, ...dark };
            css += this.generateColorVars(darkColors);
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
            success: '--md-success',
            warning: '--md-warning',
            info: '--md-info',
        };
        
        for (const [key, cssVar] of Object.entries(colorMap)) {
            if (colors[key]) {
                css += `  ${cssVar}: ${colors[key]};\n`;
            }
        }
        
        return css;
    }
    
    /**
     * Compile overrides from CSS selectors to runtime rules
     */
    private compileOverrides(overrides: Record<string, any>): CompiledOverride[] {
        const compiled: CompiledOverride[] = [];
        
        for (const [selector, props] of Object.entries(overrides)) {
            const parsed = this.parseSelector(selector);
            const specificity = this.calculateSpecificity(selector, parsed);
            
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
     * Parse CSS selector into override components
     */
    private parseSelector(selector: string): ParsedSelector {
        // Normalize simple syntax to attribute selectors
        let normalized = this.normalizeSelector(selector);
        
        // Extract component type (first word)
        const component = normalized.match(/^(\w+)/)?.[1] || 'button';
        
        // Extract data-context
        const context = normalized.match(/\[data-context="([^"]+)"\]/)?.[1];
        
        // Extract data-id
        const identifier = normalized.match(/\[data-id="([^"]+)"\]/)?.[1];
        
        // Extract pseudo-class state
        const state = normalized.match(/:(\w+)(?:\(|$)/)?.[1];
        
        // Extract HTML attribute selectors
        const attributes = this.extractAttributes(normalized);
        
        return {
            component,
            context,
            identifier,
            state,
            attributes: attributes.length > 0 ? attributes : undefined,
        };
    }
    
    /**
     * Escape special regex characters
     */
    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    
    /**
     * Normalize simple selector syntax to attribute selectors
     */
    private normalizeSelector(selector: string): string {
        let result = selector;
        
        // Convert .context to [data-context="context"]
        // Only convert known contexts
        for (const context of this.knownContexts) {
            const escapedContext = this.escapeRegex(context);
            const regex = new RegExp(`(\\w+)\\.${escapedContext}(?=[:\\[]|$)`, 'g');
            result = result.replace(regex, `$1[data-context="${context}"]`);
        }
        
        // Convert #identifier to [data-id="identifier"]
        result = result.replace(/(\w+)#([\w.]+)(?=[:\[]|$)/g, '$1[data-id="$2"]');
        
        return result;
    }
    
    /**
     * Extract HTML attribute selectors from normalized selector
     */
    private extractAttributes(selector: string): AttributeMatcher[] {
        const attributes: AttributeMatcher[] = [];
        const attrRegex = /\[([^=\]]+)(([~|^$*]?=)"([^"]+)")?\]/g;
        let match;
        
        while ((match = attrRegex.exec(selector)) !== null) {
            const attrName = match[1];
            
            // Skip data-context and data-id (already handled)
            if (attrName === 'data-context' || attrName === 'data-id') continue;
            
            const hasValue = match[2] !== undefined;
            const operator = hasValue
                ? (match[3] || '=') as AttributeOperator
                : 'exists' as AttributeOperator;
            const value = match[4];
            
            attributes.push({
                attribute: attrName,
                operator,
                value,
            });
        }
        
        return attributes;
    }
    
    /**
     * Calculate CSS selector specificity
     */
    private calculateSpecificity(selector: string, parsed: ParsedSelector): number {
        let specificity = 0;
        
        // Element: 1 point
        specificity += 1;
        
        // Attributes: 10 points each
        const attrCount = (selector.match(/\[/g) || []).length;
        specificity += attrCount * 10;
        
        // Pseudo-classes: 10 points each
        const pseudoCount = (selector.match(/:/g) || []).length;
        specificity += pseudoCount * 10;
        
        // Identifier gets extra weight
        if (parsed.identifier) {
            specificity += 10;
        }
        
        return specificity;
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
            const key = `${override.component}:${override.context || ''}:${override.identifier || ''}`;
            const existing = selectorMap.get(key) || [];
            existing.push(override);
            selectorMap.set(key, existing);
        }
        
        // Warn about exact duplicates
        for (const [key, matches] of selectorMap.entries()) {
            if (matches.length > 1) {
                const selectors = matches.map(m => m.selector).join(', ');
                warnings.push({
                    severity: 'warning',
                    code: 'COMPILER_002',
                    message: `Multiple overrides match "${key}": ${selectors}`,
                    file: 'theme.ts',
                    suggestion: 'Consider consolidating or adjusting specificity',
                });
            }
        }
    }
    
    /**
     * Generate TypeScript type definitions
     */
    private async generateTypes(results: ThemeCompilationResult[]): Promise<void> {
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
                ? Array.from(themeNames).map(n => `'${n}'`).join(' | ')
                : 'string'
        };

/**
 * Available theme identifiers for v-theme directive
 */
export type ThemeIdentifier = ${
            Array.from(identifiers).length > 0
                ? Array.from(identifiers).map(id => `'${id}'`).join(' | ')
                : 'string'
        };

/**
 * Available context names
 */
export type ThemeContext = ${
            Array.from(contexts).length > 0
                ? Array.from(contexts).map(ctx => `'${ctx}'`).join(' | ')
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
