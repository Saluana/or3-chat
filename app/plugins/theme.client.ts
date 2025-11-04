import { ref } from 'vue';
import { discoverThemes, loadTheme, validateThemeVariables, type ThemeManifest, type ThemeError, type ThemeWarning } from '~/theme/_shared/theme-loader';

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
            console.log('[theme] Discovered themes:', availableThemes.value.map(t => t.name));
        } catch (err) {
            console.error('[theme] Failed to discover themes:', err);
            errors.value.push({
                file: 'theme-discovery',
                message: `Theme discovery failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
                severity: 'error'
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

    // Load and validate theme
    const loadAndValidateTheme = async (themeName: string) => {
        try {
            errors.value = [];
            warnings.value = [];
            
            const result = await loadTheme(themeName);
            
            // Store errors and warnings
            errors.value = result.errors;
            warnings.value = result.warnings;
            
            // Log warnings
            result.warnings.forEach(warning => {
                console.warn('[theme]', warning.message, warning.file);
            });
            
            // Log errors
            result.errors.forEach(error => {
                console.error('[theme]', error.message, error.file);
            });
            
            return result;
        } catch (err) {
            const error: ThemeError = {
                file: themeName,
                message: `Failed to load theme: ${err instanceof Error ? err.message : 'Unknown error'}`,
                severity: 'error'
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

    // Switch to a different theme (requires page reload for now)
    const switchTheme = async (themeName: string) => {
        // Validate theme exists
        const theme = availableThemes.value.find(t => t.name === themeName);
        if (!theme) {
            console.error(`[theme] Theme "${themeName}" not found. Available themes:`, availableThemes.value.map(t => t.name));
            return false;
        }

        // Validate theme can be loaded
        const result = await loadAndValidateTheme(themeName);
        if (!result || result.errors.length > 0) {
            console.error(`[theme] Theme "${themeName}" has critical errors and cannot be applied`);
            return false;
        }

        // Store the active theme
        activeTheme.value = themeName;
        localStorage.setItem(activeThemeStorageKey, themeName);

        console.log(`[theme] Switched to theme "${themeName}". Page reload required to apply all theme assets.`);
        console.log('[theme] In a future version, this will be applied dynamically without reload.');
        
        // For now, we need to reload the page to apply the new theme
        // In a future enhancement, this could be done dynamically
        setTimeout(() => {
            if (confirm(`Theme "${themeName}" requires a page reload to take effect. Reload now?`)) {
                window.location.reload();
            }
        }, 100);

        return true;
    };

    // Reload current theme
    const reloadTheme = async () => {
        console.log(`[theme] Reloading current theme "${activeTheme.value}"`);
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

    nuxtApp.hook('app:beforeMount', async () => {
        current.value = readThemeMode();
        activeTheme.value = readActiveTheme();
        apply(current.value);
        
        // Re-initialize themes and load active theme
        await initializeThemes();
        await loadAndValidateTheme(activeTheme.value);
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
            return await loadAndValidateTheme(themeName);
        },
        
        // Get theme manifest by name
        getThemeManifest: (themeName: string) => {
            return availableThemes.value.find(t => t.name === themeName);
        }
    });
});
