/**
 * @module app/theme/_shared/generate-css-variables
 *
 * Purpose:
 * Generates CSS variable blocks from theme definitions.
 *
 * Behavior:
 * - Produces light and optional dark CSS variable blocks
 * - Adds font and border variables when configured
 *
 * Constraints:
 * - Only string values are emitted as variables
 *
 * Non-Goals:
 * - Validating color values
 */

import type { ThemeDefinition, ColorPalette, ThemeFontSet } from './types';
import { COLOR_TOKEN_REGISTRY } from './design-token-registry';

/**
 * `generateThemeCssVariables`
 *
 * Purpose:
 * Generates the CSS variable blocks for a theme.
 */
export function generateThemeCssVariables(def: ThemeDefinition): string {
    const light = buildPalette(def.colors);
    applyFontVars(light, def.fonts);

    applyShapeVars(light, def);

    const darkOverrides = def.colors.dark
        ? buildPalette(def.colors.dark as ColorPalette)
        : {};
    applyFontVars(darkOverrides, def.fonts?.dark);

    // Shape is shared across color modes, matching the original middle tokens.
    if (Object.keys(darkOverrides).length > 0) {
        applyShapeVars(darkOverrides, def);
    }

    const lightBlock = toCssBlock(def.name, light, false);
    const darkBlock =
        Object.keys(darkOverrides).length > 0
            ? toCssBlock(def.name, darkOverrides, true)
            : '';
    return lightBlock + (darkBlock ? '\n' + darkBlock : '');
}

function applyShapeVars(
    target: Record<string, string>,
    def: ThemeDefinition
): void {
    const shapeVars = [
        ['--md-border-width-subtle', def.borderWidthSubtle],
        ['--md-border-width', def.borderWidth],
        ['--md-border-width-strong', def.borderWidthStrong],
        ['--md-border-radius-small', def.borderRadiusSmall],
        ['--md-border-radius', def.borderRadius],
        ['--md-border-radius-large', def.borderRadiusLarge],
    ] as const;

    for (const [variable, value] of shapeVars) {
        if (value) target[variable] = value;
    }
}

// Safe to keep unbounded: keys come from theme token names, which are finite
// and author-controlled (not user-generated runtime input).
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
        const varName =
            COLOR_TOKEN_REGISTRY[key as keyof typeof COLOR_TOKEN_REGISTRY] ??
            `--md-${kebab(key)}`;
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
