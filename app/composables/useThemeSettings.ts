import { ref, watch, computed } from 'vue';
import { useNuxtApp } from '#app';
import type { ThemeSettings, ThemeMode } from './theme-types';
import * as ThemeDefs from './theme-defaults';
import { applyToRoot } from './theme-apply';
export {
    DEFAULT_THEME_SETTINGS,
    DEFAULT_THEME_SETTINGS_LIGHT,
    DEFAULT_THEME_SETTINGS_DARK,
    THEME_SETTINGS_STORAGE_KEY,
    THEME_SETTINGS_STORAGE_KEY_LIGHT,
    THEME_SETTINGS_STORAGE_KEY_DARK,
} from './theme-defaults';

/**
 * Theme customization settings (v1)
 * Future versions can extend while preserving backward compatibility.
 */
// Small shared types/constants

// singleton guard (HMR safe)
const g: any = globalThis as any;
if (!g.__or3ThemeSettingsStoreV2) {
    g.__or3ThemeSettingsStoreV2 = {
        light: ref<ThemeSettings>({
            ...ThemeDefs.DEFAULT_THEME_SETTINGS_LIGHT,
        }),
        dark: ref<ThemeSettings>({ ...ThemeDefs.DEFAULT_THEME_SETTINGS_DARK }),
        activeMode: ref<'light' | 'dark'>('light'),
        loaded: false,
    };
}

const store = g.__or3ThemeSettingsStoreV2 as {
    light: ReturnType<typeof ref<ThemeSettings>>;
    dark: ReturnType<typeof ref<ThemeSettings>>;
    activeMode: ReturnType<typeof ref<'light' | 'dark'>>;
    loaded: boolean;
};

function clamp(n: number, min: number, max: number) {
    return Math.min(max, Math.max(min, n));
}

// Helpers
const REPEAT_VALUES = new Set(['repeat', 'no-repeat'] as const);
const isColor = (v: any) =>
    typeof v === 'string' && (v.startsWith('#') || v.startsWith('var('));
const coerceBool = (v: any) => !!v;
const coerceRepeat = (v: any) => (REPEAT_VALUES.has(v) ? v : 'repeat');
const clampSizePx = (n: any, d: number) =>
    clamp(Math.round(typeof n === 'number' ? n : d), 8, 1200);

function isValidImageValue(v: string) {
    return (
        v.startsWith('/') ||
        v.startsWith('data:image/') ||
        v.startsWith('blob:') ||
        v.startsWith('internal-file://') ||
        v.startsWith('http://') ||
        v.startsWith('https://')
    );
}

