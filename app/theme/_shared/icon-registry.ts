import { reactive, ref, shallowRef, toRaw } from 'vue';
import { DEFAULT_ICONS, type IconToken } from '~/config/icon-tokens';

export type IconMap = Partial<Record<IconToken, string>>;

export interface IconRegistryState {
    themes: Record<string, IconMap>;
    activeTheme: string;
}

export class IconRegistry {
    private defaults: typeof DEFAULT_ICONS;
    private themes: Map<string, IconMap> = new Map();
    private activeTheme: string = 'default';
    private version = ref(0);

    // Flattened cache for the active theme to speed up lookups
    // Using shallowRef avoids deep reactivity overhead on the cache object
    private activeCache = shallowRef<Record<string, string>>({});

    constructor(defaults: typeof DEFAULT_ICONS = DEFAULT_ICONS) {
        this.defaults = defaults;
        this.rebuildCache();
    }

    /**
     * Register a theme's icon overrides
     */
    registerTheme(themeName: string, icons: IconMap) {
        this.themes.set(themeName, icons);
        if (themeName === this.activeTheme) {
            this.rebuildCache();
        }
        this.version.value++;
    }

    /**
     * Unregister a theme's icon overrides (for cleanup)
     */
    unregisterTheme(themeName: string) {
        this.themes.delete(themeName);
        if (themeName === this.activeTheme) {
            // Reset to default if unregistering active theme
            this.activeTheme = 'default';
            this.rebuildCache();
        }
        this.version.value++;
    }

    /**
     * Set the currently active theme for resolution
     */
    setActiveTheme(themeName: string) {
        if (this.activeTheme !== themeName) {
            this.activeTheme = themeName;
            this.rebuildCache();
        }
    }

    /**
     * Rebuild the flattened cache for the active theme
     */
    private rebuildCache() {
        const overrides = this.themes.get(this.activeTheme);
        // Merge defaults with overrides into a single flat object
        this.activeCache.value = {
            ...this.defaults,
            ...(overrides || {}),
        };
    }

    /**
     * Resolve a semantic token to a concrete icon string
     */
    resolve(token: IconToken, themeName?: string): string {
        // Fast path: resolving for active theme
        if (!themeName || themeName === this.activeTheme) {
            // Accessing .value tracks dependency on the cache (which updates on theme change)
            const cache = this.activeCache.value;
            return cache[token] || 'pixelarticons:alert';
        }

        // Slow path: resolving for a specific non-active theme
        // Track version to ensure reactivity when new themes are registered
        const _ = this.version.value;

        // 1. Try theme override
        const themeMap = this.themes.get(themeName);
        if (themeMap && themeMap[token]) {
            return themeMap[token]!;
        }

        // 2. Fallback to default
        const defaultIcon = this.defaults[token];
        if (defaultIcon) {
            return defaultIcon;
        }

        // 3. Ultimate fallback
        console.warn(`[IconRegistry] Missing icon for token: ${token}`);
        return 'pixelarticons:alert';
    }

    /**
     * Get the raw map for a specific theme (useful for debugging)
     */
    getThemeMap(themeName: string): IconMap | undefined {
        return this.themes.get(themeName);
    }

    /**
     * Export registry state for SSR hydration
     */
    get state() {
        return {
            themes: Object.fromEntries(this.themes),
            activeTheme: this.activeTheme,
        };
    }

    /**
     * Hydrate registry state from SSR
     */
    hydrate(state: IconRegistryState) {
        // Clear existing themes first
        this.themes.clear();
        // Load from hydrated state
        for (const [themeName, iconMap] of Object.entries(state.themes)) {
            this.themes.set(themeName, iconMap);
        }
        this.activeTheme = state.activeTheme;
        this.rebuildCache();
        this.version.value++;
    }
}

// Singleton instance for direct usage if needed, though plugin injection is preferred
export const iconRegistry = new IconRegistry();
