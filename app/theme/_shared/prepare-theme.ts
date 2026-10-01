import type { CompiledTheme } from './types';
import { compileThemeDefinition } from './compile-theme';
import {
    loadThemeAppConfig,
    updateManifestEntry,
    type ThemeManifestEntry,
} from './theme-manifest';

export interface PreparedThemeEntry {
    compiledTheme: CompiledTheme;
    appConfig: Record<string, unknown> | null;
}

/** Shared client/server theme module preparation with no DOM side effects. */
export async function prepareThemeEntry(
    manifestEntry: ThemeManifestEntry
): Promise<PreparedThemeEntry> {
    const themeModule = await manifestEntry.loader() as Partial<Awaited<ReturnType<ThemeManifestEntry['loader']>>> | null | undefined;
    const definition = themeModule?.default;
    if (!definition) {
        throw new Error(`Theme "${manifestEntry.name}" has no default export.`);
    }

    updateManifestEntry(manifestEntry, definition);
    let icons = definition.icons;
    if (!icons && manifestEntry.iconsLoader) {
        try {
            const iconModule = await manifestEntry.iconsLoader() as Partial<Awaited<ReturnType<NonNullable<ThemeManifestEntry['iconsLoader']>>>> | null | undefined;
            icons = iconModule?.default;
        } catch (error) {
            if (import.meta.dev) {
                console.warn(
                    `[theme] Failed to load icons for theme "${manifestEntry.name}":`,
                    error
                );
            }
        }
    }

    return {
        compiledTheme: compileThemeDefinition(definition, {
            isDefault: manifestEntry.isDefault,
            stylesheets: manifestEntry.stylesheets,
            hasStyleSelectors: manifestEntry.hasCssSelectorStyles,
            icons,
        }),
        appConfig: (await loadThemeAppConfig(manifestEntry)) ?? null,
    };
}
