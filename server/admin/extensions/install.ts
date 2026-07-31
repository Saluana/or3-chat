/**
 * @module server/admin/extensions/install.ts
 *
 * Purpose:
 * Core installation engine for OR3 extensions. Handles secure extraction,
 * validation, and safe replacement of extension packages.
 *
 * Architecture:
 * - **Atomic Installation**: Extracts archives into a `.tmp` directory first.
 *   Only renames/replaces the target directory if all validations pass.
 * - **Streaming Extraction**: Processes the zip archive without buffering
 *   the entire unpacked contents in memory.
 * - **Zip Slip Protection**: Enforces strict path normalization and resolve
 *   checks to prevent directory traversal attacks.
 * - **Resource Gating**: Enforces limits on file count, compressed size, and
 *   unpacked total size.
 *
 * Responsibilities:
 * - Validate `or3.manifest.json` early in the extraction process.
 * - Enforce file extension allow-lists to block malicious binaries.
 * - Handle nested directory prefixes within archives (common in GitHub exports).
 */
import { promises as fs } from 'node:fs';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join, normalize, resolve, extname, sep } from 'node:path';
import { unzip, Unzip, UnzipInflate } from 'fflate';
import type { ExtensionKind, Or3ExtensionManifest } from './types';
import { Or3ExtensionManifestSchema } from './types';
import { ensureExtensionsDirs, EXTENSIONS_BASE_DIR, getKindDir } from './paths';
import { removeSyncedThemeFromApp, syncInstalledThemeToApp } from './theme-install-sync';
import { validateThemeDefinition } from '../../../app/theme/_shared/validate-theme';
import type { ThemeDefinition } from '../../../app/theme/_shared/types';

/**
 * Purpose:
 * Defines security and operational limits for extension installations.
 */
export type ExtensionInstallLimits = {
    /** Maximum allowed size for the uploaded .zip file. */
    maxZipBytes: number;
    /** Maximum number of files permitted within the archive. */
    maxFiles: number;
    /** Maximum total size of all files after extraction. */
    maxTotalBytes: number;
    /** List of permitted file extensions (e.g., ['.js', '.css']). */
    allowedExtensions: string[];
};

/**
 * Purpose:
 * Strict default limits to prevent DoS or accidental disk exhaustion.
 */
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

/**
 * Purpose:
 * Structured conflict error so API layers can map to HTTP 409.
 */
export class ExtensionAlreadyInstalledError extends Error {
    readonly code = 'EXTENSION_ALREADY_INSTALLED' as const;

    constructor(id: string) {
        super(`Extension already installed: ${id}`);
        this.name = 'ExtensionAlreadyInstalledError';
    }
}

/**
 * Purpose:
 * Low-level validation to block directory traversal attempts.
 * Throws if the path escaping its root.
 */
function ensureSafePath(path: string) {
    if (path.includes('..')) throw new Error('Invalid archive path');
    if (path.startsWith('/')) throw new Error('Invalid archive path');
    if (/^[A-Za-z]:/.test(path)) throw new Error('Invalid archive path');
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await fs.access(path);
        return true;
    } catch (error) {
        if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            (error as { code?: string }).code === 'ENOENT'
        ) {
            return false;
        }
        throw error;
    }
}

/**
 * Purpose:
 * Cleans zip entry keys for consistent internal handling.
 */
function normalizeEntryKey(key: string): string {
    let normalized = key.replace(/\0/g, '');
    normalized = normalized.replace(/\\/g, '/');
    while (normalized.startsWith('./')) {
        normalized = normalized.slice(2);
    }
    return normalized;
}

/**
 * Purpose:
 * Determines the directory prefix if an extension is nested inside a folder in the zip.
 */
function computePrefix(manifestPath: string): string {
    const dir = dirname(manifestPath);
    if (dir === '.' || dir === '/') return '';
    return dir.endsWith('/') ? dir : `${dir}/`;
}

/**
 * Purpose:
 * Efficiently locates and parses the `or3.manifest.json` without extracting the whole zip.
 *
 * Behavior:
 * - Scans the zip index for the manifest file.
 * - Extracts only that file into memory.
 * - Validates it against `Or3ExtensionManifestSchema`.
 */
