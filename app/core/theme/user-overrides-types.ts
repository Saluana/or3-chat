/**
 * @module app/core/theme/user-overrides-types
 *
 * Purpose:
 * Defines the shape of user-customizable theme overrides. Stored per
 * color mode (light/dark) in localStorage. These overrides are merged
 * on top of the active base theme at runtime.
 *
 * Architecture:
 * - `UserThemeOverrides` is the top-level shape persisted to localStorage
 * - `UserBackgroundLayer` describes a single background layer override
 * - `EMPTY_USER_OVERRIDES` provides a safe default with all toggles off
 *
 * Constraints:
 * - Color values are CSS color strings (hex, rgb, etc.)
 * - Font size is clamped to 14-24 px by the composable
 * - Background opacity is clamped to 0-1
 * - This file is types-only plus the `EMPTY_USER_OVERRIDES` constant
 *
 * @see core/theme/useUserThemeOverrides for the composable that reads/writes these
 * @see core/theme/apply-merged-theme for how overrides are applied to the DOM
 */

/**
 * Purpose:
 * Top-level user theme overrides. Each sub-object has an `enabled` toggle
 * so overrides can be configured but temporarily disabled without losing values.
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

/**
 * Purpose:
 * A single user-configurable background layer override.
 *
 * Constraints:
 * - This type is persisted to localStorage, so changes should be backwards compatible
 * - `url` may be an `internal-file://` token resolved at runtime
 */
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
}

/**
 * Purpose:
 * Safe default overrides object with all feature toggles disabled.
 */
export const EMPTY_USER_OVERRIDES: UserThemeOverrides = {
    colors: { enabled: false },
    backgrounds: { enabled: false },
    typography: {},
    ui: {},
};
