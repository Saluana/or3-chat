/**
 * Shared types for theme settings components
 */

import type { RegisteredColorToken } from '~/theme/_shared/design-token-registry';

/** User-overridable theme color keys. */
export type ColorKey = RegisteredColorToken;

/** Local hex input keys (includes background colors and palette colors) */
export type LocalHexKeys = ColorKey | 'contentBg1Color' | 'contentBg2Color' | 'sidebarBgColor';

/** Allowed image types for security */
export const ALLOWED_IMAGE_TYPES = [
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
] as const;

export type AllowedBackgroundImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

/** Max size for dashboard background uploads (camera photos often exceed 2MB). */
export const MAX_BACKGROUND_IMAGE_BYTES = 8 * 1024 * 1024;

export type BackgroundImageValidationFailure =
    | 'too_large'
    | 'unsupported_type'
    | 'heic'
    | 'empty';

export type BackgroundImageValidationResult =
    | { ok: true; mime: AllowedBackgroundImageType }
    | { ok: false; reason: BackgroundImageValidationFailure };

/**
 * Type predicate for checking if a MIME type is in the allowed list
 */
export function isAllowedImageType(
    type: string
): type is AllowedBackgroundImageType {
    return ALLOWED_IMAGE_TYPES.some((allowed) => allowed === type);
}

/**
 * Detect image MIME from file magic numbers.
 * Used when browsers leave `File.type` empty (common on macOS Finder picks).
 */
export function detectImageMimeFromMagic(
    header: Uint8Array
): AllowedBackgroundImageType | null {
    if (header.length < 12) return null;

    // PNG: 89 50 4E 47
    if (
        header[0] === 0x89 &&
        header[1] === 0x50 &&
        header[2] === 0x4e &&
        header[3] === 0x47
    ) {
        return 'image/png';
    }

    // JPEG: FF D8 FF
    if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
        return 'image/jpeg';
    }

    // WebP: RIFF .... WEBP
    if (
        header[0] === 0x52 &&
        header[1] === 0x49 &&
        header[2] === 0x46 &&
        header[3] === 0x46 &&
        header[8] === 0x57 &&
        header[9] === 0x45 &&
        header[10] === 0x42 &&
        header[11] === 0x50
    ) {
        return 'image/webp';
    }

    // GIF: GIF8
    if (header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46) {
        return 'image/gif';
    }

    return null;
}

/**
 * Validate image file magic number for security
 */
export function validateImageMagicNumber(header: Uint8Array): boolean {
    return detectImageMimeFromMagic(header) !== null;
}

/** HEIC/HEIF from iPhone/macOS Photos — browsers cannot paint these as CSS backgrounds. */
export function isLikelyHeicOrHeif(header: Uint8Array): boolean {
    if (header.length < 12) return false;
    const isFtyp =
        header[4] === 0x66 &&
        header[5] === 0x74 &&
        header[6] === 0x79 &&
        header[7] === 0x70;
    if (!isFtyp) return false;
    const brand = String.fromCharCode(
        header[8]!,
        header[9]!,
        header[10]!,
        header[11]!
    ).toLowerCase();
    return (
        brand === 'heic' ||
        brand === 'heif' ||
        brand === 'mif1' ||
        brand === 'msf1' ||
        brand === 'heim' ||
        brand === 'heis'
    );
}

/**
 * Validate a candidate background image using size + magic bytes.
 * Declared MIME is ignored when empty or wrong; magic bytes are authoritative.
 */
export function validateBackgroundImageFile(input: {
    type: string;
    size: number;
    header: Uint8Array;
}): BackgroundImageValidationResult {
    if (!Number.isFinite(input.size) || input.size <= 0) {
        return { ok: false, reason: 'empty' };
    }
    if (input.size > MAX_BACKGROUND_IMAGE_BYTES) {
        return { ok: false, reason: 'too_large' };
    }

    const mime = detectImageMimeFromMagic(input.header);
    if (mime) {
        return { ok: true, mime };
    }

    if (isLikelyHeicOrHeif(input.header)) {
        return { ok: false, reason: 'heic' };
    }

    // Declared type alone is never enough — reject without valid magic.
    void input.type;
    return { ok: false, reason: 'unsupported_type' };
}

export function backgroundImageValidationMessage(
    reason: BackgroundImageValidationFailure
): string {
    switch (reason) {
        case 'too_large':
            return `Image must be ${Math.round(MAX_BACKGROUND_IMAGE_BYTES / (1024 * 1024))}MB or smaller.`;
        case 'heic':
            return 'HEIC/HEIF photos are not supported. Export as JPEG or PNG and try again.';
        case 'empty':
            return 'That file looks empty. Pick a different image.';
        case 'unsupported_type':
        default:
            return 'Use a PNG, JPEG, WebP, or GIF image.';
    }
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
