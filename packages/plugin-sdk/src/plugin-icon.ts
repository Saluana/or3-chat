import { inflateSync } from 'node:zlib';

export const PLUGIN_ICON_MAX_BYTES = 128 * 1024;
export const PLUGIN_ICON_MAX_DIMENSION = 256;

export type PluginIconMediaType = 'image/png' | 'image/webp';

export interface VerifiedPluginIcon {
    readonly path: string;
    readonly mediaType: PluginIconMediaType;
    readonly width: number;
    readonly height: number;
    readonly byteLength: number;
}

export type PluginIconValidationCode =
    | 'plugin-icon-missing'
    | 'plugin-icon-too-large'
    | 'plugin-icon-format-unsupported'
    | 'plugin-icon-malformed'
    | 'plugin-icon-animated'
    | 'plugin-icon-dimensions-invalid'
    | 'plugin-icon-dimensions-too-large';

export class PluginIconValidationError extends Error {
    constructor(
        readonly code: PluginIconValidationCode,
        message: string,
        readonly path?: string
    ) {
        super(message);
        this.name = 'PluginIconValidationError';
    }
}

/** Read only the optional V2 icon path; full manifest validation remains authoritative. */
export function declaredPluginIconPath(manifestBytes: Uint8Array): string | null {
    try {
        const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as unknown;
        if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return null;
        const record = manifest as Record<string, unknown>;
        return record.manifestVersion === 2 && typeof record.icon === 'string'
            ? record.icon
            : null;
    } catch {
        return null;
    }
}

