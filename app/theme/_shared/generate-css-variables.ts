import type { ThemeDefinition, ColorPalette, ThemeFontSet } from './types';

/**
 * Generate CSS variable declarations from theme color palette.
 * Supports light and dark palette (dark overrides).
 */
export function generateThemeCssVariables(def: ThemeDefinition): string {
    const light = buildPalette(def.colors);
    applyFontVars(light, def.fonts);

    // Add border styling if defined
    if (def.borderWidth) {
        light['--md-border-width'] = def.borderWidth;
    }
    if (def.borderRadius) {
        light['--md-border-radius'] = def.borderRadius;
    }

    const darkOverrides = def.colors.dark
        ? buildPalette(def.colors.dark as ColorPalette)
        : {};
    applyFontVars(darkOverrides, def.fonts?.dark);

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

const kebabCache = new Map<string, string>();

function kebab(str: string): string {
    let cached = kebabCache.get(str);
    if (cached) return cached;
    cached = str.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
    kebabCache.set(str, cached);
    return cached;
}

function buildPalette(colors: ColorPalette): Record<string, string> {
    const entries: Record<string, string> = {};
    for (const key in colors) {
        if (key === 'dark') continue;
        const value = colors[key as keyof ColorPalette];
        if (typeof value !== 'string') continue;
        // prefix variables with md for material design tokens
        const varName = `--md-${kebab(key)}`;
        entries[varName] = value;
    }
    return entries;
}

function applyFontVars(
    target: Record<string, string>,
    fonts?: ThemeFontSet
): void {
    if (!fonts) return;
    if (fonts.sans) {
        target['--font-sans'] = fonts.sans;
    }
    if (fonts.heading) {
        target['--font-heading'] = fonts.heading;
    }
    if (fonts.mono) {
        target['--font-mono'] = fonts.mono;
    }
    if (fonts.baseSize) {
        target['--app-font-size-root'] = fonts.baseSize;
    }
    if (fonts.baseWeight) {
        target['--app-font-weight-root'] = fonts.baseWeight;
    }
}

function toCssBlock(
    themeName: string,
    vars: Record<string, string>,
    dark: boolean
): string {
    const selector = dark
        ? `html[data-theme="${themeName}"].dark, .dark html[data-theme="${themeName}"]`
        : `html[data-theme="${themeName}"]`;

    // Optimize string concatenation
    let css = `${selector} {\n`;
    for (const key in vars) {
        css += `  ${key}: ${vars[key]};\n`;
    }
    css += '}';
    return css;
}
