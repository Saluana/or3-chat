import { ref, watch, computed } from 'vue';
import { getFileBlob } from '~/db/files';

/**
 * Theme customization settings (v1)
 * Future versions can extend while preserving backward compatibility.
 */
export interface ThemeSettings {
    baseFontPx: number; // 14..24
    useSystemFont: boolean; // when true, override both body and heading fonts with system stack
    showHeaderGradient: boolean; // controls header gradient visibility
    showBottomBarGradient: boolean; // controls bottom nav gradient visibility
    // Master toggle: when false, custom background color overrides are not applied (system/theme defaults show)
    customBgColorsEnabled: boolean;
    // Color overrides when images/gradients are disabled
    contentBg1Color: string; // css color or var()
    contentBg2Color: string; // css color or var()
    sidebarBgColor: string; // css color or var()
    headerBgColor: string; // css color or var()
    bottomBarBgColor: string; // css color or var()
    contentBg1: string | null;
    contentBg2: string | null;
    contentBg1Opacity: number; // 0..1
    contentBg2Opacity: number; // 0..1
    // Per-layer repeat (legacy contentRepeat kept for migration)
    contentBg1Repeat: 'repeat' | 'no-repeat';
    contentBg2Repeat: 'repeat' | 'no-repeat';
    // Pattern sizing / fitting
    contentBg1SizePx: number; // ignored when fit true
    contentBg2SizePx: number;
    contentBg1Fit: boolean; // when true uses cover sizing
    contentBg2Fit: boolean;
    sidebarBg: string | null;
    sidebarBgOpacity: number; // 0..1
    sidebarRepeat: 'repeat' | 'no-repeat';
    sidebarBgSizePx?: number; // optional new: size in px when not fit (legacy undefined -> default)
    sidebarBgFit?: boolean; // optional new: cover mode
    contentRepeat: 'repeat' | 'no-repeat'; // legacy shared repeat (pre-split)
    reducePatternsInHighContrast: boolean;
    // Palette overrides
    paletteEnabled?: boolean; // master toggle for palette overrides
    palettePrimary?: string; // hex or var()
    paletteSecondary?: string;
    paletteError?: string;
    // renamed: previous paletteBorder is actually surface variant
    paletteSurfaceVariant?: string; // maps to --md-surface-variant
    // new: true border color maps to inverse surface
    paletteBorder?: string; // maps to --md-inverse-surface
}

export const THEME_SETTINGS_STORAGE_KEY = 'theme:settings:v1'; // legacy single-profile key (kept for migration/back-compat)
export const THEME_SETTINGS_STORAGE_KEY_LIGHT = 'theme:settings:v1:light';
export const THEME_SETTINGS_STORAGE_KEY_DARK = 'theme:settings:v1:dark';

export const DEFAULT_THEME_SETTINGS_LIGHT: ThemeSettings = Object.freeze({
    baseFontPx: 20,
    useSystemFont: false,
    showHeaderGradient: true,
    showBottomBarGradient: true,
    customBgColorsEnabled: false,
    contentBg1Color: 'var(--md-surface)',
    contentBg2Color: 'var(--md-surface)',
    sidebarBgColor: 'var(--md-surface-container-lowest)',
    headerBgColor: 'var(--md-surface-variant)',
    bottomBarBgColor: 'var(--md-surface-variant)',
    contentBg1: '/bg-repeat.webp',
    contentBg2: '/bg-repeat-2.webp',
    contentBg1Opacity: 0.08,
    contentBg2Opacity: 0.125,
    contentBg1Repeat: 'repeat',
    contentBg2Repeat: 'repeat',
    contentBg1SizePx: 150,
    contentBg2SizePx: 380,
    contentBg1Fit: false,
    contentBg2Fit: false,
    sidebarBg: '/sidebar-repeater.webp',
    sidebarBgOpacity: 0.1,
    sidebarRepeat: 'repeat',
    sidebarBgSizePx: 240,
    sidebarBgFit: false,
    contentRepeat: 'repeat',
    reducePatternsInHighContrast: true,
    // Palette (disabled by default; values mirror light.css)
    paletteEnabled: false,
    palettePrimary: '#2c638b',
    paletteSecondary: '#51606f',
    paletteError: '#ba1a1a',
    paletteSurfaceVariant: '#dee3eb',
    paletteBorder: '#2d3135',
});

