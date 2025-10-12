export interface ThemeSettings {
    baseFontPx: number;
    useSystemFont: boolean;
    showHeaderGradient: boolean;
    showBottomBarGradient: boolean;
    customBgColorsEnabled: boolean;
    contentBg1Color: string;
    contentBg2Color: string;
    sidebarBgColor: string;
    headerBgColor: string;
    bottomBarBgColor: string;
    contentBg1: string | null;
    contentBg2: string | null;
    contentBg1Opacity: number;
    contentBg2Opacity: number;
    contentBg1Repeat: 'repeat' | 'no-repeat';
    contentBg2Repeat: 'repeat' | 'no-repeat';
    contentBg1SizePx: number;
    contentBg2SizePx: number;
    contentBg1Fit: boolean;
    contentBg2Fit: boolean;
    sidebarBg: string | null;
    sidebarBgOpacity: number;
    sidebarRepeat: 'repeat' | 'no-repeat';
    sidebarBgSizePx?: number;
    sidebarBgFit?: boolean;
    contentRepeat: 'repeat' | 'no-repeat';
    reducePatternsInHighContrast: boolean;
    paletteEnabled?: boolean;
    palettePrimary?: string;
    paletteSecondary?: string;
    paletteError?: string;
    paletteSurfaceVariant?: string;
    paletteBorder?: string;
    paletteSurface?: string;
}

export type ThemeMode = 'light' | 'dark';
