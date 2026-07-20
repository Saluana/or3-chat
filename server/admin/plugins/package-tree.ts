import { createHash } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import { posix, resolve } from 'node:path';
import type { Sha256 } from '../../../shared/plugins/runtime-descriptor';

export type PackageTreeEntryKind =
    | 'file'
    | 'directory'
    | 'symlink'
    | 'device'
    | 'socket'
    | 'fifo'
    | 'unknown';

export type PackageTreeValidationCode =
    | 'root-invalid'
    | 'path-traversal'
    | 'path-not-normalized'
    | 'duplicate-path'
    | 'case-fold-collision'
    | 'symlink'
    | 'unsupported-file-type'
    | 'unsafe-mode'
    | 'length-invalid'
    | 'file-changed'
    | 'too-many-entries'
    | 'package-too-large'
    | 'manifest-missing'
    | 'manifest-invalid'
    | 'manifest-integrity-invalid'
    | 'manifest-integrity-mismatch'
    | 'digest-mismatch';

export class PackageTreeValidationError extends Error {
    readonly code: PackageTreeValidationCode;
    readonly entryPath?: string;

    constructor(code: PackageTreeValidationCode, message: string, entryPath?: string) {
        super(message);
        this.name = 'PackageTreeValidationError';
        this.code = code;
        this.entryPath = entryPath;
    }
}

export interface PackageTreeEntryInput {
    readonly path: string;
    readonly kind: PackageTreeEntryKind;
    readonly mode: number;
    readonly bytes?: Uint8Array;
    readonly declaredLength?: number;
}

export interface PackageTreeLimits {
    readonly maximumEntries: number;
    readonly maximumFileBytes: number;
    readonly maximumPackageBytes: number;
    readonly maximumPathBytes: number;
}

export interface VerifiedPackageTree {
    readonly digest: Sha256;
    readonly entryCount: number;
    readonly totalBytes: number;
    readonly declaredManifestIntegrity: Sha256 | null;
    readonly detachedExpectedDigest: Sha256 | null;
    readonly manifestId: string | null;
    readonly manifestVersion: number | null;
}

const DEFAULT_LIMITS: PackageTreeLimits = Object.freeze({
    maximumEntries: 10_000,
    maximumFileBytes: 32 * 1024 * 1024,
    maximumPackageBytes: 128 * 1024 * 1024,
    maximumPathBytes: 1_024,
});
const SHA256_PATTERN = /^sha256-[a-f0-9]{64}$/;
const MANIFEST_PATH = 'or3.manifest.json';
const HASH_DOMAIN = Buffer.from('OR3_PLUGIN_PACKAGE_TREE_V1\0', 'utf8');

interface PreparedEntry {
    readonly path: string;
    readonly modeClass: 'directory' | 'file' | 'executable';
    readonly bytes: Uint8Array;
    readonly hashLength: number;
}

function validationError(
    code: PackageTreeValidationCode,
    message: string,
    entryPath?: string
): never {
    throw new PackageTreeValidationError(code, message, entryPath);
}

function canonicalPath(rawPath: string, maximumPathBytes: number): string {
    if (
        rawPath.length === 0 ||
        rawPath.includes('\0') ||
        rawPath.startsWith('/') ||
        /^[a-z]:[\\/]/i.test(rawPath)
    ) {
        validationError('path-traversal', `Unsafe package path: ${rawPath}`, rawPath);
    }
    const portable = rawPath.replaceAll('\\', '/');
    const normalized = posix.normalize(portable).normalize('NFC');
    if (normalized === '..' || normalized.startsWith('../') || normalized === '.') {
        validationError('path-traversal', `Package path escapes its root: ${rawPath}`, rawPath);
    }
    if (Buffer.byteLength(normalized, 'utf8') > maximumPathBytes) {
        validationError('length-invalid', `Package path is too long: ${rawPath}`, rawPath);
    }
    return normalized;
}

function modeClass(entry: PackageTreeEntryInput): PreparedEntry['modeClass'] {
    if ((entry.mode & 0o7000) !== 0) {
        validationError('unsafe-mode', `Special permission bits are forbidden: ${entry.path}`, entry.path);
    }
    const typeBits = entry.mode & constants.S_IFMT;
    const expectedType = entry.kind === 'directory' ? constants.S_IFDIR : constants.S_IFREG;
    if (typeBits !== 0 && typeBits !== expectedType) {
        validationError(
            'unsupported-file-type',
            `Entry mode does not match its package type: ${entry.path}`,
            entry.path
        );
    }
    if (entry.kind === 'directory') return 'directory';
    return (entry.mode & 0o111) !== 0 ? 'executable' : 'file';
}

