import { describe, expect, it } from 'vitest';
import {
    PLUGIN_ICON_MAX_BYTES,
    PluginIconValidationError,
    validatePluginIconBytes,
} from '../plugin-icon';

const ONE_PIXEL_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
);

function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
    const typeBytes = Buffer.from(type, 'ascii');
    const chunk = Buffer.alloc(12 + data.byteLength);
    chunk.writeUInt32BE(data.byteLength, 0);
    typeBytes.copy(chunk, 4);
    Buffer.from(data).copy(chunk, 8);
    chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, Buffer.from(data)])), 8 + data.byteLength);
    return chunk;
}

function insertBeforeIend(png: Buffer, chunk: Buffer): Buffer {
    return Buffer.concat([png.subarray(0, png.length - 12), chunk, png.subarray(png.length - 12)]);
}

function withWidth(png: Buffer, width: number): Buffer {
    const copy = Buffer.from(png);
    copy.writeUInt32BE(width, 16);
    copy.writeUInt32BE(crc32(copy.subarray(12, 29)), 29);
    return copy;
}

describe('plugin icon validation', () => {
    it('accepts a static transparent PNG and returns bounded metadata', () => {
        expect(validatePluginIconBytes(ONE_PIXEL_PNG, 'assets/icon.png')).toEqual({
            path: 'assets/icon.png',
            mediaType: 'image/png',
            width: 1,
            height: 1,
            byteLength: ONE_PIXEL_PNG.byteLength,
        });
    });

    it('accepts an exactly-at-limit structurally valid PNG', () => {
        const paddingLength = PLUGIN_ICON_MAX_BYTES - ONE_PIXEL_PNG.byteLength - 12;
        const exact = insertBeforeIend(
            ONE_PIXEL_PNG,
            pngChunk('tEXt', Buffer.alloc(paddingLength, 0x61))
        );
        expect(exact.byteLength).toBe(PLUGIN_ICON_MAX_BYTES);
        expect(validatePluginIconBytes(exact, 'icon.png').byteLength).toBe(PLUGIN_ICON_MAX_BYTES);
    });

    it('rejects large, excessive, animated, malformed, and unsupported icons', () => {
        const cases: Array<[Uint8Array, string, string]> = [
            [Buffer.alloc(15 * 1024 * 1024), 'icon.png', 'plugin-icon-too-large'],
            [withWidth(ONE_PIXEL_PNG, 257), 'icon.png', 'plugin-icon-dimensions-too-large'],
            [insertBeforeIend(ONE_PIXEL_PNG, pngChunk('acTL', Buffer.alloc(8))), 'icon.png', 'plugin-icon-animated'],
            [ONE_PIXEL_PNG.subarray(0, 20), 'icon.png', 'plugin-icon-malformed'],
            [ONE_PIXEL_PNG, 'icon.svg', 'plugin-icon-format-unsupported'],
        ];
        for (const [bytes, path, code] of cases) {
            try {
                validatePluginIconBytes(bytes, path);
                throw new Error(`Expected ${code}`);
            } catch (error) {
                expect(error).toBeInstanceOf(PluginIconValidationError);
                expect((error as PluginIconValidationError).code).toBe(code);
            }
        }
    });
});
