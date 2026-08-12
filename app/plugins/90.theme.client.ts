import { ref, shallowRef } from 'vue';
import {
    defineNuxtPlugin,
    onNuxtReady,
    useAppConfig,
    useRuntimeConfig,
} from '#imports';
import { RuntimeResolver } from '~/theme/_shared/runtime-resolver';
import type { CompiledTheme, ThemePlugin } from '~/theme/_shared/types';
import {
    applyThemeClasses,
    removeThemeClasses,
    deactivateThemeCSS,
    loadThemeCSS,
    unloadThemeCSS,
} from '~/theme/_shared/css-selector-runtime';
import { revokeBackgroundBlobs } from '~/core/theme/backgrounds';
import {
    loadThemeManifest,
    loadThemeStylesheets,
    deactivateThemeStylesheets,
    unloadThemeStylesheets,
    type ThemeManifestEntry,
} from '~/theme/_shared/theme-manifest';
import { prepareThemeEntry } from '~/theme/_shared/prepare-theme';
import { iconRegistry } from '~/theme/_shared/icon-registry';
import { useThemeSelection } from '~/composables/useThemeSelection';
import { pickDefaultTheme } from '~/theme/_shared/default-theme';
import { FALLBACK_THEME_NAME } from '~/theme/_shared/constants';
import { readCookie, sanitizeThemeName } from '~/theme/_shared/theme-core';
import {
    cloneDeep,
    computeEffectiveAppConfig,
    replaceReactiveObject,
} from '~/theme/_shared/theme-core';
import {
    ensureThemeLoaded as ensureThemeLoadedShared,
    setActiveThemeSafe,
    type ThemeLoadState,
} from '~/theme/_shared/theme-loader';
import {
    CORE_APP_COMPONENT_DEFAULTS,
    createThemeComponentMap,
} from '~/theme/_shared/theme-components-registry';
import {
    shouldReleasePreviousThemeResources,
    ThemeActivationCoordinator,
} from '~/theme/_shared/activation-transaction';

export type { ThemePlugin } from '~/theme/_shared/types';

