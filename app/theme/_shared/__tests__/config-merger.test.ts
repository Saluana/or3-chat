/**
 * Config Merger Tests
 * ===================
 * Tests for theme configuration merging functionality.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { 
  mergeThemeConfig, 
  safeMergeThemeConfig, 
  validateThemeConfig, 
  createThemeConfig,
  type AppConfig 
} from '../config-merger';

describe('Config Merger', () => {
  let baseConfig: AppConfig;
  let themeConfig: Partial<AppConfig>;

  beforeEach(() => {
    baseConfig = {
      ui: {
        button: {
          slots: {
            base: 'base-class',
            label: 'label-class'
          },
          variants: {
            size: {
              sm: { base: 'px-2 py-1' },
              md: { base: 'px-4 py-2' }
            }
          }
        }
      },
      mentions: {
        enabled: true,
        debounceMs: 100,
        maxPerGroup: 5,
        maxContextBytes: 50000
      }
    };

    themeConfig = {
      ui: {
        button: {
          slots: {
            label: 'new-label-class' // Override only label
          },
          variants: {
            color: { // Add new color variant
              primary: 'bg-blue-500 text-white'
            }
          }
        }
      }
    };
  });

  describe('mergeThemeConfig', () => {
    it('should deep merge objects correctly', () => {
      const result = mergeThemeConfig(baseConfig, themeConfig);
      
      expect(result.ui?.button?.slots?.base).toBe('base-class'); // Preserved
      expect(result.ui?.button?.slots?.label).toBe('new-label-class'); // Overridden
      expect(result.ui?.button?.variants?.size).toEqual(baseConfig.ui?.button?.variants?.size); // Preserved
      expect(result.ui?.button?.variants?.color).toEqual(themeConfig.ui?.button?.variants?.color); // Added
    });

    it('should preserve mentions config when not overridden', () => {
      const result = mergeThemeConfig(baseConfig, themeConfig);
      
      expect(result.mentions).toEqual(baseConfig.mentions);
    });

    it('should handle empty override', () => {
      const result = mergeThemeConfig(baseConfig, {});
      
      expect(result).toEqual(baseConfig);
    });

    it('should handle empty base', () => {
      const result = mergeThemeConfig({}, themeConfig);
      
      expect(result.ui?.button?.slots?.label).toBe('new-label-class');
    });
  });

  describe('safeMergeThemeConfig', () => {
    it('should return typed result', () => {
      const result = safeMergeThemeConfig(baseConfig, themeConfig);
      
      expect(result.ui?.button?.slots?.label).toBe('new-label-class');
      // TypeScript should infer the correct type
    });
  });

  describe('validateThemeConfig', () => {
    it('should validate correct config structure', () => {
      expect(validateThemeConfig(themeConfig)).toBe(true);
      expect(validateThemeConfig(baseConfig)).toBe(true);
    });

    it('should reject invalid config', () => {
      expect(validateThemeConfig(null)).toBe(false);
      expect(validateThemeConfig(undefined)).toBe(false);
      expect(validateThemeConfig('string')).toBe(false);
      expect(validateThemeConfig(123)).toBe(false);
    });

    it('should reject invalid nested objects', () => {
      const invalidConfig = {
        ui: 'not-an-object'
      };
      expect(validateThemeConfig(invalidConfig)).toBe(false);
    });
  });

  describe('createThemeConfig', () => {
    it('should create complete theme config', () => {
      const result = createThemeConfig(themeConfig, baseConfig);
      
      expect(result.ui?.button?.slots?.base).toBe('base-class');
      expect(result.ui?.button?.slots?.label).toBe('new-label-class');
      expect(result.mentions).toEqual(baseConfig.mentions);
    });

    it('should use defaults when config is invalid', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      const result = createThemeConfig('invalid' as any, baseConfig);
      
      expect(result).toEqual(baseConfig);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[theme] Invalid theme config structure')
      );
      
      consoleSpy.mockRestore();
    });

    it('should work with empty defaults', () => {
      const result = createThemeConfig(themeConfig);
      
      expect(result.ui?.button?.slots?.label).toBe('new-label-class');
    });
  });
});
