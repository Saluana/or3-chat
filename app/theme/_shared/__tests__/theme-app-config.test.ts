import { describe, it, expect } from 'vitest';
import {
    loadThemeManifest,
    loadThemeAppConfig,
} from '../../_shared/theme-manifest';
import {
    computeEffectiveAppConfig,
    replaceReactiveObject,
} from '../../_shared/theme-core';

describe('theme manifest app config integration', () => {
    it('recomputes A -> B -> A from the immutable base without leaked keys', () => {
        const base = { ui: { button: { size: 'md' } }, productName: 'OR3' };
        const themeA = computeEffectiveAppConfig(base, {
            appPatch: { onlyA: true },
            uiPatch: { button: { color: 'red' } },
        });
        const live = structuredClone(themeA);

        replaceReactiveObject(
            live,
            computeEffectiveAppConfig(base, {
                appPatch: { onlyB: true },
                uiPatch: { button: { variant: 'ghost' } },
            })
        );
        expect(live).not.toHaveProperty('onlyA');
        expect(live).toMatchObject({ onlyB: true, productName: 'OR3' });
        expect(live.ui).toEqual({
            button: { size: 'md', variant: 'ghost' },
        });

        replaceReactiveObject(live, themeA);
        expect(live).not.toHaveProperty('onlyB');
        expect(live).toEqual(themeA);
        expect(base).toEqual({ ui: { button: { size: 'md' } }, productName: 'OR3' });
    });

    it('applies the canonical theme.ui patch after a legacy app config patch', () => {
        const effective = computeEffectiveAppConfig(
            { ui: { input: { color: 'base', size: 'md' } } },
            {
                appPatch: { ui: { input: { color: 'legacy' } } },
                uiPatch: { input: { color: 'theme' } },
            }
        );

        expect(effective.ui).toEqual({
            input: { color: 'theme', size: 'md' },
        });
    });

    it.each(['blank', 'retro', 'cyberpunk'])(
        '%s authors Nuxt UI config in theme.ts only',
        async (themeName) => {
            const { entries: manifest } = await loadThemeManifest();
            const entry = manifest.find(
                (candidate) => candidate.dirName === themeName
            );

            expect(entry).toBeTruthy();
            expect(entry?.appConfigLoader).toBeUndefined();

            if (!entry) return;

            const definition = (await entry.loader()).default;
            const ui = definition.ui as
                | {
                      button?: {
                          variants?: {
                              size?: Record<string, { base?: string }>;
                          };
                      };
                  }
                | undefined;
            expect(ui).toBeTruthy();
            expect(await loadThemeAppConfig(entry)).toBeNull();

            if (themeName === 'blank') {
                const squareBase =
                    ui?.button?.variants?.size?.['sb-square']?.base ?? '';
                expect(squareBase).toContain('h-[');
                expect(squareBase).toContain('w-[');
            }
        }
    );

    it('keeps the legacy app config loader for installed-theme compatibility', async () => {
        const mockEntry = {
            name: 'legacy-theme',
            dirName: 'legacy',
            loader: async () => ({ default: {} as never }),
            stylesheets: [],
            isDefault: false,
            hasCssSelectorStyles: false,
            appConfigLoader: async () => ({ default: { legacy: true } }),
        };

        expect(await loadThemeAppConfig(mockEntry)).toEqual({ legacy: true });
    });

    it('returns null when a theme entry has no appConfigLoader', async () => {
        const mockEntry = {
            name: 'mock-theme',
            dirName: 'mock',
            loader: async () => ({ default: {} as never }),
            stylesheets: [],
            isDefault: false,
            hasCssSelectorStyles: false,
            appConfigLoader: undefined,
        };

        const config = await loadThemeAppConfig(mockEntry);
        expect(config).toBeNull();
    });
});
