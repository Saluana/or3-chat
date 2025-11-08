import type { ThemeBackgrounds } from '../../theme/_shared/types';

/**
 * User theme overrides - aligns with ThemeDefinition structure
 * Stored per mode (light/dark) in localStorage
 */
export interface UserThemeOverrides {
    /** Color palette overrides (Material Design colors) */
    colors?: {
        /** Master toggle for palette overrides */
        enabled?: boolean;
        // Primary
        primary?: string;
        onPrimary?: string;
        primaryContainer?: string;
        onPrimaryContainer?: string;
        // Secondary
        secondary?: string;
        onSecondary?: string;
        secondaryContainer?: string;
        onSecondaryContainer?: string;
        // Tertiary
        tertiary?: string;
        onTertiary?: string;
        tertiaryContainer?: string;
        onTertiaryContainer?: string;
        // Error
        error?: string;
        onError?: string;
        errorContainer?: string;
        onErrorContainer?: string;
        // Surface
        surface?: string;
        onSurface?: string;
        surfaceVariant?: string;
        onSurfaceVariant?: string;
        inverseSurface?: string;
        inverseOnSurface?: string;
        // Outline
        outline?: string;
        outlineVariant?: string;
        // Semantic (app-specific)
        success?: string;
        warning?: string;
    };

    /** Background layer overrides */
    backgrounds?: {
        /** Master toggle for custom background colors */
        enabled?: boolean;
        content?: {
            base?: Partial<UserBackgroundLayer>;
            overlay?: Partial<UserBackgroundLayer>;
        };
        sidebar?: Partial<UserBackgroundLayer>;
        headerGradient?: {
            enabled?: boolean; // true = show, false = hide
        };
        bottomNavGradient?: {
            enabled?: boolean;
        };
    };

    /** Typography overrides */
    typography?: {
        /** Base font size in pixels (14-24) */
        baseFontPx?: number;
        /** Use system fonts instead of theme fonts */
        useSystemFont?: boolean;
    };

    /** UI-specific settings (not in theme DSL) */
    ui?: {
        /** Reduce pattern opacity in high contrast modes */
        reducePatternsInHighContrast?: boolean;
    };
}

/** Structure of a background layer in user overrides (different from theme DSL) */
export interface UserBackgroundLayer {
    /** Image URL (public path, blob:, or internal-file://) */
    url: string | null;
    /** Opacity 0-1 */
    opacity: number;
    /** Background size in pixels (or 'cover' if fit enabled) */
    sizePx: number;
    /** Use background-size: cover instead of fixed size */
    fit: boolean;
    /** CSS background-repeat value */
    repeat: 'repeat' | 'no-repeat';
    /** Fallback color (hex) */
    color: string;
} /** Empty override set (used for defaults) */
export const EMPTY_USER_OVERRIDES: UserThemeOverrides = {
    colors: { enabled: false },
    backgrounds: { enabled: false },
    typography: {},
    ui: {},
};
