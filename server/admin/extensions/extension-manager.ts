/**
 * @module server/admin/extensions/extension-manager.ts
 *
 * Purpose:
 * High-level service for managing installed extensions. This module provides
 * discovery, inventory, and removal capabilities.
 *
 * Architecture:
 * - **Cached Inventory**: Uses an in-memory cache with a 15-second TTL to avoid
 *   excessive disk scanning during high-frequency requests.
 * - **Lazy Loading**: Scans the filesystem only when requested or when the
 *   cache expires/is invalidated.
 * - **Validation**: Verifies `or3.manifest.json` for every directory to ensure
 *   only valid extensions are returned.
 *
 * Non-goals:
 * - Installing new extensions (see `install.ts`).
 * - Dynamic code execution (loading is handled by the application core).
 */
import { promises as fs } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { ExtensionKind, InstalledExtensionRecord } from './types';
import { ExtensionIdSchema, Or3ExtensionManifestSchema } from './types';
import { ensureExtensionsDirs, EXTENSIONS_BASE_DIR, getKindDir } from './paths';
import { removeSyncedThemeFromApp } from './theme-install-sync';

/**
 * Purpose:
 * Internal cache structure for the extension inventory.
 */
type CacheEntry = {
    /** Timestamp of the last scan. */
    at: number;
    /** The discovered extension records. */
    items: InstalledExtensionRecord[];
    /** Cache version used for explicit invalidation. */
    version: number;
};

let cache: CacheEntry | undefined;
let cacheVersion = 0;

/** TTL to prevent frequent I/O during dashboard navigation. */
const CACHE_TTL_MS = 15_000;

/**
 * Purpose:
 * Reads and validates an extension manifest from a file.
 * Returns null if the file is missing or invalid.
 */
async function readManifest(filePath: string) {
    const raw = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(raw) as unknown;
    const parsed = Or3ExtensionManifestSchema.safeParse(data);
    if (!parsed.success) {
        return null;
    }
    return parsed.data;
}

/**
 * Purpose:
 * Scans a specific kind directory for valid OR3 extensions.
 *
 * Behavior:
 * 1. Reads the directory entries.
 * 2. Checks each sub-directory for an `or3.manifest.json`.
 * 3. Filters results to ensure the manifest `kind` matches the folder it was found in.
 */
async function listExtensionsInDir(
    root: string,
    kind: ExtensionKind
): Promise<InstalledExtensionRecord[]> {
    let entries: Array<string> = [];
    try {
        entries = await fs.readdir(root);
    } catch {
        // Directory may not exist yet if no extensions of this kind are installed
        return [];
    }

    const results: InstalledExtensionRecord[] = [];
    for (const entry of entries) {
        const manifestPath = join(root, entry, 'or3.manifest.json');
        try {
            const manifest = await readManifest(manifestPath);
            if (!manifest) continue;
            // Preserve the full validated manifest (including runtime metadata).
            results.push({
                ...manifest,
                path: join(root, entry),
            });
        } catch {
            // Skip invalid extension directories silently
            continue;
        }
    }

    return results.filter((item) => item.kind === kind);
}

/**
 * Purpose:
 * Returns a complete inventory of all extensions installed on the server.
 *
 * Behavior:
 * - Returns cached data if valid.
 * - Otherwise, performs a parallel scan across all kind directories.
 */
export async function listInstalledExtensions(): Promise<InstalledExtensionRecord[]> {
    if (cache && Date.now() - cache.at < CACHE_TTL_MS && cache.version === cacheVersion) {
        return cache.items;
    }

    await ensureExtensionsDirs();
    const pluginsDir = join(EXTENSIONS_BASE_DIR, 'plugins');
    const themesDir = join(EXTENSIONS_BASE_DIR, 'themes');
    const adminPluginsDir = join(EXTENSIONS_BASE_DIR, 'admin-plugins');

    const [plugins, themes, adminPlugins] = await Promise.all([
        listExtensionsInDir(pluginsDir, 'plugin'),
        listExtensionsInDir(themesDir, 'theme'),
        listExtensionsInDir(adminPluginsDir, 'admin_plugin'),
    ]);

    const items = [...plugins, ...themes, ...adminPlugins];
    cache = { at: Date.now(), items, version: cacheVersion };
    return items;
}

/**
 * Purpose:
 * Synchronously invalidates the current inventory cache.
 * Should be called after any install or uninstall operation.
 */
export function invalidateExtensionsCache(): void {
    cacheVersion++;
    cache = undefined;
}

function isPathInside(root: string, candidate: string): boolean {
    const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
    return candidate === root || candidate.startsWith(normalizedRoot);
}

/**
 * Purpose:
 * Completely removes an extension from the filesystem.
 *
 * Behavior:
 * Validates the extension id, resolves the path under the kind directory,
 * verifies containment (including symlink realpath), then deletes recursively.
 *
 * @param kind - The category of the extension to remove.
 * @param id - The unique ID of the extension (matches its folder name).
 */
export async function uninstallExtension(
    kind: ExtensionKind,
    id: string
): Promise<void> {
    const parsedId = ExtensionIdSchema.safeParse(id);
    if (!parsedId.success) {
        throw new Error('Invalid extension id');
    }

    await ensureExtensionsDirs();
    const kindDir = getKindDir(kind);
    const kindRoot = resolve(EXTENSIONS_BASE_DIR, kindDir);
    const targetDir = resolve(kindRoot, parsedId.data);

    if (!isPathInside(kindRoot, targetDir)) {
        throw new Error('Invalid extension id');
    }

    let realKindRoot: string;
    try {
        realKindRoot = await fs.realpath(kindRoot);
    } catch {
        throw new Error('Extension kind directory unavailable');
    }

    let realTarget: string;
    try {
        realTarget = await fs.realpath(targetDir);
    } catch (error) {
        if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            (error as { code?: string }).code === 'ENOENT'
        ) {
            throw new Error('Extension not found');
        }
        throw error;
    }

    if (!isPathInside(realKindRoot, realTarget)) {
        throw new Error('Invalid extension path');
    }

    await fs.rm(targetDir, { recursive: true, force: true });
    if (kind === 'theme') {
        await removeSyncedThemeFromApp(parsedId.data);
    }
}
