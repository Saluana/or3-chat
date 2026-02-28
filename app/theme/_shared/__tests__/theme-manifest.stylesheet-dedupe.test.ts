import { describe, expect, it, vi, beforeEach } from 'vitest';
import { loadThemeStylesheets, type ThemeManifestEntry } from '../theme-manifest';
import type { ThemeDefinition } from '../types';

describe('loadThemeStylesheets dedupe', () => {
    beforeEach(() => {
        document.head.innerHTML = '';
    });

    it('dedupes concurrent stylesheet loads for same theme and href', async () => {
        const appendSpy = vi.spyOn(document.head, 'appendChild');

        const entry: ThemeManifestEntry = {
            name: 'retro',
            dirName: 'retro',
            definition: { name: 'retro', colors: { primary: '#000', secondary: '#111', surface: '#fff' } } as ThemeDefinition,
            loader: async () => ({
                default: {
                    name: 'retro',
                    colors: { primary: '#000', secondary: '#111', surface: '#fff' },
                },
            }),
            stylesheets: ['/themes/retro.css'],
            isDefault: false,
            hasCssSelectorStyles: false,
        };

        const p1 = loadThemeStylesheets(entry, ['/themes/retro.css']);
        const p2 = loadThemeStylesheets(entry, ['/themes/retro.css']);

        await Promise.resolve();

        const link = document.head.querySelector('link[data-theme-stylesheet="retro"]') as HTMLLinkElement | null;
        expect(link).toBeTruthy();
        link?.onload?.(new Event('load'));

        await Promise.all([p1, p2]);
        expect(appendSpy).toHaveBeenCalledTimes(1);
    });
});
