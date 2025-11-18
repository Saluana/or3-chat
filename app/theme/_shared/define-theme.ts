/**
 * Refined Theme System - Theme Definition DSL
 * 
 * This file provides the `defineTheme` function, which is the primary API
 * for theme authors to define new themes.
 */

import type { ThemeDefinition } from './types';
import { validateThemeDefinition } from './validate-theme';

/**
 * Define a new theme using the refined theme DSL
 * 
 * This function provides type safety and runtime validation for theme definitions.
 * In development mode, it performs comprehensive validation and provides helpful
 * error messages.
 * 
 * @param config - Theme configuration object
 * @returns The validated theme definition
 * 
 * @example
 * ```typescript
 * export default defineTheme({
 *   name: 'nature',
 *   displayName: 'Nature',
 *   description: 'Organic green theme with natural tones',
 *   colors: {
 *     primary: '#3f8452',
 *     secondary: '#5a7b62',
 *     surface: '#f5faf5',
 *     dark: {
 *       primary: '#8dd29a',
 *       surface: '#0c130d',
 *     },
 *   },
 *   overrides: {
 *     button: { variant: 'solid', size: 'md' },
 *     'button.chat': { variant: 'ghost', size: 'sm' },
 *     'button#chat.send': { variant: 'solid', class: 'shadow-glow' },
 *   },
 * });
 * ```
 */
export function defineTheme(config: ThemeDefinition): ThemeDefinition {
    // Runtime validation in dev mode
    if (import.meta.dev) {
        const validation = validateThemeDefinition(config);
        
        if (!validation.valid) {
            console.error('[theme] Theme definition validation failed:', config.name);
            
            // Log errors
            for (const error of validation.errors) {
                console.error(
                    `[theme] ${error.severity.toUpperCase()}: ${error.message}`,
                    error.suggestion ? `\nSuggestion: ${error.suggestion}` : '',
                    error.docsUrl ? `\nDocs: ${error.docsUrl}` : ''
                );
            }
            
            // Log warnings
            for (const warning of validation.warnings) {
                console.warn(
                    `[theme] WARNING: ${warning.message}`,
                    warning.suggestion ? `\nSuggestion: ${warning.suggestion}` : ''
                );
            }
            
            // Throw in dev to fail fast
            throw new Error(`Theme definition validation failed: ${config.name}`);
        }
        
        // Log warnings even if validation passed
        if (validation.warnings.length > 0) {
            console.warn(`[theme] Theme "${config.name}" has ${validation.warnings.length} warnings`);
            for (const warning of validation.warnings) {
                console.warn(`[theme] WARNING: ${warning.message}`);
            }
        }
    }
    
    return config;
}

/**
 * Type helper for creating theme definitions with full type inference
 */
export type ThemeConfig = ThemeDefinition;
