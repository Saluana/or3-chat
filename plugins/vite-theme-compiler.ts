/**
 * Vite Plugin for Refined Theme System
 *
 * This plugin integrates the theme compiler into the Vite/Nuxt build process.
 * It compiles themes at build time and provides HMR support in development.
 */

import type { Plugin } from 'vite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ThemeCompiler } from '../scripts/theme-compiler';
import type { CompilationResult } from '../app/theme/_shared/types';

const execFileAsync = promisify(execFile);

export interface ThemePluginOptions {
    /** Whether to fail the build on compilation errors (default: true) */
    failOnError?: boolean;

    /** Whether to show warnings (default: true) */
    showWarnings?: boolean;
}

interface ThemeCompilerContext {
    error(message: string): never;
    warn(message: string): void;
}

/**
 * Create the Vite theme compiler plugin
 */
export function themeCompilerPlugin(options: ThemePluginOptions = {}): Plugin {
    const {
        failOnError = true,
        showWarnings = true,
    } = options;

    let compiler: ThemeCompiler | null = null;
    let compilation: Promise<CompilationResult> | null = null;

    /**
     * Compile themes
     */
    async function compileThemes(
        context: ThemeCompilerContext | null
    ) {
        if (!compiler) {
            compiler = new ThemeCompiler();
        }

        console.log('\n[theme-compiler] Compiling themes...');

        try {
            compilation ??= compiler.compileAll();
            const result = await compilation;

            // Log summary
            console.log(
                `[theme-compiler] Compiled ${result.themes.length} themes`
            );
            console.log(
                `  - Successful: ${
                    result.themes.filter((t) => t.success).length
                }`
            );
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
                if (context) {
                    context.warn(warningMessage);
                } else {
                    console.warn(warningMessage);
                }
            }

            if (result.success) {
                console.log(
                    '[theme-compiler] ✅ All themes compiled successfully!\n'
                );
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
        async configResolved(config) {
            if (config.command === 'serve') {
                await compileThemes(null);
            }
        },

        /**
         * Handle HMR updates for theme files
         */
        async handleHotUpdate({ file, server }) {
            const normalized = file.replace(/\\/g, '/');

            // Only handle .ts files under app/theme/<name>/ (skip _shared)
            const markerIdx = normalized.indexOf('/app/theme/');
            if (markerIdx === -1) return;

            const rel = normalized.slice(markerIdx + '/app/theme/'.length);
            if (rel.startsWith('_')) return;

            const affectsThemeEntry = /\.(?:ts|tsx|vue|css|scss|sass|less)$/.test(file);

            console.log(`[theme-compiler] Theme file changed: ${rel}`);

            try {
                // For entry files, also recompile theme definitions & types
                if (affectsThemeEntry) {
                    compilation = null;
                    if (!compiler) compiler = new ThemeCompiler();
                    const result = await (compilation = compiler.compileAll());
                    if (result.totalErrors > 0) {
                        console.error(formatErrors(result));
                    }
                }

                // Rebuild CSS via subprocess (fresh process = no ESM cache)
                const runtime = process.versions.bun ? process.execPath : 'bun';
                await execFileAsync(runtime, ['run', 'theme:build-css'], {
                    cwd: process.cwd(),
                });

                console.log('[theme-compiler] ✅ Theme CSS rebuilt');

                server.ws.send({
                    type: 'full-reload',
                    path: '*',
                });
            } catch (error) {
                console.error('[theme-compiler] HMR rebuild failed:', error);
            }

            return [];
        },
    };
}

/**
 * Format compilation errors for display
 */
function formatErrors(result: CompilationResult): string {
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
function formatWarnings(result: CompilationResult): string {
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
