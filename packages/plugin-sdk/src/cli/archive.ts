import { constants, promises as fs } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import {
    DEFAULT_LIMITS,
    PackageTreeValidationError,
    verifyCanonicalPackageEntries,
    verifyPackageTree,
    type PackageTreeEntryInput,
    type PackageTreeLimits,
    type VerifiedPackageTree,
} from '../package-tree';

/**
 * Deterministic ZIP transport for V2 plugin packages.
 *
 * This module is a thin transport layer: it never hashes or validates package
 * content on its own. Hashing, digest computation, and canonical validation all
 * come from `@or3/plugin-sdk/package-tree` (`verifyPackageTree` /
 * `verifyCanonicalPackageEntries`).
 *
 * It is first-party and uses only `node:zlib` plus `node:fs`, so the standalone
 * `or3-plugin` CLI can ship it without bundling third-party runtime code. The
 * older host module `shared/plugins/package-archive.ts` re-exports this
 * implementation, so the host and the published tool cannot drift.
 *
 * `.or3pkg` and `.zip` are filename aliases only. There is a single writer and a
 * single reader, with no format branching by extension anywhere.
 *
 * Transportable mode classes are `directory` and `file`. Executable files are
 * part of the canonical digest but ZIP metadata cannot portably round-trip Unix
 * mode bits, so a tree containing one is refused at export time.
 */

/** Fixed deflate level so compression output cannot drift with library defaults. */
const FIXED_COMPRESSION_LEVEL = 6 as const;

/** Explicit Unix origin so local/central-directory metadata is host-independent. */
const UNIX_OS = 3;

/** Fixed external attributes: Unix directory (040755) plus the DOS directory bit. */
const DIRECTORY_ATTRS = ((0o040755 << 16) | 0x10) >>> 0;

/** Fixed external attributes: Unix regular file (0100644). */
const FILE_ATTRS = (0o100644 << 16) >>> 0;

/** 1980-01-01 00:00:00 in MS-DOS date/time fields (no timezone component). */
const FIXED_DOS_DATE = ((1980 - 1980) << 9) | (1 << 5) | 1;
const FIXED_DOS_TIME = 0;

/** UTF-8 filename flag (general purpose bit 11). */
const UTF8_FLAG = 0x0800;

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;

export interface PackageZipWriteOptions {
    readonly limits?: Partial<PackageTreeLimits>;
}

export interface PackageZipReadOptions {
    readonly limits?: Partial<PackageTreeLimits>;
    /**
     * When set, the verified tree is extracted here and left in place for the
     * caller (who owns cleanup). When omitted, a temp directory is used and
     * removed before returning.
     */
    readonly extractDirectory?: string;
}

export interface PackageZipReadResult {
    /** Digest of the extracted tree, identical to `verifyPackageTree(root).digest`. */
    readonly digest: VerifiedPackageTree['digest'];
    readonly entries: number;
    /** The extracted root when `extractDirectory` was supplied, otherwise null. */
    readonly extractedRoot: string | null;
}

let crcTable: Uint32Array | null = null;

