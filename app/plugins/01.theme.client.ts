import { ref, nextTick, type Ref } from 'vue';
import { RuntimeResolver } from '~/theme/_shared/runtime-resolver';
import type { CompiledTheme } from '~/theme/_shared/types';
import { compileOverridesRuntime } from '~/theme/_shared/runtime-compile';
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
    updateManifestEntry,
    loadThemeAppConfig,
    type ThemeManifestEntry,
} from '~/theme/_shared/theme-manifest';
import { generateThemeCssVariables } from '~/theme/_shared/generate-css-variables';
import { iconRegistry } from '~/theme/_shared/icon-registry';

export interface ThemePlugin {
    set: (name: string) => void;
    toggle: () => void;
    get: () => string;
    system: () => string;
    current: Ref<string>;
    activeTheme: Ref<string>;
    setActiveTheme: (themeName: string) => Promise<void>;
    getResolver: (themeName: string) => RuntimeResolver | null;
    loadTheme: (themeName: string) => Promise<CompiledTheme | null>;
    getTheme: (themeName: string) => CompiledTheme | null;
}

export default defineNuxtPlugin(async (nuxtApp) => {
    const THEME_CLASSES = [
        'light',
        'dark',
        'light-high-contrast',
        'dark-high-contrast',
        'light-medium-contrast',
        'dark-medium-contrast',
    ];

    const manifestEntries = await loadThemeManifest();
    const themeManifest = new Map<string, ThemeManifestEntry>();
    for (const entry of manifestEntries) {
        themeManifest.set(entry.name, entry);
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
            '[theme] No theme definitions discovered. Falling back to "retro".'
        );
    }

    const appConfig = useAppConfig() as any;
    const baseAppConfig = cloneDeep(appConfig);
    registerCleanup(() => {
        replaceObject(appConfig, cloneDeep(baseAppConfig));
    });
    const themeAppConfigOverrides = new Map<
        string,
        Record<string, any> | null
    >();

    const applyThemeUiConfig = (theme?: CompiledTheme | null) => {
        const baseUi = cloneDeep(appConfig.ui || {});
        const mergedUi = deepMerge(
            baseUi,
            (theme?.ui as Record<string, any> | undefined) || undefined
        );
        appConfig.ui = mergedUi;
    };

    const applyThemeAppConfigPatch = (patch?: Record<string, any> | null) => {
        const merged = deepMerge(cloneDeep(baseAppConfig), patch || undefined);
        replaceObject(appConfig, merged);
    };

    // Determine current default theme from manifest
    const DEFAULT_THEME =
        manifestEntries.find((entry) => entry.isDefault)?.name ??
        manifestEntries[0]?.name ??
        'retro';

    // Previous default theme persistence keys
    const previousDefaultStorageKey = 'previousDefaultTheme';
    const previousDefaultCookieKey = 'or3_previous_default_theme';
    // Active theme persistence keys (declared early for migration logic)
    const activeThemeStorageKey = 'activeTheme';
    const activeThemeCookieKey = 'or3_active_theme';

    const readPreviousDefaultCookie = () => {
        const match = document.cookie.match(
            new RegExp(`(?:^|; )${previousDefaultCookieKey}=([^;]*)`)
        );
        return match && match[1] ? decodeURIComponent(match[1]) : null;
    };

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

    const availableThemes = new Set(themeManifest.keys());

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

    const read = () => localStorage.getItem(storageKey) as string | null;
    const readActiveTheme = () =>
        localStorage.getItem(activeThemeStorageKey) as string | null;
    const readActiveThemeCookie = () => {
        const match = document.cookie.match(
            new RegExp(`(?:^|; )${activeThemeCookieKey}=([^;]*)`)
        );
        return match && match[1] ? decodeURIComponent(match[1]) : null;
    };

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
        themeAppConfigOverrides.clear();
    });

    const sanitizeThemeName = (themeName: string | null) => {
        if (!themeName) return null;
        if (!/^[a-z0-9-]+$/i.test(themeName)) return null;
        if (!availableThemes.has(themeName)) return null;
        return themeName;
    };

    const rawStoredTheme = readActiveTheme() || readActiveThemeCookie();
    const storedTheme = sanitizeThemeName(rawStoredTheme);

    // Active theme name (for refined theme system)
    const activeTheme = ref<string>(DEFAULT_THEME);

    /**
     * Load a theme configuration
     *
     * This loads the theme definition and compiles it at runtime.
     * The theme compiler has already validated the theme at build time.
     *
     * Security: themeName is validated against available themes to prevent path traversal
     */
    const loadTheme = async (
        themeName: string
    ): Promise<CompiledTheme | null> => {
        try {
            const manifestEntry = themeManifest.get(themeName);

            if (!manifestEntry) {
                if (import.meta.dev) {
                    console.warn(
                        `[theme] Theme "${themeName}" is not registered.`
                    );
                }
                return null;
            }

            const themeModule = await manifestEntry.loader();

            if (themeModule?.default) {
                const definition = themeModule.default;
                updateManifestEntry(manifestEntry, definition);

                // Parallelize asset loading
                const stylesheetPromise = loadThemeStylesheets(
                    manifestEntry,
                    definition.stylesheets
                );

                let iconsPromise: Promise<any> = Promise.resolve(
                    definition.icons
                );
                if (!definition.icons && manifestEntry.iconsLoader) {
                    iconsPromise = manifestEntry
                        .iconsLoader()
                        .then((m) => m?.default || m)
                        .catch((e) => {
                            if (import.meta.dev) {
                                console.warn(
                                    `[theme] Failed to load icons for theme "${themeName}":`,
                                    e
                                );
                            }
                            return null;
                        });
                }

                const [_, themeIcons] = await Promise.all([
                    stylesheetPromise,
                    iconsPromise,
                ]);

                const hasStyleSelectors = manifestEntry.hasCssSelectorStyles;

                const compiledTheme: CompiledTheme = {
                    name: definition.name,
                    isDefault: manifestEntry.isDefault,
                    stylesheets: manifestEntry.stylesheets,
                    displayName: definition.displayName,
                    description: definition.description,
                    cssVariables: generateThemeCssVariables(definition),
                    overrides: compileOverridesRuntime(
                        definition.overrides || {}
                    ),
                    cssSelectors: definition.cssSelectors,
                    hasStyleSelectors,
                    ui: definition.ui,
                    propMaps: definition.propMaps,
                    backgrounds: definition.backgrounds,
                    icons: themeIcons,
                };

                themeRegistry.set(themeName, compiledTheme);

                // Register icons with the registry
                if (compiledTheme.icons) {
                    iconRegistry.registerTheme(themeName, compiledTheme.icons);
                }

                const themeSpecificConfig =
                    (await loadThemeAppConfig(manifestEntry)) ?? null;
                themeAppConfigOverrides.set(themeName, themeSpecificConfig);

                const resolver = new RuntimeResolver(compiledTheme);
                resolverRegistry.set(themeName, resolver);

                return compiledTheme;
            }
        } catch (error) {
            if (import.meta.dev) {
                console.warn(
                    `[theme] Failed to load theme "${themeName}":`,
                    error
                );
            }
        }

        return null;
    };

    const ensureThemeLoaded = async (themeName: string): Promise<boolean> => {
        if (resolverRegistry.has(themeName)) {
            return true;
        }

        if (themeRegistry.has(themeName)) {
            const cached = themeRegistry.get(themeName)!;
            const resolver = new RuntimeResolver(cached);
            resolverRegistry.set(themeName, resolver);
            return true;
        }

        const loaded = await loadTheme(themeName);
        return Boolean(loaded);
    };

    /**
     * Get resolver for a specific theme
     *
     * This is used by the v-theme directive to resolve overrides.
     */
    const getResolver = (themeName: string): RuntimeResolver | null => {
        // Return cached resolver if available
        if (resolverRegistry.has(themeName)) {
            return resolverRegistry.get(themeName)!;
        }

        // If theme is not loaded, try to load it synchronously
        // (This should rarely happen as themes are loaded on init)
        const theme = themeRegistry.get(themeName);
        if (theme) {
            const resolver = new RuntimeResolver(theme);
            resolverRegistry.set(themeName, resolver);
            return resolver;
        }

        if (
            themeName !== DEFAULT_THEME &&
            resolverRegistry.has(DEFAULT_THEME)
        ) {
            if (import.meta.dev) {
                console.warn(
                    `[theme] No resolver found for theme "${themeName}". Falling back to "${DEFAULT_THEME}".`
                );
            }
            return resolverRegistry.get(DEFAULT_THEME)!;
        }

        if (import.meta.dev) {
            console.warn(
                `[theme] No resolver found for theme "${themeName}". Theme may not be compiled.`
            );
        }

        return null;
    };

    /**
     * Set active theme (for refined theme system)
     *
     * This switches the active theme and persists the selection.
     */
    const setActiveTheme = async (themeName: string) => {
        let target = sanitizeThemeName(themeName);

        if (!target) {
            if (themeManifest.has(DEFAULT_THEME)) {
                target = DEFAULT_THEME;
            } else if (manifestEntries[0]) {
                target = manifestEntries[0].name;
            } else {
                if (import.meta.dev) {
                    console.warn('[theme] No available themes to activate.');
                }
                return;
            }
        }

        const available = await ensureThemeLoaded(target);

        if (!available) {
            if (import.meta.dev) {
                console.warn(
                    `[theme] Failed to load theme "${target}". Falling back to "${DEFAULT_THEME}".`
                );
            }

            const fallback = themeManifest.has(DEFAULT_THEME)
                ? DEFAULT_THEME
                : manifestEntries.find((entry) => entry.name !== target)?.name;

            if (!fallback) {
                return;
            }

            activeTheme.value = fallback;
            localStorage.setItem(activeThemeStorageKey, fallback);
            writeActiveThemeCookie(fallback);
            await ensureThemeLoaded(fallback);
            iconRegistry.setActiveTheme(fallback);
            const fallbackPatch = themeAppConfigOverrides.get(fallback) ?? null;
            applyThemeAppConfigPatch(fallbackPatch);
            applyThemeUiConfig(themeRegistry.get(fallback) || null);
            return;
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

        activeTheme.value = target;
        localStorage.setItem(activeThemeStorageKey, target);
        writeActiveThemeCookie(target);
        iconRegistry.setActiveTheme(target);

        // Load CSS file and apply classes for new theme
        const theme = themeRegistry.get(target);
        const manifest = themeManifest.get(target);
        const themePatch = themeAppConfigOverrides.get(target) ?? null;
        applyThemeAppConfigPatch(themePatch);
        applyThemeUiConfig(theme ?? null);

        if (theme && manifest) {
            // Load theme-specific stylesheets (from stylesheets array)
            await loadThemeStylesheets(manifest);

            // Load CSS file (build-time generated styles from cssSelectors)
            if (theme.hasStyleSelectors) {
                await loadThemeCSS(target);
            } else {
                unloadThemeCSS(target);
            }

            // Set data-theme attribute (activates CSS selectors)
            document.documentElement.setAttribute('data-theme', target);

            // Apply runtime classes (Tailwind utilities)
            if (theme.cssSelectors) {
                applyThemeClasses(target, theme.cssSelectors);
            }

            // Inject CSS variables if present
            if (theme.cssVariables) {
                injectThemeVariables(target, theme.cssVariables);
            }

            await applyThemeBackgrounds(theme.backgrounds, {
                resolveToken: themeBackgroundTokenResolver,
            });
        }
    };

    // Initialize: ensure default theme is available
    try {
        await ensureThemeLoaded(DEFAULT_THEME);
    } catch (error) {
        if (import.meta.dev) {
            console.warn('[theme] Failed to load default theme.', error);
        }
    }

    const sanitizedStoredTheme = sanitizeThemeName(storedTheme);

    // If we migrated default, treat sanitizedStoredTheme as null so we adopt new default automatically
    const effectiveStoredTheme = shouldMigrateDefault
        ? null
        : sanitizedStoredTheme;

    if (effectiveStoredTheme && effectiveStoredTheme !== DEFAULT_THEME) {
        try {
            const available = await ensureThemeLoaded(effectiveStoredTheme);

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
        setActiveTheme, // Function to switch themes
        getResolver, // Function to get resolver for a theme
        loadTheme, // Function to dynamically load a theme
        getTheme: (themeName: string) => themeRegistry.get(themeName) || null, // Get cached theme
    };

    nuxtApp.provide('theme', themeApi);

    // Ensure the determined active theme is applied on first load
    try {
        const currentAttr = document.documentElement.getAttribute('data-theme');
        if (activeTheme.value && currentAttr !== activeTheme.value) {
            await themeApi.setActiveTheme(activeTheme.value);
        } else if (!currentAttr) {
            await themeApi.setActiveTheme(activeTheme.value || DEFAULT_THEME);
        }
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
    if (!(globalThis as any)[HOOK_REGISTERED_KEY]) {
        (globalThis as any)[HOOK_REGISTERED_KEY] = true;

        nuxtApp.hook('page:finish', () => {
            if (import.meta.client) {
                const nuxtApp = (globalThis as any).useNuxtApp?.();
                const themePlugin = nuxtApp?.$theme as ThemePlugin | undefined;
                if (!themePlugin) return;

                const theme = themePlugin.getTheme?.(
                    themePlugin.activeTheme.value
                );
                if (theme?.cssSelectors) {
                    nextTick(() => {
                        applyThemeClasses(
                            themePlugin.activeTheme.value,
                            theme.cssSelectors!
                        );
                    });
                }
            }
        });
    }
    registerCleanup(() => {
        delete (globalThis as any)[HOOK_REGISTERED_KEY];
    });
});

// Maintain one <style> element per theme for CSS vars
const THEME_STYLE_ID_PREFIX = 'or3-theme-vars-';
function injectThemeVariables(themeName: string, css: string) {
    const id = THEME_STYLE_ID_PREFIX + themeName;
    let style = document.getElementById(id) as HTMLStyleElement | null;
    if (!style) {
        style = document.createElement('style');
        style.id = id;
        style.setAttribute('data-theme-style', themeName);
        document.head.appendChild(style);
    }
    style.textContent = css;
}

function cloneDeep<T>(value: T): T {
    if (value === undefined || value === null) {
        return value;
    }

    if (typeof globalThis.structuredClone === 'function') {
        try {
            return globalThis.structuredClone(value);
        } catch {
            // Fallback below
        }
    }

    return JSON.parse(JSON.stringify(value));
}

function deepMerge(
    base: Record<string, any>,
    patch?: Record<string, any>
): Record<string, any> {
    if (!patch) {
        return base;
    }

    for (const [key, value] of Object.entries(patch)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            const current = base[key];
            base[key] = deepMerge(
                current &&
                    typeof current === 'object' &&
                    !Array.isArray(current)
                    ? current
                    : {},
                value as Record<string, any>
            );
        } else if (value !== undefined) {
            base[key] = value;
        }
    }

    return base;
}

function replaceObject(
    target: Record<string, any>,
    source: Record<string, any>
) {
    for (const key of Object.keys(target)) {
        if (!(key in source)) {
            delete target[key];
        }
    }
    for (const [key, value] of Object.entries(source)) {
        target[key] = value;
    }
}
