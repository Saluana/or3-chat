import type { ThemeDefinition, ColorPalette } from './types';

/**
 * Generate CSS variable declarations from theme color palette.
 * Supports light and dark palette (dark overrides).
 */
export function generateThemeCssVariables(def: ThemeDefinition): string {
    const light = buildPalette(def.colors);
    
    // Add border styling if defined
    if (def.borderWidth) {
        light['--md-border-width'] = def.borderWidth;
    }
    if (def.borderRadius) {
        light['--md-border-radius'] = def.borderRadius;
    }
    
    const darkOverrides = def.colors.dark
        ? buildPalette(def.colors.dark as ColorPalette, true)
        : {};
    
    // Add border styling to dark mode as well (same values)
    if (def.borderWidth && Object.keys(darkOverrides).length > 0) {
        darkOverrides['--md-border-width'] = def.borderWidth;
    }
    if (def.borderRadius && Object.keys(darkOverrides).length > 0) {
        darkOverrides['--md-border-radius'] = def.borderRadius;
    }

    const lightBlock = toCssBlock(def.name, light, false);
    const darkBlock =
        Object.keys(darkOverrides).length > 0
            ? toCssBlock(def.name, darkOverrides, true)
            : '';
    return lightBlock + (darkBlock ? '\n' + darkBlock : '');
}

function buildPalette(
    colors: ColorPalette,
    isDark = false
): Record<string, string> {
    const entries: Record<string, string> = {};
    for (const [key, value] of Object.entries(colors)) {
        if (key === 'dark') continue;
        if (typeof value !== 'string') continue;
        // prefix variables with md for material design tokens
        const varName = `--md-${kebab(key)}`;
        entries[varName] = value;
    }
    return entries;
}

function toCssBlock(
    themeName: string,
    vars: Record<string, string>,
    dark: boolean
): string {
    const selector = dark
        ? `html[data-theme="${themeName}"].dark, .dark html[data-theme="${themeName}"]`
        : `html[data-theme="${themeName}"]`;
    const lines = Object.entries(vars).map(
        ([name, val]) => `  ${name}: ${val};`
    );
    return `${selector} {\n${lines.join('\n')}\n}`;
}

function kebab(str: string): string {
    return str.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
}