export default defineNuxtPlugin(async (nuxtApp) => {
    const THEME_CLASSES = [
        'light',
        'dark',
        'light-high-contrast',
        'dark-high-contrast',
        'light-medium-contrast',
        'dark-medium-contrast',
    ];

    const manifestResult = await loadThemeManifest();
    const manifestEntries = manifestResult.entries;
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
            `[theme] No theme definitions discovered. Falling back to "${FALLBACK_THEME_NAME}".`
        );
    }

    const appConfig = useAppConfig() as any;
    // Create a JSON snapshot of the original appConfig for restoration
    // This saves significant memory compared to deep cloning
    const baseAppConfig = cloneDeep(appConfig) as Record<string, unknown>;

    const initialPatch = (nuxtApp.payload as any)?.data
        ?.__or3ThemeAppConfigPatch;
    const appliedThemeConfigKeys = new Set<string>();
    if (initialPatch && typeof initialPatch === 'object') {
        for (const key of Object.keys(initialPatch)) {
            appliedThemeConfigKeys.add(key);
        }
        replaceReactiveObject(
            appConfig,
            computeEffectiveAppConfig(baseAppConfig, { appPatch: initialPatch })
        );
    }

    registerCleanup(() => {
        // Restore from snapshot only on cleanup
        replaceReactiveObject(appConfig, baseAppConfig);
    });
    const themeAppConfigOverrides = new Map<
        string,
        Record<string, any> | null
    >();
    const effectiveAppConfigCache = new Map<
        string,
        Record<string, unknown>
    >();

    const applyEffectiveAppConfig = (
        theme?: CompiledTheme | null,
        patch?: Record<string, unknown> | null
    ) => {
        const cacheKey = theme?.name ?? '__base__';
        let effective = effectiveAppConfigCache.get(cacheKey);
        if (!effective) {
            effective = computeEffectiveAppConfig(baseAppConfig, {
                appPatch: patch,
                uiPatch: theme?.ui,
            });
            effectiveAppConfigCache.set(cacheKey, effective);
        }

        const nextKeys = new Set(Object.keys(patch ?? {}));
        if (theme?.ui) nextKeys.add('ui');
        const keysToUpdate = new Set([
            ...appliedThemeConfigKeys,
            ...nextKeys,
        ]);

        for (const key of keysToUpdate) {
            if (!(key in effective)) {
                delete appConfig[key];
                continue;
            }
            const current = appConfig[key];
            const value = effective[key];
            if (
                current &&
                value &&
                typeof current === 'object' &&
                typeof value === 'object' &&
                !Array.isArray(current) &&
                !Array.isArray(value)
            ) {
                replaceReactiveObject(
                    current as Record<string, unknown>,
                    value as Record<string, unknown>
                );
            } else if (!Object.is(current, value)) {
                appConfig[key] = cloneDeep(value);
            }
        }

        appliedThemeConfigKeys.clear();
        for (const key of nextKeys) appliedThemeConfigKeys.add(key);
    };

    const runtimeConfig = useRuntimeConfig();
    // Determine current default theme from manifest
    const configuredDefaultTheme = runtimeConfig.public?.branding?.defaultTheme;
    const normalizedConfiguredDefault =
        typeof configuredDefaultTheme === 'string' && configuredDefaultTheme !== 'system'
            ? configuredDefaultTheme
            : null;
    const availableThemes = new Set(themeManifest.keys());
    const manifestDefaultTheme = manifestEntries.find((entry) => entry.isDefault)?.name ?? null;
    const defaultDecision = pickDefaultTheme({
        manifestNames: manifestEntries.map((entry) => entry.name),
        manifestDefaultName: manifestDefaultTheme,
        configuredDefaultName: normalizedConfiguredDefault,
        fallbackThemeName: FALLBACK_THEME_NAME,
    });

    // Build disabled themes set from runtime config
    const rawDisabledThemes = (runtimeConfig.public as Record<string, unknown>).branding as Record<string, unknown> | undefined;
    const disabledThemesArray = rawDisabledThemes?.disabledThemes;
    const disabledThemes = new Set(
        Array.isArray(disabledThemesArray) ? (disabledThemesArray as string[]).filter(Boolean) : []
    );

    const DEFAULT_THEME = defaultDecision.defaultTheme;

    if (
        import.meta.dev &&
        normalizedConfiguredDefault &&
        !availableThemes.has(normalizedConfiguredDefault.toLowerCase())
    ) {
        console.warn(
            `[theme] Default theme "${normalizedConfiguredDefault}" not found. Falling back to "${DEFAULT_THEME}".`
        );
    }
    if (import.meta.dev) {
        for (const warning of defaultDecision.warnings) {
            console.warn(warning);
        }
        if (manifestResult.errors.length > 0) {
            console.warn('[theme] Manifest contained load errors.', manifestResult.errors);
        }
    }

    // Previous default theme persistence keys
    const previousDefaultStorageKey = 'previousDefaultTheme';
    const previousDefaultCookieKey = 'or3_previous_default_theme';
    // Active theme persistence keys (declared early for migration logic)
    const activeThemeStorageKey = 'activeTheme';
    const activeThemeCookieKey = 'or3_active_theme';

    const readPreviousDefaultCookie = () => {
        return readCookie(document.cookie, previousDefaultCookieKey);
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

    const storageKey = 'theme';
    const root = document.documentElement;
    const selectionRepository = useThemeSelection();
    await selectionRepository.ensureLoaded();

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
    const readActiveThemeCookie = () => {
        return readCookie(document.cookie, activeThemeCookieKey);
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
                removeThemeClasses(name);
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
        effectiveAppConfigCache.clear();
        appliedThemeConfigKeys.clear();
        resolversVersion.value = 0;
    });

    const sanitizeTheme = (themeName: string | null) =>
        sanitizeThemeName(themeName, availableThemes);

    const rawStoredTheme =
        selectionRepository.selectedTheme.value ||
        readActiveThemeCookie() ||
        readActiveTheme();
    const storedTheme = sanitizeTheme(rawStoredTheme);

    // Hydrate with the exact theme emitted by SSR. Persisted client state can
    // differ on a first request (for example, legacy localStorage exists but
    // its cookie has not been sent yet). Activating that preference here would
    // change component implementations and app config underneath hydration.
    const renderedTheme =
        sanitizeTheme(document.documentElement.getAttribute('data-theme')) ??
        DEFAULT_THEME;
    const activeTheme = ref<string>(renderedTheme);
    const activeComponents = shallowRef({
        ...CORE_APP_COMPONENT_DEFAULTS,
    });
    const resolversVersion = ref(0);
    const bumpResolversVersion = () => {
        resolversVersion.value += 1;
    };
    const loadState: ThemeLoadState = {
        loadedThemes: new Set<string>(),
        loadingThemes: new Map<string, Promise<boolean>>(),
    };
    const activationCoordinator = new ThemeActivationCoordinator();
    let appliedThemeName: string | null = null;
    const syncActiveComponents = () => {
        const theme = themeRegistry.get(activeTheme.value);
        const manifest = themeManifest.get(activeTheme.value);

        activeComponents.value =
            theme && manifest
                ? createThemeComponentMap(
                      manifest.dirName,
                      theme.customComponents
                  )
                : { ...CORE_APP_COMPONENT_DEFAULTS };
    };

    /**
     * Load a theme configuration
     *
     * This loads the theme definition and compiles it at runtime.
     * The theme compiler has already validated the theme at build time.
     *
     * Security: themeName is validated against available themes to prevent path traversal
     */
    const registerThemeFromEntry = async (manifestEntry: ThemeManifestEntry) => {
        const themeName = manifestEntry.name;
        if (themeRegistry.has(themeName)) {
            if (!resolverRegistry.has(themeName)) {
                resolverRegistry.set(
                    themeName,
                    new RuntimeResolver(themeRegistry.get(themeName)!)
                );
            }
            return;
        }

        const { compiledTheme, appConfig: themeSpecificConfig } =
            await prepareThemeEntry(manifestEntry);

        themeRegistry.set(themeName, compiledTheme);
        if (compiledTheme.icons) {
            iconRegistry.registerTheme(themeName, compiledTheme.icons);
        }
        themeAppConfigOverrides.set(themeName, themeSpecificConfig);
        resolverRegistry.set(themeName, new RuntimeResolver(compiledTheme));
    };

    const loadTheme = async (themeName: string): Promise<CompiledTheme | null> => {
        const loaded = await ensureThemeLoadedShared(themeName, {
            manifestByName: themeManifest,
            state: loadState,
            registerTheme: registerThemeFromEntry,
        });
        return loaded ? themeRegistry.get(themeName) ?? null : null;
    };

    const ensureThemeLoaded = async (themeName: string): Promise<boolean> => {
        const loaded = await ensureThemeLoadedShared(themeName, {
            manifestByName: themeManifest,
            state: loadState,
            registerTheme: registerThemeFromEntry,
        });
        if (loaded && !resolverRegistry.has(themeName) && themeRegistry.has(themeName)) {
            resolverRegistry.set(themeName, new RuntimeResolver(themeRegistry.get(themeName)!));
        }
        return loaded;
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
        const transaction = activationCoordinator.begin();
        const previousThemeName = activeTheme.value;
        let target = sanitizeTheme(themeName) ?? DEFAULT_THEME;

        if (!themeManifest.has(target) && manifestEntries[0]) {
            target = manifestEntries[0].name;
        }

        if (!themeManifest.has(target)) {
            if (import.meta.dev) {
                console.warn('[theme] No available themes to activate.');
            }
            return;
        }

        // Block switching to a disabled theme (unless it's the default — admin wouldn't disable the default)
        if (disabledThemes.has(target) && target !== DEFAULT_THEME) {
            if (import.meta.dev) {
                console.warn(`[theme] Theme "${target}" is disabled. Falling back to "${DEFAULT_THEME}".`);
            }
            target = DEFAULT_THEME;
        }

        if (target === activeTheme.value && appliedThemeName === target) {
            return;
        }

        const activation = await setActiveThemeSafe(target, {
            availableThemes,
            defaultTheme: DEFAULT_THEME,
            previousTheme: activeTheme.value,
            ensureLoaded: ensureThemeLoaded,
        });

        if (!transaction.isCurrent()) return;

        if (!activation.ok) {
            if (import.meta.dev) {
                console.warn(
                    `[theme] Failed to activate theme "${target}" (reason: ${activation.reason}).`
                );
            }
            return;
        }

        target = activation.activeTheme;

        const theme = themeRegistry.get(target);
        const manifest = themeManifest.get(target);
        if (theme && manifest) {
            await Promise.all([
                loadThemeStylesheets(manifest),
                theme.hasStyleSelectors
                    ? loadThemeCSS(target)
                    : Promise.resolve(),
            ]);
        }
        if (!transaction.isCurrent()) return;

        // A hydration re-apply may target the already-active theme. In that
        // case the links above are the active resources, not stale resources.
        if (
            shouldReleasePreviousThemeResources(previousThemeName, target)
        ) {
            const previousTheme = themeRegistry.get(previousThemeName);
            if (previousTheme?.cssSelectors) {
                removeThemeClasses(previousTheme.name);
            }

            if (previousTheme?.hasStyleSelectors) {
                deactivateThemeCSS(previousTheme.name);
            }

            const previousManifest = themeManifest.get(previousThemeName);
            if (previousManifest) {
                deactivateThemeStylesheets(previousManifest.name);
            }
        }

        activeTheme.value = target;
        localStorage.setItem(activeThemeStorageKey, target);
        void selectionRepository.setSelectedTheme(target);
        writeActiveThemeCookie(target);
        iconRegistry.setActiveTheme(target);

        // Loaded compiled themes remain cached; visual resources are managed separately.
        const themePatch = themeAppConfigOverrides.get(target) ?? null;
        applyEffectiveAppConfig(theme ?? null, themePatch);

        if (theme && manifest) {
            if (!theme.hasStyleSelectors) {
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

        }

        if (!transaction.isCurrent()) return;

        syncActiveComponents();

        bumpResolversVersion();
        appliedThemeName = target;
    };

    // Initialize: ensure default theme is available
    try {
        await ensureThemeLoaded(DEFAULT_THEME);
    } catch (error) {
        if (import.meta.dev) {
            console.warn('[theme] Failed to load default theme.', error);
        }
    }

    const sanitizedStoredTheme = sanitizeTheme(storedTheme);

    // If we migrated default, treat sanitizedStoredTheme as null so we adopt new default automatically
    const effectiveStoredTheme = shouldMigrateDefault
        ? null
        : sanitizedStoredTheme;
    let preferredTheme = DEFAULT_THEME;

    if (effectiveStoredTheme && effectiveStoredTheme !== DEFAULT_THEME) {
        try {
            const available = await ensureThemeLoaded(effectiveStoredTheme);

            if (available) {
                preferredTheme = effectiveStoredTheme;
            } else {
                if (import.meta.dev) {
                    console.warn(
                        `[theme] Stored theme "${rawStoredTheme}" unavailable. Falling back to "${DEFAULT_THEME}".`
                    );
                }
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
        getResolver, // Function to get resolver for a theme
        loadTheme, // Function to dynamically load a theme
        getTheme: (themeName: string) => themeRegistry.get(themeName) || null, // Get cached theme
        activeComponents,
        availableThemes: manifestEntries.map((entry) => ({
            name: entry.name,
            displayName: entry.displayName,
            description: entry.description,
        })),
    };

    nuxtApp.provide('theme', themeApi);

    // Apply only the server-rendered theme before hydration. Once Nuxt has
    // resolved the root suspense boundary, switch to a differing client
    // preference without corrupting the DOM Vue is hydrating.
    try {
        await themeApi.setActiveTheme(renderedTheme);
        if (preferredTheme !== renderedTheme) {
            onNuxtReady(() => {
                void themeApi.setActiveTheme(preferredTheme);
            });
        }
    } catch (e) {
        if (import.meta.dev) {
            console.warn(
                '[theme] Failed to auto-apply active theme on init',
                e
            );
        }
    }

});

// Maintain one <style> element per theme for CSS vars
const THEME_STYLE_ID_PREFIX = 'or3-theme-vars-';
function injectThemeVariables(themeName: string, css: string) {
    if (typeof document === 'undefined' || !document.head) {
        return;
    }
    const safeThemeName = themeName.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
    const id = THEME_STYLE_ID_PREFIX + safeThemeName;
    let style = document.getElementById(id) as HTMLStyleElement | null;
    if (!style) {
        style = document.createElement('style');
        style.id = THEME_STYLE_ID_PREFIX + safeThemeName;
        style.setAttribute('data-theme-style', safeThemeName);
        document.head.appendChild(style);
    }
    style.textContent = css.replace(/<\/style>/gi, '<\\/style>');
}
