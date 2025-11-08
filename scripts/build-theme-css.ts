/**
 * Build-Time CSS Generator for Theme System
 * 
 * Generates static CSS files from theme cssSelectors definitions.
 * This allows zero-runtime-overhead styling for third-party components.
 */

import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { ThemeDefinition, CSSelectorConfig } from '~/theme/_shared/types';

/**
 * Convert camelCase to kebab-case for CSS properties
 */
function toKebabCase(str: string): string {
    return str.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/**
 * Generate CSS from theme cssSelectors
 */
export function buildThemeCSS(theme: ThemeDefinition): string {
    const blocks: string[] = [];
    
    if (!theme.cssSelectors) {
        return '';
    }
    
    for (const [selector, config] of Object.entries(theme.cssSelectors)) {
        // Only generate CSS for style properties
        if (config.style && Object.keys(config.style).length > 0) {
            const declarations = Object.entries(config.style)
                .map(([prop, value]) => `  ${toKebabCase(prop)}: ${value};`)
                .join('\n');
            
            blocks.push(
                `[data-theme="${theme.name}"] ${selector} {\n${declarations}\n}`
            );
        }
    }
    
    return blocks.join('\n\n');
}

/**
 * Build and write theme CSS files
 */
export async function buildThemeCSSFiles(themes: ThemeDefinition[], outputDir: string) {
    // Ensure output directory exists
    await mkdir(outputDir, { recursive: true });
    
    const results: { theme: string; file: string; size: number }[] = [];
    
    for (const theme of themes) {
        const css = buildThemeCSS(theme);
        
        if (css) {
            const filename = `${theme.name}.css`;
            const filepath = join(outputDir, filename);
            
            await writeFile(filepath, css, 'utf-8');
            
            results.push({
                theme: theme.name,
                file: filename,
                size: css.length,
            });
            
            console.log(`✓ Generated ${filename} (${css.length} bytes)`);
        } else {
            console.log(`⊘ Skipped ${theme.name} (no CSS selectors)`);
        }
    }
    
    return results;
}

// CLI execution
if (import.meta.main) {
    console.log('Building theme CSS files...\n');
    
    // Dynamic imports for themes
    const retro = await import('../app/theme/retro/theme.ts');
    
    const themes = [retro.default];
    const outputDir = join(process.cwd(), 'public', 'themes');
    
    const results = await buildThemeCSSFiles(themes, outputDir);
    
    console.log(`\n✓ Built ${results.length} theme CSS file(s)`);
}
