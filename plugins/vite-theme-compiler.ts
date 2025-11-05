/**
 * Vite Plugin for Refined Theme System
 * 
 * This plugin integrates the theme compiler into the Vite/Nuxt build process.
 * It compiles themes at build time and provides HMR support in development.
 */

import type { Plugin } from 'vite';
import { ThemeCompiler } from '../scripts/theme-compiler';

export interface ThemePluginOptions {
    /** Whether to fail the build on compilation errors (default: true) */
    failOnError?: boolean;
    
    /** Whether to show warnings (default: true) */
    showWarnings?: boolean;
    
    /** Whether to generate type definitions (default: true) */
    generateTypes?: boolean;
}

/**
 * Create the Vite theme compiler plugin
 */
export function themeCompilerPlugin(options: ThemePluginOptions = {}): Plugin {
    const {
        failOnError = true,
        showWarnings = true,
        generateTypes = true,
    } = options;
    
    let compiler: ThemeCompiler;
    let compiled = false;
    
    /**
     * Compile themes
     */
    async function compileThemes(context: any) {
        if (compiled) return; // Only compile once per build
        compiled = true;
        
        compiler = new ThemeCompiler();
        
        console.log('\n[theme-compiler] Compiling themes...');
        
        try {
            const result = await compiler.compileAll();
            
            // Log summary
            console.log(`[theme-compiler] Compiled ${result.themes.length} themes`);
            console.log(`  - Successful: ${result.themes.filter(t => t.success).length}`);
            console.log(`  - Errors: ${result.totalErrors}`);
            console.log(`  - Warnings: ${result.totalWarnings}`);
            
            // Handle errors
            if (result.totalErrors > 0) {
                const errorMessage = formatErrors(result);
                
                if (failOnError && context) {
                    context.error(errorMessage);
                } else {
                    console.error(errorMessage);
                }
            }
            
            // Handle warnings
            if (showWarnings && result.totalWarnings > 0) {
                const warningMessage = formatWarnings(result);
                if (context && context.warn) {
                    context.warn(warningMessage);
                } else {
                    console.warn(warningMessage);
                }
            }
            
            if (result.success) {
                console.log('[theme-compiler] ✅ All themes compiled successfully!\n');
            }
        } catch (error) {
            const message = `[theme-compiler] Fatal compilation error: ${error}`;
            
            if (failOnError && context) {
                context.error(message);
            } else {
                console.error(message);
            }
        }
    }
    
    return {
        name: 'vite-theme-compiler',
        
        // Run early in the build process
        enforce: 'pre',
        
        /**
         * Initialize the compiler when the build starts
         */
        async buildStart() {
            await compileThemes(this);
        },
        
        /**
         * Also compile on config resolution for dev mode
         */
        async configResolved() {
            await compileThemes(null);
        },
        
        /**
         * Handle HMR updates for theme files
         */
        async handleHotUpdate({ file, server }) {
            // Check if the changed file is a theme file
            if (file.includes('/theme/') && file.endsWith('theme.ts')) {
                console.log('[theme-compiler] Theme file changed, recompiling...');
                
                // Reset compilation flag to allow recompilation
                compiled = false;
                
                try {
                    const result = await compiler.compileAll();
                    
                    if (result.totalErrors > 0) {
                        console.error('[theme-compiler] Recompilation failed');
                        console.error(formatErrors(result));
                    } else {
                        console.log('[theme-compiler] ✅ Theme recompiled successfully');
                        
                        // Trigger full page reload for theme changes
                        server.ws.send({
                            type: 'full-reload',
                            path: '*',
                        });
                    }
                } catch (error) {
                    console.error('[theme-compiler] HMR recompilation failed:', error);
                }
                
                // Return empty array to prevent default HMR
                return [];
            }
        },
    };
}

/**
 * Format compilation errors for display
 */
function formatErrors(result: any): string {
    let message = '\n[theme-compiler] ❌ Compilation Errors:\n';
    
    for (const theme of result.themes) {
        if (theme.errors.length > 0) {
            message += `\n  Theme: ${theme.name}\n`;
            
            for (const error of theme.errors) {
                message += `    ${error.code}: ${error.message}\n`;
                
                if (error.file) {
                    message += `      File: ${error.file}`;
                    if (error.line) {
                        message += `:${error.line}`;
                        if (error.column) {
                            message += `:${error.column}`;
                        }
                    }
                    message += '\n';
                }
                
                if (error.suggestion) {
                    message += `      💡 ${error.suggestion}\n`;
                }
                
                if (error.docsUrl) {
                    message += `      📖 ${error.docsUrl}\n`;
                }
            }
        }
    }
    
    return message;
}

/**
 * Format compilation warnings for display
 */
function formatWarnings(result: any): string {
    let message = '\n[theme-compiler] ⚠️  Warnings:\n';
    
    for (const theme of result.themes) {
        if (theme.warnings.length > 0) {
            message += `\n  Theme: ${theme.name}\n`;
            
            for (const warning of theme.warnings) {
                message += `    ${warning.code}: ${warning.message}\n`;
                
                if (warning.suggestion) {
                    message += `      💡 ${warning.suggestion}\n`;
                }
            }
        }
    }
    
    return message;
}

/**
 * Default export for convenience
 */
export default themeCompilerPlugin;