export function sanitize(
    s: ThemeSettings,
    defaults: ThemeSettings
): ThemeSettings {
    const out: ThemeSettings = { ...s } as ThemeSettings;
    out.baseFontPx = clamp(Math.round(out.baseFontPx), 14, 24);
    out.useSystemFont = coerceBool(out.useSystemFont);
    out.showHeaderGradient = coerceBool(out.showHeaderGradient);
    out.showBottomBarGradient = coerceBool(out.showBottomBarGradient);
    out.customBgColorsEnabled = coerceBool(out.customBgColorsEnabled);
    // Colors
    if (!isColor(out.contentBg1Color))
        out.contentBg1Color = defaults.contentBg1Color;
    if (!isColor(out.contentBg2Color))
        out.contentBg2Color = defaults.contentBg2Color;
    if (!isColor(out.sidebarBgColor))
        out.sidebarBgColor = defaults.sidebarBgColor;
    if (!isColor(out.headerBgColor)) out.headerBgColor = defaults.headerBgColor;
    if (!isColor(out.bottomBarBgColor))
        out.bottomBarBgColor = defaults.bottomBarBgColor;
    // Images
    out.contentBg1 =
        out.contentBg1 && isValidImageValue(out.contentBg1)
            ? out.contentBg1
            : defaults.contentBg1;
    out.contentBg2 =
        out.contentBg2 && isValidImageValue(out.contentBg2)
            ? out.contentBg2
            : null;
    out.sidebarBg =
        out.sidebarBg && isValidImageValue(out.sidebarBg)
            ? out.sidebarBg
            : defaults.sidebarBg;
    // Opacities
    out.contentBg1Opacity = +clamp(out.contentBg1Opacity, 0, 1).toFixed(3);
    out.contentBg2Opacity = +clamp(out.contentBg2Opacity, 0, 1).toFixed(3);
    out.sidebarBgOpacity = +clamp(out.sidebarBgOpacity, 0, 1).toFixed(3);
    // Sizes / fit
    const defaultSidebarSize = (defaults as any).sidebarBgSizePx || 240;
    (out as any).sidebarBgSizePx = clampSizePx(
        (out as any).sidebarBgSizePx,
        defaultSidebarSize
    );
    (out as any).sidebarBgFit = coerceBool((out as any).sidebarBgFit);
    out.contentBg1SizePx = clampSizePx(
        out.contentBg1SizePx,
        defaults.contentBg1SizePx
    );
    out.contentBg2SizePx = clampSizePx(
        out.contentBg2SizePx,
        defaults.contentBg2SizePx
    );
    out.contentBg1Fit = coerceBool(out.contentBg1Fit);
    out.contentBg2Fit = coerceBool(out.contentBg2Fit);
    // Repeats (migrate legacy)
    out.sidebarRepeat = coerceRepeat(out.sidebarRepeat);
    out.contentRepeat = coerceRepeat(out.contentRepeat);
    out.contentBg1Repeat = coerceRepeat(out.contentBg1Repeat);
    out.contentBg2Repeat = coerceRepeat(out.contentBg2Repeat);
    if (!('contentBg1Repeat' in s) && 'contentRepeat' in s)
        out.contentBg1Repeat = out.contentRepeat;
    if (!('contentBg2Repeat' in s) && 'contentRepeat' in s)
        out.contentBg2Repeat = out.contentRepeat;
    out.reducePatternsInHighContrast = coerceBool(
        out.reducePatternsInHighContrast
    );
    // Palette overrides
    const anyOut: any = out;
    const anyDefaults: any = defaults;
    anyOut.paletteEnabled = coerceBool(anyOut.paletteEnabled);
    const paletteKeys = [
        'palettePrimary',
        'paletteSecondary',
        'paletteError',
        'paletteSurfaceVariant',
        'paletteBorder',
        'paletteSurface',
    ] as const;
    for (const k of paletteKeys) {
        if (!isColor(anyOut[k])) anyOut[k] = anyDefaults[k];
    }
    // Migration: paletteBorder used to map to surface-variant when paletteSurfaceVariant missing
    const hadOldBorderOnly =
        Object.prototype.hasOwnProperty.call(s as any, 'paletteBorder') &&
        !Object.prototype.hasOwnProperty.call(
            s as any,
            'paletteSurfaceVariant'
        );
    if (hadOldBorderOnly && isColor((s as any).paletteBorder)) {
        anyOut.paletteSurfaceVariant = (s as any).paletteBorder;
        anyOut.paletteBorder = anyDefaults.paletteBorder;
    }
    return out;
}

// Defensive runtime completeness guard (in case older persisted objects or external code
// accidentally removed keys). Ensures every key from DEFAULT_THEME_SETTINGS exists.
function ensureComplete(partial: any, defaults: ThemeSettings): ThemeSettings {
    const base: any = { ...defaults };
    for (const k of Object.keys(base)) {
        if (partial[k] === undefined) partial[k] = base[k];
    }
    return partial as ThemeSettings;
}

