/** Canonical, side-effect-free theme definition compiler. */
import type { CompiledTheme, ThemeDefinition } from './types';
import { compileOverridesRuntime } from './runtime-compile';
import { generateThemeCssVariables } from './generate-css-variables';

export interface ResolvedThemeAssets {
    isDefault?: boolean;
    stylesheets?: string[];
    hasStyleSelectors?: boolean;
    icons?: Record<string, string>;
}

export function hasThemeStyleSelectors(definition: ThemeDefinition): boolean {
    return Object.values(definition.cssSelectors ?? {}).some(
        (config) => Boolean(config.style && Object.keys(config.style).length > 0)
    );
}

export function compileThemeDefinition(
    definition: ThemeDefinition,
    assets: ResolvedThemeAssets = {}
): CompiledTheme {
    return deepFreeze({
        name: definition.name,
        isDefault: assets.isDefault ?? Boolean(definition.isDefault),
        stylesheets: assets.stylesheets ?? definition.stylesheets ?? [],
        displayName: definition.displayName,
        description: definition.description,
        cssVariables: generateThemeCssVariables(definition),
        overrides: compileOverridesRuntime(definition.overrides ?? {}),
        cssSelectors: definition.cssSelectors,
        hasStyleSelectors:
            assets.hasStyleSelectors ?? hasThemeStyleSelectors(definition),
        ui: definition.ui,
        propMaps: definition.propMaps,
        backgrounds: definition.backgrounds,
        icons: assets.icons ?? definition.icons,
        customComponents: definition.customComponents,
        componentContractVersion: definition.componentContractVersion,
        workspaceProfiles: definition.workspaceProfiles,
        recommendedWorkspaceProfileId:
            definition.recommendedWorkspaceProfileId,
    });
}

function deepFreeze<T>(value: T): T {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value as Record<string, unknown>)) {
        deepFreeze(child);
    }
    return Object.freeze(value);
}