// Dark defaults tuned for lower luminance (slightly reduced pattern opacity + darker container fallbacks)
export const DEFAULT_THEME_SETTINGS_DARK: ThemeSettings = Object.freeze({
    baseFontPx: 20,
    useSystemFont: false,
    showHeaderGradient: true,
    showBottomBarGradient: true,
    customBgColorsEnabled: false,
    // Dark mode defaults use darker containers for immediate visual contrast after reset.
    contentBg1Color: 'var(--md-surface-dim)',
    contentBg2Color: 'var(--md-surface-container)',
    sidebarBgColor: 'var(--md-surface)',
    headerBgColor: 'var(--md-surface-container-high)',
    bottomBarBgColor: 'var(--md-surface-container-high)',
    // Use a single subtle pattern layer by default (second disabled) to avoid washed-out light feel.
    contentBg1: '/bg-repeat.webp',
    contentBg2: '/bg-repeat-2.webp', // disabled for clearer dark differentiation
    contentBg1Opacity: 0.03,
    contentBg2Opacity: 0.05, // kept for when user enables second layer
    contentBg1Repeat: 'repeat',
    contentBg2Repeat: 'repeat',
    contentBg1SizePx: 150,
    contentBg2SizePx: 380,
    contentBg1Fit: false,
    contentBg2Fit: false,
    sidebarBg: '/sidebar-repeater.webp',
    sidebarBgOpacity: 0.12,
    sidebarRepeat: 'repeat',
    sidebarBgSizePx: 240,
    sidebarBgFit: false,
    contentRepeat: 'repeat',
    reducePatternsInHighContrast: true,
    // Palette (disabled by default; values mirror dark.css)
    paletteEnabled: false,
    palettePrimary: '#99ccf9',
    paletteSecondary: '#b8c8da',
    paletteError: '#ffb4ab',
    paletteSurfaceVariant: '#42474e',
    paletteBorder: '#5a7d96',
});

// For backwards compatibility where other modules refer to DEFAULT_THEME_SETTINGS, point to light profile
export const DEFAULT_THEME_SETTINGS = DEFAULT_THEME_SETTINGS_LIGHT;