function isBrowser() {
    return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function persist(mode: 'light' | 'dark', settings: ThemeSettings) {
    if (!isBrowser()) return;
    try {
        // Mode specific key
        const key =
            mode === 'light'
                ? ThemeDefs.THEME_SETTINGS_STORAGE_KEY_LIGHT
                : ThemeDefs.THEME_SETTINGS_STORAGE_KEY_DARK;
        localStorage.setItem(key, JSON.stringify(settings));
        // Legacy combined key (write last active for backward compatibility)
        localStorage.setItem(
            ThemeDefs.THEME_SETTINGS_STORAGE_KEY,
            JSON.stringify(settings)
        );
    } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[theme-settings] failed to persist settings', e);
    }
}

function loadFromStorage(mode: 'light' | 'dark'): ThemeSettings | null {
    if (!isBrowser()) return null;
    try {
        const key =
            mode === 'light'
                ? ThemeDefs.THEME_SETTINGS_STORAGE_KEY_LIGHT
                : ThemeDefs.THEME_SETTINGS_STORAGE_KEY_DARK;
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const defaults =
            mode === 'light'
                ? ThemeDefs.DEFAULT_THEME_SETTINGS_LIGHT
                : ThemeDefs.DEFAULT_THEME_SETTINGS_DARK;
        return sanitize({ ...defaults, ...parsed }, defaults);
    } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[theme-settings] failed to parse stored settings', e);
        return null;
    }
}

export function detectModeFromHtml(): 'light' | 'dark' {
    if (!isBrowser()) return 'light';
    const cls = document.documentElement.className;
    // treat any class starting with 'dark' as dark mode variant
    return /(^|\s)dark(?![a-zA-Z0-9_-])|(^|\s)dark-/.test(cls)
        ? 'dark'
        : 'light';
}

