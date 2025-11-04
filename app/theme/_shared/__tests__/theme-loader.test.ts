/**
 * Theme Loader Tests
 * ==================
 * Tests for theme discovery, loading, and validation functionality.
 */

import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';

// Mock defineAppConfig for theme config loading
beforeAll(() => {
    (globalThis as any).defineAppConfig = (config: any) => config;
});
import {
    discoverThemes,
    loadTheme,
    validateThemeVariables,
    mergeThemeConfig,
    type ThemeManifest,
    type ThemeLoadResult,
} from '../theme-loader';

describe('Theme Loader', () => {
    describe('discoverThemes', () => {
        it('should find all available themes', () => {
            const themes = discoverThemes();

            // We should have 4 themes: default, cyberpunk, minimal, nature
            expect(themes.length).toBeGreaterThanOrEqual(4);

            // Check that default theme exists
            const defaultTheme = themes.find((t) => t.name === 'default');
            expect(defaultTheme).toBeDefined();
            expect(defaultTheme).toMatchObject({
                name: 'default',
                hasLight: true,
                hasDark: true,
                hasMain: true,
                hasConfig: true,
            });
        });

        it('should return array of ThemeManifest objects', () => {
            const themes = discoverThemes();

            themes.forEach((theme) => {
                expect(theme).toHaveProperty('name');
                expect(theme).toHaveProperty('path');
                expect(theme).toHaveProperty('hasLight');
                expect(theme).toHaveProperty('hasDark');
                expect(theme).toHaveProperty('hasMain');
                expect(theme).toHaveProperty('hasConfig');
                expect(theme).toHaveProperty('variants');
                expect(Array.isArray(theme.variants)).toBe(true);
            });
        });
    });

    describe('validateThemeVariables', () => {
        it('should pass validation for complete CSS', () => {
            const css = `
        .light {
          --md-primary: #2c638b;
          --md-on-primary: #ffffff;
          --md-secondary: #51606f;
          --md-on-secondary: #ffffff;
          --md-surface: #f7f9ff;
          --md-on-surface: #181c20;
          --md-error: #ba1a1a;
          --md-on-error: #ffffff;
          --md-background: #f7f9ff;
          --md-on-background: #181c20;
        }
      `;

            const errors = validateThemeVariables(css, 'light');
            expect(errors).toHaveLength(0);
        });

        it('should detect missing CSS variables', () => {
            const css = `
        .light {
          --md-primary: #2c638b;
          --md-on-primary: #ffffff;
          /* Missing other required variables */
        }
      `;

            const errors = validateThemeVariables(css, 'light');
            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0]?.severity).toBe('warning');
            expect(errors[0]?.message).toContain(
                'Missing required CSS variable'
            );
            expect(errors[0]?.file).toBe('light.css');
        });

        it('should work for dark mode', () => {
            const css = `
        .dark {
          --md-primary: #99ccf9;
          --md-on-primary: #003352;
          --md-secondary: #b8c8da;
          --md-on-secondary: #283441;
          --md-surface: #101418;
          --md-on-surface: #e0e2e8;
          --md-error: #ffb4ab;
          --md-on-error: #690005;
          --md-background: #101418;
          --md-on-background: #e0e2e8;
        }
      `;

            const errors = validateThemeVariables(css, 'dark');
            expect(errors).toHaveLength(0);
        });
    });

    describe('loadTheme', () => {
        it('should load valid theme without errors', async () => {
            const result = await loadTheme('default');

            expect(result.manifest.name).toBe('default');
            // Check that there are no critical errors (severity: 'error')
            const criticalErrors = result.errors.filter(
                (e) => e.severity === 'error'
            );

            // Debug: log the actual errors
            if (criticalErrors.length > 0) {
                console.log('Critical errors found:', criticalErrors);
            }

            expect(criticalErrors).toHaveLength(0);
            expect(result.manifest.hasLight).toBe(true);
            expect(result.manifest.hasDark).toBe(true);
        });

        it('should handle non-existent theme', async () => {
            const result = await loadTheme('non-existent');

            expect(result.manifest.name).toBe('non-existent');
            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.errors[0]?.message).toContain('not found');
            expect(result.errors[0]?.severity).toBe('error');
        });

        it('should return manifest and optional files', async () => {
            const result = await loadTheme('default');

            expect(result.manifest).toBeDefined();
            expect(result.lightCss).toBeDefined();
            expect(result.darkCss).toBeDefined();
            expect(result.mainCss).toBeDefined();
            expect(result.config).toBeDefined();
            expect(Array.isArray(result.warnings)).toBe(true);
        });
    });

    describe('mergeThemeConfig', () => {
        it('should merge theme config with base config', () => {
            const base = {
                ui: {
                    button: {
                        slots: { base: 'base-class' },
                        variants: { size: { md: { base: 'px-4 py-2' } } },
                    },
                },
            };

            const override = {
                ui: {
                    button: {
                        slots: { label: 'label-class' },
                        variants: { color: { primary: 'bg-blue-500' } },
                    },
                },
            };

            const result = mergeThemeConfig(base, override);

            expect(result.ui?.button?.slots?.base).toBe('base-class'); // Preserved
            expect(result.ui?.button?.slots?.label).toBe('label-class'); // Added
            expect(result.ui?.button?.variants?.size).toEqual(
                base.ui.button.variants.size
            ); // Preserved
            expect(result.ui?.button?.variants?.color).toEqual(
                override.ui.button.variants.color
            ); // Added
        });
    });
});
