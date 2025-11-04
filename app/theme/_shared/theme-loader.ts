/**
 * Theme Loader Infrastructure
 * ===========================
 * Detects, validates, and loads theme files at build time and runtime.
 * Provides APIs for theme discovery and loading with proper error handling.
 */

import { mergeThemeConfig as defuMerge } from './config-merger';

// Core interfaces for theme management
export interface ThemeManifest {
  name: string;
  path: string;
  hasLight: boolean;
  hasDark: boolean;
  hasMain: boolean;
  hasConfig: boolean;
  variants: ('light' | 'dark' | 'light-hc' | 'dark-hc' | 'light-mc' | 'dark-mc')[];
}

export interface ThemeLoadResult {
  manifest: ThemeManifest;
  lightCss?: string;
  darkCss?: string;
  mainCss?: string;
  config?: any; // Partial<AppConfig>
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
  '--md-primary', '--md-on-primary',
  '--md-secondary', '--md-on-secondary', 
  '--md-surface', '--md-on-surface',
  '--md-error', '--md-on-error',
  '--md-background', '--md-on-background',
];

const REQUIRED_DARK_VARS = [...REQUIRED_LIGHT_VARS]; // Same set for dark

/**
 * Scans app/theme directory and returns available themes
 */
export function discoverThemes(): ThemeManifest[] {
  const themes: ThemeManifest[] = [];
  
  // In a real implementation, this would scan the file system
  // For now, we return the default theme manifest
  const defaultTheme: ThemeManifest = {
    name: 'default',
    path: '~/theme/default',
    hasLight: true,
    hasDark: true,
    hasMain: true,
    hasConfig: true,
    variants: ['light', 'dark', 'light-hc', 'dark-hc', 'light-mc', 'dark-mc']
  };
  
  themes.push(defaultTheme);
  
  return themes;
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
    const manifest = themes.find(t => t.name === themeName);
    
    if (!manifest) {
      errors.push({
        file: themeName,
        message: `Theme "${themeName}" not found`,
        severity: 'error'
      });
      
      return {
        manifest: {
          name: themeName,
          path: '',
          hasLight: false,
          hasDark: false,
          hasMain: false,
          hasConfig: false,
          variants: []
        },
        errors,
        warnings
      };
    }
    
    // Load CSS files (in real implementation, this would read from file system)
    let lightCss: string | undefined;
    let darkCss: string | undefined;
    let mainCss: string | undefined;
    let config: any | undefined;
    
    if (manifest.hasLight) {
      lightCss = await loadThemeCss(`${manifest.path}/light.css`);
      const lightErrors = validateThemeVariables(lightCss, 'light');
      warnings.push(...lightErrors);
    }
    
    if (manifest.hasDark) {
      darkCss = await loadThemeCss(`${manifest.path}/dark.css`);
      const darkErrors = validateThemeVariables(darkCss, 'dark');
      warnings.push(...darkErrors);
    }
    
    if (manifest.hasMain) {
      mainCss = await loadThemeCss(`${manifest.path}/main.css`);
    }
    
    if (manifest.hasConfig) {
      config = await loadThemeConfig(`${manifest.path}/theme.ts`);
    }
    
    return {
      manifest,
      lightCss,
      darkCss,
      mainCss,
      config,
      errors,
      warnings
    };
    
  } catch (err) {
    errors.push({
      file: themeName,
      message: `Failed to load theme: ${err instanceof Error ? err.message : String(err)}`,
      severity: 'error'
    });
    
    return {
      manifest: {
        name: themeName,
        path: '',
        hasLight: false,
        hasDark: false,
        hasMain: false,
        hasConfig: false,
        variants: []
      },
      errors,
      warnings
    };
  }
}

/**
 * Validates CSS variables presence
 */
export function validateThemeVariables(css: string, mode: 'light' | 'dark'): ThemeError[] {
  const required = mode === 'light' ? REQUIRED_LIGHT_VARS : REQUIRED_DARK_VARS;
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
export function mergeThemeConfig(base: any, override: any): any {
  return defuMerge(base, override);
}

// Helper functions (would be implemented with actual file system access)
async function loadThemeCss(path: string): Promise<string> {
  // In real implementation, this would read the CSS file
  // For now, return empty string as placeholder
  return '';
}

async function loadThemeConfig(path: string): Promise<any> {
  // In real implementation, this would import/require the theme.ts file
  // For now, return empty object as placeholder
  return {};
}

/**
 * Theme error service for centralized error handling
 */
export class ThemeErrorService {
  private errors: ThemeError[] = [];
  private warnings: ThemeWarning[] = [];
  
  logError(error: ThemeError) {
    this.errors.push(error);
    console.error('[theme]', error.message, error.file);
  }
  
  logWarning(warning: ThemeWarning) {
    this.warnings.push(warning);
    if (import.meta?.dev !== false) { // Show warnings in dev and test
      console.warn('[theme]', warning.message, warning.file);
    }
  }
  
  getErrors() { return this.errors; }
  getWarnings() { return this.warnings; }
  clear() { this.errors = []; this.warnings = []; }
}

export const themeErrors = new ThemeErrorService();
