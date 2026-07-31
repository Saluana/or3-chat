/**
 * @module app/theme/_shared/theme-manifest
 *
 * Purpose:
 * Builds and manages a manifest of theme modules and assets.
 *
 * Behavior:
 * - Discovers theme modules via Vite glob imports
 * - Lazily loads stylesheets and optional assets
 *
 * Constraints:
 * - Requires Vite runtime for glob imports
 *
 * Non-Goals:
 * - Validating theme definitions beyond basic presence checks
 */

import type { ThemeDefinition } from './types';
import { GENERATED_THEME_METADATA } from './theme-manifest.generated';

type ThemeModuleLoader = () => Promise<{ default: ThemeDefinition }>;

type StylesheetModuleLoader = () => Promise<string>;

type ThemeAppConfig = Record<string, unknown>;

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
 * `ThemeManifestEntry`
 *
 * Purpose:
 * Manifest entry enriched with definition metadata and loaders.
 */
export interface ThemeManifestEntry {
    /** Theme identifier from definition */
    name: string;
    /** Directory name inside app/theme */
    dirName: string;
    /** Human-readable metadata generated without importing theme code */
    displayName?: string;
    description?: string;
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

export interface ThemeManifestError {
    path: string;
    /** Human-readable message (POJO-safe for Nuxt payload / dev log stringify). */
    message: string;
}

function toManifestError(path: string, error: unknown): ThemeManifestError {
    const message =
        error instanceof Error
            ? error.message
            : typeof error === 'string'
              ? error
              : 'Unknown theme manifest error';
    return { path, message };
}

export interface ThemeManifestResult {
    entries: ThemeManifestEntry[];
    errors: ThemeManifestError[];
}

/**
 * `loadThemeManifest`
 *
 * Purpose:
 * Joins generated metadata with lazy module loaders without importing theme code.
 *
 * Constraints:
 * - Missing or invalid theme modules are skipped in dev
 */
export async function loadThemeManifest(): Promise<ThemeManifestResult> {
    const manifest: ThemeManifestEntry[] = [];
    const errors: ThemeManifestError[] = [];

    const rawByDir = new Map(rawThemeEntries.map((entry) => [entry.dirName, entry]));
    for (const metadata of GENERATED_THEME_METADATA) {
        const entry = rawByDir.get(metadata.dirName);
        if (!entry) {
            errors.push(
                toManifestError(
                    `app/theme/${metadata.dirName}/theme.ts`,
                    'Generated theme metadata has no matching module'
                )
            );
            continue;
        }
        manifest.push({
            ...metadata,
            stylesheets: [...metadata.stylesheets],
            loader: entry.loader,
            appConfigLoader: configModules[`../${entry.dirName}/app.config.ts`],
            iconsLoader: iconModules[`../${entry.dirName}/icons.config.ts`],
        });
        rawByDir.delete(metadata.dirName);
    }
    for (const entry of rawByDir.values()) {
        errors.push(
            toManifestError(
                entry.path,
                'Theme is missing generated metadata; run bun run theme:validate'
            )
        );
    }

    manifest.sort((a, b) => a.name.localeCompare(b.name));

    const defaults = manifest.filter((entry) => entry.isDefault);
    if (defaults.length > 1) {
        errors.push(
            toManifestError(
                'app/theme/*/theme.ts',
                `Multiple themes declare isDefault: ${defaults
                    .map((entry) => entry.name)
                    .join(', ')}`
            )
        );
    }

    if (import.meta.dev && errors.length > 0) {
        console.warn(
            `[theme] Failed to load ${errors.length} theme module(s).`,
            errors
        );
    }

    return {
        entries: manifest,
        errors,
    };
}

const stylesheetInFlight = new Map<string, Promise<void>>();

/**
 * `loadThemeStylesheets`
 *
 * Purpose:
 * Loads theme stylesheets via link tags when a theme is activated.
 */
export async function loadThemeStylesheets(
    entry: ThemeManifestEntry,
    overrideList?: string[]
): Promise<void> {
    const stylesheets = overrideList ?? entry.stylesheets;

    if (stylesheets.length === 0) {
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

        const dedupeKey = `${entry.name}|${href}`;

        const existingInFlight = stylesheetInFlight.get(dedupeKey);
        if (existingInFlight) {
            return existingInFlight;
        }

        const existingLink = doc.querySelector(
            `link[data-theme-stylesheet="${entry.name}"][href="${href}"]`
        );

        if (existingLink) {
            return;
        }

        const inFlight = new Promise<void>((resolve) => {
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
        }).finally(() => {
            stylesheetInFlight.delete(dedupeKey);
        });

        stylesheetInFlight.set(dedupeKey, inFlight);
        return inFlight;
    });

    await Promise.all(promises);
}

/**
 * `unloadThemeStylesheets`
 *
 * Purpose:
 * Removes theme stylesheet link tags for a theme.
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
 * `updateManifestEntry`
 *
 * Purpose:
 * Updates a manifest entry with a new definition and derived values.
 */
export function updateManifestEntry(
    entry: ThemeManifestEntry,
    definition: ThemeDefinition
): void {
    entry.displayName = definition.displayName;
    entry.description = definition.description;
    entry.stylesheets = definition.stylesheets ?? [];
    entry.isDefault = Boolean(definition.isDefault);
    entry.hasCssSelectorStyles = containsStyleSelectors(definition);
}

/**
 * `loadThemeAppConfig`
 *
 * Purpose:
 * Loads a theme specific app.config override if present.
 */
export async function loadThemeAppConfig(
    entry: ThemeManifestEntry
): Promise<ThemeAppConfig | null> {
    if (!entry.appConfigLoader) {
        return null;
    }

    try {
        const module = await entry.appConfigLoader();
        const moduleWithDefault = module as { default?: ThemeAppConfig };
        const config = moduleWithDefault.default ?? module;
        if (typeof config === 'object') {
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
        const style = config.style;
        return style !== undefined && Object.keys(style).length > 0;
    });
}

export async function resolveThemeStylesheetHref(
    stylesheet: string,
    entry: ThemeManifestEntry
): Promise<string | null> {
    const trimmed = stylesheet.trim();
    const isExternal =
        /^(?:[a-z]+:)?\/\//i.test(trimmed) ||
        trimmed.startsWith('data:') ||
        trimmed.startsWith('blob:');

    if (isExternal) {
        if (import.meta.dev) {
            console.warn(
                `[theme] External stylesheet rejected for theme "${entry.name}": ${trimmed}`
            );
        }
        return null;
    }

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
