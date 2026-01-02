/**
 * Shared theme utilities used by both client and server plugins
 * Consolidates duplicated logic to reduce code bloat
 */

import { RuntimeResolver } from './runtime-resolver';
import { compileOverridesRuntime } from './runtime-compile';
import { generateThemeCssVariables } from './generate-css-variables';
import { iconRegistry } from './icon-registry';
import {
    loadThemeStylesheets,
    updateManifestEntry,
    loadThemeAppConfig,
    type ThemeManifestEntry,
} from './theme-manifest';
import type { CompiledTheme } from './types';

// ============================================================================
// Deep Clone / Merge Utilities
// ============================================================================

/**
 * Deep clone a value using structuredClone when available, falling back to JSON
 */
export function cloneDeep<T>(value: T): T {
    if (value === undefined || value === null) {
        return value;
    }

    if (typeof globalThis.structuredClone === 'function') {
        try {
            return globalThis.structuredClone(value);
        } catch {
            // ignore - fall through to JSON method
        }
    }

    return JSON.parse(JSON.stringify(value));
}

/**
 * Deep merge patch into base object (mutates base)
 */
export function deepMerge(
    base: Record<string, unknown>,
    patch?: Record<string, unknown>
): Record<string, unknown> {
    if (!patch) {
        return base;
    }

    for (const [key, value] of Object.entries(patch)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            const current = base[key] as Record<string, unknown> | undefined;
            base[key] = deepMerge(
                current &&
                    typeof current === 'object' &&
                    !Array.isArray(current)
                    ? current
                    : {},
                value as Record<string, unknown>
            );
        } else if (value !== undefined) {
            base[key] = value;
        }
    }

    return base;
}

/**
 * Recursively update target with source values (in-place mutation)
 */
export function recursiveUpdate(
    target: Record<string, unknown>,
    source: Record<string, unknown>
): void {
    for (const [key, value] of Object.entries(source)) {
        if (value !== undefined) {
            const targetValue = target[key];
            if (
                value &&
                typeof value === 'object' &&
                !Array.isArray(value) &&
                targetValue &&
                typeof targetValue === 'object' &&
                !Array.isArray(targetValue)
            ) {
                recursiveUpdate(
                    targetValue as Record<string, unknown>,
                    value as Record<string, unknown>
                );
            } else {
                target[key] = value;
            }
        }
    }
}

// ============================================================================
// Theme Name Validation
// ============================================================================

/**
 * Validate and sanitize a theme name
 * Returns null if the theme name is invalid or not available
 */
export function sanitizeThemeName(
    themeName: string | null,
    availableThemes: Set<string>
): string | null {
    if (!themeName) return null;
    // Only allow alphanumeric and hyphens (security: prevent path traversal)
    if (!/^[a-z0-9-]+$/i.test(themeName)) return null;
    if (!availableThemes.has(themeName)) return null;
    return themeName;
}

// ============================================================================
// Theme Loading Infrastructure
// ============================================================================

export interface ThemeLoaderOptions {
    /** Callback when a theme is loaded and registered */
    onThemeRegistered?: (themeName: string, theme: CompiledTheme) => void;
    /** Whether running in development mode */
    isDev?: boolean;
}

export interface ThemeLoaderState {
    themeRegistry: Map<string, CompiledTheme>;
    resolverRegistry: Map<string, RuntimeResolver>;
    appConfigOverrides: Map<string, Record<string, unknown> | null>;
}

/**
 * Load a theme by name, compiling it if not already cached
 */
