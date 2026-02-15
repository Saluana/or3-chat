/**
 * @module app/core/theme/apply-merged-theme
 *
 * Purpose:
 * Applies the final merged theme to the DOM by setting CSS custom properties
 * on `document.documentElement.style`. Merges the base theme (loaded from the
 * theme plugin registry) with user overrides (typography, colors, backgrounds).
 *
 * Responsibilities:
 * - Apply typography overrides (font size, system font toggle)
 * - Apply color palette overrides (Material Design tokens)
 * - Build merged background layers and apply via `applyThemeBackgrounds`
 * - Apply background color overrides
 * - Handle gradient visibility toggles (header, bottom nav)
 * - Clamp background opacities in high-contrast mode
 *
 * Constraints:
 * - Client-only (early-returns on server via `isBrowser()` check)
 * - Requires the theme plugin to be initialized (accesses `$theme` from Nuxt app)
 * - Color overrides use Material Design CSS variable names (`--md-*`)
 * - Background URLs may be `internal-file://` tokens that need async resolution
 *
 * Non-goals:
 * - Does not persist overrides (see useUserThemeOverrides)
 * - Does not manage the theme registry (see plugins/90.theme.client)
 *
 * @see core/theme/useUserThemeOverrides for the composable that calls this
 * @see core/theme/backgrounds for background layer application
 * @see docs/theme-backgrounds.md for background system documentation
 */
import type { UserThemeOverrides } from './user-overrides-types';
import type { ThemeBackgrounds } from '../../theme/_shared/types';
import type { ThemePlugin } from '~/plugins/90.theme.client';
import {
    applyThemeBackgrounds,
    createThemeBackgroundTokenResolver,
} from './backgrounds';
import { isBrowser } from '~/utils/env';
const backgroundTokenResolver = createThemeBackgroundTokenResolver();

type NuxtAppGlobals = typeof globalThis & {
    useNuxtApp?: () => { $theme?: ThemePlugin };
};

/**
 * Purpose:
 * Apply the merged theme (base theme + user overrides) to the live DOM.
 *
 * Behavior:
 * - Resolves the active base theme via the theme plugin
 * - Applies typography and palette overrides via CSS variables
 * - Builds merged background layers and resolves any `internal-file://` tokens
 *
 * Constraints:
 * - Client-only; no-ops on SSR
 * - Requires the theme plugin to be available on the Nuxt app
 */
