import { ref, type Ref } from 'vue';
import { RuntimeResolver } from '~/theme/_shared/runtime-resolver';
import type { CompiledTheme } from '~/theme/_shared/types';
import { compileOverridesRuntime } from '~/theme/_shared/runtime-compile';
import {
    applyThemeClasses,
    removeThemeClasses,
    loadThemeCSS,
} from '~/theme/_shared/css-selector-runtime';
import {
    applyThemeBackgrounds,
    createThemeBackgroundTokenResolver,
} from '~/core/theme/backgrounds';

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

    const DEFAULT_THEME = 'retro';

    const storageKey = 'theme';
    const activeThemeStorageKey = 'activeTheme';
    const activeThemeCookieKey = 'or3_active_theme';
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

    nuxtApp.hook('app:beforeMount', () => {
        current.value = read() || getSystemPref();
        apply(current.value);
    });

    // Cleanup for HMR in dev so we don't stack listeners
    if (import.meta.hot) {
        import.meta.hot.dispose(() =>
            media.removeEventListener('change', onChange)
        );
    }

    // ===== REFINED THEME SYSTEM INTEGRATION =====
    // Load compiled theme configs and initialize resolvers

    // Registry of compiled themes and their resolvers
    const themeRegistry = new Map<string, CompiledTheme>();
    const resolverRegistry = new Map<string, RuntimeResolver>();

    const sanitizeThemeName = (themeName: string | null) => {
        if (!themeName) return null;
        return /^[a-z0-9-]+$/i.test(themeName) ? themeName : null;
    };

    const storedTheme = sanitizeThemeName(
        readActiveTheme() || readActiveThemeCookie()
    );

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
            // Validate theme name to prevent path traversal attacks
            // Only allow alphanumeric characters and hyphens
            if (!/^[a-z0-9-]+$/i.test(themeName)) {
                if (import.meta.dev) {
                    console.warn(`[theme] Invalid theme name: "${themeName}"`);
                }
                return null;
            }

            // Dynamic import of theme definition
            const themeModule = await import(
                `~/theme/${themeName}/theme.ts`
            ).catch(() => null);

            if (themeModule?.default) {
                const definition = themeModule.default;

                // Create a simple compiled theme from the definition
                // The full compilation happened at build time for validation
                const compiledTheme: CompiledTheme = {
                    name: definition.name,
                    displayName: definition.displayName,
                    description: definition.description,
                    // CSS variables are generated by the theme compiler at build time
                    // and included in the theme's styles.css file, so we don't need to
                    // generate them again at runtime
                    cssVariables: '',
                    overrides: compileOverridesRuntime(
                        definition.overrides || {}
                    ),
                    cssSelectors: definition.cssSelectors,
                    ui: definition.ui,
                    propMaps: definition.propMaps,
                    backgrounds: definition.backgrounds,
                };

                themeRegistry.set(themeName, compiledTheme);

                // Initialize resolver for this theme
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
        const target = sanitizeThemeName(themeName) || DEFAULT_THEME;

        const available = await ensureThemeLoaded(target);

        if (!available) {
            if (import.meta.dev) {
                console.warn(
                    `[theme] Failed to load theme "${target}". Falling back to "${DEFAULT_THEME}".`
                );
            }

            activeTheme.value = DEFAULT_THEME;
            localStorage.setItem(activeThemeStorageKey, DEFAULT_THEME);
            writeActiveThemeCookie(DEFAULT_THEME);
            await ensureThemeLoaded(DEFAULT_THEME);
            return;
        }

        // Remove classes from previous theme
        const previousTheme = themeRegistry.get(activeTheme.value);
        if (previousTheme?.cssSelectors) {
            removeThemeClasses(previousTheme.cssSelectors);
        }

        activeTheme.value = target;
        localStorage.setItem(activeThemeStorageKey, target);
        writeActiveThemeCookie(target);

        // Load CSS file and apply classes for new theme
        const theme = themeRegistry.get(target);
        if (theme) {
            // Load CSS file (build-time generated styles)
            await loadThemeCSS(target);

            // Set data-theme attribute (activates CSS selectors)
            document.documentElement.setAttribute('data-theme', target);

            // Apply runtime classes (Tailwind utilities)
            if (theme.cssSelectors) {
                applyThemeClasses(target, theme.cssSelectors);
            }

            // Inject CSS variables if present
            if (theme.cssVariables) {
                // TODO: Inject CSS variables into document
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

    if (storedTheme && storedTheme !== DEFAULT_THEME) {
        try {
            const available = await ensureThemeLoaded(storedTheme);

            if (available) {
                activeTheme.value = storedTheme;
                localStorage.setItem(activeThemeStorageKey, storedTheme);
                writeActiveThemeCookie(storedTheme);
            } else {
                if (import.meta.dev) {
                    console.warn(
                        `[theme] Stored theme "${storedTheme}" unavailable. Falling back to "${DEFAULT_THEME}".`
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
    };

    nuxtApp.provide('theme', themeApi);

    // Auto-apply theme classes on page navigation (for lazy-loaded components)
    nuxtApp.hook('page:finish', () => {
        if (import.meta.client) {
            const theme = themeRegistry.get(activeTheme.value);
            if (theme?.cssSelectors) {
                // Use nextTick to ensure DOM is ready
                import('vue').then(({ nextTick }) => {
                    nextTick(() => {
                        applyThemeClasses(
                            activeTheme.value,
                            theme.cssSelectors!
                        );
                    });
                });
            }
        }
    });
});