/** Standard CRC-32 (IEEE) used by every ZIP reader/writer. */
function crc32(table: Uint32Array, bytes: Uint8Array): number {
    let crc = 0xffffffff;
    for (let index = 0; index < bytes.length; index += 1) {
        crc = (crc >>> 8) ^ table[(crc ^ bytes[index]!) & 0xff]!;
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function getCrcTable(): Uint32Array {
    if (crcTable) return crcTable;
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
        let value = index;
        for (let bit = 0; bit < 8; bit += 1) {
            value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }
        table[index] = value >>> 0;
    }
    crcTable = table;
    return table;
}

function compareUtf8Paths(left: PackageTreeEntryInput, right: PackageTreeEntryInput): number {
    return Buffer.compare(Buffer.from(left.path, 'utf8'), Buffer.from(right.path, 'utf8'));
}

function concatChunks(chunks: readonly Uint8Array[]): Uint8Array {
    let total = 0;
    for (const chunk of chunks) total += chunk.byteLength;
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return output;
}

class ByteWriter {
    readonly #chunks: Uint8Array[] = [];
    #length = 0;

    get length(): number {
        return this.#length;
    }

    bytes(value: Uint8Array): void {
        this.#chunks.push(value);
        this.#length += value.byteLength;
    }

    u16(value: number): void {
        const bytes = new Uint8Array(2);
        new DataView(bytes.buffer).setUint16(0, value, true);
        this.bytes(bytes);
    }

    u32(value: number): void {
        const bytes = new Uint8Array(4);
        new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
        this.bytes(bytes);
    }

    concat(): Uint8Array {
        return concatChunks(this.#chunks);
    }
}

/**
 * Reads the tree exactly as the verifier walks it: every file and directory,
 * including empty directories and non-ASCII names. Files are opened with
 * `O_NOFOLLOW` so the bytes encoded into the archive are the same bytes the
 * verifier hashed.
 */
async function collectPackageTreeEntries(root: string): Promise<PackageTreeEntryInput[]> {
    const entries: PackageTreeEntryInput[] = [];
    const visit = async (directory: string, relativeDirectory: string): Promise<void> => {
        const children = await fs.readdir(directory, { withFileTypes: true });
        for (const child of children) {
            const relativePath = relativeDirectory
                ? `${relativeDirectory}/${child.name}`
                : child.name;
            const absolutePath = resolve(directory, child.name);
            const stat = await fs.lstat(absolutePath);
            if (stat.isSymbolicLink()) {
                throw new PackageTreeValidationError(
                    'symlink',
                    `Symlinks are forbidden: ${relativePath}`,
                    relativePath
                );
            }
            if (stat.isDirectory()) {
                entries.push({ path: relativePath, kind: 'directory', mode: stat.mode });
                await visit(absolutePath, relativePath);
                continue;
            }
            if (!stat.isFile()) {
                throw new PackageTreeValidationError(
                    'unsupported-file-type',
                    `Unsupported package entry type: ${relativePath}`,
                    relativePath
                );
            }
            let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
            try {
                handle = await fs.open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
                const opened = await handle.stat();
                if ((opened.mode & 0o111) !== 0) {
                    // Executable mode is part of the canonical digest, but ZIP
                    // metadata cannot portably surface Unix mode bits on
                    // extraction, so executable trees cannot round-trip. Refuse
                    // rather than silently exporting a mis-verifying archive.
                    throw new PackageTreeValidationError(
                        'unsupported-file-type',
                        `Executable package files are not transportable: ${relativePath}`,
                        relativePath
                    );
                }
                const bytes = await handle.readFile();
                entries.push({
                    path: relativePath,
                    kind: 'file',
                    mode: opened.mode,
                    bytes,
                    declaredLength: opened.size,
                });
            } finally {
                await handle?.close();
            }
        }
    };
    await visit(resolve(root), '');
    return entries;
}

/** Encodes entries into a ZIP in the supplied order with fixed metadata. */
function encodeZip(entries: readonly PackageTreeEntryInput[]): Uint8Array {
    const table = getCrcTable();
    const writer = new ByteWriter();
    const central: Array<{ record: Uint8Array; offset: number }> = [];
    for (const entry of entries) {
        const isDirectory = entry.kind === 'directory';
        const name = Buffer.from(isDirectory ? `${entry.path}/` : entry.path, 'utf8');
        const raw = entry.bytes ?? new Uint8Array(0);
        const method = isDirectory ? 0 : 8;
        const compressed = isDirectory ? new Uint8Array(0) : deflateRawSync(raw, {
            level: FIXED_COMPRESSION_LEVEL,
        });
        const checksum = isDirectory ? 0 : crc32(table, raw);
        const offset = writer.length;

        writer.u32(LOCAL_HEADER_SIGNATURE);
        writer.u16(20);
        writer.u16(UTF8_FLAG);
        writer.u16(method);
        writer.u16(FIXED_DOS_TIME);
        writer.u16(FIXED_DOS_DATE);
        writer.u32(checksum);
        writer.u32(compressed.byteLength);
        writer.u32(raw.byteLength);
        writer.u16(name.byteLength);
        writer.u16(0);
        writer.bytes(name);
        writer.bytes(compressed);

        const record = new ByteWriter();
        record.u32(CENTRAL_HEADER_SIGNATURE);
        record.u16((UNIX_OS << 8) | 20);
        record.u16(20);
        record.u16(UTF8_FLAG);
        record.u16(method);
        record.u16(FIXED_DOS_TIME);
        record.u16(FIXED_DOS_DATE);
        record.u32(checksum);
        record.u32(compressed.byteLength);
        record.u32(raw.byteLength);
        record.u16(name.byteLength);
        record.u16(0);
        record.u16(0);
        record.u16(0);
        record.u16(0);
        record.u32(isDirectory ? DIRECTORY_ATTRS : FILE_ATTRS);
        record.u32(offset);
        record.bytes(name);
        central.push({ record: record.concat(), offset });
    }
    const centralOffset = writer.length;
    let centralSize = 0;
    for (const entry of central) {
        writer.bytes(entry.record);
        centralSize += entry.record.byteLength;
    }
    writer.u32(EOCD_SIGNATURE);
    writer.u16(0);
    writer.u16(0);
    writer.u16(central.length);
    writer.u16(central.length);
    writer.u32(centralSize);
    writer.u32(centralOffset);
    writer.u16(0);
    return writer.concat();
}

/**
 * Encodes caller-supplied files into a deterministic ZIP with the same fixed
 * metadata as package archives (fixed compression, timestamps, attributes,
 * UTF-8 names sorted in byte order).
 *
 * Unlike `writeDeterministicPackageZip` this performs no package-tree
 * verification: it is the source-snapshot transport for candidate receipts,
 * where the bytes are review input rather than executable package content.
 * Symlink-escape and absolute paths are still refused.
 */
export function encodeFileZip(
    files: ReadonlyArray<{ readonly path: string; readonly bytes: Uint8Array }>
): Uint8Array {
    const entries: PackageTreeEntryInput[] = files.map((file) => {
        if (
            file.path.length === 0 ||
            file.path.includes('\0') ||
            file.path.startsWith('/') ||
            /^[a-z]:[\\/]/i.test(file.path)
        ) {
            throw new PackageTreeValidationError('path-traversal', `Unsafe snapshot path: ${file.path}`, file.path);
        }
        return { path: file.path, kind: 'file' as const, mode: 0o644, bytes: file.bytes, declaredLength: file.bytes.byteLength };
    });
    entries.sort(compareUtf8Paths);
    return encodeZip(entries);
}

/**
 * Verifies `treeRoot` and returns a deterministic ZIP of its canonical tree.
 *
 * The tree is verified first and an invalid tree is never exported. Entries are
 * written in ascending UTF-8 byte order of the canonical path, followed by a
 * second canonical verification bound to the first digest so bytes read for the
 * archive must be the same bytes that were verified.
 */
export async function writeDeterministicPackageZip(
    treeRoot: string,
    options: PackageZipWriteOptions = {}
): Promise<Uint8Array> {
    const root = resolve(treeRoot);
    const verified = await verifyPackageTree(root, { limits: options.limits });
    const entries = await collectPackageTreeEntries(root);
    entries.sort(compareUtf8Paths);
    verifyCanonicalPackageEntries(entries, {
        limits: options.limits,
        expectedDigest: verified.digest,
    });
    return encodeZip(entries);
}

interface PendingEntry {
    readonly path: string;
    readonly kind: 'file' | 'directory';
    readonly chunks: Uint8Array[];
    length: number;
}

interface ParsedCentralEntry {
    readonly path: string;
    /** Raw central-directory name bytes, compared against the local header. */
    readonly rawName: string;
    readonly isDirectory: boolean;
    readonly flags: number;
    readonly method: number;
    readonly crc32: number;
    readonly compressedSize: number;
    readonly uncompressedSize: number;
    readonly localOffset: number;
}

function findEocd(view: DataView): number {
    const minimum = Math.max(0, view.byteLength - (0xffff + 22));
    for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
        if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
    }
    throw new PackageTreeValidationError('length-invalid', 'Package archive has no ZIP end record');
}

/** Parses the central directory without trusting any size or offset field blindly. */
function parseCentralDirectory(
    bytes: Uint8Array,
    limits: PackageTreeLimits
): { entries: ParsedCentralEntry[]; centralDirectoryOffset: number } {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocd = findEocd(view);
    const totalEntries = view.getUint16(eocd + 10, true);
    const centralDirectoryOffset = view.getUint32(eocd + 16, true);
    if (totalEntries === 0xffff || centralDirectoryOffset === 0xffffffff) {
        throw new PackageTreeValidationError('unsupported-file-type', 'ZIP64 package archives are not supported');
    }
    if (totalEntries > limits.maximumEntries) {
        throw new PackageTreeValidationError('too-many-entries', 'Package tree exceeds the entry limit');
    }
    let offset = centralDirectoryOffset;
    const entries: ParsedCentralEntry[] = [];
    for (let index = 0; index < totalEntries; index += 1) {
        if (offset + 46 > view.byteLength || view.getUint32(offset, true) !== CENTRAL_HEADER_SIGNATURE) {
            throw new PackageTreeValidationError('length-invalid', 'Package archive central directory is corrupt');
        }
        const flags = view.getUint16(offset + 8, true);
        if ((flags & 0x0001) !== 0) {
            throw new PackageTreeValidationError('unsupported-file-type', 'Encrypted package entries are not supported');
        }
        const method = view.getUint16(offset + 10, true);
        const crc32 = view.getUint32(offset + 16, true);
        const compressedSize = view.getUint32(offset + 20, true);
        const uncompressedSize = view.getUint32(offset + 24, true);
        const nameLength = view.getUint16(offset + 28, true);
        const extraLength = view.getUint16(offset + 30, true);
        const commentLength = view.getUint16(offset + 32, true);
        const localOffset = view.getUint32(offset + 42, true);
        const nameStart = offset + 46;
        const nameEnd = nameStart + nameLength;
        if (nameEnd > view.byteLength) {
            throw new PackageTreeValidationError('length-invalid', 'Package archive entry name is truncated');
        }
        const rawName = Buffer.from(bytes.subarray(nameStart, nameEnd)).toString('utf8');
        // A central record with no name cannot describe a package path, and skipping
        // it would hide an entry from the canonical tree.
        if (rawName.length === 0) {
            throw new PackageTreeValidationError('length-invalid', 'Package archive contains an entry with no name');
        }
        const isDirectory = rawName.endsWith('/');
        const path = isDirectory ? rawName.slice(0, -1) : rawName;
        entries.push({
            path,
            rawName,
            isDirectory,
            flags,
            method,
            crc32,
            compressedSize,
            uncompressedSize,
            localOffset,
        });
        offset = nameEnd + extraLength + commentLength;
    }
    return { entries, centralDirectoryOffset };
}

/**
 * Walks the local file records from the start of the archive to the central
 * directory and requires them to agree with it: the same entries, same names,
 * methods and flags, and a valid trailing data descriptor where one is used.
 *
 * A central-directory-only reader would otherwise ignore an extra local record
 * that a streaming extractor consumes, so the two could materialise different
 * trees from the same bytes.
 */
function assertLocalRecordsConsistent(
    bytes: Uint8Array,
    view: DataView,
    entries: readonly ParsedCentralEntry[],
    centralDirectoryOffset: number
): void {
    const byOffset = new Map<number, ParsedCentralEntry>();
    for (const entry of entries) {
        if (byOffset.has(entry.localOffset)) {
            throw new PackageTreeValidationError('length-invalid', `Two central directory entries share a local record: ${entry.path}`, entry.path);
        }
        byOffset.set(entry.localOffset, entry);
    }
    const visited = new Set<number>();
    let offset = 0;
    while (offset < centralDirectoryOffset) {
        if (offset + 30 > view.byteLength || view.getUint32(offset, true) !== LOCAL_HEADER_SIGNATURE) {
            throw new PackageTreeValidationError('length-invalid', 'Package archive has data that is not a local file record');
        }
        const entry = byOffset.get(offset);
        if (!entry) {
            throw new PackageTreeValidationError('length-invalid', 'Package archive contains a local file record that the central directory does not list');
        }
        visited.add(offset);

        const localFlags = view.getUint16(offset + 6, true);
        const localMethod = view.getUint16(offset + 8, true);
        const localCrc = view.getUint32(offset + 14, true);
        const localCompressedSize = view.getUint32(offset + 18, true);
        const localUncompressedSize = view.getUint32(offset + 22, true);
        const nameLength = view.getUint16(offset + 26, true);
        const extraLength = view.getUint16(offset + 28, true);
        const nameStart = offset + 30;
        const nameEnd = nameStart + nameLength;
        if (nameEnd > view.byteLength) {
            throw new PackageTreeValidationError('length-invalid', `Package entry local header is truncated: ${entry.path}`, entry.path);
        }
        const localName = Buffer.from(bytes.subarray(nameStart, nameEnd)).toString('utf8');
        if (localName !== entry.rawName) {
            throw new PackageTreeValidationError('length-invalid', `Package entry name differs between its local header and central directory: ${entry.path}`, entry.path);
        }
        if (localFlags !== entry.flags) {
            throw new PackageTreeValidationError('length-invalid', `Package entry flags differ between its local header and central directory: ${entry.path}`, entry.path);
        }
        if (localMethod !== entry.method) {
            throw new PackageTreeValidationError('length-invalid', `Package entry compression method differs between its local header and central directory: ${entry.path}`, entry.path);
        }
        if ((localFlags & 0x0001) !== 0) {
            throw new PackageTreeValidationError('unsupported-file-type', `Encrypted package entries are not supported: ${entry.path}`, entry.path);
        }

        const dataStart = nameEnd + extraLength;
        const dataEnd = dataStart + entry.compressedSize;
        if (dataEnd > view.byteLength) {
            throw new PackageTreeValidationError('length-invalid', `Package entry data is truncated: ${entry.path}`, entry.path);
        }
        if ((localFlags & 0x0008) !== 0) {
            // Sizes and checksum live in the trailing descriptor; the placeholder
            // values in this header are not trusted.
            offset = readDataDescriptor(view, dataEnd, entry);
            continue;
        }
        if (
            localCrc !== entry.crc32 ||
            localCompressedSize !== entry.compressedSize ||
            localUncompressedSize !== entry.uncompressedSize
        ) {
            throw new PackageTreeValidationError('length-invalid', `Package entry checksum or sizes differ between its local header and central directory: ${entry.path}`, entry.path);
        }
        offset = dataEnd;
    }
    if (offset !== centralDirectoryOffset) {
        throw new PackageTreeValidationError('length-invalid', 'Package archive local records do not end at its central directory');
    }
    if (visited.size !== entries.length) {
        throw new PackageTreeValidationError('length-invalid', 'Package archive central directory lists entries with no local file record');
    }
}

/** Validates a trailing data descriptor and returns the offset after it. */
function readDataDescriptor(view: DataView, start: number, entry: ParsedCentralEntry): number {
    let offset = start;
    if (offset + 4 <= view.byteLength && view.getUint32(offset, true) === DATA_DESCRIPTOR_SIGNATURE) {
        offset += 4;
    }
    if (offset + 12 > view.byteLength) {
        throw new PackageTreeValidationError('length-invalid', `Package entry data descriptor is truncated: ${entry.path}`, entry.path);
    }
    const crc = view.getUint32(offset, true);
    const compressedSize = view.getUint32(offset + 4, true);
    const uncompressedSize = view.getUint32(offset + 8, true);
    if (crc !== entry.crc32 || compressedSize !== entry.compressedSize || uncompressedSize !== entry.uncompressedSize) {
        throw new PackageTreeValidationError('length-invalid', `Package entry data descriptor disagrees with its central directory: ${entry.path}`, entry.path);
    }
    return offset + 12;
}

/**
 * Decodes one entry's bytes. Local-header consistency, flags and any data
 * descriptor were already validated by `assertLocalRecordsConsistent`, so this
 * only bounds, inflates and checksums the data.
 */
function readEntryData(
    bytes: Uint8Array,
    view: DataView,
    entry: ParsedCentralEntry,
    limits: PackageTreeLimits,
    remainingPackageBytes: number
): Uint8Array {
    const local = entry.localOffset;
    const nameLength = view.getUint16(local + 26, true);
    const extraLength = view.getUint16(local + 28, true);
    const dataStart = local + 30 + nameLength + extraLength;
    const dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > view.byteLength) {
        throw new PackageTreeValidationError('length-invalid', `Package entry data is truncated: ${entry.path}`, entry.path);
    }
    if (entry.isDirectory) {
        if (entry.uncompressedSize !== 0 || entry.compressedSize !== 0) {
            throw new PackageTreeValidationError('length-invalid', `Package directory entry carries data: ${entry.path}`, entry.path);
        }
        return new Uint8Array(0);
    }
    // Bound before allocating: reject a declared size that already exceeds a limit,
    // so a decompression bomb cannot be inflated into memory first.
    if (entry.uncompressedSize > limits.maximumFileBytes) {
        throw new PackageTreeValidationError('length-invalid', `Package file exceeds its byte limit: ${entry.path}`, entry.path);
    }
    if (entry.uncompressedSize > remainingPackageBytes) {
        throw new PackageTreeValidationError('package-too-large', 'Package tree exceeds the total byte limit');
    }
    const compressed = bytes.subarray(dataStart, dataEnd);
    let data: Uint8Array;
    if (entry.method === 0) {
        data = compressed;
    } else if (entry.method === 8) {
        // Cap the inflater's own output so a lying size declaration cannot exceed
        // the file limit or the remaining package budget.
        const maxOutputLength = Math.min(limits.maximumFileBytes, remainingPackageBytes);
        try {
            data = inflateRawSync(compressed, { maxOutputLength });
        } catch {
            throw new PackageTreeValidationError(
                'length-invalid',
                `Package entry failed to decompress within its byte limit: ${entry.path}`,
                entry.path
            );
        }
    } else {
        throw new PackageTreeValidationError('unsupported-file-type', `Unsupported package compression method ${entry.method}: ${entry.path}`, entry.path);
    }
    if (data.byteLength !== entry.uncompressedSize) {
        throw new PackageTreeValidationError('length-invalid', `Package entry decompressed to the wrong length: ${entry.path}`, entry.path);
    }
    // The central directory's CRC-32 must match the bytes we actually decoded.
    if (crc32(getCrcTable(), data) !== entry.crc32) {
        throw new PackageTreeValidationError('length-invalid', `Package entry failed its CRC-32 check: ${entry.path}`, entry.path);
    }
    return data;
}

