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

    it('loads app.config.ts for themes that provide one', async () => {
        const { entries: manifest } = await loadThemeManifest();
        const blankEntry = manifest.find((entry) => entry.dirName === 'blank');

        expect(blankEntry).toBeTruthy();
        expect(blankEntry?.appConfigLoader).toBeTypeOf('function');

        if (!blankEntry) return;

        const config = (await loadThemeAppConfig(blankEntry)) as {
            ui?: {
                button?: {
                    variants?: { size?: Record<string, { base?: string }> };
                };
            };
        } | null;
        expect(config).toBeTruthy();
        const squareBase =
            config?.ui?.button?.variants?.size?.['sb-square']?.base ?? '';
        expect(squareBase).toContain('h-[');
        expect(squareBase).toContain('w-[');
    });

    it('loads app.config.ts for retro theme', async () => {
        const { entries: manifest } = await loadThemeManifest();
        const retroEntry = manifest.find((entry) => entry.dirName === 'retro');

        expect(retroEntry).toBeTruthy();
        expect(retroEntry?.appConfigLoader).toBeTypeOf('function');

        if (!retroEntry) return;

        const config = await loadThemeAppConfig(retroEntry);
        expect(config).toBeTruthy();
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
