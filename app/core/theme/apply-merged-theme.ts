/**
 * @module app/core/theme/apply-merged-theme
 *
 * Purpose:
 * Applies the final merged theme to the DOM by setting CSS custom properties
 * on `document.documentElement.style`. Merges the base theme (loaded from the
 * theme plugin registry) with user overrides (typography, colors, backgrounds).
 *
 * Responsibilities:
 * - Apply typography overrides (font size and independent font choices)
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
import { resolveUserFontStack } from './font-options';
import type {
    ThemeBackgrounds,
    ThemeBackgroundSlots,
} from '../../theme/_shared/types';
import type { ThemePlugin } from '~/plugins/90.theme.client';
import {
    COLOR_TOKEN_ALIASES,
    COLOR_TOKEN_REGISTRY,
} from '~/theme/_shared/design-token-registry';
import {
    applyThemeBackgrounds,
    createThemeBackgroundTokenResolver,
} from './backgrounds';
import { isBrowser } from '~/utils/env';
import {
    DENSITY_TOKEN_VARIABLES,
    ELEVATION_TOKEN_VARIABLES,
    getDensityPresetTokens,
    getElevationPresetTokens,
} from './theme-token-presets';
const backgroundTokenResolver = createThemeBackgroundTokenResolver();

interface MergedThemeApplicationState {
    themeName: string;
    mode: 'light' | 'dark';
    contrastClass: string;
    typography: string;
    shape: string;
    density: string;
    elevation: string;
    colors: string;
    backgrounds: string;
    ui: string;
}

let lastAppliedState: MergedThemeApplicationState | null = null;

/** Reset module state for isolated DOM tests. */
export function __resetMergedThemeApplicationState(): void {
    lastAppliedState = null;
}

function sectionSignature(value: unknown): string {
    return JSON.stringify(value ?? null);
}

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

    const r = document.documentElement.style;
    const nextState: MergedThemeApplicationState = {
        themeName: activeThemeName,
        mode,
        contrastClass:
            document.documentElement.className.match(/(?:high|medium)-contrast/)?.[0] ?? '',
        typography: sectionSignature(overrides.typography),
        shape: sectionSignature(overrides.shape),
        density: sectionSignature(overrides.density),
        elevation: sectionSignature(overrides.elevation),
        colors: sectionSignature(overrides.colors),
        backgrounds: sectionSignature(overrides.backgrounds),
        ui: sectionSignature(overrides.ui),
    };
    const previous = lastAppliedState;

    if (!previous || previous.typography !== nextState.typography) {
        applyTypographyOverrides(r, overrides);
    }
    if (!previous || previous.shape !== nextState.shape) {
        applyShapeOverrides(r, overrides);
    }
    if (!previous || previous.density !== nextState.density) {
        applyDensityOverrides(r, overrides);
    }
    if (!previous || previous.elevation !== nextState.elevation) {
        applyElevationOverrides(r, overrides);
    }
    if (!previous || previous.colors !== nextState.colors) {
        applyColorOverrides(r, overrides);
    }

    const backgroundsChanged =
        !previous ||
        previous.themeName !== nextState.themeName ||
        previous.mode !== nextState.mode ||
        previous.contrastClass !== nextState.contrastClass ||
        previous.backgrounds !== nextState.backgrounds ||
        previous.ui !== nextState.ui;
    if (backgroundsChanged) {
        const baseBackgrounds = resolveModeBackgrounds(theme.backgrounds, mode);
        const committed = await applyBackgroundOverrides(
            r,
            baseBackgrounds,
            overrides,
            shouldCommit
        );
        if (!committed) return;
    }

    lastAppliedState = nextState;
}

function applyTypographyOverrides(
    style: CSSStyleDeclaration,
    overrides: UserThemeOverrides
): void {
    if (overrides.typography?.baseFontPx) {
        style.setProperty(
            '--app-font-size-root',
            `${overrides.typography.baseFontPx}px`
        );
    } else {
        style.removeProperty('--app-font-size-root');
    }

    const legacyFontChoice = overrides.typography?.useSystemFont
        ? 'system'
        : 'theme';
    const bodyFontChoice = overrides.typography?.bodyFont;
    const headingFontChoice = overrides.typography?.headingFont;
    if (
        bodyFontChoice !== undefined ||
        overrides.typography?.useSystemFont !== undefined
    ) {
        style.setProperty(
            '--app-font-sans-current',
            resolveUserFontStack(bodyFontChoice ?? legacyFontChoice, 'body')
        );
    } else {
        style.removeProperty('--app-font-sans-current');
    }
    if (
        headingFontChoice !== undefined ||
        overrides.typography?.useSystemFont !== undefined
    ) {
        style.setProperty(
            '--app-font-heading-current',
            resolveUserFontStack(
                headingFontChoice ?? legacyFontChoice,
                'heading'
            )
        );
    } else {
        style.removeProperty('--app-font-heading-current');
    }
}