function decodeZip(bytes: Uint8Array, limits: PackageTreeLimits): PackageTreeEntryInput[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const { entries: parsed, centralDirectoryOffset } = parseCentralDirectory(bytes, limits);
    assertLocalRecordsConsistent(bytes, view, parsed, centralDirectoryOffset);
    let totalBytes = 0;
    const entries: PackageTreeEntryInput[] = [];
    for (const entry of parsed) {
        if (entry.path.includes('\0') || entry.path.startsWith('/') || /^[a-z]:[\\/]/i.test(entry.path)) {
            throw new PackageTreeValidationError('path-traversal', `Unsafe package path: ${entry.path}`, entry.path);
        }
        const data = readEntryData(bytes, view, entry, limits, limits.maximumPackageBytes - totalBytes);
        totalBytes += data.byteLength;
        if (totalBytes > limits.maximumPackageBytes) {
            throw new PackageTreeValidationError('package-too-large', 'Package tree exceeds the total byte limit');
        }
        entries.push({
            path: entry.path,
            kind: entry.isDirectory ? 'directory' : 'file',
            mode: entry.isDirectory ? 0o755 : 0o644,
            bytes: data,
            declaredLength: data.byteLength,
        });
    }
    return entries;
}

function assertStructurallySound(entries: readonly PackageTreeEntryInput[]): void {
    const files = new Set(
        entries.filter((entry) => entry.kind === 'file').map((entry) => entry.path)
    );
    for (const entry of entries) {
        const segments = entry.path.split('/');
        for (let index = 1; index < segments.length; index += 1) {
            const ancestor = segments.slice(0, index).join('/');
            if (files.has(ancestor)) {
                throw new PackageTreeValidationError(
                    'unsupported-file-type',
                    `Package path is nested under a file: ${entry.path}`,
                    entry.path
                );
            }
        }
    }
}

