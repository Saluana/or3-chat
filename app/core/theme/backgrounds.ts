import type { ThemeBackgroundLayer, ThemeBackgrounds } from '~/theme/_shared/types';
import { getFileBlob } from '~/db/files';

const CACHE_KEY = '__or3ThemeBackgroundTokenCache';
const DEFAULT_REPEAT = 'repeat';
const DEFAULT_SIZE = '150px';
const GRADIENT_FALLBACK_SIZE = 'auto 100%';

const isBrowser = () =>
    typeof window !== 'undefined' && typeof document !== 'undefined';

function getCache(): Map<string, string> {
    const g: any = globalThis as any;
    if (!g[CACHE_KEY]) {
        g[CACHE_KEY] = new Map<string, string>();
    }
    return g[CACHE_KEY];
}

export function createThemeBackgroundTokenResolver() {
    const cache = getCache();
    return async (token: string): Promise<string | null> => {
        if (!token) return null;
        if (!token.startsWith('internal-file://')) {
            return token;
        }
        const hash = token.slice('internal-file://'.length);
        if (cache.has(hash)) {
            return cache.get(hash)!;
        }
        try {
            const blob = await getFileBlob(hash);
            if (!blob) return null;
            const url = URL.createObjectURL(blob);
            cache.set(hash, url);
            return url;
        } catch (error) {
            if (import.meta.dev) {
                console.warn('[theme] Failed to resolve internal token', token, error);
            }
            return null;
        }
    };
}

function clampOpacity(value?: number): number {
    if (typeof value !== 'number' || Number.isNaN(value)) return 1;
    return Math.min(1, Math.max(0, value));
}

function normalizeRepeat(value?: string): string {
    const allowed = new Set(['repeat', 'no-repeat', 'repeat-x', 'repeat-y']);
    if (value && allowed.has(value)) return value;
    return DEFAULT_REPEAT;
}

function determineSize(layer: ThemeBackgroundLayer | undefined, fallback: string): string {
    if (!layer) return fallback;
    if (layer.fit === 'cover') return 'cover';
    if (layer.fit === 'contain') return 'contain';
    if (layer.size) return layer.size;
    return fallback;
}

async function applyLayer(
    cssVar: string,
    layer: ThemeBackgroundLayer | undefined,
    resolveToken: (token: string) => Promise<string | null>
) {
    if (!isBrowser()) return;
    const style = document.documentElement.style;
    if (!layer || !layer.image) {
        style.setProperty(cssVar, 'none');
        style.setProperty(`${cssVar}-opacity`, '1');
        style.setProperty(`${cssVar}-repeat`, DEFAULT_REPEAT);
        style.setProperty(`${cssVar}-size`, DEFAULT_SIZE);
        return;
    }

    const url = await resolveToken(layer.image);
    style.setProperty(cssVar, url ? `url("${url}")` : 'none');
    style.setProperty(`${cssVar}-opacity`, String(clampOpacity(layer.opacity)));
    style.setProperty(`${cssVar}-repeat`, normalizeRepeat(layer.repeat));
    style.setProperty(`${cssVar}-size`, determineSize(layer, DEFAULT_SIZE));
}

async function applyGradient(
    cssVar: string,
    layer: ThemeBackgroundLayer | undefined,
    resolveToken: (token: string) => Promise<string | null>
) {
    if (!isBrowser()) return;
    const style = document.documentElement.style;
    if (!layer || !layer.image) {
        style.setProperty(cssVar, 'none');
        return;
    }
    const url = await resolveToken(layer.image);
    style.setProperty(cssVar, url ? `url("${url}")` : 'none');
}

export async function applyThemeBackgrounds(
    backgrounds: ThemeBackgrounds | undefined,
    options: { resolveToken: (token: string) => Promise<string | null> }
) {
    if (!isBrowser()) return;
    await Promise.all([
        applyLayer('--app-content-bg-1', backgrounds?.content?.base, options.resolveToken),
        applyLayer('--app-content-bg-2', backgrounds?.content?.overlay, options.resolveToken),
        applyLayer('--app-sidebar-bg-1', backgrounds?.sidebar, options.resolveToken),
    ]);
    await Promise.all([
        applyGradient('--app-header-gradient', backgrounds?.headerGradient, options.resolveToken),
        applyGradient('--app-bottomnav-gradient', backgrounds?.bottomNavGradient, options.resolveToken),
    ]);
}

export function buildBackgroundsFromSettings(
    settings: import('./theme-types').ThemeSettings
): ThemeBackgrounds {
    const toLayer = (
        image: string | null,
        opacity: number,
        repeat: ThemeBackgroundLayer['repeat'],
        sizePx: number,
        fit?: boolean
    ): ThemeBackgroundLayer | undefined => {
        if (!image) return undefined;
        return {
            image,
            opacity,
            repeat,
            size: fit ? undefined : `${sizePx}px`,
            fit: fit ? 'cover' : undefined,
        } as ThemeBackgroundLayer;
    };

    return {
        content: {
            base: toLayer(
                settings.contentBg1,
                settings.contentBg1Opacity,
                settings.contentBg1Repeat,
                settings.contentBg1SizePx,
                settings.contentBg1Fit
            ),
            overlay: toLayer(
                settings.contentBg2,
                settings.contentBg2Opacity,
                settings.contentBg2Repeat,
                settings.contentBg2SizePx,
                settings.contentBg2Fit
            ),
        },
        sidebar: toLayer(
            settings.sidebarBg,
            settings.sidebarBgOpacity,
            settings.sidebarRepeat,
            settings.sidebarBgSizePx || 240,
            settings.sidebarBgFit
        ),
        headerGradient: settings.showHeaderGradient
            ? {
                  image: '/gradient-x.webp',
                  repeat: 'repeat',
                  size: GRADIENT_FALLBACK_SIZE,
              }
            : undefined,
        bottomNavGradient: settings.showBottomBarGradient
            ? {
                  image: '/gradient-x.webp',
                  repeat: 'repeat',
                  size: GRADIENT_FALLBACK_SIZE,
              }
            : undefined,
    };
}