async function extractManifestFromZip(buffer: Buffer): Promise<{
    manifest: Or3ExtensionManifest;
    manifestPath: string;
    prefix: string;
}> {
    const zipData = new Uint8Array(buffer);
    const extracted = await new Promise<Record<string, Uint8Array>>((resolvePromise, rejectPromise) => {
        unzip(
            zipData,
            {
                filter: (file) =>
                    file.name.replace(/\\/g, '/').split('/').pop() ===
                    'or3.manifest.json',
            },
            (err, data) => {
                if (err) {
                    rejectPromise(err);
                    return;
                }
                resolvePromise(data);
            }
        );
    });

    const keys = Object.keys(extracted);
    if (keys.length === 0) {
        throw new Error('Missing or3.manifest.json');
    }
    if (keys.length > 1) {
        throw new Error('Duplicate archive entry');
    }

    const rawPath = keys[0]!;
    const manifestRaw = extracted[rawPath];
    if (!manifestRaw) {
        throw new Error('Missing manifest data');
    }

    const manifestPath = normalizeEntryKey(rawPath);
    ensureSafePath(manifestPath);

    let manifestJson: unknown;
    try {
        manifestJson = JSON.parse(
            Buffer.from(manifestRaw).toString('utf8')
        ) as unknown;
    } catch {
        throw new Error('Invalid manifest');
    }

    const parsed = Or3ExtensionManifestSchema.safeParse(manifestJson);
    if (!parsed.success) {
        throw new Error('Invalid manifest');
    }

    const prefix = computePrefix(manifestPath);

    return {
        manifest: parsed.data,
        manifestPath,
        prefix,
    };
}

/**
 * Purpose:
 * Orchestrates the full extension installation process from a Buffer.
 *
 * Behavior:
 * 1. Checks pre-extraction limits (compressed size).
 * 2. Extracts and validates the manifest.
 * 3. Prepares a temporary staging directory.
 * 4. Extracts all files while checking inline limits (file count, total size, extensions).
 * 5. Atomically replaces any existing extension directory with the new one.
 *
 * @param buffer - The raw binary data of the .zip file.
 * @param force - If true, replaces existing extensions; otherwise throws.
 * @param limits - User-provided or default limits.
 * @returns The manifest of the successfully installed extension.
 *
 * @throws Error on manifest violations, security checks, or resource limits.
 */
