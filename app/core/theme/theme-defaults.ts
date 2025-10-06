import type { ThemeSettings } from './theme-types';

export const THEME_SETTINGS_STORAGE_KEY = 'theme:settings:v1';
export const THEME_SETTINGS_STORAGE_KEY_LIGHT = 'theme:settings:v1:light';
export const THEME_SETTINGS_STORAGE_KEY_DARK = 'theme:settings:v1:dark';

const BASE = Object.freeze({
    baseFontPx: 20,
    useSystemFont: false,
    showHeaderGradient: true,
    showBottomBarGradient: true,
    customBgColorsEnabled: false,
    contentBg1: '/bg-repeat.webp',
    contentBg2: '/bg-repeat-2.webp',
    contentBg1Repeat: 'repeat' as const,
    contentBg2Repeat: 'repeat' as const,
    contentBg1SizePx: 150,
    contentBg2SizePx: 380,
    contentBg1Fit: false,
    contentBg2Fit: false,
    sidebarBg: '/sidebar-repeater.webp',
    sidebarRepeat: 'repeat' as const,
    sidebarBgSizePx: 240,
    sidebarBgFit: false,
    contentRepeat: 'repeat' as const,
    reducePatternsInHighContrast: true,
    paletteEnabled: false,
});

export const DEFAULT_THEME_SETTINGS_LIGHT: ThemeSettings = Object.freeze({
    ...BASE,
    contentBg1Color: 'var(--md-surface)',
    contentBg2Color: 'var(--md-surface)',
    sidebarBgColor: 'var(--md-surface-container-lowest)',
    headerBgColor: 'var(--md-surface-variant)',
    bottomBarBgColor: 'var(--md-surface-variant)',
    contentBg1Opacity: 0.08,
    contentBg2Opacity: 0.125,
    sidebarBgOpacity: 0.1,
    palettePrimary: '#2c638b',
    paletteSecondary: '#51606f',
    paletteError: '#ba1a1a',
    paletteSurfaceVariant: '#dee3eb',
    paletteBorder: '#2d3135',
    paletteSurface: '#f7f9ff',
});

export const DEFAULT_THEME_SETTINGS_DARK: ThemeSettings = Object.freeze({
    ...BASE,
    contentBg1Color: 'var(--md-surface-dim)',
    contentBg2Color: 'var(--md-surface-container)',
    sidebarBgColor: 'var(--md-surface)',
    headerBgColor: 'var(--md-surface-container-high)',
    bottomBarBgColor: 'var(--md-surface-container-high)',
    contentBg1Opacity: 0.03,
    contentBg2Opacity: 0.05,
    sidebarBgOpacity: 0.12,
    palettePrimary: '#99ccf9',
    paletteSecondary: '#b8c8da',
    paletteError: '#ffb4ab',
    paletteSurfaceVariant: '#42474e',
    paletteBorder: '#5a7d96',
    paletteSurface: '#101418',
});

export const DEFAULT_THEME_SETTINGS = DEFAULT_THEME_SETTINGS_LIGHT;
