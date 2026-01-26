import { promises as fs } from 'node:fs';
import { dirname, join, normalize, resolve, extname, sep } from 'node:path';
import { unzipSync } from 'fflate';
import type { ExtensionKind, Or3ExtensionManifest } from './types';
import { Or3ExtensionManifestSchema } from './types';
import { ensureExtensionsDirs, EXTENSIONS_BASE_DIR, getKindDir } from './paths';

export type ExtensionInstallLimits = {
    maxZipBytes: number;
    maxFiles: number;
    maxTotalBytes: number;
    allowedExtensions: string[];
};

const DEFAULT_LIMITS: ExtensionInstallLimits = {
    maxZipBytes: 25 * 1024 * 1024,
    maxFiles: 2000,
    maxTotalBytes: 200 * 1024 * 1024,
    allowedExtensions: [
        '.js',
        '.mjs',
        '.cjs',
        '.ts',
        '.tsx',
        '.vue',
        '.json',
        '.css',
        '.scss',
        '.sass',
        '.less',
        '.md',
        '.txt',
        '.svg',
        '.png',
        '.jpg',
        '.jpeg',
        '.gif',
        '.webp',
        '.ico',
        '.ttf',
        '.otf',
        '.woff',
        '.woff2',
        '.map',
    ],
};

function ensureSafePath(path: string) {
    if (path.includes('..')) throw new Error('Invalid archive path');
    if (path.startsWith('/')) throw new Error('Invalid archive path');
    if (/^[A-Za-z]:/.test(path)) throw new Error('Invalid archive path');
}

function normalizeEntryKey(key: string): string {
    let normalized = key.replace(/\0/g, '');
    normalized = normalized.replace(/\\/g, '/');
    while (normalized.startsWith('./')) {
        normalized = normalized.slice(2);
    }
    return normalized;
}

function normalizeEntries(
    entries: Record<string, Uint8Array>
): Record<string, Uint8Array> {
    const normalized: Record<string, Uint8Array> = {};
    for (const [key, value] of Object.entries(entries)) {
        const normalizedKey = normalizeEntryKey(key);
        if (!normalizedKey) continue;
        if (normalized[normalizedKey]) {
            throw new Error('Duplicate archive entry');
        }
        normalized[normalizedKey] = value;
    }
    return normalized;
}

function findManifestPath(entries: Record<string, Uint8Array>): string | null {
    const keys = Object.keys(entries);
    const match = keys.find(
        (key) => key.split('/').pop() === 'or3.manifest.json'
    );
    return match || null;
}

function computePrefix(manifestPath: string): string {
    const dir = dirname(manifestPath);
    if (dir === '.' || dir === '/') return '';
    return dir.endsWith('/') ? dir : `${dir}/`;
}

export async function installExtensionFromZip(
    buffer: Buffer,
    force: boolean,
    limits: ExtensionInstallLimits = DEFAULT_LIMITS
): Promise<Or3ExtensionManifest> {
    await ensureExtensionsDirs();

    if (buffer.byteLength > limits.maxZipBytes) {
        throw new Error('Zip exceeds maximum allowed size');
    }

    const rawEntries = unzipSync(new Uint8Array(buffer));
    const entries = normalizeEntries(rawEntries);
    const manifestPath = findManifestPath(entries);
    if (!manifestPath) {
        throw new Error('Missing or3.manifest.json');
    }

    const manifestRaw = entries[manifestPath];
    if (!manifestRaw) {
        throw new Error('Missing manifest data');
    }

    const manifestJson = JSON.parse(Buffer.from(manifestRaw).toString('utf8')) as unknown;
    const parsed = Or3ExtensionManifestSchema.safeParse(manifestJson);
    if (!parsed.success) {
        throw new Error('Invalid manifest');
    }

    const manifest = parsed.data;
    const prefix = computePrefix(manifestPath);

    const kindDir = getKindDir(manifest.kind);
    const targetDir = join(EXTENSIONS_BASE_DIR, kindDir, manifest.id);
    const tmpDir = join(EXTENSIONS_BASE_DIR, '.tmp', `${manifest.id}-${Date.now()}`);

    try {
        await fs.access(targetDir);
        if (!force) {
            throw new Error('Extension already installed');
        }
    } catch {
        if (force === true) {
            await fs.rm(targetDir, { recursive: true, force: true });
        }
    }

    await fs.mkdir(tmpDir, { recursive: true });

    try {
        let fileCount = 0;
        let totalBytes = 0;

        for (const [pathKey, data] of Object.entries(entries)) {
            if (pathKey.endsWith('/')) continue;
            if (prefix && !pathKey.startsWith(prefix)) continue;
            const relative = prefix ? pathKey.slice(prefix.length) : pathKey;
            ensureSafePath(relative);
            const normalized = normalize(relative);
            ensureSafePath(normalized);
            const extension = extname(normalized).toLowerCase();
            if (extension) {
                if (!limits.allowedExtensions.includes(extension)) {
                    throw new Error(`Extension type not allowed: ${extension}`);
                }
            } else {
                const base = normalized.split('/').pop()?.toLowerCase() ?? '';
                const allowedNames = ['readme', 'license', 'notice', 'changelog'];
                if (!allowedNames.includes(base)) {
                    throw new Error('Extension type not allowed');
                }
            }
            fileCount += 1;
            totalBytes += data.byteLength;
            if (fileCount > limits.maxFiles) {
                throw new Error('Too many files in extension');
            }
            if (totalBytes > limits.maxTotalBytes) {
                throw new Error('Extension exceeds unpacked size limit');
            }
            const filePath = join(tmpDir, normalized);
            const resolvedPath = resolve(tmpDir, normalized);
            if (!resolvedPath.startsWith(tmpDir + sep)) {
                throw new Error('Invalid archive path');
            }
            await fs.mkdir(dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, Buffer.from(data));
        }

        const finalManifestPath = join(tmpDir, 'or3.manifest.json');
        await fs.access(finalManifestPath);

        await fs.rm(targetDir, { recursive: true, force: true });
        await fs.rename(tmpDir, targetDir);

        return manifest;
    } catch (error) {
        await fs.rm(tmpDir, { recursive: true, force: true });
        throw error;
    }
}

export function resolveExtensionInstallLimits(
    overrides?: Partial<ExtensionInstallLimits>
): ExtensionInstallLimits {
    const toFinite = (value?: number) =>
        Number.isFinite(value) ? (value as number) : undefined;
    const normalizeExtensions = (list: string[] | undefined) =>
        list
            ? list
                  .map((ext) => ext.trim().toLowerCase())
                  .filter(Boolean)
                  .map((ext) => (ext.startsWith('.') ? ext : `.${ext}`))
            : undefined;
    return {
        maxZipBytes:
            toFinite(overrides?.maxZipBytes) ?? DEFAULT_LIMITS.maxZipBytes,
        maxFiles: toFinite(overrides?.maxFiles) ?? DEFAULT_LIMITS.maxFiles,
        maxTotalBytes:
            toFinite(overrides?.maxTotalBytes) ??
            DEFAULT_LIMITS.maxTotalBytes,
        allowedExtensions:
            normalizeExtensions(overrides?.allowedExtensions) ??
            DEFAULT_LIMITS.allowedExtensions,
    };
}
