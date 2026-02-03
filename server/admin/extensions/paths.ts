/**
 * @module server/admin/extensions/paths.ts
 *
 * Purpose:
 * Provides directory resolution and filesystem initialization for extensions.
 * Ensures the extension storage hierarchy is established before operations.
 *
 * Responsibilities:
 * - Resolve the root extensions directory.
 * - Map extension kinds to their respective subdirectories.
 * - Bootstrap necessary directories (`plugins`, `themes`, `temp`, etc.).
 *
 * Constraints:
 * - Directories are created relative to the process current working directory.
 */
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ExtensionKind } from './types';

/**
 * The absolute path to the root `extensions/` directory on the server.
 */
export const EXTENSIONS_BASE_DIR = resolve(process.cwd(), 'extensions');

/**
 * Purpose:
 * Maps an internal `ExtensionKind` to its corresponding filesystem directory name.
 */
export function getKindDir(kind: ExtensionKind): string {
    if (kind === 'admin_plugin') return 'admin-plugins';
    if (kind === 'theme') return 'themes';
    return 'plugins';
}

/**
 * Purpose:
 * Safely creates a directory and its parents if they do not exist.
 *
 * Performance:
 * Uses `{ recursive: true }` to minimize syscalls.
 */
async function mkdirSafe(path: string): Promise<void> {
    try {
        await fs.mkdir(path, { recursive: true });
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error) {
            const code = (error as { code?: string }).code;
            if (code === 'ENOENT') {
                await fs.mkdir(EXTENSIONS_BASE_DIR, { recursive: true });
                await fs.mkdir(path, { recursive: true });
                return;
            }
        }
        throw error;
    }
}

/**
 * Purpose:
 * Bootstraps the extensions directory structure.
 * This is called by the Extension Manager and Installer before any I/O occurs.
 *
 * Behavior:
 * Creates the base directory and kind-specific subfolders.
 * Also initializes a `.tmp` directory for atomic installations.
 */
export async function ensureExtensionsDirs(): Promise<void> {
    await mkdirSafe(EXTENSIONS_BASE_DIR);
    await mkdirSafe(join(EXTENSIONS_BASE_DIR, 'plugins'));
    await mkdirSafe(join(EXTENSIONS_BASE_DIR, 'themes'));
    await mkdirSafe(join(EXTENSIONS_BASE_DIR, 'admin-plugins'));
    await mkdirSafe(join(EXTENSIONS_BASE_DIR, '.tmp'));
}
