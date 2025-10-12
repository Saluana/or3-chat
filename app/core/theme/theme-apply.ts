import type { ThemeSettings } from './theme-types';
import { getFileBlob } from '~/db/files';

const g: any = globalThis as any;
function isBrowser() {
    return typeof window !== 'undefined' && typeof document !== 'undefined';
}

export function applyToRoot(settings: ThemeSettings) {
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
    const setBgVar = (varName: string, urlOrNone: string | null) => {
        r.setProperty(varName, urlOrNone ? `url("${urlOrNone}")` : 'none');
    };
    const setVar = (name: string, value: string | null) => {
        if (value == null) r.removeProperty(name);
        else r.setProperty(name, value);
    };
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
    const colorMappings: Array<[keyof ThemeSettings, string]> = [
        ['contentBg1Color', '--app-content-bg-1-color'],
        ['contentBg2Color', '--app-content-bg-2-color'],
        ['sidebarBgColor', '--app-sidebar-bg-color'],
        ['headerBgColor', '--app-header-bg-color'],
        ['bottomBarBgColor', '--app-bottomnav-bg-color'],
    ];
    for (const [k, cssVar] of colorMappings) {
        if (settings.customBgColorsEnabled)
            setVar(cssVar, (settings as any)[k]);
        else r.removeProperty(cssVar);
    }
    // Palette overrides (primary/secondary/error/surfaceVariant/border/surface)
    const anySettings: any = settings as any;
    const paletteMap: Array<[keyof ThemeSettings, string]> = [
        ['palettePrimary', '--md-primary'],
        ['paletteSecondary', '--md-secondary'],
        ['paletteError', '--md-error'],
        ['paletteSurfaceVariant', '--md-surface-variant'],
        ['paletteBorder', '--md-inverse-surface'],
        ['paletteSurface', '--md-surface'],
    ];
    if (anySettings.paletteEnabled) {
        for (const [key, cssVar] of paletteMap) {
            const v = anySettings[key];
            if (v) r.setProperty(cssVar, v);
        }
    } else {
        for (const [, cssVar] of paletteMap) r.removeProperty(cssVar);
    }
    // Start with placeholders (will update asynchronously if internal tokens)
    setBgVar('--app-content-bg-1', null);
    setBgVar('--app-content-bg-2', null);
    // Resolve (async) then set; race-safe by capturing current token
    const t1 = settings.contentBg1;
    const t2 = settings.contentBg2;
    if (t1)
        resolveToken(t1).then((u) => {
            if (settings.contentBg1 === t1) setBgVar('--app-content-bg-1', u);
        });
    else setBgVar('--app-content-bg-1', null);
    if (t2)
        resolveToken(t2).then((u) => {
            if (settings.contentBg2 === t2) setBgVar('--app-content-bg-2', u);
        });
    else setBgVar('--app-content-bg-2', null);
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
    if (ts)
        resolveToken(ts).then((u) => {
            if (settings.sidebarBg === ts) setBgVar('--app-sidebar-bg-1', u);
        });
    else setBgVar('--app-sidebar-bg-1', null);
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
    const clampTargets: Array<[boolean, string, number]> = [
        [
            !!settings.contentBg1,
            '--app-content-bg-1-opacity',
            settings.contentBg1Opacity,
        ],
        [
            !!settings.contentBg2,
            '--app-content-bg-2-opacity',
            settings.contentBg2Opacity,
        ],
        [
            !!settings.sidebarBg,
            '--app-sidebar-bg-1-opacity',
            settings.sidebarBgOpacity,
        ],
    ];
    for (const [present, cssVar, v] of clampTargets) {
        if (present) r.setProperty(cssVar, String(clampOpacity(v)));
    }
}
