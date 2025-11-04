// Type augmentation for the theme plugin
import type { Ref } from 'vue';
import type { ThemeManifest, ThemeError, ThemeWarning, ThemeLoadResult } from '~/theme/_shared/theme-loader';

declare module '#app' {
    interface NuxtApp {
        $theme: {
            // Existing API
            set: (name: string) => void;
            toggle: () => void;
            get: () => string;
            system: () => 'light' | 'dark';
            current: Ref<string>;
            
            // New multi-theme API
            /**
             * Currently active theme name
             */
            activeTheme: Ref<string>;
            
            /**
             * List of available themes
             */
            availableThemes: Ref<ThemeManifest[]>;
            
            /**
             * Switch to a different theme (requires page reload)
             * @param themeName - Name of the theme to switch to
             * @returns Promise<boolean> - True if switch was successful
             */
            switchTheme: (themeName: string) => Promise<boolean>;
            
            /**
             * Reload the current theme
             * @returns Promise<boolean> - True if reload was successful
             */
            reloadTheme: () => Promise<boolean>;
            
            /**
             * Current theme errors
             */
            errors: Ref<ThemeError[]>;
            
            /**
             * Current theme warnings
             */
            warnings: Ref<ThemeWarning[]>;
            
            /**
             * Validate a theme without switching to it
             * @param themeName - Name of the theme to validate
             * @returns Promise<ThemeLoadResult | null> - Validation result
             */
            validateTheme: (themeName: string) => Promise<ThemeLoadResult | null>;
            
            /**
             * Get theme manifest by name
             * @param themeName - Name of the theme
             * @returns ThemeManifest | undefined - Theme manifest
             */
            getThemeManifest: (themeName: string) => ThemeManifest | undefined;
        };
        $hooks: import('../app/utils/typed-hooks').TypedHookEngine;
    }
}

export {};
