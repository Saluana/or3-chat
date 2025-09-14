import { ref, reactive, watch, toRaw } from 'vue';

/**
 * Theme customization settings (v1)
 * Future versions can extend while preserving backward compatibility.
 */
export interface ThemeSettings {
    baseFontPx: number; // 14..24
    useSystemFont: boolean; // when true, override both body and heading fonts with system stack
    contentBg1: string | null;
    contentBg2: string | null;
    contentBg1Opacity: number; // 0..1
    contentBg2Opacity: number; // 0..1
    sidebarBg: string | null;
    sidebarBgOpacity: number; // 0..1
    sidebarRepeat: 'repeat' | 'no-repeat';
    contentRepeat: 'repeat' | 'no-repeat';
    reducePatternsInHighContrast: boolean;
}

export const THEME_SETTINGS_STORAGE_KEY = 'theme:settings:v1';

export const DEFAULT_THEME_SETTINGS: ThemeSettings = Object.freeze({
    baseFontPx: 20,
    useSystemFont: false,
    contentBg1: '/bg-repeat.webp',
    contentBg2: '/bg-repeat-2.webp',
    contentBg1Opacity: 0.08,
    contentBg2Opacity: 0.125,
    sidebarBg: '/sidebar-repeater.webp',
    sidebarBgOpacity: 0.1,
    sidebarRepeat: 'repeat',
    contentRepeat: 'repeat',
    reducePatternsInHighContrast: true,
});

// singleton guard (HMR safe)
const g: any = globalThis as any;
if (!g.__or3ThemeSettingsStore) {
    g.__or3ThemeSettingsStore = {
        settings: ref<ThemeSettings>({ ...DEFAULT_THEME_SETTINGS }),
        loaded: false,
    };
}

const store = g.__or3ThemeSettingsStore as {
    settings: ReturnType<typeof ref<ThemeSettings>>; // guaranteed initialized
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
        v.startsWith('http://') ||
        v.startsWith('https://')
    );
}

function sanitize(s: ThemeSettings): ThemeSettings {
    const out: ThemeSettings = { ...s } as ThemeSettings;
    out.baseFontPx = clamp(Math.round(out.baseFontPx), 14, 24);
    out.useSystemFont = !!out.useSystemFont;
    out.contentBg1 =
        out.contentBg1 && isValidImageValue(out.contentBg1)
            ? out.contentBg1
            : DEFAULT_THEME_SETTINGS.contentBg1;
    out.contentBg2 =
        out.contentBg2 && isValidImageValue(out.contentBg2)
            ? out.contentBg2
            : null;
    out.sidebarBg =
        out.sidebarBg && isValidImageValue(out.sidebarBg)
            ? out.sidebarBg
            : DEFAULT_THEME_SETTINGS.sidebarBg;
    out.contentBg1Opacity = +clamp(out.contentBg1Opacity, 0, 1).toFixed(3);
    out.contentBg2Opacity = +clamp(out.contentBg2Opacity, 0, 1).toFixed(3);
    out.sidebarBgOpacity = +clamp(out.sidebarBgOpacity, 0, 1).toFixed(3);
    out.sidebarRepeat =
        out.sidebarRepeat === 'no-repeat' ? 'no-repeat' : 'repeat';
    out.contentRepeat =
        out.contentRepeat === 'no-repeat' ? 'no-repeat' : 'repeat';
    out.reducePatternsInHighContrast = !!out.reducePatternsInHighContrast;
    return out;
}

function isBrowser() {
    return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function applyToRoot(settings: ThemeSettings) {
    if (!isBrowser()) return; // SSR/test guard
    const r = document.documentElement.style;
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
    r.setProperty(
        '--app-content-bg-1',
        settings.contentBg1 ? `url("${settings.contentBg1}")` : 'none'
    );
    r.setProperty(
        '--app-content-bg-2',
        settings.contentBg2 ? `url("${settings.contentBg2}")` : 'none'
    );
    r.setProperty(
        '--app-content-bg-1-opacity',
        String(settings.contentBg1Opacity)
    );
    r.setProperty(
        '--app-content-bg-2-opacity',
        String(settings.contentBg2Opacity)
    );
    r.setProperty('--app-content-bg-repeat', settings.contentRepeat);
    r.setProperty(
        '--app-sidebar-bg-1',
        settings.sidebarBg ? `url("${settings.sidebarBg}")` : 'none'
    );
    r.setProperty(
        '--app-sidebar-bg-1-opacity',
        String(settings.sidebarBgOpacity)
    );
    r.setProperty('--app-sidebar-bg-repeat', settings.sidebarRepeat);
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
    r.setProperty(
        '--app-content-bg-1-opacity',
        String(clampOpacity(settings.contentBg1Opacity))
    );
    r.setProperty(
        '--app-content-bg-2-opacity',
        String(clampOpacity(settings.contentBg2Opacity))
    );
    r.setProperty(
        '--app-sidebar-bg-1-opacity',
        String(clampOpacity(settings.sidebarBgOpacity))
    );
}

function persist(settings: ThemeSettings) {
    if (!isBrowser()) return;
    try {
        localStorage.setItem(
            THEME_SETTINGS_STORAGE_KEY,
            JSON.stringify(settings)
        );
    } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[theme-settings] failed to persist settings', e);
    }
}

function loadFromStorage(): ThemeSettings | null {
    if (!isBrowser()) return null;
    try {
        const raw = localStorage.getItem(THEME_SETTINGS_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return sanitize({ ...DEFAULT_THEME_SETTINGS, ...parsed });
    } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[theme-settings] failed to parse stored settings', e);
        return null;
    }
}

/** Public composable API */
export function useThemeSettings() {
    if (!store.loaded && isBrowser()) {
        const loaded = loadFromStorage();
        if (loaded) store.settings.value = loaded as ThemeSettings;
        // Apply immediately
        applyToRoot(store.settings.value as ThemeSettings);
        store.loaded = true;
    }

    function set(patch: Partial<ThemeSettings>) {
        const base = store.settings.value as ThemeSettings;
        // Construct object ensuring all required keys present before sanitize
        const mergedInput: ThemeSettings = {
            ...base,
            ...patch,
        } as ThemeSettings;
        const merged = sanitize(mergedInput);
        store.settings.value = merged as ThemeSettings;
        applyToRoot(merged as ThemeSettings);
        persist(merged as ThemeSettings);
    }

    function reset() {
        store.settings.value = { ...DEFAULT_THEME_SETTINGS };
        applyToRoot(store.settings.value);
        if (process.client) localStorage.removeItem(THEME_SETTINGS_STORAGE_KEY);
    }

    function load(): ThemeSettings {
        if (!isBrowser()) return store.settings.value as ThemeSettings;
        const fresh = loadFromStorage();
        if (fresh) {
            store.settings.value = fresh as ThemeSettings;
            applyToRoot(fresh as ThemeSettings);
        }
        return store.settings.value as ThemeSettings;
    }

    function reapply() {
        applyToRoot(store.settings.value as ThemeSettings);
    }

    // Deep watch (client only) to auto-apply variable changes if mutated directly
    if (isBrowser()) {
        watch(
            store.settings, // ref<ThemeSettings>
            (v) => {
                applyToRoot(v as ThemeSettings);
                persist(v as ThemeSettings);
            },
            { deep: true }
        );
    }

    return {
        settings: store.settings,
        set,
        reset,
        load,
        reapply,
        applyToRoot,
    };
}
