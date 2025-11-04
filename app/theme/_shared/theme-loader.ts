/**
 * Theme Loader Infrastructure
 * ===========================
 * Detects, validates, and loads theme files at build time and runtime.
 * Provides APIs for theme discovery and loading with proper error handling.
 */

import { mergeThemeConfig as defuMerge } from './config-merger';
import type { AppConfig } from './config-merger';

// Core interfaces for theme management
export interface ThemeManifest {
    name: string;
    path: string;
    hasLight: boolean;
    hasDark: boolean;
    hasMain: boolean;
    hasConfig: boolean;
    variants: (
        | 'light'
        | 'dark'
        | 'light-hc'
        | 'dark-hc'
        | 'light-mc'
        | 'dark-mc'
    )[];
}

export interface ThemeLoadResult {
    manifest: ThemeManifest;
    lightCss?: string;
    darkCss?: string;
    mainCss?: string;
    config?: Partial<AppConfig>;
    errors: ThemeError[];
    warnings: ThemeWarning[];
}

export interface ThemeError {
    file: string;
    line?: number;
    message: string;
    severity: 'error' | 'warning';
}

export type ThemeWarning = ThemeError;

// Required CSS variables for validation
const REQUIRED_LIGHT_VARS = [
    '--md-primary',
    '--md-on-primary',
    '--md-secondary',
    '--md-on-secondary',
    '--md-surface',
    '--md-on-surface',
    '--md-error',
    '--md-on-error',
    '--md-background',
    '--md-on-background',
];

const REQUIRED_DARK_VARS = [...REQUIRED_LIGHT_VARS]; // Same set for dark

// Use Vite's import.meta.glob to dynamically discover theme files
// Pattern is relative to this file's location (app/theme/_shared/)
// ../ goes to app/theme/
const themeCssFiles = import.meta.glob(
    '../**/{light,dark,light-hc,dark-hc,light-mc,dark-mc,main}.css',
    {
        eager: false,
        query: '?raw',
        import: 'default',
    }
);

const themeConfigFiles = import.meta.glob('../**/theme.ts', {
    eager: false,
    import: 'default',
});

/**
 * Scans app/theme directory and returns available themes
 */
export function discoverThemes(): ThemeManifest[] {
    const themes: ThemeManifest[] = [];
    const themeNames = new Set<string>();

    // Extract theme names from CSS file paths
    for (const path of Object.keys(themeCssFiles)) {
        // Path will be like ../default/light.css or ../cyberpunk/dark.css
        const match = path.match(/\.\.\/([^/]+)\//);
        if (match && match[1] && match[1] !== '_shared') {
            themeNames.add(match[1]);
        }
    }

    // Build manifests for each discovered theme
    for (const themeName of themeNames) {
        const basePath = `../${themeName}`;

        const manifest: ThemeManifest = {
            name: themeName,
            path: `~/theme/${themeName}`,
            hasLight: `${basePath}/light.css` in themeCssFiles,
            hasDark: `${basePath}/dark.css` in themeCssFiles,
            hasMain: `${basePath}/main.css` in themeCssFiles,
            hasConfig: `${basePath}/theme.ts` in themeConfigFiles,
            variants: [],
        };

        // Check which variants exist
        if (manifest.hasLight) manifest.variants.push('light');
        if (manifest.hasDark) manifest.variants.push('dark');
        if (`${basePath}/light-hc.css` in themeCssFiles) {
            manifest.variants.push('light-hc');
        }
        if (`${basePath}/dark-hc.css` in themeCssFiles) {
            manifest.variants.push('dark-hc');
        }
        if (`${basePath}/light-mc.css` in themeCssFiles) {
            manifest.variants.push('light-mc');
        }
        if (`${basePath}/dark-mc.css` in themeCssFiles) {
            manifest.variants.push('dark-mc');
        }

        themes.push(manifest);
    }

    return themes.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Loads specified theme with validation
 */
export async function loadTheme(themeName: string): Promise<ThemeLoadResult> {
    const errors: ThemeError[] = [];
    const warnings: ThemeWarning[] = [];

    try {
        // Get theme manifest
        const themes = discoverThemes();
        const manifest = themes.find((t) => t.name === themeName);

        if (!manifest) {
            errors.push({
                file: themeName,
                message: `Theme "${themeName}" not found`,
                severity: 'error',
            });

            return {
                manifest: {
                    name: themeName,
                    path: '',
                    hasLight: false,
                    hasDark: false,
                    hasMain: false,
                    hasConfig: false,
                    variants: [],
                },
                errors,
                warnings,
            };
        }

        // Load CSS files using the actual loaders
        let lightCss: string | undefined;
        let darkCss: string | undefined;
        let mainCss: string | undefined;
        let config: Partial<AppConfig> | undefined;

        // Use the relative path format that matches import.meta.glob
        const basePath = `../${themeName}`;

        if (manifest.hasLight) {
            const loader = themeCssFiles[`${basePath}/light.css`];
            if (loader) {
                lightCss = (await loader()) as string;
                const lightErrors = validateThemeVariables(lightCss, 'light');
                warnings.push(...lightErrors);
            }
        }

        if (manifest.hasDark) {
            const loader = themeCssFiles[`${basePath}/dark.css`];
            if (loader) {
                darkCss = (await loader()) as string;
                const darkErrors = validateThemeVariables(darkCss, 'dark');
                warnings.push(...darkErrors);
            }
        }

        if (manifest.hasMain) {
            const loader = themeCssFiles[`${basePath}/main.css`];
            if (loader) {
                mainCss = (await loader()) as string;
            }
        }

        if (manifest.hasConfig) {
            const loader = themeConfigFiles[`${basePath}/theme.ts`];
            if (loader) {
                config = (await loader()) as Partial<AppConfig>;
            }
        }

        return {
            manifest,
            lightCss,
            darkCss,
            mainCss,
            config,
            errors,
            warnings,
        };
    } catch (err) {
        errors.push({
            file: themeName,
            message: `Failed to load theme: ${
                err instanceof Error ? err.message : String(err)
            }`,
            severity: 'error',
        });

        return {
            manifest: {
                name: themeName,
                path: '',
                hasLight: false,
                hasDark: false,
                hasMain: false,
                hasConfig: false,
                variants: [],
            },
            errors,
            warnings,
        };
    }
}

/**
 * Validates CSS variables presence
 */
export function validateThemeVariables(
    css: string,
    mode: 'light' | 'dark'
): ThemeError[] {
    const required =
        mode === 'light' ? REQUIRED_LIGHT_VARS : REQUIRED_DARK_VARS;
    const errors: ThemeError[] = [];

    for (const varName of required) {
        if (!css.includes(varName)) {
            errors.push({
                file: `${mode}.css`,
                message: `Missing required CSS variable: ${varName}`,
                severity: 'warning', // Warning not error - fallback exists
            });
        }
    }

    return errors;
}

/**
 * Deep merge theme.ts config with default app.config.ts
 */
export function mergeThemeConfig(
    base: AppConfig,
    override: Partial<AppConfig>
): AppConfig {
    return defuMerge(base, override);
}
