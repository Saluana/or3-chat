import { ref } from 'vue';
import { defineNuxtPlugin, useAppConfig, useRuntimeConfig } from '#imports';
import { defu } from 'defu';
import type { CompiledTheme, ThemePlugin } from '~/theme/_shared/types';
import type { RuntimeResolver } from '~/theme/_shared/runtime-resolver';
import {
    applyThemeClasses,
    removeThemeClasses,
    loadThemeCSS,
    unloadThemeCSS,
} from '~/theme/_shared/css-selector-runtime';
import {
    applyThemeBackgrounds,
    createThemeBackgroundTokenResolver,
    revokeBackgroundBlobs,
} from '~/core/theme/backgrounds';
import {
    loadThemeManifest,
    loadThemeStylesheets,
    unloadThemeStylesheets,
    type ThemeManifestEntry,
} from '~/theme/_shared/theme-manifest';
import { iconRegistry } from '~/theme/_shared/icon-registry';
import { FALLBACK_THEME_NAME } from '~/theme/_shared/constants';
import { pickDefaultTheme } from '~/theme/_shared/default-theme';
import {
    ensureThemeLoaded,
    getResolver,
    loadTheme,
    setActiveThemeSafe,
    type ThemeLoaderState,
} from '~/theme/_shared/theme-loader';
import { readCookie, sanitizeThemeName } from '~/theme/_shared/theme-core';
import { setKvByName } from '~/db/kv';

// Helper to persist theme selection to KV for cross-device sync
const saveThemeToKv = (themeName: string) => {
    // Fire-and-forget - don't block theme application
    void setKvByName('theme_selection', themeName).catch((error) => {
        console.warn('[theme] Failed to save theme to KV:', error);
    });
};

// Module-level variable for page:finish debouncing
let pageFinishTimeout: ReturnType<typeof setTimeout> | null = null;