/**
 * Requires a fresh, empty, real destination directory and returns it.
 *
 * `readPackageZip` is a public API, so a caller-supplied `extractDirectory` may
 * already contain entries. Writing into such a directory could follow a
 * pre-existing symlink and write outside it (the later verification would
 * reject the symlink only after the damage), so refuse anything that is not a
 * real, empty directory.
 */
async function prepareExtractionRoot(destination: string): Promise<string> {
    const base = resolve(destination);
    const existing = await fs.lstat(base).catch(() => null);
    if (!existing) {
        await fs.mkdir(base, { recursive: true });
        return base;
    }
    if (existing.isSymbolicLink()) {
        throw new PackageTreeValidationError('symlink', `Extraction destination must not be a symlink: ${base}`);
    }
    if (!existing.isDirectory()) {
        throw new PackageTreeValidationError('unsupported-file-type', `Extraction destination is not a directory: ${base}`);
    }
    const children = await fs.readdir(base);
    if (children.length > 0) {
        throw new PackageTreeValidationError('length-invalid', `Extraction destination must be empty: ${base}`);
    }
    return base;
}

async function extractEntries(
    entries: readonly PackageTreeEntryInput[],
    destination: string
): Promise<void> {
    const base = await prepareExtractionRoot(destination);
    for (const entry of entries) {
        const target = resolve(base, entry.path);
        if (target !== base && !target.startsWith(`${base}${sep}`)) {
            throw new PackageTreeValidationError(
                'path-traversal',
                `Package path escapes its root: ${entry.path}`,
                entry.path
            );
        }
        if (entry.kind === 'directory') {
            await fs.mkdir(target, { recursive: true });
            continue;
        }
        await fs.mkdir(dirname(target), { recursive: true });
        // O_NOFOLLOW + O_EXCL: never follow a symlink and never overwrite an
        // existing entry, even one that appears during extraction.
        const handle = await fs.open(
            target,
            constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
            0o644
        );
        try {
            await handle.writeFile(entry.bytes ?? new Uint8Array(0));
        } finally {
            await handle.close();
        }
    }
}