export async function installExtensionFromZip(
    buffer: Buffer,
    force: boolean,
    limits: ExtensionInstallLimits = DEFAULT_LIMITS,
    expectedKind?: ExtensionKind
): Promise<Or3ExtensionManifest> {
    await ensureExtensionsDirs();

    if (buffer.byteLength > limits.maxZipBytes) {
        throw new Error('Zip exceeds maximum allowed size');
    }

    const { manifest, prefix } = await extractManifestFromZip(buffer);

    if (expectedKind && manifest.kind !== expectedKind) {
        throw new Error(
            `Extension kind mismatch: expected ${expectedKind}, received ${manifest.kind}`
        );
    }

    if (manifest.kind === 'theme' && !/^[a-z][a-z0-9-]*$/.test(manifest.id)) {
        throw new Error('Theme id must use lower-kebab-case');
    }

    const kindDir = getKindDir(manifest.kind);
    const targetDir = join(EXTENSIONS_BASE_DIR, kindDir, manifest.id);
    const stagingToken = `${manifest.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const tmpDir = join(EXTENSIONS_BASE_DIR, '.tmp', `stage-${stagingToken}`);
    const backupDir = join(EXTENSIONS_BASE_DIR, '.tmp', `backup-${stagingToken}`);

    const targetExists = await pathExists(targetDir);
    if (targetExists && !force) {
        throw new ExtensionAlreadyInstalledError(manifest.id);
    }

    await fs.mkdir(tmpDir, { recursive: true });

    let swapped = false;
    let backedUp = false;

    try {
        let fileCount = 0;
        let totalBytes = 0;
        const seenPaths = new Set<string>();
        let extractionError: Error | null = null;

        const shouldWrite = (entryKey: string): string | null => {
            if (entryKey.endsWith('/')) return null;
            if (prefix && !entryKey.startsWith(prefix)) return null;
            const relative = prefix ? entryKey.slice(prefix.length) : entryKey;
            ensureSafePath(relative);
            const normalizedRel = normalize(relative);
            ensureSafePath(normalizedRel);
            if (seenPaths.has(normalizedRel)) {
                throw new Error('Duplicate archive entry');
            }
            const extension = extname(normalizedRel).toLowerCase();
            if (extension) {
                if (!limits.allowedExtensions.includes(extension)) {
                    throw new Error(`Extension type not allowed: ${extension}`);
                }
            } else {
                const base = normalizedRel.split('/').pop()?.toLowerCase() ?? '';
                const allowedNames = ['readme', 'license', 'notice', 'changelog'];
                if (!allowedNames.includes(base)) {
                    throw new Error('Extension type not allowed');
                }
            }
            seenPaths.add(normalizedRel);
            return normalizedRel;
        };

        const unzipper = new Unzip((file) => {
            if (typeof file.name !== 'string') return;

            const normalizedKey = normalizeEntryKey(file.name);

            const writeRel =
                extractionError === null ? shouldWrite(normalizedKey) : null;

            // Always start files with data to avoid buffering in memory.
            // For files outside the install prefix (or after an error), discard output.
            if (!writeRel) {
                file.ondata = (err) => {
                    if (extractionError) return;
                    if (err) {
                        extractionError =
                            err instanceof Error
                                ? err
                                : new Error(String(err));
                    }
                };
                file.start();
                return;
            }

            fileCount += 1;
            if (fileCount > limits.maxFiles) {
                extractionError = new Error('Too many files in extension');
            }

            const filePath = join(tmpDir, writeRel);
            const resolvedPath = resolve(tmpDir, writeRel);
            if (!resolvedPath.startsWith(tmpDir + sep)) {
                extractionError = new Error('Invalid archive path');
            }

            mkdirSync(dirname(filePath), { recursive: true });

            file.ondata = (err, data, final) => {
                if (extractionError) return;
                if (err) {
                    extractionError =
                        err instanceof Error ? err : new Error(String(err));
                    return;
                }
                if (data.length) {
                    if (totalBytes + data.length > limits.maxTotalBytes) {
                        extractionError = new Error(
                            'Extension exceeds unpacked size limit'
                        );
                        return;
                    }
                    totalBytes += data.length;
                    appendFileSync(filePath, Buffer.from(data));
                }
                if (final) return;
            };

            file.start();
        });
        unzipper.register(UnzipInflate);

        try {
            unzipper.push(new Uint8Array(buffer), true);
        } catch (error) {
            extractionError =
                error instanceof Error ? error : new Error(String(error));
        }

        if (extractionError) {
            throw extractionError;
        }

        const finalManifestPath = join(tmpDir, 'or3.manifest.json');
        await fs.access(finalManifestPath);

        if (manifest.kind === 'theme') {
            const declarativePath = join(tmpDir, 'or3.theme.json');
            const sourcePath = join(tmpDir, 'theme.ts');
            if (manifest.themeTrust === 'declarative') {
                const disallowedCodeExtensions = new Set([
                    '.js', '.mjs', '.cjs', '.ts', '.tsx', '.vue',
                    '.scss', '.sass', '.less',
                ]);
                if ([...seenPaths].some((path) => disallowedCodeExtensions.has(extname(path).toLowerCase()))) {
                    throw new Error('Declarative themes cannot contain executable code');
                }
                let definition: ThemeDefinition;
                try {
                    definition = JSON.parse(
                        await fs.readFile(declarativePath, 'utf8')
                    ) as ThemeDefinition;
                } catch {
                    throw new Error('Declarative theme requires valid or3.theme.json');
                }
                if (definition.name !== manifest.id) {
                    throw new Error('Theme definition name must match manifest id');
                }
                const validation = validateThemeDefinition(definition);
                if (!validation.valid) {
                    throw new Error(
                        `Invalid declarative theme: ${validation.errors
                            .map((error) => error.message)
                            .join('; ')}`
                    );
                }
                await fs.writeFile(
                    sourcePath,
                    `export default ${JSON.stringify(definition, null, 2)};\n`,
                    'utf8'
                );
            } else {
                try {
                    await fs.access(sourcePath);
                } catch {
                    throw new Error('Trusted code theme requires theme.ts');
                }
            }
        }

        // Atomic-ish swap: backup current -> move staging into place -> drop backup.
        if (targetExists) {
            await fs.rename(targetDir, backupDir);
            backedUp = true;
        }
        await fs.rename(tmpDir, targetDir);
        swapped = true;

        if (manifest.kind === 'theme') {
            try {
                await syncInstalledThemeToApp(manifest.id, targetDir);
            } catch (error) {
                // Restore previous install if theme sync fails after swap.
                await fs.rm(targetDir, { recursive: true, force: true });
                if (backedUp) {
                    await fs.rename(backupDir, targetDir);
                    backedUp = false;
                }
                await removeSyncedThemeFromApp(manifest.id);
                throw error;
            }
        }

        if (backedUp) {
            await fs.rm(backupDir, { recursive: true, force: true });
            backedUp = false;
        }

        return manifest;
    } catch (error) {
        if (!swapped) {
            await fs.rm(tmpDir, { recursive: true, force: true });
        }
        if (backedUp) {
            // Staging rename failed or post-swap work failed before cleanup:
            // restore the previous working version when possible.
            if (swapped && (await pathExists(targetDir))) {
                await fs.rm(targetDir, { recursive: true, force: true });
            }
            if (!(await pathExists(targetDir)) && (await pathExists(backupDir))) {
                await fs.rename(backupDir, targetDir);
            } else {
                await fs.rm(backupDir, { recursive: true, force: true });
            }
        }
        throw error;
    }
}

/**
 * Purpose:
 * Merges user-provided limits with the system defaults.
 */
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
