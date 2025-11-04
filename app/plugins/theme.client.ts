import { ref } from 'vue';
import {
    discoverThemes,
    loadTheme,
    validateThemeVariables,
    type ThemeManifest,
    type ThemeError,
    type ThemeWarning,
} from '~/theme/_shared/theme-loader';

export default defineNuxtPlugin(async (nuxtApp) => {
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

            const result = await loadTheme(themeName);

            // Store errors and warnings
            errors.value = result.errors;
            warnings.value = result.warnings;

            // Log warnings
            result.warnings.forEach((warning) => {
                console.warn('[theme]', warning.message, warning.file);
            });

            // Log errors
            result.errors.forEach((error) => {
                console.error('[theme]', error.message, error.file);
            });

            // Only inject CSS if requested (default true for backwards compatibility)
            if (injectCss) {
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

    // Load and validate the active theme
    await initializeThemes();
    await loadAndValidateTheme(activeTheme.value);

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

        // Remove old theme CSS
        const oldTheme = activeTheme.value;
        if (oldTheme && oldTheme !== themeName) {
            removeThemeCSS(oldTheme);
        }

        // Validate and load new theme
        const result = await loadAndValidateTheme(themeName);
        if (!result || result.errors.length > 0) {
            console.error(
                `[theme] Theme "${themeName}" has critical errors and cannot be applied`
            );
            return false;
        }

        // Store the active theme
        activeTheme.value = themeName;
        localStorage.setItem(activeThemeStorageKey, themeName);

        // Apply the current mode to ensure correct CSS is active
        apply(current.value);

        return true;
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

        // Utility methods
        validateTheme: async (themeName: string) => {
            // Validate without injecting CSS (just check for errors/warnings)
            return await loadAndValidateTheme(themeName, false);
        },

        // Get theme manifest by name
        getThemeManifest: (themeName: string) => {
            return availableThemes.value.find((t) => t.name === themeName);
        },
    });
});
