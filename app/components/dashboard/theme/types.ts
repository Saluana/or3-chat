/**
 * Shared types for theme settings components
 */

/** Material Design 3 color keys */
export type ColorKey = 
  | 'primary' | 'onPrimary' | 'primaryContainer' | 'onPrimaryContainer'
  | 'secondary' | 'onSecondary' | 'secondaryContainer' | 'onSecondaryContainer'
  | 'tertiary' | 'onTertiary' | 'tertiaryContainer' | 'onTertiaryContainer'
  | 'error' | 'onError' | 'errorContainer' | 'onErrorContainer'
  | 'surface' | 'onSurface' | 'surfaceVariant' | 'onSurfaceVariant'
  | 'inverseSurface' | 'inverseOnSurface' | 'outline' | 'outlineVariant'
  | 'success' | 'warning';

/** Local hex input keys (includes background colors and palette colors) */
export type LocalHexKeys = ColorKey | 'contentBg1Color' | 'contentBg2Color' | 'sidebarBgColor';

/** Allowed image types for security */
export const ALLOWED_IMAGE_TYPES = [
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
] as const;

/**
 * Validate image file magic number for security
 */
export function validateImageMagicNumber(header: Uint8Array): boolean {
    const isPNG = header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47;
    const isJPEG = header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF;
    const isWebP = header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50;
    const isGIF = header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46;
    return isPNG || isJPEG || isWebP || isGIF;
}

/** Color group structure for organized UI */
export interface ColorGroup {
    label: string;
    colors: Array<{
        key: string;
        label: string;
    }>;
}

/** Preset for background images */
export interface BackgroundPreset {
    label: string;
    src: string;
    opacity: number;
}
