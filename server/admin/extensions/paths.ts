import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ExtensionKind } from './types';

export const EXTENSIONS_BASE_DIR = resolve(process.cwd(), 'extensions');

export function getKindDir(kind: ExtensionKind): string {
    if (kind === 'admin_plugin') return 'admin-plugins';
    if (kind === 'theme') return 'themes';
    return 'plugins';
}

export async function ensureExtensionsDirs(): Promise<void> {
    await fs.mkdir(EXTENSIONS_BASE_DIR, { recursive: true });
    await fs.mkdir(join(EXTENSIONS_BASE_DIR, 'plugins'), { recursive: true });
    await fs.mkdir(join(EXTENSIONS_BASE_DIR, 'themes'), { recursive: true });
    await fs.mkdir(join(EXTENSIONS_BASE_DIR, 'admin-plugins'), { recursive: true });
    await fs.mkdir(join(EXTENSIONS_BASE_DIR, '.tmp'), { recursive: true });
}
