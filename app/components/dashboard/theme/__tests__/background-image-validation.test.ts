import { describe, expect, it } from 'vitest';
import {
    backgroundImageValidationMessage,
    MAX_BACKGROUND_IMAGE_BYTES,
    validateBackgroundImageFile,
} from '../types';

function headerFrom(...bytes: number[]): Uint8Array {
    const out = new Uint8Array(12);
    out.set(bytes);
    return out;
}

const PNG = headerFrom(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const JPEG = headerFrom(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10);
const WEBP = headerFrom(
    0x52,
    0x49,
    0x46,
    0x46,
    0x00,
    0x00,
    0x00,
    0x00,
    0x57,
    0x45,
    0x42,
    0x50
);
const GIF = headerFrom(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
const HEIC = headerFrom(
    0x00,
    0x00,
    0x00,
    0x18,
    0x66,
    0x74,
    0x79,
    0x70,
    0x68,
    0x65,
    0x69,
    0x63
);

describe('background image validation', () => {
    it.each([
        ['image/png', PNG],
        ['image/jpeg', JPEG],
        ['image/webp', WEBP],
        ['image/gif', GIF],
    ] as const)('accepts %s magic bytes when File.type is empty', (mime, header) => {
        expect(
            validateBackgroundImageFile({ type: '', size: 128_000, header })
        ).toEqual({ ok: true, mime });
    });

    it('rejects oversized images', () => {
        const result = validateBackgroundImageFile({
            type: 'image/jpeg',
            size: MAX_BACKGROUND_IMAGE_BYTES + 1,
            header: JPEG,
        });
        expect(result).toEqual({ ok: false, reason: 'too_large' });
        expect(backgroundImageValidationMessage('too_large')).toMatch(/MB/);
    });

    it('rejects HEIC/HEIF with a specific reason', () => {
        const result = validateBackgroundImageFile({
            type: 'image/heic',
            size: 500_000,
            header: HEIC,
        });
        expect(result).toEqual({ ok: false, reason: 'heic' });
        expect(backgroundImageValidationMessage('heic')).toMatch(/HEIC/);
    });

    it('rejects unknown bytes even if MIME claims image/*', () => {
        const result = validateBackgroundImageFile({
            type: 'image/png',
            size: 2048,
            header: headerFrom(0x00, 0x01, 0x02, 0x03),
        });
        expect(result).toEqual({ ok: false, reason: 'unsupported_type' });
    });
});