/** Public composable API */
export function useThemeSettings() {
    if (!store.loaded && isBrowser()) {
        // Migration: if legacy single key exists and light-specific is absent, migrate to light
        try {
            const legacyRaw = localStorage.getItem(
                ThemeDefs.THEME_SETTINGS_STORAGE_KEY
            );
            const lightRaw = localStorage.getItem(
                ThemeDefs.THEME_SETTINGS_STORAGE_KEY_LIGHT
            );
            if (legacyRaw && !lightRaw) {
                localStorage.setItem(
                    ThemeDefs.THEME_SETTINGS_STORAGE_KEY_LIGHT,
                    legacyRaw
                );
            }
        } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('[theme-settings] migration failed', e);
        }
        const loadedLight = loadFromStorage('light');
        const loadedDark = loadFromStorage('dark');
        if (loadedLight) store.light.value = loadedLight;
        if (loadedDark) store.dark.value = loadedDark;
        store.activeMode.value = detectModeFromHtml();
        applyToRoot(
            (store.activeMode.value === 'light'
                ? store.light.value
                : store.dark.value) as ThemeSettings
        );
        // Ensure the theme plugin reflects the detected mode on boot
        if (isBrowser()) {
            const nuxtApp: any = useNuxtApp();
            nuxtApp?.$theme?.set(store.activeMode.value);
        }
        // Observe html class changes to sync mode automatically
        if (isBrowser()) {
            const mo = new MutationObserver(() => {
                const mode = detectModeFromHtml();
                if (mode !== store.activeMode.value) {
                    store.activeMode.value = mode;
                    applyToRoot(
                        (mode === 'light'
                            ? store.light.value
                            : store.dark.value) as ThemeSettings
                    );
                    // Keep plugin-applied classes in sync when external changes happen
                    const nuxtApp: any = useNuxtApp();
                    nuxtApp?.$theme?.set(mode);
                }
            });
            mo.observe(document.documentElement, {
                attributes: true,
                attributeFilter: ['class'],
            });
            if (import.meta.hot) {
                import.meta.hot.dispose(() => mo.disconnect());
            }
        }
        store.loaded = true;
    }

    const current = computed<ThemeSettings>(
        () =>
            (store.activeMode.value === 'light'
                ? store.light.value
                : store.dark.value) as ThemeSettings
    );

    function set(patch: Partial<ThemeSettings>) {
        const mode = store.activeMode.value;
        const base = mode === 'light' ? store.light.value : store.dark.value;
        const defaults =
            mode === 'light'
                ? ThemeDefs.DEFAULT_THEME_SETTINGS_LIGHT
                : ThemeDefs.DEFAULT_THEME_SETTINGS_DARK;
        const mergedInput: ThemeSettings = { ...base, ...patch } as any;
        const merged = sanitize(
            ensureComplete(mergedInput, defaults),
            defaults
        );
        if (mode === 'light') store.light.value = merged;
        else store.dark.value = merged;
        applyToRoot(merged);
        persist(mode as 'light' | 'dark', merged);
    }

    function setForMode(mode: 'light' | 'dark', patch: Partial<ThemeSettings>) {
        const base = mode === 'light' ? store.light.value : store.dark.value;
        const defaults =
            mode === 'light'
                ? ThemeDefs.DEFAULT_THEME_SETTINGS_LIGHT
                : ThemeDefs.DEFAULT_THEME_SETTINGS_DARK;
        const mergedInput: ThemeSettings = { ...base, ...patch } as any;
        const merged = sanitize(
            ensureComplete(mergedInput, defaults),
            defaults
        );
        if (mode === 'light') store.light.value = merged;
        else store.dark.value = merged;
        if (mode === store.activeMode.value) {
            applyToRoot(merged);
        }
        persist(mode, merged);
    }

    function reset(mode?: 'light' | 'dark') {
        const target = mode || store.activeMode.value;
        if (target === 'light') {
            store.light.value = { ...ThemeDefs.DEFAULT_THEME_SETTINGS_LIGHT };
            persist('light', store.light.value);
        } else {
            store.dark.value = { ...ThemeDefs.DEFAULT_THEME_SETTINGS_DARK };
            persist('dark', store.dark.value);
        }
        if (target === store.activeMode.value) {
            applyToRoot(
                (target === 'light'
                    ? store.light.value
                    : store.dark.value) as ThemeSettings
            );
        }
    }

    function resetAll() {
        reset('light');
        reset('dark');
    }

    function load(): ThemeSettings {
        const mode = store.activeMode.value;
        const fresh = loadFromStorage(mode as 'light' | 'dark');
        if (fresh) {
            if (mode === 'light') store.light.value = fresh;
            else store.dark.value = fresh;
            applyToRoot(fresh);
        }
        return current.value;
    }

    function reapply() {
        applyToRoot(current.value);
    }

    function switchMode(mode: 'light' | 'dark') {
        if (mode === store.activeMode.value) return;
        store.activeMode.value = mode;
        applyToRoot(
            (mode === 'light'
                ? store.light.value
                : store.dark.value) as ThemeSettings
        );
        // Also update the root theme classes via the theme plugin so the site
        // visually switches (and MutationObserver stays in sync).
        if (isBrowser()) {
            const nuxtApp: any = useNuxtApp();
            nuxtApp?.$theme?.set(mode);
        }
    }

    // Watch both profiles for changes (deep) and persist them independently
    if (isBrowser()) {
        watch(
            () => store.light.value,
            (v) => {
                if (store.activeMode.value === 'light')
                    applyToRoot(v as ThemeSettings);
                persist('light', v as ThemeSettings);
            },
            { deep: true }
        );
        watch(
            () => store.dark.value,
            (v) => {
                if (store.activeMode.value === 'dark')
                    applyToRoot(v as ThemeSettings);
                persist('dark', v as ThemeSettings);
            },
            { deep: true }
        );
    }

    return {
        settings: current, // active profile (backwards-compatible name)
        light: store.light,
        dark: store.dark,
        activeMode: store.activeMode,
        set,
        setForMode,
        reset, // resets current or specified
        resetAll,
        load,
        reapply,
        switchMode,
        applyToRoot,
    };
}
