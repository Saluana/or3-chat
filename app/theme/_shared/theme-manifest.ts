/**
 * Theme manifest helper utilities.
 *
 * Provides a typed manifest of theme modules and associated assets so
 * runtime plugins can automatically discover and load themes.
 */

import type { ThemeDefinition } from './types';

type ThemeModuleLoader = () => Promise<{ default: ThemeDefinition }>;

type StylesheetModuleLoader = () => Promise<string>;

type ThemeAppConfig = Record<string, any>;

type ThemeAppConfigLoader = () => Promise<
    { default: ThemeAppConfig } | ThemeAppConfig
>;

type ThemeIconsLoader = () => Promise<{ default: Record<string, string> }>;

interface RawThemeEntry {
    path: string;
    dirName: string;
    loader: ThemeModuleLoader;
}

const themeModules = import.meta.glob('../*/theme.ts') as Record<
    string,
    ThemeModuleLoader
>;

const iconModules = import.meta.glob('../*/icons.config.ts') as Record<
    string,
    ThemeIconsLoader
>;

// Stylesheet asset loaders. These are resolved lazily so the CSS is only
// fetched when the corresponding theme becomes active. Using `as: 'url'`
// keeps the CSS out of the main bundle while still letting Vite emit an
// asset that can be referenced at runtime.
const stylesheetModules = import.meta.glob('../**/*.css', {
    query: '?url',
    import: 'default',
}) as Record<string, StylesheetModuleLoader>;

const configModules = import.meta.glob('../*/app.config.ts') as Record<
    string,
    ThemeAppConfigLoader
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
    /** Whether cssSelectors include style blocks (requires static CSS) */
    hasCssSelectorStyles: boolean;
    /** Optional theme-specific app config loader */
    appConfigLoader?: ThemeAppConfigLoader;
    /** Optional theme-specific icons loader */
    iconsLoader?: ThemeIconsLoader;
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
                hasCssSelectorStyles: containsStyleSelectors(definition),
                appConfigLoader:
                    configModules[`../${entry.dirName}/app.config.ts`],
                iconsLoader: iconModules[`../${entry.dirName}/icons.config.ts`],
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

/**
 * Dynamically load theme stylesheets via <link> tags.
 * This ensures CSS is only loaded when the theme is active, not bundled into main CSS.
 */
export async function loadThemeStylesheets(
    entry: ThemeManifestEntry,
    overrideList?: string[]
): Promise<void> {
    const stylesheets = overrideList ?? entry.stylesheets;

    if (!stylesheets || stylesheets.length === 0) {
        return;
    }

    if (typeof document === 'undefined') {
        return;
    }

    const doc = document;

    // Convert theme-relative paths to absolute URLs
    const promises = stylesheets.map(async (stylesheet) => {
        const href = await resolveThemeStylesheetHref(stylesheet, entry);
        if (!href) {
            return;
        }

        const existingLink = doc.querySelector(
            `link[data-theme-stylesheet="${entry.name}"][href="${href}"]`
        );

        if (existingLink) {
            return;
        }

        return new Promise<void>((resolve) => {
            const link = doc.createElement('link');
            link.rel = 'stylesheet';
            link.href = href;
            link.setAttribute('data-theme-stylesheet', entry.name);

            link.onload = () => resolve();
            link.onerror = () => {
                if (import.meta.dev) {
                    console.warn(
                        `[theme] Failed to load stylesheet "${stylesheet}" (resolved to "${href}") for theme "${entry.name}".`
                    );
                }
                resolve();
            };

            doc.head.appendChild(link);
        });
    });

    await Promise.all(promises);
}

/**
 * Unload theme stylesheets by removing their <link> tags
 */
export function unloadThemeStylesheets(themeName: string): void {
    if (typeof document === 'undefined') {
        return;
    }

    const links = document.querySelectorAll(
        `link[data-theme-stylesheet="${themeName}"]`
    );

    links.forEach((link) => link.remove());
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
    entry.hasCssSelectorStyles = containsStyleSelectors(definition);
}

export async function loadThemeAppConfig(
    entry: ThemeManifestEntry
): Promise<ThemeAppConfig | null> {
    if (!entry.appConfigLoader) {
        return null;
    }

    try {
        const module = await entry.appConfigLoader();
        const config = (module as any)?.default ?? module;
        if (config && typeof config === 'object') {
            return config as ThemeAppConfig;
        }
    } catch (error) {
        if (import.meta.dev) {
            console.warn(
                `[theme] Failed to load app.config.ts for theme "${entry.name}":`,
                error
            );
        }
    }

    return null;
}

function containsStyleSelectors(definition: ThemeDefinition): boolean {
    const selectors = definition.cssSelectors;
    if (!selectors) {
        return false;
    }

    return Object.values(selectors).some((config) => {
        const style = config?.style;
        return style !== undefined && Object.keys(style).length > 0;
    });
}

async function resolveThemeStylesheetHref(
    stylesheet: string,
    entry: ThemeManifestEntry
): Promise<string | null> {
    const trimmed = stylesheet.trim();
    const isExternal =
        /^(?:[a-z]+:)?\/\//i.test(trimmed) ||
        trimmed.startsWith('data:') ||
        trimmed.startsWith('blob:');

    // Try resolving via emitted asset URL first
    const moduleKeyCandidates = new Set<string>();

    if (trimmed.startsWith('~/theme/')) {
        moduleKeyCandidates.add(`../${trimmed.slice('~/theme/'.length)}`);
    }

    if (trimmed.startsWith('./')) {
        moduleKeyCandidates.add(`../${entry.dirName}/${trimmed.slice(2)}`);
    }

    if (
        !isExternal &&
        !trimmed.startsWith('~/') &&
        !trimmed.startsWith('./') &&
        !trimmed.startsWith('../')
    ) {
        moduleKeyCandidates.add(`../${entry.dirName}/${trimmed}`);
    }

    for (const key of moduleKeyCandidates) {
        const loader = stylesheetModules[key];
        if (loader) {
            try {
                const href = await loader();
                if (typeof href === 'string' && href.length > 0) {
                    return href;
                }
            } catch (error) {
                if (import.meta.dev) {
                    console.warn(
                        `[theme] Failed to resolve stylesheet module "${key}" for theme "${entry.name}".`,
                        error
                    );
                }
            }
        }
    }

    // Fallback to path-based resolution for assets placed under /public
    if (trimmed.startsWith('~/')) {
        return trimmed.replace(/^~\//, '/');
    }

    if (trimmed.startsWith('./')) {
        return `/theme/${entry.dirName}/${trimmed.slice(2)}`;
    }

    return trimmed;
}
