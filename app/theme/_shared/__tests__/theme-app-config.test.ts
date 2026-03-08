import { describe, it, expect } from 'vitest';
import {
    loadThemeManifest,
    loadThemeAppConfig,
} from '../../_shared/theme-manifest';

describe('theme manifest app config integration', () => {
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
            definition: {} as never,
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
