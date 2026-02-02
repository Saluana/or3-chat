import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ExtensionKind } from './types';

export const EXTENSIONS_BASE_DIR = resolve(process.cwd(), 'extensions');

export function getKindDir(kind: ExtensionKind): string {
    if (kind === 'admin_plugin') return 'admin-plugins';
    if (kind === 'theme') return 'themes';
    return 'plugins';
}

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

export async function ensureExtensionsDirs(): Promise<void> {
    await mkdirSafe(EXTENSIONS_BASE_DIR);
    await mkdirSafe(join(EXTENSIONS_BASE_DIR, 'plugins'));
    await mkdirSafe(join(EXTENSIONS_BASE_DIR, 'themes'));
    await mkdirSafe(join(EXTENSIONS_BASE_DIR, 'admin-plugins'));
    await mkdirSafe(join(EXTENSIONS_BASE_DIR, '.tmp'));
}
