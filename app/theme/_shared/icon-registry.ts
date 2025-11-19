import { reactive, ref } from 'vue';
import { DEFAULT_ICONS, type IconToken } from '~/config/icon-tokens';

export type IconMap = Partial<Record<IconToken, string>>;

export class IconRegistry {
    private defaults: typeof DEFAULT_ICONS;
    private themes: Record<string, IconMap> = reactive({});
    private activeTheme: string = 'default';
    private version = ref(0);

    constructor(defaults: typeof DEFAULT_ICONS = DEFAULT_ICONS) {
        this.defaults = defaults;
    }

    /**
     * Register a theme's icon overrides
     */
    registerTheme(themeName: string, icons: IconMap) {
        this.themes[themeName] = icons;
        this.version.value++;
    }

    /**
     * Set the currently active theme for resolution
     */
    setActiveTheme(themeName: string) {
        this.activeTheme = themeName;
    }

    /**
     * Resolve a semantic token to a concrete icon string
     */
    resolve(token: IconToken, themeName?: string): string {
        // Track version to ensure reactivity when new themes are registered
        const _ = this.version.value;
        const targetTheme = themeName || this.activeTheme;

        // 1. Try active theme override
        const themeMap = this.themes[targetTheme];
        if (themeMap && themeMap[token]) {
            return themeMap[token]!;
        }

        // 2. Fallback to default
        const defaultIcon = this.defaults[token];
        if (defaultIcon) {
            return defaultIcon;
        }

        // 3. Ultimate fallback (should never happen if types are correct)
        console.warn(`[IconRegistry] Missing icon for token: ${token}`);
        return 'pixelarticons:alert';
    }

    /**
     * Get the raw map for a specific theme (useful for debugging)
     */
    getThemeMap(themeName: string): IconMap | undefined {
        return this.themes[themeName];
    }

    /**
     * Export registry state for SSR hydration
     */
    get state() {
        return {
            themes: this.themes,
            activeTheme: this.activeTheme,
        };
    }

    /**
     * Hydrate registry state from SSR
     */
    hydrate(state: { themes: Record<string, IconMap>; activeTheme: string }) {
        Object.assign(this.themes, state.themes);
        this.activeTheme = state.activeTheme;
        this.version.value++;
    }
}

// Singleton instance for direct usage if needed, though plugin injection is preferred
export const iconRegistry = new IconRegistry();
