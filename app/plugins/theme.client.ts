import { ref, readonly } from 'vue';
import sharedBaseCssUrl from '~/theme/_shared/base.css?url';

// Simple LRU cache implementation
class LRUCache<K, V> {
    private cache = new Map<K, V>();
    private maxSize: number;

    constructor(maxSize: number = 3) {
        this.maxSize = maxSize;
    }

    get(key: K): V | undefined {
        const value = this.cache.get(key);
        if (value !== undefined) {
            // Move to end (most recently used)
            this.cache.delete(key);
            this.cache.set(key, value);
        }
        return value;
    }

    set(key: K, value: V): void {
        if (this.cache.has(key)) {
            // Update existing
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            // Remove least recently used (first item)
            const iterator = this.cache.keys().next();
            if (!iterator.done) {
                this.cache.delete(iterator.value);
            }
        }
        this.cache.set(key, value);
    }

    has(key: K): boolean {
        return this.cache.has(key);
    }

    clear(): void {
        this.cache.clear();
    }

    size(): number {
        return this.cache.size;
    }
}

import {
    discoverThemes,
    loadTheme,
    type ThemeManifest,
    type ThemeError,
    type ThemeWarning,
    type ThemeLoadResult,
} from '~/theme/_shared/theme-loader';

export default defineNuxtPlugin((nuxtApp) => {
    const ensureBaseCssInjected = () => {
        const linkId = 'theme-shared-base';
        if (document.getElementById(linkId)) {
            return;
        }

        const linkElement = document.createElement('link');
        linkElement.id = linkId;
        linkElement.rel = 'stylesheet';
        linkElement.href = sharedBaseCssUrl;
        linkElement.setAttribute('data-theme-shared', 'true');
        document.head.appendChild(linkElement);
    };
    const THEME_CLASSES = [
        'light',
        'dark',
        'light-high-contrast',
        'dark-high-contrast',
        'light-medium-contrast',
        'dark-medium-contrast',
    ];

    const themeStorageKey = 'theme';
    const activeThemeStorageKey = 'activeTheme';
    const root = document.documentElement;

    // Theme discovery and state
    const availableThemes = ref<ThemeManifest[]>([]);
    const activeTheme = ref<string>('default');
    const errors = ref<ThemeError[]>([]);
    const warnings = ref<ThemeWarning[]>([]);

    // LRU cache for loaded themes (size 3 as requested)
    const themeCache = new LRUCache<string, ThemeLoadResult>(3);

    const getSystemPref = () =>
        window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light';

    // Initialize theme discovery
    const initializeThemes = async () => {
        try {
            availableThemes.value = discoverThemes();
            console.log(
                '[theme] Discovered themes:',
                availableThemes.value.map((t) => t.name)
            );
        } catch (err) {
            console.error('[theme] Failed to discover themes:', err);
            errors.value.push({
                file: 'theme-discovery',
                message: `Theme discovery failed: ${
                    err instanceof Error ? err.message : 'Unknown error'
                }`,
                severity: 'error',
            });
        }
    };

    // Read active theme from localStorage
    const readActiveTheme = () => {
        const stored = localStorage.getItem(activeThemeStorageKey);
        return stored || 'default';
    };

    // Read theme mode from localStorage
    const readThemeMode = () => {
        const stored = localStorage.getItem(themeStorageKey);
        return stored || getSystemPref();
    };

    // Apply theme mode class
    const apply = (name: string) => {
        for (const cls of THEME_CLASSES) root.classList.remove(cls);
        root.classList.add(name);
    };

    // Inject CSS into the page
    const injectThemeCSS = (css: string, themeName: string, mode: string) => {
        const styleId = `theme-${themeName}-${mode}`;
        let styleElement = document.getElementById(styleId) as HTMLStyleElement;

        if (!styleElement) {
            ensureBaseCssInjected();
            styleElement = document.createElement('style');
            styleElement.id = styleId;
            styleElement.setAttribute('data-theme', themeName);
            styleElement.setAttribute('data-mode', mode);
            document.head.appendChild(styleElement);
        }

        styleElement.textContent = css;
    };

    // Remove theme CSS from the page
    const removeThemeCSS = (themeName: string) => {
        const styleElements = document.querySelectorAll(
            `style[data-theme="${themeName}"]`
        );
        styleElements.forEach((el) => el.remove());
    };

    // Load and validate theme (injects CSS into page)
    const loadAndValidateTheme = async (
        themeName: string,
        injectCss = true
    ) => {
        try {
            errors.value = [];
            warnings.value = [];

            // Check cache first
            const cached = themeCache.get(themeName);
            if (cached) {
                console.log(`[theme] Loaded "${themeName}" from cache`);

                // Separate critical errors from warnings
                const criticalErrors = cached.errors.filter(
                    (e) => e.severity === 'error'
                );
                const warningErrors = cached.errors.filter(
                    (e) => e.severity === 'warning'
                );

                errors.value = criticalErrors;
                warnings.value = [...cached.warnings, ...warningErrors];

                // Log warnings but don't block
                warnings.value.forEach((warning) => {
                    console.warn('[theme]', warning.message, warning.file);
                });

                // Log and surface critical errors
                criticalErrors.forEach((error) => {
                    console.error('[theme]', error.message, error.file);
                });

                // Only inject CSS if requested (default true for backwards compatibility)
                if (injectCss) {
                    // Inject CSS even with warnings (not critical errors)
                    if (cached.lightCss) {
                        injectThemeCSS(cached.lightCss, themeName, 'light');
                    }

                    if (cached.darkCss) {
                        injectThemeCSS(cached.darkCss, themeName, 'dark');
                    }

                    if (cached.mainCss) {
                        injectThemeCSS(cached.mainCss, themeName, 'main');
                    }
                }

                return cached;
            }

            // Load from disk if not in cache
            const result = await loadTheme(themeName);

            // Cache the result
            themeCache.set(themeName, result);
            console.log(
                `[theme] Loaded "${themeName}" from disk and cached (cache size: ${themeCache.size()})`
            );

            // Separate critical errors from warnings
            const criticalErrors = result.errors.filter(
                (e) => e.severity === 'error'
            );
            const warningErrors = result.errors.filter(
                (e) => e.severity === 'warning'
            );

            errors.value = criticalErrors;
            warnings.value = [...result.warnings, ...warningErrors];

            // Log warnings but don't block
            warnings.value.forEach((warning) => {
                console.warn('[theme]', warning.message, warning.file);
            });

            // Log and surface critical errors
            criticalErrors.forEach((error) => {
                console.error('[theme]', error.message, error.file);
            });

            // Only inject CSS if requested (default true for backwards compatibility)
            if (injectCss) {
                // Inject CSS even with warnings (not critical errors)
                if (result.lightCss) {
                    injectThemeCSS(result.lightCss, themeName, 'light');
                }

                if (result.darkCss) {
                    injectThemeCSS(result.darkCss, themeName, 'dark');
                }

                if (result.mainCss) {
                    injectThemeCSS(result.mainCss, themeName, 'main');
                }
            }

            return result;
        } catch (err) {
            const error: ThemeError = {
                file: themeName,
                message: `Failed to load theme: ${
                    err instanceof Error ? err.message : 'Unknown error'
                }`,
                severity: 'error',
            };

            errors.value = [error];
            console.error('[theme]', error.message);

            return null;
        }
    };

    // Initialize current theme mode
    const current = ref(readThemeMode());
    apply(current.value);

    // Initialize active theme
    activeTheme.value = readActiveTheme();

    // Add ready state tracking
    const isReady = ref(false);

    // Defer async work (don't await)
    const readyPromise = (async () => {
        try {
            await initializeThemes();
            await loadAndValidateTheme(activeTheme.value);
            isReady.value = true;
        } catch (err) {
            console.error('[theme] Init failed:', err);
        }
    })();

    const set = (name: string) => {
        current.value = name;
        localStorage.setItem(themeStorageKey, name);
        apply(name);
    };

    const toggle = () =>
        set(current.value.startsWith('dark') ? 'light' : 'dark');

    // Switch to a different theme (now works dynamically without reload)
    const switchTheme = async (themeName: string) => {
        // Validate theme exists
        const theme = availableThemes.value.find((t) => t.name === themeName);
        if (!theme) {
            console.error(
                `[theme] Theme "${themeName}" not found. Available themes:`,
                availableThemes.value.map((t) => t.name)
            );
            return false;
        }

        const oldTheme = activeTheme.value;
        let cssInjected = false;

        try {
            // Load and validate theme first (don't inject CSS yet)
            const result = await loadAndValidateTheme(themeName, false);

            const criticalErrors =
                result?.errors.filter((e) => e.severity === 'error') ?? [];

            if (!result || criticalErrors.length > 0) {
                throw new Error(
                    `Theme "${themeName}" has ${criticalErrors.length} critical errors`
                );
            }

            // Inject CSS only after validation passes
            if (result.lightCss) {
                injectThemeCSS(result.lightCss, themeName, 'light');
            }
            if (result.darkCss) {
                injectThemeCSS(result.darkCss, themeName, 'dark');
            }
            if (result.mainCss) {
                injectThemeCSS(result.mainCss, themeName, 'main');
            }
            cssInjected = true;

            // Remove old theme CSS
            if (oldTheme && oldTheme !== themeName) {
                removeThemeCSS(oldTheme);
            }

            // Store the active theme
            activeTheme.value = themeName;
            localStorage.setItem(activeThemeStorageKey, themeName);

            // Apply the current mode to ensure correct CSS is active
            apply(current.value);

            return true;
        } catch (err) {
            console.error(`[theme] Failed to switch to ${themeName}:`, err);

            // Rollback: remove any CSS we injected
            if (cssInjected) {
                removeThemeCSS(themeName);
            }

            return false;
        }
    };

    // Reload current theme
    const reloadTheme = async () => {
        const result = await loadAndValidateTheme(activeTheme.value);
        return result !== null;
    };

    // Listen for system preference changes
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => {
        if (!readThemeMode()) {
            current.value = e.matches ? 'dark' : 'light';
            apply(current.value);
        }
    };
    media.addEventListener('change', onChange);

    nuxtApp.hook('app:beforeMount', () => {
        // Only sync the mode (light/dark) from localStorage and apply it
        // Don't reload themes - they're already loaded during plugin init
        const storedMode = readThemeMode();
        const storedTheme = readActiveTheme();

        // Only update if values changed (avoid unnecessary operations)
        if (current.value !== storedMode) {
            current.value = storedMode;
        }
        if (activeTheme.value !== storedTheme) {
            activeTheme.value = storedTheme;
        }

        // Apply the current mode to update HTML class
        apply(current.value);
    });

    // Cleanup for HMR in dev so we don't stack listeners
    if (import.meta.hot) {
        import.meta.hot.dispose(() =>
            media.removeEventListener('change', onChange)
        );
    }

    nuxtApp.provide('theme', {
        // Existing API
        set,
        toggle,
        get: () => current.value,
        system: getSystemPref,
        current, // expose ref for reactivity if needed

        // New multi-theme API
        activeTheme,
        availableThemes,
        switchTheme,
        reloadTheme,
        errors,
        warnings,

        // Ready state for components that need to wait
        ready: readyPromise,
        isReady: readonly(isReady),

        // Utility methods
        validateTheme: async (themeName: string) => {
            // Validate without injecting CSS (just check for errors/warnings)
            return await loadAndValidateTheme(themeName, false);
        },

        // Get theme manifest by name
        getThemeManifest: (themeName: string) => {
            return availableThemes.value.find((t) => t.name === themeName);
        },

        // Cache management methods
        clearCache: () => {
            themeCache.clear();
            console.log('[theme] Cache cleared');
        },

        getCacheSize: () => {
            return themeCache.size();
        },

        getCacheInfo: () => {
            return {
                size: themeCache.size(),
                maxSize: 3,
                description: 'LRU cache for loaded themes',
            };
        },
    });
});
