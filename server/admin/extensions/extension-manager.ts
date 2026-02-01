import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { ExtensionKind, InstalledExtensionRecord } from './types';
import { Or3ExtensionManifestSchema } from './types';
import { ensureExtensionsDirs, EXTENSIONS_BASE_DIR, getKindDir } from './paths';

type CacheEntry = {
    at: number;
    items: InstalledExtensionRecord[];
    version: number;
};

let cache: CacheEntry | undefined;
let cacheVersion = 0;

const CACHE_TTL_MS = 15_000;

async function readManifest(filePath: string) {
    const raw = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(raw) as unknown;
    const parsed = Or3ExtensionManifestSchema.safeParse(data);
    if (!parsed.success) {
        return null;
    }
    return parsed.data;
}

async function listExtensionsInDir(
    root: string,
    kind: ExtensionKind
): Promise<InstalledExtensionRecord[]> {
    let entries: Array<string> = [];
    try {
        entries = await fs.readdir(root);
    } catch {
        return [];
    }

    const results: InstalledExtensionRecord[] = [];
    for (const entry of entries) {
        const manifestPath = join(root, entry, 'or3.manifest.json');
        try {
            const manifest = await readManifest(manifestPath);
            if (!manifest) continue;
            results.push({
                id: manifest.id,
                name: manifest.name,
                version: manifest.version,
                kind: manifest.kind,
                description: manifest.description,
                capabilities: manifest.capabilities,
                path: join(root, entry),
            });
        } catch {
            continue;
        }
    }

    return results.filter((item) => item.kind === kind);
}

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

export function invalidateExtensionsCache(): void {
    cacheVersion++;
    cache = undefined;
}

export async function uninstallExtension(
    kind: ExtensionKind,
    id: string
): Promise<void> {
    await ensureExtensionsDirs();
    const kindDir = getKindDir(kind);
    const targetDir = join(EXTENSIONS_BASE_DIR, kindDir, id);
    await fs.rm(targetDir, { recursive: true, force: true });
}
