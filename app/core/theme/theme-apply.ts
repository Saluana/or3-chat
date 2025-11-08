import type { ThemeSettings } from './theme-types';
import {
    applyThemeBackgrounds,
    buildBackgroundsFromSettings,
    createThemeBackgroundTokenResolver,
} from './backgrounds';

const isBrowser = () =>
    typeof window !== 'undefined' && typeof document !== 'undefined';
const backgroundTokenResolver = createThemeBackgroundTokenResolver();

export function applyToRoot(settings: ThemeSettings) {
    if (!isBrowser()) return; // SSR/test guard
    const r = document.documentElement.style;
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
    // Background layers (content, sidebar, gradients)
    void applyThemeBackgrounds(
        buildBackgroundsFromSettings(settings),
        {
            resolveToken: backgroundTokenResolver,
        }
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
    // Legacy repeat flag (still used by the layout)
    r.setProperty('--app-content-bg-repeat', settings.contentRepeat);
    // Sidebar size vars (optional; fallback to 240px)
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
