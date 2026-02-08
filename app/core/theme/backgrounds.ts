/**
 * @module app/core/theme/backgrounds
 *
 * Purpose:
 * Applies theme background layers (images, colors, gradients) to the DOM
 * via CSS custom properties. Handles blob URL lifecycle (creation and
 * revocation) for locally stored file-backed backgrounds.
 *
 * Responsibilities:
 * - Resolve `internal-file://` tokens to blob URLs via the Dexie file store
 * - Cache resolved blob URLs globally to avoid repeated blob creation
 * - Apply background image, opacity, size, repeat, and color CSS variables
 * - Apply header and bottom-nav gradient overlays
 * - Revoke all cached blob URLs on cleanup (HMR, theme switch)
 *
 * Constraints:
 * - Client-only (guards via `isBrowserWithDocument()`)
 * - Blob URL cache is global (survives component re-mounts, cleared on HMR)
 * - Background layers follow the `ThemeBackgroundLayer` type from the theme DSL
 * - Default size is `150px`; default repeat is `repeat`
 *
 * @see core/theme/apply-merged-theme for the orchestrator that calls this
 * @see docs/theme-backgrounds.md for the background system specification
 * @see theme/_shared/types for ThemeBackgrounds / ThemeBackgroundLayer types
 */
import type {
    ThemeBackgroundLayer,
    ThemeBackgrounds,
} from '../../theme/_shared/types';
import { getFileBlob } from '../../db/files';
import { isBrowserWithDocument } from '../../utils/env';

const CACHE_KEY = '__or3ThemeBackgroundTokenCache';
const DEFAULT_REPEAT = 'repeat';
const DEFAULT_SIZE = '150px';

function getCache(): Map<string, string> {
    const g = globalThis as typeof globalThis & {
        [CACHE_KEY]?: Map<string, string>;
    };
    if (!g[CACHE_KEY]) {
        g[CACHE_KEY] = new Map<string, string>();
    }
    return g[CACHE_KEY];
}

/**
 * Purpose:
 * Revoke all blob URLs created for resolved background tokens.
 *
 * Behavior:
 * - Calls `URL.revokeObjectURL()` for cached blob URLs
 * - Clears the global token cache
 *
 * Constraints:
 * - Client-only; safe to call during HMR disposal and theme resets
 */
export function revokeBackgroundBlobs() {
    const cache = getCache();
    for (const url of cache.values()) {
        if (url.startsWith('blob:')) {
            URL.revokeObjectURL(url);
        }
    }
    cache.clear();
}

/**
 * Purpose:
 * Invalidate a single cached background token by file hash.
 *
 * Behavior:
 * - Revokes the cached blob URL if present
 * - Removes the entry from the token cache
 */
export function invalidateBackgroundToken(hash: string) {
    const cache = getCache();
    const url = cache.get(hash);
    if (url?.startsWith('blob:')) {
        URL.revokeObjectURL(url);
    }
    cache.delete(hash);
}

/**
 * Purpose:
 * Create a token resolver for theme background image references.
 *
 * Behavior:
 * - Passes through normal URLs
 * - Resolves `internal-file://<hash>` tokens to cached `blob:` URLs
 *
 * Constraints:
 * - Uses a global cache so repeated calls share blob URLs
 */
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
                console.warn(
                    '[theme] Failed to resolve internal token',
                    token,
                    error
                );
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

function determineSize(
    layer: ThemeBackgroundLayer | undefined,
    fallback: string
): string {
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
    if (!isBrowserWithDocument()) return;
    const style = document.documentElement.style;
    const colorVar = getColorVar(cssVar);

    if (colorVar) {
        if (layer?.color && layer.color.trim().length > 0) {
            style.setProperty(colorVar, layer.color);
        } else {
            style.removeProperty(colorVar);
        }
    }

    if (!layer) {
        style.setProperty(cssVar, 'none');
        style.setProperty(`${cssVar}-opacity`, '1');
        style.setProperty(`${cssVar}-repeat`, DEFAULT_REPEAT);
        style.setProperty(`${cssVar}-size`, DEFAULT_SIZE);
        return;
    }

    if (!layer.image) {
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
    if (!isBrowserWithDocument()) return;
    const style = document.documentElement.style;
    if (!layer || !layer.image) {
        style.setProperty(cssVar, 'none');
        return;
    }
    const url = await resolveToken(layer.image);
    style.setProperty(cssVar, url ? `url("${url}")` : 'none');
}

function getColorVar(cssVar: string): string | null {
    switch (cssVar) {
        case '--app-content-bg-1':
            return '--app-content-bg-1-color';
        case '--app-content-bg-2':
            return '--app-content-bg-2-color';
        case '--app-sidebar-bg-1':
            return '--app-sidebar-bg-color';
        default:
            return null;
    }
}

/**
 * Purpose:
 * Apply theme background layers (content/sidebar + gradients) to CSS variables.
 *
 * Behavior:
 * - Resolves layer image tokens using the provided resolver
 * - Writes CSS custom properties on `document.documentElement.style`
 *
 * Constraints:
 * - Client-only; no-ops if `document` is unavailable
 */
export async function applyThemeBackgrounds(
    backgrounds: ThemeBackgrounds | undefined,
    options: { resolveToken: (token: string) => Promise<string | null> }
) {
    if (!isBrowserWithDocument()) return;
    await Promise.all([
        applyLayer(
            '--app-content-bg-1',
            backgrounds?.content?.base,
            options.resolveToken
        ),
        applyLayer(
            '--app-content-bg-2',
            backgrounds?.content?.overlay,
            options.resolveToken
        ),
        applyLayer(
            '--app-sidebar-bg-1',
            backgrounds?.sidebar,
            options.resolveToken
        ),
    ]);
    await Promise.all([
        applyGradient(
            '--app-header-gradient',
            backgrounds?.headerGradient,
            options.resolveToken
        ),
        applyGradient(
            '--app-bottomnav-gradient',
            backgrounds?.bottomNavGradient,
            options.resolveToken
        ),
    ]);
}
