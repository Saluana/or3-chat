import { ref } from 'vue';
import { RuntimeResolver } from '~/theme/_shared/runtime-resolver';
import type { CompiledTheme } from '~/theme/_shared/types';

export default defineNuxtPlugin((nuxtApp) => {
    const THEME_CLASSES = [
        'light',
        'dark',
        'light-high-contrast',
        'dark-high-contrast',
        'light-medium-contrast',
        'dark-medium-contrast',
    ];

    const storageKey = 'theme';
    const activeThemeStorageKey = 'activeTheme';
    const root = document.documentElement;

    const getSystemPref = () =>
        window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light';

    const apply = (name: string) => {
        for (const cls of THEME_CLASSES) root.classList.remove(cls);
        root.classList.add(name);
    };

    const read = () => localStorage.getItem(storageKey) as string | null;
    const readActiveTheme = () => localStorage.getItem(activeThemeStorageKey) as string | null;

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

    // Active theme name (for refined theme system)
    const activeTheme = ref(readActiveTheme() || 'default');

    /**
     * Load a compiled theme configuration
     * 
     * This is called at build time by the theme compiler or at runtime
     * to dynamically import compiled theme configs.
     */
    const loadCompiledTheme = async (themeName: string): Promise<CompiledTheme | null> => {
        try {
            // Try to import compiled theme
            // Note: In Phase 1, we only have example-refined theme
            // In Phase 4, we'll migrate all themes
            const compiledTheme = await import(`~/theme/${themeName}/theme.compiled.js`).catch(() => null);
            
            if (compiledTheme?.default) {
                const theme = compiledTheme.default as CompiledTheme;
                themeRegistry.set(themeName, theme);
                
                // Initialize resolver for this theme
                const resolver = new RuntimeResolver(theme);
                resolverRegistry.set(themeName, resolver);
                
                return theme;
            }
        } catch (error) {
            if (import.meta.dev) {
                console.warn(`[theme] Failed to load compiled theme "${themeName}":`, error);
            }
        }
        
        return null;
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

        if (import.meta.dev) {
            console.warn(`[theme] No resolver found for theme "${themeName}". Theme may not be compiled.`);
        }

        return null;
    };

    /**
     * Set active theme (for refined theme system)
     * 
     * This switches the active theme and persists the selection.
     */
    const setActiveTheme = async (themeName: string) => {
        // Load theme if not already loaded
        if (!themeRegistry.has(themeName)) {
            await loadCompiledTheme(themeName);
        }

        // Update active theme
        activeTheme.value = themeName;
        localStorage.setItem(activeThemeStorageKey, themeName);

        // Apply CSS variables if theme provides them
        const theme = themeRegistry.get(themeName);
        if (theme?.cssVariables) {
            // TODO: Inject CSS variables into document
            // This will be implemented when we add CSS generation support
        }
    };

    // Initialize: Try to load example-refined theme if available
    if (import.meta.dev) {
        loadCompiledTheme('example-refined').catch(() => {
            // Theme not available yet, that's ok
        });
    }

    nuxtApp.provide('theme', {
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
        loadCompiledTheme, // Function to dynamically load a theme
    });
});
