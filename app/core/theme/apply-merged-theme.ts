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
import type {
    ThemeBackgrounds,
    ThemeBackgroundSlots,
} from '../../theme/_shared/types';
import type { ThemePlugin } from '~/plugins/90.theme.client';
import { COLOR_TOKEN_REGISTRY } from '~/theme/_shared/design-token-registry';
import {
    applyThemeBackgrounds,
    createThemeBackgroundTokenResolver,
} from './backgrounds';
import { isBrowser } from '~/utils/env';
const backgroundTokenResolver = createThemeBackgroundTokenResolver();

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
    overrides: UserThemeOverrides,
    themePlugin?: ThemePlugin,
    shouldCommit?: () => boolean
) {
    if (!isBrowser()) return;

    // Get active base theme (from theme plugin registry)
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
        if (typeof themePlugin.loadTheme !== 'function') return;
        theme = (await themePlugin.loadTheme(activeThemeName)) ?? null;
    }
    if (shouldCommit && !shouldCommit()) return;

    if (!theme) {
        console.warn('[apply-merged-theme] Failed to resolve theme');
        return;
    }

    // Get base theme backgrounds from loaded theme
    const baseBackgrounds = resolveModeBackgrounds(theme.backgrounds, mode);

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
                : 'var(--font-sans)'
        );
        r.setProperty(
            '--app-font-heading-current',
            useSystem
                ? 'ui-sans-serif, system-ui, sans-serif'
                : 'var(--font-heading)'
        );
    } else {
        r.removeProperty('--app-font-sans-current');
        r.removeProperty('--app-font-heading-current');
    }

    // 2. Apply color palette overrides
    if (overrides.colors?.enabled) {
        for (const [key, cssVar] of Object.entries(COLOR_TOKEN_REGISTRY)) {
            const val = (overrides.colors as Record<string, unknown>)[key];
            if (val && typeof val === 'string') r.setProperty(cssVar, val);
            else r.removeProperty(cssVar);
        }
    } else {
        // Remove overrides to let base theme values cascade
        for (const cssVar of Object.values(COLOR_TOKEN_REGISTRY)) {
            r.removeProperty(cssVar);
        }
    }

    // 3. Build merged backgrounds
    const mergedBackgrounds = buildMergedBackgrounds(
        baseBackgrounds,
        overrides
    );
    await applyThemeBackgrounds(mergedBackgrounds, {
        resolveToken: backgroundTokenResolver,
        shouldCommit,
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
    } else r.removeProperty('--app-header-gradient-display');
    if (overrides.backgrounds?.bottomNavGradient?.enabled !== undefined) {
        r.setProperty(
            '--app-bottomnav-gradient-display',
            overrides.backgrounds.bottomNavGradient.enabled ? 'block' : 'none'
        );
    } else r.removeProperty('--app-bottomnav-gradient-display');
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

    if (overrides.ui?.reducePatternsInHighContrast && isHighContrastActive()) {
        for (const layer of [
            result.content?.base,
            result.content?.overlay,
            result.sidebar,
        ]) {
            if (layer?.opacity !== undefined) {
                layer.opacity = Math.min(layer.opacity, 0.04);
            }
        }
    }

    return result;
}

function resolveModeBackgrounds(
    base: ThemeBackgrounds | undefined,
    mode: 'light' | 'dark'
): ThemeBackgrounds | undefined {
    if (!base) return undefined;
    if (mode !== 'dark' || !base.dark) {
        return {
            content: {
                base: { ...base.content?.base },
                overlay: { ...base.content?.overlay },
            },
            sidebar: { ...base.sidebar },
            headerGradient: { ...base.headerGradient },
            bottomNavGradient: { ...base.bottomNavGradient },
        };
    }

    const dark = base.dark as ThemeBackgroundSlots;

    return {
        content: {
            base: { ...base.content?.base, ...dark.content?.base },
            overlay: { ...base.content?.overlay, ...dark.content?.overlay },
        },
        sidebar: { ...base.sidebar, ...dark.sidebar },
        headerGradient: { ...base.headerGradient, ...dark.headerGradient },
        bottomNavGradient: {
            ...base.bottomNavGradient,
            ...dark.bottomNavGradient,
        },
    };
}

interface LayerInput {
    url?: string | null;
    opacity?: number;
    fit?: boolean;
    sizePx?: number;
    repeat?: 'repeat' | 'no-repeat';
}

interface ThemeLayerFormat {
    image?: string | null;
    opacity?: number;
    size?: string;
    repeat?: 'repeat' | 'no-repeat';
}

function convertLayerToThemeFormat(layer: LayerInput): ThemeLayerFormat {
    const result: ThemeLayerFormat = {};
    if ('url' in layer) result.image = layer.url;
    if (layer.opacity !== undefined) result.opacity = layer.opacity;
    if (layer.fit !== undefined || layer.sizePx !== undefined) {
        result.size = layer.fit
            ? 'cover'
            : layer.sizePx !== undefined
            ? `${layer.sizePx}px`
            : undefined;
    }
    if (layer.repeat !== undefined) result.repeat = layer.repeat;
    return result;
}

function isHighContrastActive(): boolean {
    if (!isBrowser()) return false;
    return /high-contrast/.test(document.documentElement.className);
}