function canonicalJson(value: unknown): string {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return JSON.stringify(value);
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) validationError('manifest-invalid', 'Manifest contains a non-finite number');
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (!value || typeof value !== 'object') {
        validationError('manifest-invalid', 'Manifest contains an unsupported JSON value');
    }
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${entries.join(',')}}`;
}

function canonicalManifestBytes(bytes: Uint8Array): {
    readonly bytes: Uint8Array;
    readonly declaredIntegrity: Sha256 | null;
    readonly manifestId: string | null;
    readonly manifestVersion: number | null;
} {
    let manifest: Record<string, unknown>;
    try {
        const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
        manifest = parsed as Record<string, unknown>;
    } catch {
        validationError('manifest-invalid', 'or3.manifest.json must contain a JSON object', MANIFEST_PATH);
    }
    let declaredIntegrity: Sha256 | null = null;
    if (manifest.integrity !== undefined) {
        if (!manifest.integrity || typeof manifest.integrity !== 'object' || Array.isArray(manifest.integrity)) {
            validationError('manifest-integrity-invalid', 'Manifest integrity must be an object', MANIFEST_PATH);
        }
        const integrity = { ...(manifest.integrity as Record<string, unknown>) };
        if (integrity.package !== undefined) {
            if (typeof integrity.package !== 'string' || !SHA256_PATTERN.test(integrity.package)) {
                validationError(
                    'manifest-integrity-invalid',
                    'Manifest integrity.package must be a lowercase sha256 digest',
                    MANIFEST_PATH
                );
            }
            declaredIntegrity = integrity.package as Sha256;
            delete integrity.package;
        }
        if (Object.keys(integrity).length > 0) manifest = { ...manifest, integrity };
        else {
            manifest = { ...manifest };
            delete manifest.integrity;
        }
    }
    return {
        bytes: Buffer.from(canonicalJson(manifest), 'utf8'),
        declaredIntegrity,
        manifestId: typeof manifest.id === 'string' ? manifest.id : null,
        manifestVersion:
            typeof manifest.manifestVersion === 'number' ? manifest.manifestVersion : null,
    };
}

function uint32(value: number): Buffer {
    const result = Buffer.allocUnsafe(4);
    result.writeUInt32BE(value);
    return result;
}

function uint64(value: number): Buffer {
    const result = Buffer.allocUnsafe(8);
    result.writeBigUInt64BE(BigInt(value));
    return result;
}

function compareUtf8(left: PreparedEntry, right: PreparedEntry): number {
    return Buffer.compare(Buffer.from(left.path, 'utf8'), Buffer.from(right.path, 'utf8'));
}

export function verifyCanonicalPackageEntries(
    inputEntries: readonly PackageTreeEntryInput[],
    options: {
        readonly expectedDigest?: Sha256;
        readonly limits?: Partial<PackageTreeLimits>;
    } = {}
): VerifiedPackageTree {
    const limits = Object.freeze({ ...DEFAULT_LIMITS, ...options.limits });
    if (inputEntries.length > limits.maximumEntries) {
        validationError('too-many-entries', 'Package tree exceeds the entry limit');
    }
    const normalized = inputEntries.map((entry) => ({
        entry,
        path: canonicalPath(entry.path, limits.maximumPathBytes),
    }));
    const exactPaths = new Set<string>();
    const foldedPaths = new Map<string, string>();
    for (const candidate of normalized) {
        if (exactPaths.has(candidate.path)) {
            validationError('duplicate-path', `Duplicate normalized package path: ${candidate.path}`, candidate.entry.path);
        }
        exactPaths.add(candidate.path);
        const folded = candidate.path.toLowerCase();
        const prior = foldedPaths.get(folded);
        if (prior && prior !== candidate.path) {
            validationError(
                'case-fold-collision',
                `Case-fold package path collision: ${prior} and ${candidate.path}`,
                candidate.entry.path
            );
        }
        foldedPaths.set(folded, candidate.path);
    }
    for (const candidate of normalized) {
        if (candidate.path !== candidate.entry.path) {
            validationError(
                'path-not-normalized',
                `Package path is not canonical: ${candidate.entry.path}`,
                candidate.entry.path
            );
        }
    }

    const manifestEntry = normalized.find(({ path }) => path === MANIFEST_PATH)?.entry;
    if (!manifestEntry || manifestEntry.kind !== 'file') {
        validationError('manifest-missing', `Package tree must contain ${MANIFEST_PATH}`);
    }
    const canonicalManifest = canonicalManifestBytes(manifestEntry.bytes ?? Buffer.alloc(0));
    const declaredManifestIntegrity = canonicalManifest.declaredIntegrity;
    let totalBytes = 0;
    const prepared: PreparedEntry[] = normalized.map(({ entry, path }) => {
        if (entry.kind === 'symlink') validationError('symlink', `Symlinks are forbidden: ${path}`, path);
        if (entry.kind !== 'file' && entry.kind !== 'directory') {
            validationError('unsupported-file-type', `Unsupported package entry type: ${entry.kind}`, path);
        }
        const bytes = entry.bytes ?? Buffer.alloc(0);
        const actualLength = entry.kind === 'directory' ? 0 : bytes.byteLength;
        if (
            !Number.isSafeInteger(entry.declaredLength ?? actualLength) ||
            (entry.declaredLength ?? actualLength) < 0 ||
            (entry.declaredLength !== undefined && entry.declaredLength !== actualLength) ||
            (entry.kind === 'directory' && bytes.byteLength !== 0)
        ) {
            validationError('length-invalid', `Invalid byte length for package entry: ${path}`, path);
        }
        if (actualLength > limits.maximumFileBytes) {
            validationError('length-invalid', `Package file exceeds its byte limit: ${path}`, path);
        }
        totalBytes += actualLength;
        if (totalBytes > limits.maximumPackageBytes) {
            validationError('package-too-large', 'Package tree exceeds the total byte limit');
        }
        let hashBytes = bytes;
        if (path === MANIFEST_PATH && entry.kind === 'file') {
            hashBytes = canonicalManifest.bytes;
        }
        return {
            path,
            modeClass: modeClass(entry),
            bytes: hashBytes,
            hashLength: hashBytes.byteLength,
        };
    });
    const hash = createHash('sha256').update(HASH_DOMAIN);
    for (const entry of prepared.sort(compareUtf8)) {
        const pathBytes = Buffer.from(entry.path, 'utf8');
        const modeBytes = Buffer.from(entry.modeClass, 'ascii');
        hash.update(uint32(pathBytes.byteLength));
        hash.update(pathBytes);
        hash.update(uint32(modeBytes.byteLength));
        hash.update(modeBytes);
        hash.update(uint64(entry.hashLength));
        hash.update(entry.bytes);
    }
    const digest = `sha256-${hash.digest('hex')}` as Sha256;
    if (options.expectedDigest && options.expectedDigest !== digest) {
        validationError('digest-mismatch', 'Detached expected package digest does not match computed tree digest');
    }
    if (declaredManifestIntegrity && declaredManifestIntegrity !== digest) {
        validationError('manifest-integrity-mismatch', 'Manifest package integrity does not match computed tree digest', MANIFEST_PATH);
    }
    return Object.freeze({
        digest,
        entryCount: prepared.length,
        totalBytes,
        declaredManifestIntegrity,
        detachedExpectedDigest: options.expectedDigest ?? null,
        manifestId: canonicalManifest.manifestId,
        manifestVersion: canonicalManifest.manifestVersion,
    });
}

function statKind(stat: Awaited<ReturnType<typeof fs.lstat>>): PackageTreeEntryKind {
    if (stat.isFile()) return 'file';
    if (stat.isDirectory()) return 'directory';
    if (stat.isSymbolicLink()) return 'symlink';
    if (stat.isBlockDevice() || stat.isCharacterDevice()) return 'device';
    if (stat.isSocket()) return 'socket';
    if (stat.isFIFO()) return 'fifo';
    return 'unknown';
}

export async function verifyPackageTree(
    packageRoot: string,
    options: {
        readonly expectedDigest?: Sha256;
        readonly limits?: Partial<PackageTreeLimits>;
    } = {}
): Promise<VerifiedPackageTree> {
    const root = resolve(packageRoot);
    const limits = Object.freeze({ ...DEFAULT_LIMITS, ...options.limits });
    const rootStat = await fs.lstat(root).catch(() => null);
    if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
        validationError('root-invalid', 'Package root must be a real directory');
    }
    const entries: PackageTreeEntryInput[] = [];
    let observedBytes = 0;
    const visit = async (directory: string, relativeDirectory: string): Promise<void> => {
        const children = await fs.readdir(directory, { withFileTypes: true });
        for (const child of children) {
            const relativePath = relativeDirectory ? `${relativeDirectory}/${child.name}` : child.name;
            canonicalPath(relativePath, limits.maximumPathBytes);
            if (entries.length >= limits.maximumEntries) {
                validationError('too-many-entries', 'Package tree exceeds the entry limit');
            }
            const absolutePath = resolve(directory, child.name);
            const before = await fs.lstat(absolutePath);
            const kind = statKind(before);
            if (kind === 'directory') {
                entries.push({ path: relativePath, kind, mode: before.mode });
                await visit(absolutePath, relativePath);
                continue;
            }
            if (kind !== 'file') {
                entries.push({ path: relativePath, kind, mode: before.mode });
                continue;
            }
            let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
            try {
                handle = await fs.open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
                const opened = await handle.stat();
                if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
                    validationError('file-changed', `Package file changed during verification: ${relativePath}`, relativePath);
                }
                if (opened.size > limits.maximumFileBytes) {
                    validationError('length-invalid', `Package file exceeds its byte limit: ${relativePath}`, relativePath);
                }
                observedBytes += opened.size;
                if (observedBytes > limits.maximumPackageBytes) {
                    validationError('package-too-large', 'Package tree exceeds the total byte limit');
                }
                const bytes = await handle.readFile();
                if (bytes.byteLength !== opened.size) {
                    validationError('file-changed', `Package file length changed during verification: ${relativePath}`, relativePath);
                }
                entries.push({
                    path: relativePath,
                    kind,
                    mode: opened.mode,
                    bytes,
                    declaredLength: opened.size,
                });
            } catch (error) {
                if (error instanceof PackageTreeValidationError) throw error;
                validationError('file-changed', `Unable to safely open package file: ${relativePath}`, relativePath);
            } finally {
                await handle?.close();
            }
        }
    };
    await visit(root, '');
    return verifyCanonicalPackageEntries(entries, { ...options, limits });
}