export default defineNuxtPlugin(async (nuxtApp) => {
    const THEME_CLASSES = [
        'light',
        'dark',
        'light-high-contrast',
        'dark-high-contrast',
        'light-medium-contrast',
        'dark-medium-contrast',
    ];

    const { entries: manifestEntries, errors: manifestErrors } =
        await loadThemeManifest();
    const themeManifest = new Map<string, ThemeManifestEntry>();
    for (const entry of manifestEntries) {
        themeManifest.set(entry.name, entry);
    }

    if (import.meta.dev && manifestErrors.length > 0) {
        console.warn(
            `[theme] ${manifestErrors.length} theme(s) failed to load from the manifest.`
        );
        for (const error of manifestErrors) {
            console.warn(
                `[theme] Failed to load theme at ${error.path}:`,
                error.error
            );
        }
    }

    const cleanupCallbacks: Array<() => void> = [];
    const registerCleanup = (fn: () => void) => {
        cleanupCallbacks.push(fn);
    };
    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            while (cleanupCallbacks.length > 0) {
                const cleanup = cleanupCallbacks.pop();
                try {
                    cleanup?.();
                } catch (error) {
                    console.error('[theme] cleanup failed', error);
                }
            }
        });
    }

    if (manifestEntries.length === 0 && import.meta.dev) {
        console.warn(
            `[theme] No theme definitions discovered. Falling back to "${FALLBACK_THEME_NAME}".`
        );
    }

    const appConfig = useAppConfig() as any;
    // Create a JSON snapshot of the original appConfig for restoration
    // This saves significant memory compared to deep cloning
    const baseAppConfigSnapshot = JSON.stringify(appConfig);

    const initialPatch = (nuxtApp.payload as any)?.data
        ?.__or3ThemeAppConfigPatch;
    if (initialPatch && typeof initialPatch === 'object') {
        Object.assign(appConfig, defu(initialPatch, appConfig));
    }

    registerCleanup(() => {
        // Restore from snapshot only on cleanup
        const restored = JSON.parse(baseAppConfigSnapshot);
        Object.assign(appConfig, restored);
    });
    const themeAppConfigOverrides = new Map<
        string,
        Record<string, any> | null
    >();

    const applyThemeUiConfig = (theme?: CompiledTheme | null) => {
        // Directly merge into appConfig.ui without extra cloning
        if (!appConfig.ui) {
            appConfig.ui = {};
        }
        if (theme?.ui) {
            appConfig.ui = defu(theme.ui, appConfig.ui);
        }
    };

    const applyThemeAppConfigPatch = (patch?: Record<string, any> | null) => {
        if (patch) {
            Object.assign(appConfig, defu(patch, appConfig));
        }
    };

    const runtimeConfig = useRuntimeConfig();
    const configuredDefaultTheme =
        typeof runtimeConfig.public?.branding?.defaultTheme === 'string' &&
        runtimeConfig.public?.branding?.defaultTheme !== 'system'
            ? runtimeConfig.public?.branding?.defaultTheme
            : null;
    const availableThemes = new Set(themeManifest.keys());
    const manifestDefaultName =
        manifestEntries.find((entry) => entry.isDefault)?.name ?? null;
    const defaultDecision = pickDefaultTheme({
        manifestNames: manifestEntries.map((entry) => entry.name),
        manifestDefaultName,
        configuredDefaultName: configuredDefaultTheme,
        fallbackThemeName: FALLBACK_THEME_NAME,
    });
    const DEFAULT_THEME = defaultDecision.defaultTheme;

    if (import.meta.dev) {
        for (const warning of defaultDecision.warnings) {
            console.warn(warning);
        }

        if (
            configuredDefaultTheme &&
            !sanitizeThemeName(configuredDefaultTheme, availableThemes)
        ) {
            console.warn(
                `[theme] Default theme "${configuredDefaultTheme}" not found. Falling back to "${DEFAULT_THEME}".`
            );
        }
    }

    // Previous default theme persistence keys
    const previousDefaultStorageKey = 'previousDefaultTheme';
    const previousDefaultCookieKey = 'or3_previous_default_theme';
    // Active theme persistence keys (declared early for migration logic)
    const activeThemeStorageKey = 'activeTheme';
    const activeThemeCookieKey = 'or3_active_theme';

    const readPreviousDefaultCookie = () =>
        readCookie(document.cookie, previousDefaultCookieKey);

    const writePreviousDefaultCookie = (themeName: string) => {
        document.cookie = `${previousDefaultCookieKey}=${encodeURIComponent(
            themeName
        )}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
    };

    const previousDefaultStored =
        localStorage.getItem(previousDefaultStorageKey) ||
        readPreviousDefaultCookie();

    // Auto-migrate if the default theme changed and user never explicitly chose a different theme
    // Conditions for migration:
    // 1. previousDefaultStored exists and is different from current DEFAULT_THEME
    // 2. activeTheme/localStorage choice equals previousDefaultStored OR is missing
    // 3. stored theme not explicitly set by user (heuristic: if activeTheme === previous default or no stored theme)
    // This prevents forcing a user off a theme they picked manually.

    const rawStoredActiveTheme = localStorage.getItem(activeThemeStorageKey);
    const shouldMigrateDefault =
        previousDefaultStored &&
        previousDefaultStored !== DEFAULT_THEME &&
        (!rawStoredActiveTheme ||
            rawStoredActiveTheme === previousDefaultStored);

    if (shouldMigrateDefault) {
        if (import.meta.dev) {
            console.info(
                `[theme] Default theme changed from "${previousDefaultStored}" to "${DEFAULT_THEME}". Auto-migrating user to new default.`
            );
        }
        // Clear any persisted active theme that matches old default so initialization uses new default
        if (rawStoredActiveTheme === previousDefaultStored) {
            localStorage.removeItem(activeThemeStorageKey);
        }
    }

    // Persist new default for future migration comparisons
    try {
        localStorage.setItem(previousDefaultStorageKey, DEFAULT_THEME);
        writePreviousDefaultCookie(DEFAULT_THEME);
    } catch (_) {
        // Ignore storage errors silently
    }

    const storageKey = 'theme';
    const root = document.documentElement;
    const themeBackgroundTokenResolver = createThemeBackgroundTokenResolver();

    const getSystemPref = () =>
        window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light';

    const apply = (name: string) => {
        for (const cls of THEME_CLASSES) root.classList.remove(cls);
        root.classList.add(name);
    };

    const read = () => localStorage.getItem(storageKey);
    const readActiveTheme = () =>
        localStorage.getItem(activeThemeStorageKey);
    const readActiveThemeCookie = () =>
        readCookie(document.cookie, activeThemeCookieKey);

    const writeActiveThemeCookie = (themeName: string) => {
        document.cookie = `${activeThemeCookieKey}=${encodeURIComponent(
            themeName
        )}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
    };

    const current = ref(read() || getSystemPref());
    apply(current.value);

    const set = (name: string) => {
        current.value = name;
        localStorage.setItem(storageKey, name);
        apply(name);
    };

    const toggle = () =>
        set(current.value.startsWith('dark') ? 'light' : 'dark');

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => {
        if (!read()) {
            current.value = e.matches ? 'dark' : 'light';
            apply(current.value);
        }
    };
    media.addEventListener('change', onChange);
    registerCleanup(() => media.removeEventListener('change', onChange));

    nuxtApp.hook('app:beforeMount', () => {
        current.value = read() || getSystemPref();
        apply(current.value);
    });

    // ===== REFINED THEME SYSTEM INTEGRATION =====
    // Load compiled theme configs and initialize resolvers

    // Registry of compiled themes and their resolvers
    const themeRegistry = new Map<string, CompiledTheme>();
    const resolverRegistry = new Map<string, RuntimeResolver>();
    const loadingThemes = new Map<string, Promise<CompiledTheme | null>>();
    const themeLoaderState: ThemeLoaderState = {
        themeRegistry,
        resolverRegistry,
        appConfigOverrides: themeAppConfigOverrides,
        loadingThemes,
    };
    registerCleanup(() => {
        if (typeof document === 'undefined') return;
        themeRegistry.forEach((theme, name) => {
            if (theme.cssSelectors) {
                removeThemeClasses(theme.cssSelectors);
            }
            if (theme.hasStyleSelectors) {
                unloadThemeCSS(name);
            }
        });
        themeManifest.forEach((entry) => {
            unloadThemeStylesheets(entry.name);
        });
        document
            .querySelectorAll('[data-theme-style]')
            .forEach((el) => el.remove());
        document.documentElement.removeAttribute('data-theme');
        for (const cls of THEME_CLASSES) {
            root.classList.remove(cls);
        }
        revokeBackgroundBlobs();
    });
    registerCleanup(() => {
        themeRegistry.clear();
        resolverRegistry.clear();
        loadingThemes.clear();
        themeAppConfigOverrides.clear();
        resolversVersion.value = 0;
    });

    const rawStoredTheme = readActiveTheme() || readActiveThemeCookie();
    const storedTheme = sanitizeThemeName(rawStoredTheme, availableThemes);

    // Active theme name (for refined theme system)
    const activeTheme = ref<string>(DEFAULT_THEME);
    const resolversVersion = ref(0);
    const bumpResolversVersion = () => {
        resolversVersion.value += 1;
    };

    /**
     * Load a theme configuration
     *
     * This loads the theme definition and compiles it at runtime.
     * The theme compiler has already validated the theme at build time.
     *
     * Security: themeName is validated against available themes to prevent path traversal
     */
    const loadThemeByName = async (
        themeName: string
    ): Promise<CompiledTheme | null> =>
        loadTheme(themeName, themeManifest, themeLoaderState, {
            isDev: import.meta.dev,
        });

    const ensureThemeReady = async (themeName: string): Promise<boolean> =>
        ensureThemeReady(themeName);

    /**
     * Get resolver for a specific theme
     *
     * This is used by the v-theme directive to resolve overrides.
     */
    const getThemeResolver = (themeName: string) =>
        getResolver(themeName, DEFAULT_THEME, themeLoaderState, {
            isDev: import.meta.dev,
        });

    /**
     * Cleanup theme resources when switching away from it
     * Keeps only the active theme and default theme loaded to save memory
     */
    const cleanupInactiveThemes = (activeThemeName: string) => {
        const themesToKeep = new Set([activeThemeName, DEFAULT_THEME]);

        const themesToDelete: string[] = [];
        for (const [themeName] of themeRegistry) {
            if (!themesToKeep.has(themeName)) {
                themesToDelete.push(themeName);
            }
        }

        for (const themeName of themesToDelete) {
            themeRegistry.delete(themeName);
            resolverRegistry.delete(themeName);
            iconRegistry.unregisterTheme(themeName);
            themeAppConfigOverrides.delete(themeName);
        }
    };

    /**
     * Set active theme (for refined theme system)
     *
     * This switches the active theme and persists the selection.
     */
    const setActiveTheme = async (themeName: string) => {
        if (availableThemes.size === 0) {
            if (import.meta.dev) {
                console.warn('[theme] No available themes to activate.');
            }
            return;
        }

        const sanitized = sanitizeThemeName(themeName, availableThemes);
        const requestedTheme = sanitized ?? '';

        const activation = await setActiveThemeSafe(requestedTheme, {
            availableThemes,
            defaultTheme: DEFAULT_THEME,
            previousTheme: activeTheme.value,
            ensureLoaded: ensureThemeReady,
        });

        if (!activation.ok) {
            if (import.meta.dev) {
                console.warn(
                    `[theme] Failed to activate theme "${themeName}". Keeping "${activeTheme.value}".`
                );
            }
            return;
        }

        if (sanitized && activation.activeTheme !== sanitized && import.meta.dev) {
            console.warn(
                `[theme] Using "${activation.activeTheme}" instead of "${sanitized}" due to load failure.`
            );
        }

        // Remove classes and stylesheets from previous theme
        const previousTheme = themeRegistry.get(activeTheme.value);
        if (previousTheme?.cssSelectors) {
            removeThemeClasses(previousTheme.cssSelectors);
        }

        if (previousTheme?.hasStyleSelectors) {
            unloadThemeCSS(previousTheme.name);
        }
        // Unload theme-specific stylesheets
        const previousManifest = themeManifest.get(activeTheme.value);
        if (previousManifest) {
            unloadThemeStylesheets(previousManifest.name);
        }

        activeTheme.value = activation.activeTheme;
        localStorage.setItem(activeThemeStorageKey, activation.activeTheme);
        saveThemeToKv(activation.activeTheme);
        writeActiveThemeCookie(activation.activeTheme);
        iconRegistry.setActiveTheme(activation.activeTheme);

        // Clean up inactive themes to save memory
        cleanupInactiveThemes(activation.activeTheme);

        // Load CSS file and apply classes for new theme
        const theme = themeRegistry.get(activation.activeTheme);
        const manifest = themeManifest.get(activation.activeTheme);
        const themePatch =
            themeAppConfigOverrides.get(activation.activeTheme) ?? null;
        applyThemeAppConfigPatch(themePatch);
        applyThemeUiConfig(theme ?? null);

        if (theme && manifest) {
            // Load theme-specific stylesheets (from stylesheets array)
            await loadThemeStylesheets(manifest);

            // Load CSS file (build-time generated styles from cssSelectors)
            if (theme.hasStyleSelectors) {
                await loadThemeCSS(activation.activeTheme);
            } else {
                unloadThemeCSS(activation.activeTheme);
            }

            // Set data-theme attribute (activates CSS selectors)
            document.documentElement.setAttribute(
                'data-theme',
                activation.activeTheme
            );

            // Apply runtime classes (Tailwind utilities)
            if (theme.cssSelectors) {
                applyThemeClasses(activation.activeTheme, theme.cssSelectors);
            }

            // Inject CSS variables if present
            if (theme.cssVariables) {
                injectThemeVariables(
                    activation.activeTheme,
                    theme.cssVariables
                );
            }

            await applyThemeBackgrounds(theme.backgrounds, {
                resolveToken: themeBackgroundTokenResolver,
            });
        }
        bumpResolversVersion();
    };

    // Initialize: ensure default theme is available
    try {
        await ensureThemeReady(DEFAULT_THEME);
    } catch (error) {
        if (import.meta.dev) {
            console.warn('[theme] Failed to load default theme.', error);
        }
    }

    const sanitizedStoredTheme = sanitizeThemeName(
        storedTheme,
        availableThemes
    );

    // If we migrated default, treat sanitizedStoredTheme as null so we adopt new default automatically
    const effectiveStoredTheme = shouldMigrateDefault
        ? null
        : sanitizedStoredTheme;

    if (effectiveStoredTheme && effectiveStoredTheme !== DEFAULT_THEME) {
        try {
            const available = await ensureThemeReady(effectiveStoredTheme);

            if (available) {
                activeTheme.value = effectiveStoredTheme;
                localStorage.setItem(
                    activeThemeStorageKey,
                    effectiveStoredTheme
                );
                writeActiveThemeCookie(effectiveStoredTheme);
            } else {
                if (import.meta.dev) {
                    console.warn(
                        `[theme] Stored theme "${rawStoredTheme}" unavailable. Falling back to "${DEFAULT_THEME}".`
                    );
                }
                activeTheme.value = DEFAULT_THEME;
                localStorage.setItem(activeThemeStorageKey, DEFAULT_THEME);
                writeActiveThemeCookie(DEFAULT_THEME);
            }
        } catch (error) {
            if (import.meta.dev) {
                console.warn(
                    `[theme] Failed to initialize stored theme "${storedTheme}". Falling back to "${DEFAULT_THEME}".`,
                    error
                );
            }
            activeTheme.value = DEFAULT_THEME;
            localStorage.setItem(activeThemeStorageKey, DEFAULT_THEME);
            writeActiveThemeCookie(DEFAULT_THEME);
        }
    } else if (rawStoredTheme && !effectiveStoredTheme && import.meta.dev) {
        console.warn(
            `[theme] Ignoring stored theme "${rawStoredTheme}" because it is not registered.`
        );
    }

    const themeApi: ThemePlugin = {
        // Original theme API (for light/dark mode)
        set,
        toggle,
        get: () => current.value,
        system: getSystemPref,
        current, // expose ref for reactivity if needed

        // Refined theme system API (for theme variants)
        activeTheme, // Reactive ref to active theme name
        resolversVersion, // Bumps whenever a theme finishes applying
        setActiveTheme, // Function to switch themes
        getResolver: getThemeResolver, // Function to get resolver for a theme
        loadTheme: loadThemeByName, // Function to dynamically load a theme
        getTheme: (themeName: string) => themeRegistry.get(themeName) || null, // Get cached theme
    };

    nuxtApp.provide('theme', themeApi);

    // Ensure the determined active theme is applied on first load
    try {
        const currentAttr = document.documentElement.getAttribute('data-theme');
        // Always re-apply the theme on hydration to keep UI/app config in sync
        const initialTheme = activeTheme.value || currentAttr || DEFAULT_THEME;
        await themeApi.setActiveTheme(initialTheme);
    } catch (e) {
        if (import.meta.dev) {
            console.warn(
                '[theme] Failed to auto-apply active theme on init',
                e
            );
        }
    }

    // Auto-apply theme classes on page navigation (for lazy-loaded components)
    // Use a global flag to ensure hook is only registered once (prevents memory leak on HMR)
    const HOOK_REGISTERED_KEY = '__or3_theme_page_finish_registered';
    let unregisterPageFinish: (() => void) | null = null;
    if (!(globalThis as any)[HOOK_REGISTERED_KEY]) {
        (globalThis as any)[HOOK_REGISTERED_KEY] = true;

        // Debounce the page:finish handler to avoid excessive class applications
        unregisterPageFinish = nuxtApp.hook('page:finish', () => {
            if (import.meta.client) {
                // Clear any pending timeout
                if (pageFinishTimeout) {
                    clearTimeout(pageFinishTimeout);
                }
                
                // Debounce by 100ms to batch multiple rapid navigations
                pageFinishTimeout = setTimeout(() => {
                    pageFinishTimeout = null;
                    const nuxtApp = (globalThis as any).useNuxtApp?.();
                    const themePlugin = nuxtApp?.$theme as ThemePlugin | undefined;
                    if (!themePlugin) return;

                    const theme = themePlugin.getTheme?.(
                        themePlugin.activeTheme.value
                    );
                    if (theme?.cssSelectors) {
                        applyThemeClasses(
                            themePlugin.activeTheme.value,
                            theme.cssSelectors
                        );
                    }
                }, 100);
            }
        });
    }
    registerCleanup(() => {
        if (pageFinishTimeout) {
            clearTimeout(pageFinishTimeout);
            pageFinishTimeout = null;
        }
        unregisterPageFinish?.();
        unregisterPageFinish = null;
        delete (globalThis as any)[HOOK_REGISTERED_KEY];
    });
});

// Maintain one <style> element per theme for CSS vars
const THEME_STYLE_ID_PREFIX = 'or3-theme-vars-';
function injectThemeVariables(themeName: string, css: string) {
    if (typeof document === 'undefined' || !document.head) {
        return;
    }
    const safeThemeName = themeName.replace(/[^a-z0-9-_]/gi, '-');
    const id = THEME_STYLE_ID_PREFIX + safeThemeName;
    let style = document.getElementById(id) as HTMLStyleElement | null;
    if (!style) {
        style = document.createElement('style');
        style.id = id;
        style.setAttribute('data-theme-style', themeName);
        document.head.appendChild(style);
    }
    style.textContent = css.replace(/<\/style/gi, '<\\/style');
}
