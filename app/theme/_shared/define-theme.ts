/**
 * @module app/theme/_shared/define-theme
 *
 * Purpose:
 * Defines a theme using the OR3 theme DSL and validates it in development.
 *
 * Behavior:
 * - Performs validation in dev and throws on errors
 * - Logs warnings in dev without blocking
 *
 * Constraints:
 * - Validation is dev only and does not run in production
 *
 * Non-Goals:
 * - Runtime normalization or auto fixing of invalid definitions
 */

import type { ThemeDefinition } from './types';
import { validateThemeDefinition } from './validate-theme';

/**
 * `defineTheme`
 *
 * Purpose:
 * Returns a validated theme definition for consumption by build and runtime.
 *
 * Behavior:
 * - Throws on validation errors in development
 * - Returns the input unchanged in production
 *
 * Constraints:
 * - Validation does not run in production
 *
 * @example
 * ```ts
 * export default defineTheme({
 *   name: 'nature',
 *   displayName: 'Nature',
 *   colors: { primary: '#3f8452', secondary: '#5a7b62', surface: '#f5faf5' }
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
 * `ThemeConfig`
 *
 * Purpose:
 * Type helper for theme definitions.
 */
export type ThemeConfig = ThemeDefinition;
