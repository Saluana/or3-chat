import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import {
    BUNDLED_PLUGIN_CATALOG_MARKER,
    type BundledPluginCatalog,
    type BundledPluginCatalogEntry,
} from '../../shared/plugins/bundled-plugin-catalog';

const LEGACY_ENTRIES = ['plugin.client.ts', 'plugin.client.js', 'plugin.client.mjs'] as const;
const HOST_INPUT_ROOTS = ['app', 'server', 'shared', 'extensions', 'tests/plugin-runtime/build-fixtures'];
const HOST_INPUT_FILES = ['package.json', 'bun.lock', 'nuxt.config.ts', 'config.or3.ts', 'config.or3cloud.ts'];

export interface GeneratedBundledPluginCatalog {
    catalog: BundledPluginCatalog;
    issues: string[];
}

function normalizedRelativePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
}

function listFiles(root: string, options: { productionOnly?: boolean } = {}): string[] {
    if (!existsSync(root)) return [];
    const files: string[] = [];
    const visit = (directory: string) => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            if (options.productionOnly && entry.isDirectory() && entry.name === '__tests__') continue;
            const path = resolve(directory, entry.name);
            if (entry.isDirectory()) visit(path);
            else if (
                entry.isFile() &&
                (!options.productionOnly || !/\.(?:test|spec)\.[^.]+$/i.test(entry.name))
            ) {
                files.push(path);
            }
        }
    };
    if (statSync(root).isDirectory()) visit(root);
    else files.push(root);
    return files.sort();
}

function updateLengthPrefixed(hash: ReturnType<typeof createHash>, value: Buffer | string): void {
    const bytes = typeof value === 'string' ? Buffer.from(value) : value;
    const length = Buffer.allocUnsafe(8);
    length.writeBigUInt64BE(BigInt(bytes.byteLength));
    hash.update(length);
    hash.update(bytes);
}

export function computeHostBuildId(repoRoot: string, explicitId?: string): string {
    const configured = explicitId?.trim();
    if (configured) return configured;
    const files = [
        ...HOST_INPUT_FILES.map((file) => resolve(repoRoot, file)).filter(existsSync),
        ...HOST_INPUT_ROOTS.flatMap((root) =>
            listFiles(resolve(repoRoot, root), { productionOnly: root !== 'tests/plugin-runtime/build-fixtures' })
        ),
    ].sort();
    const hash = createHash('sha256');
    for (const file of files) {
        updateLengthPrefixed(hash, normalizedRelativePath(relative(repoRoot, file)));
        updateLengthPrefixed(hash, readFileSync(file));
    }
    return `sha256-${hash.digest('hex')}`;
}

export function generateBundledPluginCatalog(options: {
    repoRoot: string;
    hostBuildId?: string;
}): GeneratedBundledPluginCatalog {
    const pluginsRoot = resolve(options.repoRoot, 'extensions/plugins');
    const entries: BundledPluginCatalogEntry[] = [];
    const issues: string[] = [];
    const pluginDirectories = new Map<string, string>();
    const duplicatePluginIds = new Set<string>();
    if (existsSync(pluginsRoot)) {
        for (const directory of readdirSync(pluginsRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            if (!directory.isDirectory()) continue;
            const pluginRoot = resolve(pluginsRoot, directory.name);
            const manifestPath = resolve(pluginRoot, 'or3.manifest.json');
            if (!existsSync(manifestPath)) continue;
            let manifest: Record<string, unknown>;
            try {
                manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
            } catch {
                issues.push(`${directory.name}: invalid or3.manifest.json`);
                continue;
            }
            if (
                manifest.kind !== 'plugin' ||
                typeof manifest.id !== 'string' ||
                !/^[A-Za-z0-9._-]+$/.test(manifest.id) ||
                manifest.id.includes('..')
            ) {
                continue;
            }
            const pluginId = manifest.id;
            const previousDirectory = pluginDirectories.get(pluginId);
            if (previousDirectory || duplicatePluginIds.has(pluginId)) {
                if (!duplicatePluginIds.has(pluginId)) {
                    issues.push(
                        `${directory.name}: duplicate plugin id ${pluginId} (already declared by ${previousDirectory})`
                    );
                }
                duplicatePluginIds.add(pluginId);
                for (let index = entries.length - 1; index >= 0; index--) {
                    if (entries[index]?.pluginId === pluginId) {
                        entries.splice(index, 1);
                    }
                }
                continue;
            }
            pluginDirectories.set(pluginId, directory.name);
            const clientEntries = listFiles(pluginRoot)
                .map((file) => normalizedRelativePath(relative(pluginRoot, file)))
                .filter((entry) => /\.client\.(?:ts|js|mjs)$/i.test(entry));
            for (const clientEntry of clientEntries) {
                entries.push({
                    pluginId,
                    clientEntry,
                    moduleKey: `../../extensions/plugins/${directory.name}/${clientEntry}`,
                });
            }
            const runtime = manifest.runtime as { client?: { entry?: unknown } } | undefined;
            const requested = runtime?.client?.entry;
            const hasLegacyFallback = LEGACY_ENTRIES.some((entry) => clientEntries.includes(entry));
            if (
                typeof requested === 'string' &&
                requested.trim() &&
                !clientEntries.includes(normalizedRelativePath(requested)) &&
                !hasLegacyFallback
            ) {
                const normalized = normalizedRelativePath(requested);
                const reason = /\.client\.(?:ts|js|mjs)$/i.test(normalized)
                    ? 'is absent from this host build'
                    : 'is outside the V1 client glob';
                issues.push(`${directory.name}: client entry ${reason} (${normalized})`);
            }
        }
    }
    return {
        catalog: {
            schemaVersion: 1,
            marker: BUNDLED_PLUGIN_CATALOG_MARKER,
            hostBuildId: computeHostBuildId(options.repoRoot, options.hostBuildId),
            entries,
        },
        issues,
    };
}

export function renderBundledPluginCatalogModule(catalog: BundledPluginCatalog): string {
    return [
        // This source is consumed both as a .ts Nuxt template and as a Nitro
        // JavaScript virtual module, so it must stay valid in both parsers.
        `export const bundledPluginCatalog = Object.freeze(${JSON.stringify(catalog, null, 2)});`,
        '',
    ].join('\n');
}
