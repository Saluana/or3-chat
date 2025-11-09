/**
 * Theme manifest helper utilities.
 *
 * Provides a typed manifest of theme modules and associated assets so
 * runtime plugins can automatically discover and load themes.
 */

import type { ThemeDefinition } from './types';

type ThemeModuleLoader = () => Promise<{ default: ThemeDefinition }>;

type StylesheetModuleLoader = () => Promise<unknown>;

interface RawThemeEntry {
    path: string;
    dirName: string;
    loader: ThemeModuleLoader;
}

const themeModules = import.meta.glob('../*/theme.ts') as Record<
    string,
    ThemeModuleLoader
>;

const stylesheetModules = import.meta.glob('../*/**/*.css') as Record<
    string,
    StylesheetModuleLoader
>;

const rawThemeEntries: RawThemeEntry[] = Object.entries(themeModules).map(
    ([path, loader]) => {
        const match = path.match(/\.\.\/(.+?)\/theme\.ts$/);
        const dirName = match?.[1] ?? path;
        return { path, dirName, loader };
    }
);

/**
 * Loaded theme entry enriched with definition metadata.
 */
export interface ThemeManifestEntry {
    /** Theme identifier from definition */
    name: string;
    /** Directory name inside app/theme */
    dirName: string;
    /** Latest theme definition */
    definition: ThemeDefinition;
    /** Loader for hot-module replacement */
    loader: ThemeModuleLoader;
    /** Cached stylesheet list */
    stylesheets: string[];
    /** Whether the theme marked itself as default */
    isDefault: boolean;
}

/**
 * Load every theme definition to construct the manifest.
 */
export async function loadThemeManifest(): Promise<ThemeManifestEntry[]> {
    const manifest: ThemeManifestEntry[] = [];

    for (const entry of rawThemeEntries) {
        try {
            const module = await entry.loader();
            const definition = module?.default as ThemeDefinition | undefined;

            if (!definition?.name) {
                if (import.meta.dev) {
                    console.warn(
                        `[theme] Skipping ${entry.path}: missing theme name.`
                    );
                }
                continue;
            }

            manifest.push({
                name: definition.name,
                dirName: entry.dirName,
                definition,
                loader: entry.loader,
                stylesheets: definition.stylesheets ?? [],
                isDefault: Boolean(definition.isDefault),
            });
        } catch (error) {
            if (import.meta.dev) {
                console.warn(
                    `[theme] Failed to load theme module at ${entry.path}:`,
                    error
                );
            }
        }
    }

    return manifest;
}

function normalizeStylesheetTargets(
    entry: ThemeManifestEntry,
    stylesheets: string[]
): string[] {
    return stylesheets.map((sheet) => {
        const trimmed = sheet.trim();
        if (trimmed.startsWith('~/')) {
            return trimmed.replace(/^~\//, '');
        }
        if (trimmed.startsWith('./')) {
            return `theme/${entry.dirName}/${trimmed.slice(2)}`;
        }
        if (trimmed.startsWith('/')) {
            return trimmed.replace(/^\//, '');
        }
        return `theme/${entry.dirName}/${trimmed}`;
    });
}

function findStylesheetLoader(target: string): StylesheetModuleLoader | null {
    const candidates = [target];

    const withoutThemePrefix = target.startsWith('theme/')
        ? target.slice('theme/'.length)
        : target;

    candidates.push(withoutThemePrefix);

    const segments = withoutThemePrefix.split('/');
    if (segments.length > 1) {
        candidates.push(segments.slice(1).join('/'));
    }

    for (const candidate of candidates) {
        for (const [key, loader] of Object.entries(stylesheetModules)) {
            if (key.endsWith(candidate)) {
                return loader;
            }
        }
    }

    return null;
}

/**
 * Ensure stylesheet modules declared by a theme are loaded.
 */
export async function loadThemeStylesheets(
    entry: ThemeManifestEntry,
    overrideList?: string[]
): Promise<void> {
    const pending = normalizeStylesheetTargets(
        entry,
        overrideList ?? entry.stylesheets
    );

    for (const target of pending) {
        const loader = findStylesheetLoader(target);
        if (!loader) {
            if (import.meta.dev) {
                console.warn(
                    `[theme] Stylesheet "${target}" could not be resolved. ` +
                        'Ensure the path is correct relative to the theme directory or uses the ~/ alias.'
                );
            }
            continue;
        }

        await loader();
    }
}

/**
 * Refresh a manifest entry after reloading the module, keeping derived data in sync.
 */
export function updateManifestEntry(
    entry: ThemeManifestEntry,
    definition: ThemeDefinition
): void {
    entry.definition = definition;
    entry.stylesheets = definition.stylesheets ?? [];
    entry.isDefault = Boolean(definition.isDefault);
}
