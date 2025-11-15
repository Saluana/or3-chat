import { describe, it, expect } from 'vitest';
import {
    loadThemeManifest,
    loadThemeAppConfig,
} from '../../_shared/theme-manifest';

describe('theme manifest app config integration', () => {
    it('loads app.config.ts for themes that provide one', async () => {
        const manifest = await loadThemeManifest();
        const blankEntry = manifest.find((entry) => entry.dirName === 'blank');

        expect(blankEntry).toBeTruthy();
        expect(blankEntry?.appConfigLoader).toBeTypeOf('function');

        if (!blankEntry) return;

        const config = await loadThemeAppConfig(blankEntry);
        expect(config).toBeTruthy();
        expect(config?.ui?.themeMeta?.blankTheme).toBe(true);
    });

    it('returns null when a theme has no app.config.ts', async () => {
        const manifest = await loadThemeManifest();
        const retroEntry = manifest.find((entry) => entry.dirName === 'retro');

        expect(retroEntry).toBeTruthy();
        expect(retroEntry?.appConfigLoader).toBeUndefined();

        if (!retroEntry) return;

        const config = await loadThemeAppConfig(retroEntry);
        expect(config).toBeNull();
    });
});