// singleton guard (HMR safe)
const g: any = globalThis as any;
if (!g.__or3ThemeSettingsStoreV2) {
    g.__or3ThemeSettingsStoreV2 = {
        light: ref<ThemeSettings>({ ...DEFAULT_THEME_SETTINGS_LIGHT }),
        dark: ref<ThemeSettings>({ ...DEFAULT_THEME_SETTINGS_DARK }),
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

function sanitize(s: ThemeSettings, defaults: ThemeSettings): ThemeSettings {
    const out: ThemeSettings = { ...s } as ThemeSettings;
    out.baseFontPx = clamp(Math.round(out.baseFontPx), 14, 24);
    out.useSystemFont = !!out.useSystemFont;
    out.showHeaderGradient = !!out.showHeaderGradient;
    out.showBottomBarGradient = !!out.showBottomBarGradient;
    out.customBgColorsEnabled = !!out.customBgColorsEnabled;
    const isColor = (v: any) =>
        typeof v === 'string' && (v.startsWith('#') || v.startsWith('var('));
    if (!isColor(out.contentBg1Color))
        out.contentBg1Color = defaults.contentBg1Color;
    if (!isColor(out.contentBg2Color))
        out.contentBg2Color = defaults.contentBg2Color;
    if (!isColor(out.sidebarBgColor))
        out.sidebarBgColor = defaults.sidebarBgColor;
    if (!isColor(out.headerBgColor)) out.headerBgColor = defaults.headerBgColor;
    if (!isColor(out.bottomBarBgColor))
        out.bottomBarBgColor = defaults.bottomBarBgColor;
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
    out.contentBg1Opacity = +clamp(out.contentBg1Opacity, 0, 1).toFixed(3);
    out.contentBg2Opacity = +clamp(out.contentBg2Opacity, 0, 1).toFixed(3);
    out.sidebarBgOpacity = +clamp(out.sidebarBgOpacity, 0, 1).toFixed(3);
    // Sidebar size / fit (optional fields migration-safe)
    const defaultSidebarSize = (defaults as any).sidebarBgSizePx || 240;
    const rawSidebarSize = (out as any).sidebarBgSizePx;
    const sidebarSize =
        typeof rawSidebarSize === 'number'
            ? rawSidebarSize
            : defaultSidebarSize;
    (out as any).sidebarBgSizePx = clamp(Math.round(sidebarSize), 8, 1200);
    (out as any).sidebarBgFit = !!(out as any).sidebarBgFit;
    // Clamp sizes
    const clampSize = (n: any, d: number) => {
        const v = typeof n === 'number' ? n : d;
        return clamp(Math.round(v), 8, 1200);
    };
    out.contentBg1SizePx = clampSize(
        out.contentBg1SizePx,
        defaults.contentBg1SizePx
    );
    out.contentBg2SizePx = clampSize(
        out.contentBg2SizePx,
        defaults.contentBg2SizePx
    );
    out.contentBg1Fit = !!out.contentBg1Fit;
    out.contentBg2Fit = !!out.contentBg2Fit;
    out.sidebarRepeat =
        out.sidebarRepeat === 'no-repeat' ? 'no-repeat' : 'repeat';
    out.contentRepeat =
        out.contentRepeat === 'no-repeat' ? 'no-repeat' : 'repeat';
    // Per-layer repeats (migrate from legacy if missing)
    out.contentBg1Repeat =
        out.contentBg1Repeat === 'no-repeat' ? 'no-repeat' : 'repeat';
    out.contentBg2Repeat =
        out.contentBg2Repeat === 'no-repeat' ? 'no-repeat' : 'repeat';
    if (!('contentBg1Repeat' in s) && 'contentRepeat' in s) {
        out.contentBg1Repeat = out.contentRepeat;
    }
    if (!('contentBg2Repeat' in s) && 'contentRepeat' in s) {
        out.contentBg2Repeat = out.contentRepeat;
    }
    out.reducePatternsInHighContrast = !!out.reducePatternsInHighContrast;
    // Palette overrides
    (out as any).paletteEnabled = !!(out as any).paletteEnabled;
    if (!isColor((out as any).palettePrimary))
        (out as any).palettePrimary = (defaults as any).palettePrimary;
    if (!isColor((out as any).paletteSecondary))
        (out as any).paletteSecondary = (defaults as any).paletteSecondary;
    if (!isColor((out as any).paletteError))
        (out as any).paletteError = (defaults as any).paletteError;
    if (!isColor((out as any).paletteSurfaceVariant))
        (out as any).paletteSurfaceVariant = (
            defaults as any
        ).paletteSurfaceVariant;
    if (!isColor((out as any).paletteBorder))
        (out as any).paletteBorder = (defaults as any).paletteBorder;
    // Migration: if older stored object had only paletteBorder (used for surface-variant),
    // and no paletteSurfaceVariant, move that value to paletteSurfaceVariant.
    const hadOldBorderOnly =
        Object.prototype.hasOwnProperty.call(s as any, 'paletteBorder') &&
        !Object.prototype.hasOwnProperty.call(
            s as any,
            'paletteSurfaceVariant'
        );
    if (hadOldBorderOnly && isColor((s as any).paletteBorder)) {
        (out as any).paletteSurfaceVariant = (s as any).paletteBorder;
        // Reset new border to defaults as it did not exist before
        (out as any).paletteBorder = (defaults as any).paletteBorder;
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

function applyToRoot(settings: ThemeSettings) {
    if (!isBrowser()) return; // SSR/test guard
    const r = document.documentElement.style;
    // Global cached object URLs for internal-file tokens (persist across reapply)
    const gAny: any = g;
    if (!gAny.__or3ThemeFileUrlCache) {
        gAny.__or3ThemeFileUrlCache = new Map<string, string>();
    }
    const fileUrlCache: Map<string, string> = gAny.__or3ThemeFileUrlCache;
    async function resolveToken(token: string): Promise<string | null> {
        if (!token.startsWith('internal-file://')) return token;
        const hash = token.slice('internal-file://'.length);
        if (fileUrlCache.has(hash)) return fileUrlCache.get(hash)!;
        try {
            const blob = await getFileBlob(hash);
            if (!blob) return null;
            const url = URL.createObjectURL(blob);
            fileUrlCache.set(hash, url);
            return url;
        } catch {
            return null;
        }
    }
    function setBgVar(varName: string, urlOrNone: string | null) {
        r.setProperty(varName, urlOrNone ? `url("${urlOrNone}")` : 'none');
    }
    r.setProperty('--app-font-size-root', settings.baseFontPx + 'px');
    // Font overrides
    if (settings.useSystemFont) {
        r.setProperty(
            '--app-font-sans-current',
            'ui-sans-serif, system-ui, sans-serif'
        );
        r.setProperty(
            '--app-font-heading-current',
            'ui-sans-serif, system-ui, sans-serif'
        );
    } else {
        r.setProperty(
            '--app-font-sans-current',
            '"VT323", ui-sans-serif, system-ui, sans-serif'
        );
        r.setProperty(
            '--app-font-heading-current',
            '"Press Start 2P", ui-sans-serif, system-ui, sans-serif'
        );
    }
    // Gradient visibility toggles
    r.setProperty(
        '--app-header-gradient',
        settings.showHeaderGradient ? 'url("/gradient-x.webp")' : 'none'
    );
    r.setProperty(
        '--app-bottomnav-gradient',
        settings.showBottomBarGradient ? 'url("/gradient-x.webp")' : 'none'
    );
    // Color overrides: only apply if enabled, otherwise remove so system/theme defaults cascade
    if (settings.customBgColorsEnabled) {
        r.setProperty('--app-content-bg-1-color', settings.contentBg1Color);
        r.setProperty('--app-content-bg-2-color', settings.contentBg2Color);
        r.setProperty('--app-sidebar-bg-color', settings.sidebarBgColor);
        r.setProperty('--app-header-bg-color', settings.headerBgColor);
        r.setProperty('--app-bottomnav-bg-color', settings.bottomBarBgColor);
    } else {
        r.removeProperty('--app-content-bg-1-color');
        r.removeProperty('--app-content-bg-2-color');
        r.removeProperty('--app-sidebar-bg-color');
        r.removeProperty('--app-header-bg-color');
        r.removeProperty('--app-bottomnav-bg-color');
    }
    // Palette overrides (primary/secondary/error/surfaceVariant/border)
    const anySettings: any = settings as any;
    if (anySettings.paletteEnabled) {
        if (anySettings.palettePrimary)
            r.setProperty('--md-primary', anySettings.palettePrimary);
        if (anySettings.paletteSecondary)
            r.setProperty('--md-secondary', anySettings.paletteSecondary);
        if (anySettings.paletteError)
            r.setProperty('--md-error', anySettings.paletteError);
        if (anySettings.paletteSurfaceVariant)
            r.setProperty(
                '--md-surface-variant',
                anySettings.paletteSurfaceVariant
            );
        if (anySettings.paletteBorder)
            r.setProperty('--md-inverse-surface', anySettings.paletteBorder);
    } else {
        // Remove so base theme css takes effect
        r.removeProperty('--md-primary');
        r.removeProperty('--md-secondary');
        r.removeProperty('--md-error');
        r.removeProperty('--md-surface-variant');
        r.removeProperty('--md-inverse-surface');
    }
    // Start with placeholders (will update asynchronously if internal tokens)
    setBgVar('--app-content-bg-1', null);
    setBgVar('--app-content-bg-2', null);
    // Resolve (async) then set; race-safe by capturing current token
    const t1 = settings.contentBg1;
    const t2 = settings.contentBg2;
    if (t1) {
        resolveToken(t1).then((u) => {
            if (settings.contentBg1 === t1) setBgVar('--app-content-bg-1', u);
        });
    } else setBgVar('--app-content-bg-1', null);
    if (t2) {
        resolveToken(t2).then((u) => {
            if (settings.contentBg2 === t2) setBgVar('--app-content-bg-2', u);
        });
    } else setBgVar('--app-content-bg-2', null);
    // If an image layer is removed (null) we want the solid color to show, so force opacity 1
    const effectiveBg1Opacity = settings.contentBg1
        ? settings.contentBg1Opacity
        : 1;
    const effectiveBg2Opacity = settings.contentBg2
        ? settings.contentBg2Opacity
        : 1;
    r.setProperty('--app-content-bg-1-opacity', String(effectiveBg1Opacity));
    r.setProperty('--app-content-bg-2-opacity', String(effectiveBg2Opacity));
    // Legacy shared repeat
    r.setProperty('--app-content-bg-repeat', settings.contentRepeat);
    // New per-layer repeats
    r.setProperty('--app-content-bg-1-repeat', settings.contentBg1Repeat);
    r.setProperty('--app-content-bg-2-repeat', settings.contentBg2Repeat);
    // Sizes (cover if fit)
    r.setProperty(
        '--app-content-bg-1-size',
        settings.contentBg1Fit ? 'cover' : settings.contentBg1SizePx + 'px'
    );
    r.setProperty(
        '--app-content-bg-2-size',
        settings.contentBg2Fit ? 'cover' : settings.contentBg2SizePx + 'px'
    );
    setBgVar('--app-sidebar-bg-1', null);
    const ts = settings.sidebarBg;
    if (ts) {
        resolveToken(ts).then((u) => {
            if (settings.sidebarBg === ts) setBgVar('--app-sidebar-bg-1', u);
        });
    } else setBgVar('--app-sidebar-bg-1', null);
    const effectiveSidebarOpacity = settings.sidebarBg
        ? settings.sidebarBgOpacity
        : 1;
    r.setProperty(
        '--app-sidebar-bg-1-opacity',
        String(effectiveSidebarOpacity)
    );
    r.setProperty('--app-sidebar-bg-repeat', settings.sidebarRepeat);
    // Sidebar size variables (optional; fallback to 240px if undefined)
    const sbSize = (settings as any).sidebarBgFit
        ? 'cover'
        : ((settings as any).sidebarBgSizePx || 240) + 'px';
    r.setProperty('--app-sidebar-bg-size', sbSize);
    maybeClampForHighContrast(settings);
}

function isHighContrastActive() {
    if (!isBrowser()) return false;
    const cls = document.documentElement.className;
    return /high-contrast/.test(cls);
}

function maybeClampForHighContrast(settings: ThemeSettings) {
    if (!isBrowser()) return;
    if (!settings.reducePatternsInHighContrast) return;
    if (!isHighContrastActive()) return;
    const r = document.documentElement.style;
    const clampOpacity = (v: number) => Math.min(v, 0.04);
    // Only clamp if image layer present (patterns); if removed we keep solid color full opacity
    if (settings.contentBg1) {
        r.setProperty(
            '--app-content-bg-1-opacity',
            String(clampOpacity(settings.contentBg1Opacity))
        );
    }
    if (settings.contentBg2) {
        r.setProperty(
            '--app-content-bg-2-opacity',
            String(clampOpacity(settings.contentBg2Opacity))
        );
    }
    if (settings.sidebarBg) {
        r.setProperty(
            '--app-sidebar-bg-1-opacity',
            String(clampOpacity(settings.sidebarBgOpacity))
        );
    }
}

function persist(mode: 'light' | 'dark', settings: ThemeSettings) {
    if (!isBrowser()) return;
    try {
        // Mode specific key
        const key =
            mode === 'light'
                ? THEME_SETTINGS_STORAGE_KEY_LIGHT
                : THEME_SETTINGS_STORAGE_KEY_DARK;
        localStorage.setItem(key, JSON.stringify(settings));
        // Legacy combined key (write last active for backward compatibility)
        localStorage.setItem(
            THEME_SETTINGS_STORAGE_KEY,
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
                ? THEME_SETTINGS_STORAGE_KEY_LIGHT
                : THEME_SETTINGS_STORAGE_KEY_DARK;
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const defaults =
            mode === 'light'
                ? DEFAULT_THEME_SETTINGS_LIGHT
                : DEFAULT_THEME_SETTINGS_DARK;
        return sanitize({ ...defaults, ...parsed }, defaults);
    } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[theme-settings] failed to parse stored settings', e);
        return null;
    }
}

function detectModeFromHtml(): 'light' | 'dark' {
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
            const legacyRaw = localStorage.getItem(THEME_SETTINGS_STORAGE_KEY);
            const lightRaw = localStorage.getItem(
                THEME_SETTINGS_STORAGE_KEY_LIGHT
            );
            if (legacyRaw && !lightRaw) {
                localStorage.setItem(
                    THEME_SETTINGS_STORAGE_KEY_LIGHT,
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
                ? DEFAULT_THEME_SETTINGS_LIGHT
                : DEFAULT_THEME_SETTINGS_DARK;
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
                ? DEFAULT_THEME_SETTINGS_LIGHT
                : DEFAULT_THEME_SETTINGS_DARK;
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
            store.light.value = { ...DEFAULT_THEME_SETTINGS_LIGHT };
            persist('light', store.light.value);
        } else {
            store.dark.value = { ...DEFAULT_THEME_SETTINGS_DARK };
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