function applyShapeOverrides(
    style: CSSStyleDeclaration,
    overrides: UserThemeOverrides
): void {
    if (overrides.shape?.enabled) {
        applyPixelOverride(
            style,
            '--md-border-width-subtle',
            overrides.shape.borderWidthSubtlePx
        );
        applyPixelOverride(
            style,
            '--md-border-width',
            overrides.shape.borderWidthPx
        );
        applyPixelOverride(
            style,
            '--md-border-width-strong',
            overrides.shape.borderWidthStrongPx
        );
        applyPixelOverride(
            style,
            '--md-border-radius-small',
            overrides.shape.borderRadiusSmallPx
        );
        applyPixelOverride(
            style,
            '--md-border-radius',
            overrides.shape.borderRadiusPx
        );
        applyPixelOverride(
            style,
            '--md-border-radius-large',
            overrides.shape.borderRadiusLargePx
        );
    } else {
        for (const property of [
            '--md-border-width',
            '--md-border-radius',
            '--md-border-width-subtle',
            '--md-border-width-strong',
            '--md-border-radius-small',
            '--md-border-radius-large',
        ]) {
            style.removeProperty(property);
        }
    }
}

function applyColorOverrides(
    style: CSSStyleDeclaration,
    overrides: UserThemeOverrides
): void {
    if (overrides.colors?.enabled) {
        for (const [key, cssVar] of Object.entries(COLOR_TOKEN_REGISTRY)) {
            const value = (overrides.colors as Record<string, unknown>)[key];
            const targets = [
                cssVar,
                ...(COLOR_TOKEN_ALIASES[
                    key as keyof typeof COLOR_TOKEN_REGISTRY
                ] ?? []),
            ];
            for (const target of targets) {
                if (value && typeof value === 'string') {
                    style.setProperty(target, value);
                } else {
                    style.removeProperty(target);
                }
            }
        }
        return;
    }

    const overrideVariables = new Set([
        ...Object.values(COLOR_TOKEN_REGISTRY),
        ...Object.values(COLOR_TOKEN_ALIASES).flatMap(
            (aliases) => aliases ?? []
        ),
    ]);
    for (const cssVar of overrideVariables) style.removeProperty(cssVar);
}

async function applyBackgroundOverrides(
    style: CSSStyleDeclaration,
    baseBackgrounds: ThemeBackgrounds | undefined,
    overrides: UserThemeOverrides,
    shouldCommit?: () => boolean
): Promise<boolean> {
    const mergedBackgrounds = buildMergedBackgrounds(
        baseBackgrounds,
        overrides
    );
    await applyThemeBackgrounds(mergedBackgrounds, {
        resolveToken: backgroundTokenResolver,
        shouldCommit,
    });
    if (shouldCommit && !shouldCommit()) return false;

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
            if (color) style.setProperty(cssVar, color);
        }
    } else {
        if (!hasColor(themeBaseColor)) {
            style.removeProperty('--app-content-bg-1-color');
        }
        if (!hasColor(themeOverlayColor)) {
            style.removeProperty('--app-content-bg-2-color');
        }
        if (!hasColor(themeSidebarColor)) {
            style.removeProperty('--app-sidebar-bg-color');
        }
    }

    if (overrides.backgrounds?.headerGradient?.enabled !== undefined) {
        style.setProperty(
            '--app-header-gradient-display',
            overrides.backgrounds.headerGradient.enabled ? 'block' : 'none'
        );
    } else {
        style.removeProperty('--app-header-gradient-display');
    }
    if (overrides.backgrounds?.bottomNavGradient?.enabled !== undefined) {
        style.setProperty(
            '--app-bottomnav-gradient-display',
            overrides.backgrounds.bottomNavGradient.enabled ? 'block' : 'none'
        );
    } else {
        style.removeProperty('--app-bottomnav-gradient-display');
    }
    return true;
}

function applyDensityOverrides(
    style: CSSStyleDeclaration,
    overrides: UserThemeOverrides
): void {
    const tokens = overrides.density?.enabled
        ? getDensityPresetTokens(overrides.density.preset)
        : null;
    applyTokenMap(style, DENSITY_TOKEN_VARIABLES, tokens);
    if (tokens && isBrowser()) {
        document.documentElement.dataset.density = overrides.density?.preset!;
    } else if (isBrowser()) {
        delete document.documentElement.dataset.density;
    }
}

function applyElevationOverrides(
    style: CSSStyleDeclaration,
    overrides: UserThemeOverrides
): void {
    const tokens = overrides.elevation?.enabled
        ? getElevationPresetTokens(overrides.elevation.preset)
        : null;
    applyTokenMap(style, ELEVATION_TOKEN_VARIABLES, tokens);
    if (tokens && isBrowser()) {
        document.documentElement.dataset.elevation = overrides.elevation?.preset!;
    } else if (isBrowser()) {
        delete document.documentElement.dataset.elevation;
    }
}

function applyTokenMap(
    style: CSSStyleDeclaration,
    variables: readonly string[],
    tokens: Readonly<Record<string, string>> | null
): void {
    for (const variable of variables) {
        const value = tokens?.[variable];
        if (value) style.setProperty(variable, value);
        else style.removeProperty(variable);
    }
}

function applyPixelOverride(
    style: CSSStyleDeclaration,
    variable: string,
    value: number | undefined
): void {
    if (value !== undefined) style.setProperty(variable, `${value}px`);
    else style.removeProperty(variable);
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
