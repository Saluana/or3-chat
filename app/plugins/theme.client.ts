import { ref, readonly } from 'vue';
import { useAppConfig } from '#imports';
import sharedBaseCssUrl from '~/theme/_shared/base.css?url';

// Import override system functions
import {
    getOverrideResolver,
    setOverrideResolver,
    clearOverrideResolver,
    type ComponentOverrides,
    type OverrideRule,
} from '~/theme/_shared/override-resolver';
import type { IdentifierOverride } from '~/theme/_shared/override-types';
import {
    validateComponentOverrides,
    logValidationErrors,
    type ValidationResult
} from '~/theme/_shared/override-validator';

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
import { mergeThemeConfig, type AppConfig } from '~/theme/_shared/config-merger';

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

    const appConfig = useAppConfig();
    const baseAppConfig = JSON.parse(JSON.stringify(appConfig)) as AppConfig;

    const replaceAppConfig = (next: AppConfig) => {
        const target = appConfig as Record<string, unknown>;
        for (const key of Object.keys(target)) {
            delete target[key];
        }
        Object.assign(target, JSON.parse(JSON.stringify(next)));
    };

    const applyThemeConfig = (themeConfig?: Partial<AppConfig>) => {
        if (!themeConfig) {
            replaceAppConfig(baseAppConfig);
            return;
        }

        const merged = mergeThemeConfig(baseAppConfig, themeConfig);
        replaceAppConfig(merged);
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

    const setThemeAttribute = (themeName?: string | null) => {
        if (themeName) {
            root.setAttribute('data-theme', themeName);
        } else {
            root.removeAttribute('data-theme');
        }
    };

    // Override system state
    const overrideStats = ref({
        resolverLoaded: false,
        rulesCount: 0,
        contextsCount: 0,
        lastInitTheme: '',
    });
    const currentOverrides = ref<ComponentOverrides | null>(null);

    // Initialize override system with theme config
    const initializeOverrides = (
        themeConfig?: Partial<AppConfig>,
        applyConfig = true,
        applyResolver = true,
        logContext?: string
    ) => {
        try {
            if (applyResolver) {
                clearOverrideResolver();
                overrideStats.value.resolverLoaded = false;
                currentOverrides.value = null;
            }

            if (applyConfig) {
                applyThemeConfig(themeConfig);
            }

            const overridesConfig = themeConfig?.componentOverrides;

            if (!overridesConfig) {
                if (applyResolver) {
                    console.log('[theme] No component overrides found in theme config');
                }
                return;
            }

            const validation = validateComponentOverrides(overridesConfig);

            if (!validation.valid || validation.warnings.length > 0) {
                logValidationErrors(
                    validation,
                    logContext ?? activeTheme.value
                );
            }

            if (!validation.valid) {
                console.error(
                    `[theme] Skipping override initialization due to validation errors in theme "${activeTheme.value}"`
                );
                if (applyConfig) {
                    applyThemeConfig();
                }
                return;
            }

            if (!applyResolver) {
                return;
            }

            setOverrideResolver(overridesConfig);
            currentOverrides.value = overridesConfig;

            const resolver = getOverrideResolver();
            if (resolver) {
                const overrides = overridesConfig;

                const countRules = (bucket: Record<string, OverrideRule[] | undefined> = {}) =>
                    Object.values(bucket).reduce(
                        (total, rules) => total + (Array.isArray(rules) ? rules.length : 0),
                        0,
                    );

                const rulesCount =
                    countRules(overrides.global) +
                    Object.values(overrides.contexts ?? {}).reduce(
                        (total, ctx) => total + countRules(ctx ?? {}),
                        0,
                    ) +
                    Object.values(overrides.states ?? {}).reduce(
                        (total, stateBucket) => total + countRules(stateBucket ?? {}),
                        0,
                    ) +
                    Object.keys(overrides.identifiers ?? {}).length;

                const contextsCount = Object.keys(overrides.contexts || {}).length;

                overrideStats.value = {
                    resolverLoaded: true,
                    rulesCount,
                    contextsCount,
                    lastInitTheme: activeTheme.value,
                };

            console.log(
                `[theme] Initialized overrides for "${activeTheme.value}":`,
                `${rulesCount} global rules, ${contextsCount} contexts`
            );
        }
        } catch (err) {
            console.error('[theme] Failed to initialize overrides:', err);
            // Clear stats on error
            overrideStats.value = {
                resolverLoaded: false,
                rulesCount: 0,
                contextsCount: 0,
                lastInitTheme: '',
            };
            currentOverrides.value = null;
            if (applyConfig) {
                applyThemeConfig();
            }
        }
    };

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

                // Initialize overrides from cached theme config
                initializeOverrides(cached.config, injectCss, injectCss, themeName);
                if (injectCss) {
                    setThemeAttribute(themeName);
                }

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

            // Initialize overrides from loaded theme config
            initializeOverrides(result.config, injectCss, injectCss, themeName);
            if (injectCss) {
                setThemeAttribute(themeName);
            }

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

            initializeOverrides(result.config, true, true, themeName);
            setThemeAttribute(themeName);

            // Apply the current mode to ensure correct CSS is active
            apply(current.value);

            return true;
        } catch (err) {
            console.error(`[theme] Failed to switch to ${themeName}:`, err);

            // Rollback: remove any CSS we injected
            if (cssInjected) {
                removeThemeCSS(themeName);
            }

            // Restore previous theme config if available
            const previous = themeCache.get(oldTheme);
            if (previous) {
                initializeOverrides(previous.config, true, true, oldTheme);
            } else {
                initializeOverrides(undefined, true, true, oldTheme);
            }
            setThemeAttribute(oldTheme);

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

        // Override system API
        overrides: readonly(overrideStats),
        reinitializeOverrides: (themeConfig?: Partial<AppConfig>) => {
            initializeOverrides(themeConfig);
        },
        componentOverrides: readonly(currentOverrides),
        getIdentifierOverride: (identifier: string): IdentifierOverride | undefined =>
            currentOverrides.value?.identifiers?.[identifier],
    });
});