function fail(code: PluginIconValidationCode, message: string, path: string): never {
    throw new PluginIconValidationError(code, message, path);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
    return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function readU32Be(bytes: Uint8Array, offset: number): number {
    return (
        bytes[offset]! * 0x1000000 +
        bytes[offset + 1]! * 0x10000 +
        bytes[offset + 2]! * 0x100 +
        bytes[offset + 3]!
    );
}

function readU32Le(bytes: Uint8Array, offset: number): number {
    return (
        bytes[offset]! +
        bytes[offset + 1]! * 0x100 +
        bytes[offset + 2]! * 0x10000 +
        bytes[offset + 3]! * 0x1000000
    );
}

function crc32(bytes: Uint8Array, start: number, end: number): number {
    let crc = 0xffffffff;
    for (let index = start; index < end; index += 1) {
        crc ^= bytes[index]!;
        for (let bit = 0; bit < 8; bit += 1) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function validateDimensions(width: number, height: number, path: string): void {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
        fail('plugin-icon-dimensions-invalid', 'Plugin icon dimensions must be positive integers', path);
    }
    if (width > PLUGIN_ICON_MAX_DIMENSION || height > PLUGIN_ICON_MAX_DIMENSION) {
        fail(
            'plugin-icon-dimensions-too-large',
            `Plugin icon dimensions must not exceed ${PLUGIN_ICON_MAX_DIMENSION} × ${PLUGIN_ICON_MAX_DIMENSION} pixels`,
            path
        );
    }
}

function parsePng(bytes: Uint8Array, path: string): { width: number; height: number } {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length < 33 || signature.some((byte, index) => bytes[index] !== byte)) {
        fail('plugin-icon-malformed', 'Plugin PNG icon has an invalid signature', path);
    }
    let offset = 8;
    let width = 0;
    let height = 0;
    let sawHeader = false;
    let sawEnd = false;
    let sawImageData = false;
    let imageDataBytes = 0;
    let sawPalette = false;
    let bitDepth = 0;
    let colorType = 0;
    let interlace = 0;
    const imageChunks: Uint8Array[] = [];
    while (offset + 12 <= bytes.length) {
        const length = readU32Be(bytes, offset);
        const dataStart = offset + 8;
        const dataEnd = dataStart + length;
        const chunkEnd = dataEnd + 4;
        if (dataEnd < dataStart || chunkEnd > bytes.length) {
            fail('plugin-icon-malformed', 'Plugin PNG icon contains a truncated chunk', path);
        }
        const type = ascii(bytes, offset + 4, 4);
        const expectedCrc = readU32Be(bytes, dataEnd);
        if (crc32(bytes, offset + 4, dataEnd) !== expectedCrc) {
            fail('plugin-icon-malformed', `Plugin PNG icon has an invalid ${type} checksum`, path);
        }
        if (!sawHeader) {
            if (type !== 'IHDR' || length !== 13) {
                fail('plugin-icon-malformed', 'Plugin PNG icon must begin with IHDR', path);
            }
            width = readU32Be(bytes, dataStart);
            height = readU32Be(bytes, dataStart + 4);
            bitDepth = bytes[dataStart + 8]!;
            colorType = bytes[dataStart + 9]!;
            interlace = bytes[dataStart + 12]!;
            const validDepths: Record<number, number[]> = {
                0: [1, 2, 4, 8, 16],
                2: [8, 16],
                3: [1, 2, 4, 8],
                4: [8, 16],
                6: [8, 16],
            };
            if (
                !validDepths[colorType]?.includes(bitDepth) ||
                bytes[dataStart + 10] !== 0 ||
                bytes[dataStart + 11] !== 0 ||
                ![0, 1].includes(interlace)
            ) {
                fail('plugin-icon-malformed', 'Plugin PNG icon has unsupported image encoding', path);
            }
            validateDimensions(width, height, path);
            sawHeader = true;
        }
        if (type === 'IHDR' && offset !== 8) {
            fail('plugin-icon-malformed', 'Plugin PNG icon has duplicate headers', path);
        }
        if (type === 'PLTE') {
            if (sawPalette || sawImageData || length < 3 || length > 768 || length % 3 !== 0) {
                fail('plugin-icon-malformed', 'Plugin PNG icon has an invalid palette', path);
            }
            sawPalette = true;
        }
        if (type === 'IDAT') {
            sawImageData = true;
            imageDataBytes += length;
            imageChunks.push(bytes.subarray(dataStart, dataEnd));
        }
        if (type === 'acTL') {
            fail('plugin-icon-animated', 'Animated PNG plugin icons are not supported', path);
        }
        if (type === 'IEND') {
            if (length !== 0 || chunkEnd !== bytes.length) {
                fail('plugin-icon-malformed', 'Plugin PNG icon has an invalid IEND chunk', path);
            }
            sawEnd = true;
            break;
        }
        offset = chunkEnd;
    }
    if (
        !sawHeader || !sawEnd || !sawImageData || imageDataBytes < 6 ||
        (colorType === 3 && !sawPalette)
    ) {
        fail('plugin-icon-malformed', 'Plugin PNG icon is incomplete', path);
    }
    const channels = colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 1;
    const bitsPerPixel = channels * bitDepth;
    const passes = interlace === 0
        ? [[0, 0, 1, 1]]
        : [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
    const rowLengths: number[] = [];
    for (const [x, y, dx, dy] of passes) {
        const passWidth = Math.max(0, Math.ceil((width - x!) / dx!));
        const passHeight = Math.max(0, Math.ceil((height - y!) / dy!));
        if (!passWidth || !passHeight) continue;
        const rowLength = Math.ceil((passWidth * bitsPerPixel) / 8);
        for (let row = 0; row < passHeight; row += 1) rowLengths.push(rowLength);
    }
    const expectedLength = rowLengths.reduce((sum, length) => sum + length + 1, 0);
    let inflated: Uint8Array;
    try {
        inflated = inflateSync(Buffer.concat(imageChunks), { maxOutputLength: expectedLength + 1 });
    } catch {
        fail('plugin-icon-malformed', 'Plugin PNG icon has invalid image data', path);
    }
    if (inflated.length !== expectedLength) {
        fail('plugin-icon-malformed', 'Plugin PNG icon has incomplete image data', path);
    }
    let rowOffset = 0;
    for (const rowLength of rowLengths) {
        if (inflated[rowOffset]! > 4) {
            fail('plugin-icon-malformed', 'Plugin PNG icon has an invalid row filter', path);
        }
        rowOffset += rowLength + 1;
    }
    return { width, height };
}

function parseWebp(bytes: Uint8Array, path: string): { width: number; height: number } {
    if (
        bytes.length < 20 ||
        ascii(bytes, 0, 4) !== 'RIFF' ||
        ascii(bytes, 8, 4) !== 'WEBP' ||
        readU32Le(bytes, 4) + 8 !== bytes.length
    ) {
        fail('plugin-icon-malformed', 'Plugin WebP icon has an invalid RIFF container', path);
    }
    let offset = 12;
    let dimensions: { width: number; height: number } | null = null;
    let sawFrame = false;
    while (offset + 8 <= bytes.length) {
        const type = ascii(bytes, offset, 4);
        const length = readU32Le(bytes, offset + 4);
        const dataStart = offset + 8;
        const dataEnd = dataStart + length;
        const chunkEnd = dataEnd + (length & 1);
        if (dataEnd < dataStart || chunkEnd > bytes.length) {
            fail('plugin-icon-malformed', 'Plugin WebP icon contains a truncated chunk', path);
        }
        if (type === 'ANIM' || type === 'ANMF') {
            fail('plugin-icon-animated', 'Animated WebP plugin icons are not supported', path);
        }
        if (type === 'VP8X') {
            if (offset !== 12 || dimensions !== null || sawFrame) {
                fail('plugin-icon-malformed', 'Plugin WebP VP8X chunk must precede the image frame', path);
            }
            if (length !== 10) fail('plugin-icon-malformed', 'Plugin WebP VP8X chunk is invalid', path);
            if ((bytes[dataStart]! & 0x02) !== 0) {
                fail('plugin-icon-animated', 'Animated WebP plugin icons are not supported', path);
            }
            dimensions = {
                width:
                    1 + bytes[dataStart + 4]! + (bytes[dataStart + 5]! << 8) + (bytes[dataStart + 6]! << 16),
                height:
                    1 + bytes[dataStart + 7]! + (bytes[dataStart + 8]! << 8) + (bytes[dataStart + 9]! << 16),
            };
        } else if (type === 'VP8 ') {
            if (
                length <= 10 ||
                bytes[dataStart + 3] !== 0x9d ||
                bytes[dataStart + 4] !== 0x01 ||
                bytes[dataStart + 5] !== 0x2a
            ) {
                fail('plugin-icon-malformed', 'Plugin WebP VP8 frame header is invalid', path);
            }
            const frameTag = bytes[dataStart]! | (bytes[dataStart + 1]! << 8) | (bytes[dataStart + 2]! << 16);
            const firstPartitionBytes = frameTag >>> 5;
            if ((frameTag & 1) !== 0 || firstPartitionBytes === 0 || 10 + firstPartitionBytes > length) {
                fail('plugin-icon-malformed', 'Plugin WebP VP8 frame data is incomplete', path);
            }
            const frameDimensions = {
                width: (bytes[dataStart + 6]! | (bytes[dataStart + 7]! << 8)) & 0x3fff,
                height: (bytes[dataStart + 8]! | (bytes[dataStart + 9]! << 8)) & 0x3fff,
            };
            if (sawFrame || (dimensions &&
                (dimensions.width !== frameDimensions.width || dimensions.height !== frameDimensions.height))) {
                fail('plugin-icon-malformed', 'Plugin WebP icon has conflicting frames', path);
            }
            dimensions = frameDimensions;
            sawFrame = true;
        } else if (type === 'VP8L') {
            if (length <= 5 || bytes[dataStart] !== 0x2f) {
                fail('plugin-icon-malformed', 'Plugin WebP VP8L frame header is invalid', path);
            }
            const bits = readU32Le(bytes, dataStart + 1);
            const frameDimensions = {
                width: (bits & 0x3fff) + 1,
                height: ((bits >>> 14) & 0x3fff) + 1,
            };
            if (sawFrame || (dimensions &&
                (dimensions.width !== frameDimensions.width || dimensions.height !== frameDimensions.height))) {
                fail('plugin-icon-malformed', 'Plugin WebP icon has conflicting frames', path);
            }
            dimensions = frameDimensions;
            sawFrame = true;
        }
        offset = chunkEnd;
    }
    if (offset !== bytes.length || dimensions === null || !sawFrame) {
        fail('plugin-icon-malformed', 'Plugin WebP icon has no valid image frame', path);
    }
    return dimensions;
}

export function validatePluginIconBytes(bytes: Uint8Array, path: string): VerifiedPluginIcon {
    if (bytes.byteLength > PLUGIN_ICON_MAX_BYTES) {
        fail(
            'plugin-icon-too-large',
            `Plugin icon exceeds the ${PLUGIN_ICON_MAX_BYTES} byte limit`,
            path
        );
    }
    const extension = path.slice(path.lastIndexOf('.')).toLowerCase();
    let mediaType: PluginIconMediaType;
    let dimensions: { width: number; height: number };
    if (extension === '.png') {
        mediaType = 'image/png';
        dimensions = parsePng(bytes, path);
    } else if (extension === '.webp') {
        mediaType = 'image/webp';
        dimensions = parseWebp(bytes, path);
    } else {
        fail('plugin-icon-format-unsupported', 'Plugin icons must be PNG or WebP files', path);
    }
    validateDimensions(dimensions.width, dimensions.height, path);
    return Object.freeze({
        path,
        mediaType,
        width: dimensions.width,
        height: dimensions.height,
        byteLength: bytes.byteLength,
    });
}