export async function applyMergedTheme(
    mode: 'light' | 'dark',
    overrides: UserThemeOverrides
) {
    if (!isBrowser()) return;

    // Get active base theme (from theme plugin registry)
    const g = globalThis as NuxtAppGlobals;
    const nuxtApp = g.useNuxtApp?.();
    const themePlugin = nuxtApp?.$theme;

    if (!themePlugin) {
        console.warn('[apply-merged-theme] Theme plugin not found');
        return;
    }

    const activeThemeName = themePlugin.activeTheme.value;

    // Prefer cached theme to avoid redundant dynamic imports
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- getTheme may not exist in test mocks
    let theme = themePlugin.getTheme?.(activeThemeName) ?? null;

    // Fallback: ensure theme is loaded once if cache missed (e.g. on app boot)
    if (!theme) {
        theme = (await themePlugin.loadTheme(activeThemeName)) ?? null;
    }

    if (!theme) {
        console.warn('[apply-merged-theme] Failed to resolve theme');
        return;
    }

    // Get base theme backgrounds from loaded theme
    const baseBackgrounds = theme.backgrounds;

    const r = document.documentElement.style;

    // 1. Apply typography
    if (overrides.typography?.baseFontPx) {
        r.setProperty(
            '--app-font-size-root',
            overrides.typography.baseFontPx + 'px'
        );
    } else {
        r.removeProperty('--app-font-size-root'); // use theme default
    }

    if (overrides.typography?.useSystemFont !== undefined) {
        const useSystem = overrides.typography.useSystemFont;
        r.setProperty(
            '--app-font-sans-current',
            useSystem
                ? 'ui-sans-serif, system-ui, sans-serif'
                : '"VT323", ui-sans-serif, system-ui, sans-serif'
        );
        r.setProperty(
            '--app-font-heading-current',
            useSystem
                ? 'ui-sans-serif, system-ui, sans-serif'
                : '"Press Start 2P", ui-sans-serif, system-ui, sans-serif'
        );
    } else {
        r.removeProperty('--app-font-sans-current');
        r.removeProperty('--app-font-heading-current');
    }

    // 2. Apply color palette overrides
    if (overrides.colors?.enabled) {
        const colorMap: Array<[keyof typeof overrides.colors, string]> = [
            // Primary colors
            ['primary', '--md-primary'],
            ['onPrimary', '--md-on-primary'],
            ['primaryContainer', '--md-primary-container'],
            ['onPrimaryContainer', '--md-on-primary-container'],
            // Secondary colors
            ['secondary', '--md-secondary'],
            ['onSecondary', '--md-on-secondary'],
            ['secondaryContainer', '--md-secondary-container'],
            ['onSecondaryContainer', '--md-on-secondary-container'],
            // Tertiary colors
            ['tertiary', '--md-tertiary'],
            ['onTertiary', '--md-on-tertiary'],
            ['tertiaryContainer', '--md-tertiary-container'],
            ['onTertiaryContainer', '--md-on-tertiary-container'],
            // Error colors
            ['error', '--md-error'],
            ['onError', '--md-on-error'],
            ['errorContainer', '--md-error-container'],
            ['onErrorContainer', '--md-on-error-container'],
            // Surface colors
            ['surface', '--md-surface'],
            ['onSurface', '--md-on-surface'],
            ['surfaceVariant', '--md-surface-variant'],
            ['onSurfaceVariant', '--md-on-surface-variant'],
            ['inverseSurface', '--md-inverse-surface'],
            ['inverseOnSurface', '--md-inverse-on-surface'],
            // Outline colors
            ['outline', '--md-outline'],
            ['outlineVariant', '--md-outline-variant'],
        ];
        for (const [key, cssVar] of colorMap) {
            const val = overrides.colors[key];
            if (val && typeof val === 'string') r.setProperty(cssVar, val);
        }

        // Handle semantic colors separately (they use extended color tokens)
        if (overrides.colors.success) {
            r.setProperty(
                '--md-extended-color-success-color',
                overrides.colors.success
            );
        }
        if (overrides.colors.warning) {
            r.setProperty(
                '--md-extended-color-warning-color',
                overrides.colors.warning
            );
        }
    } else {
        // Remove overrides to let base theme values cascade
        r.removeProperty('--md-primary');
        r.removeProperty('--md-on-primary');
        r.removeProperty('--md-primary-container');
        r.removeProperty('--md-on-primary-container');
        r.removeProperty('--md-secondary');
        r.removeProperty('--md-on-secondary');
        r.removeProperty('--md-secondary-container');
        r.removeProperty('--md-on-secondary-container');
        r.removeProperty('--md-tertiary');
        r.removeProperty('--md-on-tertiary');
        r.removeProperty('--md-tertiary-container');
        r.removeProperty('--md-on-tertiary-container');
        r.removeProperty('--md-error');
        r.removeProperty('--md-on-error');
        r.removeProperty('--md-error-container');
        r.removeProperty('--md-on-error-container');
        r.removeProperty('--md-surface');
        r.removeProperty('--md-on-surface');
        r.removeProperty('--md-surface-variant');
        r.removeProperty('--md-on-surface-variant');
        r.removeProperty('--md-inverse-surface');
        r.removeProperty('--md-inverse-on-surface');
        r.removeProperty('--md-outline');
        r.removeProperty('--md-outline-variant');
        // Semantic colors (extended color tokens)
        r.removeProperty('--md-extended-color-success-color');
        r.removeProperty('--md-extended-color-warning-color');
    }

    // 3. Build merged backgrounds
    const mergedBackgrounds = buildMergedBackgrounds(
        baseBackgrounds,
        overrides
    );
    await applyThemeBackgrounds(mergedBackgrounds, {
        resolveToken: backgroundTokenResolver,
    });

    // 4. Apply background color overrides (if enabled)
    const themeBaseColor = mergedBackgrounds.content?.base?.color;
    const themeOverlayColor = mergedBackgrounds.content?.overlay?.color;
    const themeSidebarColor = mergedBackgrounds.sidebar?.color;

    if (overrides.backgrounds?.enabled) {
        const bgColorMap: Array<[string, string]> = [
            [
                overrides.backgrounds.content?.base?.color || '',
                '--app-content-bg-1-color',
            ],
            [
                overrides.backgrounds.content?.overlay?.color || '',
                '--app-content-bg-2-color',
            ],
            [
                overrides.backgrounds.sidebar?.color || '',
                '--app-sidebar-bg-color',
            ],
        ];
        for (const [color, cssVar] of bgColorMap) {
            if (color) r.setProperty(cssVar, color);
        }
    } else {
        if (!hasColor(themeBaseColor)) {
            r.removeProperty('--app-content-bg-1-color');
        }
        if (!hasColor(themeOverlayColor)) {
            r.removeProperty('--app-content-bg-2-color');
        }
        if (!hasColor(themeSidebarColor)) {
            r.removeProperty('--app-sidebar-bg-color');
        }
    }

    // 5. Handle gradient visibility (UI-specific)
    if (overrides.backgrounds?.headerGradient?.enabled !== undefined) {
        r.setProperty(
            '--app-header-gradient-display',
            overrides.backgrounds.headerGradient.enabled ? 'block' : 'none'
        );
    }
    if (overrides.backgrounds?.bottomNavGradient?.enabled !== undefined) {
        r.setProperty(
            '--app-bottomnav-gradient-display',
            overrides.backgrounds.bottomNavGradient.enabled ? 'block' : 'none'
        );
    }

    // 6. High-contrast pattern reduction
    if (overrides.ui?.reducePatternsInHighContrast && isHighContrastActive()) {
        clampBackgroundOpacities();
    }
}

