#!/usr/bin/env node
/**
 * CLI tool to compile themes
 * 
 * Usage: bun run scripts/compile-themes.ts
 */

import { ThemeCompiler } from './theme-compiler';

async function main() {
    console.log('[theme-compiler] Starting theme compilation...\n');
    
    const compiler = new ThemeCompiler();
    const result = await compiler.compileAll();
    
    console.log('\n[theme-compiler] Compilation complete!');
    console.log(`- Total themes: ${result.themes.length}`);
    console.log(`- Successful: ${result.themes.filter(t => t.success).length}`);
    console.log(`- Errors: ${result.totalErrors}`);
    console.log(`- Warnings: ${result.totalWarnings}`);
    
    if (result.totalErrors > 0) {
        console.error('\n[theme-compiler] ❌ Compilation failed with errors:');
        for (const theme of result.themes) {
            if (theme.errors.length > 0) {
                console.error(`\n  Theme: ${theme.name}`);
                for (const error of theme.errors) {
                    console.error(`    ${error.code}: ${error.message}`);
                    if (error.suggestion) {
                        console.error(`      → ${error.suggestion}`);
                    }
                }
            }
        }
        process.exit(1);
    }
    
    if (result.totalWarnings > 0) {
        console.warn('\n[theme-compiler] ⚠️  Warnings:');
        for (const theme of result.themes) {
            if (theme.warnings.length > 0) {
                console.warn(`\n  Theme: ${theme.name}`);
                for (const warning of theme.warnings) {
                    console.warn(`    ${warning.code}: ${warning.message}`);
                }
            }
        }
    }
    
    if (result.success) {
        console.log('\n[theme-compiler] ✅ All themes compiled successfully!');
    }
}

main().catch(error => {
    console.error('[theme-compiler] Fatal error:', error);
    process.exit(1);
});
