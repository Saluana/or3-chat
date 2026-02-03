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
    loadingThemes: Map<string, Promise<CompiledTheme | null>>;
}

export interface ThemeLoadState {
    loadedThemes: Set<string>;
    loadingThemes: Map<string, Promise<boolean>>;
}

export interface ThemeActivationResult {
    ok: boolean;
    activeTheme: string;
    reason:
        | 'requested'
        | 'requested-invalid'
        | 'requested-load-failed-fallback'
        | 'fallback-load-failed-kept-previous';
    error?: unknown;
}

export async function loadTheme(
    themeName: string,
    themeManifest: Map<string, ThemeManifestEntry>,
    state: ThemeLoaderState,
    options: ThemeLoaderOptions = {}
): Promise<CompiledTheme | null> {
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

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (!definition) {
            if (options.isDev) {
                console.warn(
                    `[theme] Theme "${themeName}" has no default export.`
                );
            }
            return null;
        }

        updateManifestEntry(manifestEntry, definition);

        await loadThemeStylesheets(manifestEntry, definition.stylesheets);

        let themeIcons = definition.icons;
        if (!themeIcons && manifestEntry.iconsLoader) {
            try {
                const iconsModule = await manifestEntry.iconsLoader();
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

        state.themeRegistry.set(themeName, compiledTheme);

        if (compiledTheme.icons) {
            iconRegistry.registerTheme(themeName, compiledTheme.icons);
        }

        const themeSpecificConfig =
            (await loadThemeAppConfig(manifestEntry)) ?? null;
        state.appConfigOverrides.set(themeName, themeSpecificConfig);

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

    const inFlight = state.loadingThemes.get(themeName);
    if (inFlight) {
        return Boolean(await inFlight);
    }

    const loadPromise = loadTheme(
        themeName,
        themeManifest,
        state,
        options
    ).finally(() => {
        state.loadingThemes.delete(themeName);
    });
    state.loadingThemes.set(themeName, loadPromise);
    const loaded = await loadPromise;
    return Boolean(loaded);
}

export function getResolver(
    themeName: string,
    defaultTheme: string,
    state: ThemeLoaderState,
    options: ThemeLoaderOptions = {}
): RuntimeResolver | null {
    if (state.resolverRegistry.has(themeName)) {
        return state.resolverRegistry.get(themeName)!;
    }

    if (state.themeRegistry.has(themeName)) {
        const resolver = new RuntimeResolver(state.themeRegistry.get(themeName)!);
        state.resolverRegistry.set(themeName, resolver);
        return resolver;
    }

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

export function getTheme(
    themeName: string,
    state: ThemeLoaderState
): CompiledTheme | null {
    return state.themeRegistry.get(themeName) || null;
}

export async function setActiveThemeSafe(
    requested: string,
    opts: {
        availableThemes: Set<string>;
        defaultTheme: string;
        previousTheme: string;
        ensureLoaded: (name: string) => Promise<boolean>;
    }
): Promise<ThemeActivationResult> {
    try {
        const isRequestedAvailable = opts.availableThemes.has(requested);
        const initialTarget = isRequestedAvailable
            ? requested
            : opts.defaultTheme;

        if (!initialTarget) {
            return {
                ok: false,
                activeTheme: opts.previousTheme,
                reason: 'fallback-load-failed-kept-previous',
            };
        }

        const loaded = await opts.ensureLoaded(initialTarget);
        if (loaded) {
            return {
                ok: true,
                activeTheme: initialTarget,
                reason: isRequestedAvailable ? 'requested' : 'requested-invalid',
            };
        }

        const fallback = opts.defaultTheme;
        if (fallback && fallback !== initialTarget) {
            const fallbackLoaded = await opts.ensureLoaded(fallback);
            if (fallbackLoaded) {
                return {
                    ok: true,
                    activeTheme: fallback,
                    reason: isRequestedAvailable
                        ? 'requested-load-failed-fallback'
                        : 'requested-invalid',
                };
            }
        }

        return {
            ok: false,
            activeTheme: opts.previousTheme,
            reason: 'fallback-load-failed-kept-previous',
        };
    } catch (error) {
        return {
            ok: false,
            activeTheme: opts.previousTheme,
            reason: 'fallback-load-failed-kept-previous',
            error,
        };
    }
}