function hasColor(value: string | null | undefined): boolean {
    return typeof value === 'string' && value.trim().length > 0;
}

function buildMergedBackgrounds(
    base: ThemeBackgrounds | undefined,
    overrides: UserThemeOverrides
): ThemeBackgrounds {
    const result: ThemeBackgrounds = {
        content: {
            base: { ...base?.content?.base },
            overlay: { ...base?.content?.overlay },
        },
        sidebar: { ...base?.sidebar },
        headerGradient: { ...base?.headerGradient },
        bottomNavGradient: { ...base?.bottomNavGradient },
    };

    // Merge user override layers
    if (overrides.backgrounds?.content?.base) {
        result.content = result.content || {};
        result.content.base = result.content.base || {};
        Object.assign(
            result.content.base,
            convertLayerToThemeFormat(overrides.backgrounds.content.base)
        );
    }
    if (overrides.backgrounds?.content?.overlay) {
        result.content = result.content || {};
        result.content.overlay = result.content.overlay || {};
        Object.assign(
            result.content.overlay,
            convertLayerToThemeFormat(overrides.backgrounds.content.overlay)
        );
    }
    if (overrides.backgrounds?.sidebar) {
        result.sidebar = result.sidebar || {};
        Object.assign(
            result.sidebar,
            convertLayerToThemeFormat(overrides.backgrounds.sidebar)
        );
    }

    return result;
}

interface LayerInput {
    url?: string | null;
    opacity?: number;
    fit?: boolean;
    sizePx?: number;
    repeat?: 'repeat' | 'no-repeat';
}

interface ThemeLayerFormat {
    image: string | null;
    opacity?: number;
    size?: string;
    repeat?: 'repeat' | 'no-repeat';
}

function convertLayerToThemeFormat(layer: LayerInput): ThemeLayerFormat {
    return {
        image: layer.url || null,
        opacity: layer.opacity,
        size: layer.fit
            ? 'cover'
            : layer.sizePx
            ? layer.sizePx + 'px'
            : undefined,
        repeat: layer.repeat,
    };
}

function isHighContrastActive(): boolean {
    if (!isBrowser()) return false;
    return /high-contrast/.test(document.documentElement.className);
}

function clampBackgroundOpacities() {
    const r = document.documentElement.style;
    const clamp = (v: string) => String(Math.min(parseFloat(v) || 0, 0.04));
    const vars = [
        '--app-content-bg-1-opacity',
        '--app-content-bg-2-opacity',
        '--app-sidebar-bg-1-opacity',
    ];
    for (const v of vars) {
        const current = r.getPropertyValue(v);
        if (current) r.setProperty(v, clamp(current));
    }
}
