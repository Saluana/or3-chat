/**
 * Config Merger Utility
 * =====================
 * Deep merges theme.ts overrides with default app.config.ts.
 * Uses defu for proper deep merge behavior with Nuxt configs.
 */

import { defu } from 'defu';
import type { ComponentOverrides } from './override-types';

// Type definitions for safe merging
export interface AppConfig {
  ui?: {
    button?: {
      slots?: Record<string, string | string[]>;
      variants?: {
        size?: Record<string, { base?: string }>;
        color?: Record<string, string>;
      };
    };
    [key: string]: unknown;
  };
  mentions?: {
    enabled?: boolean;
    debounceMs?: number;
    maxPerGroup?: number;
    maxContextBytes?: number;
  };
  componentOverrides?: ComponentOverrides;
  [key: string]: unknown;
}

/**
 * Deep merge theme config with base app config
 * 
 * @param base - The base configuration (usually from app.config.ts)
 * @param override - The theme-specific overrides (from theme.ts)
 * @returns Merged configuration with overrides taking precedence
 */
export function mergeThemeConfig(
  base: AppConfig,
  override: Partial<AppConfig>
): AppConfig {
  // defu performs deep merge with override taking precedence
  // Arrays are replaced, not merged (desired behavior for component slots)
  return defu(override, base) as AppConfig;
}

/**
 * Type-safe wrapper for merging theme configs
 * 
 * @param base - Base configuration object
 * @param override - Override configuration object
 * @returns Safely merged configuration
 */
export function safeMergeThemeConfig<T extends AppConfig>(
  base: T,
  override: Partial<T>
): T {
  return mergeThemeConfig(base, override) as T;
}

/**
 * Validates that a theme config has the correct structure
 * 
 * @param config - Configuration to validate
 * @returns True if config is valid, false otherwise
 */
export function validateThemeConfig(config: unknown): config is Partial<AppConfig> {
  if (!config || typeof config !== 'object') {
    return false;
  }
  
  // Type assertion to access properties safely
  const cfg = config as Record<string, unknown>;
  
  // Basic structure validation - can be extended as needed
  if (cfg.ui && typeof cfg.ui !== 'object') {
    return false;
  }
  
  if (cfg.mentions && typeof cfg.mentions !== 'object') {
    return false;
  }
  
  if (cfg.componentOverrides && typeof cfg.componentOverrides !== 'object') {
    return false;
  }
  
  return true;
}

/**
 * Creates a new theme config by merging with defaults
 * 
 * @param themeConfig - Theme-specific configuration
 * @param defaultConfig - Default configuration to fall back to
 * @returns Complete theme configuration
 */
export function createThemeConfig(
  themeConfig: Partial<AppConfig>,
  defaultConfig: AppConfig = {}
): AppConfig {
  if (!validateThemeConfig(themeConfig)) {
    console.warn('[theme] Invalid theme config structure, using defaults');
    return defaultConfig;
  }
  
  return mergeThemeConfig(defaultConfig, themeConfig);
}
