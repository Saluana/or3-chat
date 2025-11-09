import type { UserThemeOverrides } from './user-overrides-types';

const LEGACY_KEY_LIGHT = 'or3:theme-settings:light';
const LEGACY_KEY_DARK = 'or3:theme-settings:dark';
const LEGACY_KEY_COMBINED = 'or3:theme-settings';

export function migrateFromLegacy(): {
    lightOverrides: UserThemeOverrides | null;
    darkOverrides: UserThemeOverrides | null;
} {
    if (typeof window === 'undefined')
        return { lightOverrides: null, darkOverrides: null };

    try {
        // Check if new format already exists (skip migration)
        const hasNew =
            localStorage.getItem('or3:user-theme-overrides:light') ||
            localStorage.getItem('or3:user-theme-overrides:dark');
        if (hasNew) return { lightOverrides: null, darkOverrides: null };

        // Load legacy data
        const legacyLight =
            loadLegacy(LEGACY_KEY_LIGHT) || loadLegacy(LEGACY_KEY_COMBINED);
        const legacyDark = loadLegacy(LEGACY_KEY_DARK);

        if (!legacyLight && !legacyDark) {
            return { lightOverrides: null, darkOverrides: null };
        }

        console.info('[migrate-legacy] Migrating legacy ThemeSettings...');

        const lightOverrides = legacyLight
            ? convertToOverrides(legacyLight)
            : null;
        const darkOverrides = legacyDark
            ? convertToOverrides(legacyDark)
            : null;

        // Clean up legacy keys
        localStorage.removeItem(LEGACY_KEY_LIGHT);
        localStorage.removeItem(LEGACY_KEY_DARK);
        localStorage.removeItem(LEGACY_KEY_COMBINED);

        return { lightOverrides, darkOverrides };
    } catch (e) {
        console.warn('[migrate-legacy] Migration failed', e);
        return { lightOverrides: null, darkOverrides: null };
    }
}

function loadLegacy(key: string): any {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function convertToOverrides(legacy: any): UserThemeOverrides {
    return {
        colors: {
            enabled: Boolean(legacy.paletteEnabled),
            primary: legacy.palettePrimary ?? undefined,
            secondary: legacy.paletteSecondary ?? undefined,
            error: legacy.paletteError ?? undefined,
            surfaceVariant: legacy.paletteSurfaceVariant ?? undefined,
            surface: legacy.paletteSurface ?? undefined,
        },
        backgrounds: {
            enabled: Boolean(legacy.customBgColorsEnabled),
            content: {
                base: {
                    url: legacy.contentBg1 ?? null,
                    opacity: legacy.contentBg1Opacity ?? 0,
                    sizePx: legacy.contentBg1SizePx ?? 240,
                    fit: Boolean(legacy.contentBg1Fit),
                    repeat: legacy.contentBg1Repeat ?? 'repeat',
                    color: legacy.contentBg1Color ?? '',
                },
                overlay: {
                    url: legacy.contentBg2 ?? null,
                    opacity: legacy.contentBg2Opacity ?? 0,
                    sizePx: legacy.contentBg2SizePx ?? 240,
                    fit: Boolean(legacy.contentBg2Fit),
                    repeat: legacy.contentBg2Repeat ?? 'repeat',
                    color: legacy.contentBg2Color ?? '',
                },
            },
            sidebar: {
                url: legacy.sidebarBg ?? null,
                opacity: legacy.sidebarBgOpacity ?? 0,
                sizePx: legacy.sidebarBgSizePx ?? 240,
                fit: Boolean(legacy.sidebarBgFit),
                repeat: legacy.sidebarRepeat ?? 'repeat',
                color: legacy.sidebarBgColor ?? '',
            },
            headerGradient: {
                enabled: legacy.showHeaderGradient !== false,
            },
            bottomNavGradient: {
                enabled: legacy.showBottomBarGradient !== false,
            },
        },
        typography: {
            baseFontPx: legacy.baseFontPx ?? undefined,
            useSystemFont: Boolean(legacy.useSystemFont),
        },
        ui: {
            reducePatternsInHighContrast: Boolean(
                legacy.reducePatternsInHighContrast
            ),
        },
    };
}