/**
 * Reads a package ZIP, validates it with the canonical verifier, extracts it,
 * verifies the extracted tree, and returns the computed digest.
 *
 * Zip-slip, absolute/traversal/non-canonical paths, duplicate and
 * case-fold-colliding paths, entry-count and byte limits are all enforced
 * through `verifyCanonicalPackageEntries` (the same code, limits, and error
 * codes used everywhere else). Symlinks and special modes are impossible here:
 * ZIP metadata does not surface Unix mode bits, so entries are only ever
 * materialized as regular files and directories.
 */
export async function readPackageZip(
    bytes: Uint8Array,
    options: PackageZipReadOptions = {}
): Promise<PackageZipReadResult> {
    if (bytes.byteLength === 0) {
        throw new PackageTreeValidationError('length-invalid', 'Package archive is empty');
    }
    // Effective limits are resolved up front from the canonical defaults, so the
    // reader is always bounded even when the caller passes no limits at all.
    const limits: PackageTreeLimits = Object.freeze({ ...DEFAULT_LIMITS, ...options.limits });
    const entries = decodeZip(bytes, limits);
    verifyCanonicalPackageEntries(entries, { limits });
    assertStructurallySound(entries);
    const ownsDirectory = options.extractDirectory === undefined;
    const target = ownsDirectory
        ? mkdtempSync(join(tmpdir(), 'or3-package-archive-'))
        : resolve(options.extractDirectory!);
    try {
        await extractEntries(entries, target);
        const verification = await verifyPackageTree(target, { limits });
        return {
            digest: verification.digest,
            entries: verification.entryCount,
            extractedRoot: ownsDirectory ? null : target,
        };
    } finally {
        if (ownsDirectory) rmSync(target, { recursive: true, force: true });
    }
}