export async function loadTheme(
    themeName: string,
    themeManifest: Map<string, ThemeManifestEntry>,
    state: ThemeLoaderState,
    options: ThemeLoaderOptions = {}
): Promise<CompiledTheme | null> {
    // Return cached if already loaded
    if (state.themeRegistry.has(themeName)) {
        return state.themeRegistry.get(themeName)!;
    }

    try {
        const manifestEntry = themeManifest.get(themeName);

        if (!manifestEntry) {
            if (options.isDev) {
                console.warn(`[theme] Theme "${themeName}" is not registered.`);
            }
            return null;
        }

        const themeModule = await manifestEntry.loader();
        const definition = themeModule.default;

        // Runtime check for dynamic imports - type says it exists but runtime may differ
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (!definition) {
            if (options.isDev) {
                console.warn(`[theme] Theme "${themeName}" has no default export.`);
            }
            return null;
        }

        updateManifestEntry(manifestEntry, definition);

        // Load stylesheets
        await loadThemeStylesheets(manifestEntry, definition.stylesheets);

        // Load icons if available
        let themeIcons = definition.icons;
        if (!themeIcons && manifestEntry.iconsLoader) {
            try {
                const iconsModule = await manifestEntry.iconsLoader();
                // ThemeIconsLoader returns { default: Record<string, string> }
                themeIcons = iconsModule.default;
            } catch (e) {
                if (options.isDev) {
                    console.warn(
                        `[theme] Failed to load icons for theme "${themeName}":`,
                        e
                    );
                }
            }
        }

        const compiledTheme: CompiledTheme = {
            name: definition.name,
            isDefault: manifestEntry.isDefault,
            stylesheets: manifestEntry.stylesheets,
            displayName: definition.displayName,
            description: definition.description,
            cssVariables: generateThemeCssVariables(definition),
            overrides: compileOverridesRuntime(definition.overrides || {}),
            cssSelectors: definition.cssSelectors,
            hasStyleSelectors: manifestEntry.hasCssSelectorStyles,
            ui: definition.ui,
            propMaps: definition.propMaps,
            backgrounds: definition.backgrounds,
            icons: themeIcons,
        };

        // Register in caches
        state.themeRegistry.set(themeName, compiledTheme);

        if (compiledTheme.icons) {
            iconRegistry.registerTheme(themeName, compiledTheme.icons);
        }

        // Load app config overrides
        const themeSpecificConfig =
            (await loadThemeAppConfig(manifestEntry)) ?? null;
        state.appConfigOverrides.set(themeName, themeSpecificConfig);

        // Create and cache resolver
        const resolver = new RuntimeResolver(compiledTheme);
        state.resolverRegistry.set(themeName, resolver);

        options.onThemeRegistered?.(themeName, compiledTheme);

        return compiledTheme;
    } catch (error) {
        if (options.isDev) {
            console.warn(`[theme] Failed to load theme "${themeName}":`, error);
        }
    }

    return null;
}

/**
 * Ensure a theme is loaded and has a resolver available
 */
export async function ensureThemeLoaded(
    themeName: string,
    themeManifest: Map<string, ThemeManifestEntry>,
    state: ThemeLoaderState,
    options: ThemeLoaderOptions = {}
): Promise<boolean> {
    if (state.resolverRegistry.has(themeName)) {
        return true;
    }

    if (state.themeRegistry.has(themeName)) {
        const cached = state.themeRegistry.get(themeName)!;
        const resolver = new RuntimeResolver(cached);
        state.resolverRegistry.set(themeName, resolver);
        return true;
    }

    const loaded = await loadTheme(themeName, themeManifest, state, options);
    return Boolean(loaded);
}

/**
 * Get the resolver for a theme, with optional fallback to default theme
 */
export function getResolver(
    themeName: string,
    defaultTheme: string,
    state: ThemeLoaderState,
    options: ThemeLoaderOptions = {}
): RuntimeResolver | null {
    // Check resolver cache first
    if (state.resolverRegistry.has(themeName)) {
        return state.resolverRegistry.get(themeName)!;
    }

    // Create resolver from cached theme
    if (state.themeRegistry.has(themeName)) {
        const resolver = new RuntimeResolver(state.themeRegistry.get(themeName)!);
        state.resolverRegistry.set(themeName, resolver);
        return resolver;
    }

    // Fallback to default theme
    if (themeName !== defaultTheme && state.resolverRegistry.has(defaultTheme)) {
        if (options.isDev) {
            console.warn(
                `[theme] No resolver found for theme "${themeName}". Falling back to "${defaultTheme}".`
            );
        }
        return state.resolverRegistry.get(defaultTheme)!;
    }

    if (options.isDev) {
        console.warn(
            `[theme] No resolver found for theme "${themeName}". Theme may not be compiled.`
        );
    }

    return null;
}

/**
 * Get a cached theme by name
 */
export function getTheme(
    themeName: string,
    state: ThemeLoaderState
): CompiledTheme | null {
    return state.themeRegistry.get(themeName) || null;
}

// ============================================================================
// Cookie Utilities
// ============================================================================

/**
 * Read a cookie value from a cookie header string (works on server and client)
 */
export function readCookie(
    cookieHeader: string | undefined,
    cookieName: string
): string | null {
    if (!cookieHeader) return null;

    const pairs = cookieHeader.split(';');
    for (const pair of pairs) {
        const [rawName, ...rest] = pair.trim().split('=');
        if (rawName === cookieName) {
            return decodeURIComponent(rest.join('='));
        }
    }

    return null;
}
