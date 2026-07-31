/**
 * @module app/theme/_shared/icon-registry
 *
 * Purpose:
 * Registers and resolves theme specific icon overrides.
 *
 * Behavior:
 * - Maintains default icons and per theme overrides
 * - Resolves tokens against the active theme cache
 *
 * Constraints:
 * - Theme names must match those used in the theme manifest
 * - Resolution falls back to defaults when no override exists
 *
 * Non-Goals:
 * - Icon loading or validation
 */

import { ref, shallowRef } from 'vue';
import { DEFAULT_ICONS, type IconToken } from '~/config/icon-tokens';

/**
 * `IconMap`
 *
 * Purpose:
 * Partial map of icon tokens to concrete icon names.
 *
 * Constraints:
 * - Tokens must exist in the default icon token set
 */
export type IconMap = Partial<Record<IconToken, string>>;

/**
 * `IconRegistryState`
 *
 * Purpose:
 * Serializable registry state for SSR hydration.
 */
export interface IconRegistryState {
    themes: Record<string, IconMap>;
    activeTheme: string;
}

/**
 * `IconRegistry`
 *
 * Purpose:
 * Runtime registry for icon overrides with fast resolution.
 *
 * Behavior:
 * - Caches the active theme icon map for fast lookup
 * - Supports SSR hydration through `state` and `hydrate`
 */
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
     * Registers icon overrides for a theme.
     */
    registerTheme(themeName: string, icons: IconMap) {
        this.themes.set(themeName, icons);
        if (themeName === this.activeTheme) {
            this.rebuildCache();
        }
        this.version.value++;
    }

    /**
     * Unregisters icon overrides for a theme.
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
     * Sets the active theme for resolution.
     */
    setActiveTheme(themeName: string) {
        if (this.activeTheme !== themeName) {
            this.activeTheme = themeName;
            this.rebuildCache();
        }
    }

    /**
     * Rebuilds the flattened cache for the active theme.
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
     * Resolves an icon token to a concrete icon name.
     *
     * Constraints:
     * - Returns a fallback icon when resolution fails
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
        void this.version.value;

        // 1. Try theme override
        const themeMap = this.themes.get(themeName);
        if (themeMap?.[token]) {
            return themeMap[token];
        }

        // 2. Fallback to default
        return this.defaults[token];
    }

    /**
     * Returns the raw icon map for a theme.
     */
    getThemeMap(themeName: string): IconMap | undefined {
        return this.themes.get(themeName);
    }

    /**
     * Returns serializable registry state for SSR hydration.
     */
    get state() {
        return {
            themes: Object.fromEntries(this.themes),
            activeTheme: this.activeTheme,
        };
    }

    /**
     * Hydrates registry state from SSR.
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

/**
 * `iconRegistry`
 *
 * Purpose:
 * Singleton registry instance for theme icon resolution.
 */
export const iconRegistry = new IconRegistry();
