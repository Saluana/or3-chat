/**
 * Build-Time CSS Generator for Theme System
 *
 * Generates static CSS files from theme cssSelectors definitions.
 * This allows zero-runtime-overhead styling for third-party components.
 */

import { writeFile, mkdir, access, readdir, rm } from 'fs/promises';
import { join } from 'path';
import { constants as fsConstants } from 'fs';
import { pathToFileURL } from 'url';
import type { ThemeDefinition } from '~/theme/_shared/types';

/**
 * Convert camelCase to kebab-case for CSS properties
 */
function toKebabCase(str: string): string {
    return str.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function splitSelectorList(selector: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let quote = '';
    let start = 0;
    for (let index = 0; index < selector.length; index++) {
        const char = selector[index]!;
        if (quote) {
            if (char === quote && selector[index - 1] !== '\\') quote = '';
        } else if (char === '"' || char === "'") {
            quote = char;
        } else if (char === '(' || char === '[') {
            depth++;
        } else if (char === ')' || char === ']') {
            depth--;
        } else if (char === ',' && depth === 0) {
            parts.push(selector.slice(start, index).trim());
            start = index + 1;
        }
    }
    parts.push(selector.slice(start).trim());
    return parts.filter(Boolean);
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

            const scopedSelector = splitSelectorList(selector)
                .map((branch) => `[data-theme="${theme.name}"] ${branch}`)
                .join(',\n');
            blocks.push(`${scopedSelector} {\n${declarations}\n}`);
        }
    }

    return blocks.join('\n\n');
}

/**
 * Build and write theme CSS files
 */
export async function buildThemeCSSFiles(
    themes: ThemeDefinition[],
    outputDir: string
) {
    // Ensure output directory exists
    await mkdir(outputDir, { recursive: true });

    const expectedFiles = new Set(
        themes
            .filter((theme) => buildThemeCSS(theme).length > 0)
            .map((theme) => `${theme.name}.css`)
    );
    for (const entry of await readdir(outputDir, { withFileTypes: true })) {
        if (
            entry.isFile() &&
            entry.name.endsWith('.css') &&
            !expectedFiles.has(entry.name)
        ) {
            await rm(join(outputDir, entry.name));
        }
    }

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

async function discoverThemes(): Promise<ThemeDefinition[]> {
    const themesDir = join(process.cwd(), 'app', 'theme');
    const entries = await readdir(themesDir, { withFileTypes: true });
    const themes: ThemeDefinition[] = [];

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('_')) continue;

        const themePath = join(themesDir, entry.name, 'theme.ts');

        try {
            await access(themePath, fsConstants.F_OK);
        } catch {
            continue;
        }

        try {
            const module = await import(pathToFileURL(themePath).href);
            if (module?.default) {
                themes.push(module.default as ThemeDefinition);
            }
        } catch (error) {
            console.warn(
                `⚠️  Failed to load theme definition at ${themePath}`,
                error
            );
        }
    }

    return themes;
}

// CLI execution
if (import.meta.main) {
    console.log('Building theme CSS files...\n');

    const themes = await discoverThemes();

    if (themes.length === 0) {
        console.log('⊘ No themes found. Nothing to build.');
    } else {
        const outputDir = join(process.cwd(), 'public', 'themes');

        const results = await buildThemeCSSFiles(themes, outputDir);

        console.log(`\n✓ Built ${results.length} theme CSS file(s)`);
    }
}
