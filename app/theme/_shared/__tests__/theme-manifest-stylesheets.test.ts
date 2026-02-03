import { afterEach, describe, expect, it } from 'vitest';
import { loadThemeStylesheets } from '../theme-manifest';
import type { ThemeManifestEntry } from '../theme-manifest';

describe('loadThemeStylesheets', () => {
    afterEach(() => {
        document
            .querySelectorAll('link[data-theme-stylesheet]')
            .forEach((link) => link.remove());
    });

    it('dedupes concurrent stylesheet loads', async () => {
        const entry = {
            name: 'test',
            dirName: 'test',
            definition: {} as any,
            loader: async () => ({ default: {} as any }),
            stylesheets: ['https://example.com/theme.css'],
            isDefault: false,
            hasCssSelectorStyles: false,
        } as ThemeManifestEntry;

        const first = loadThemeStylesheets(entry, [
            'https://example.com/theme.css',
        ]);
        const second = loadThemeStylesheets(entry, [
            'https://example.com/theme.css',
        ]);

        await Promise.resolve();

        const links = document.querySelectorAll(
            'link[data-theme-stylesheet="test"]'
        );
        expect(links.length).toBe(1);

        const link = links[0] as HTMLLinkElement | undefined;
        link?.onload?.(new Event('load'));

        await Promise.all([first, second]);

        expect(
            document.querySelectorAll('link[data-theme-stylesheet="test"]')
                .length
        ).toBe(1);
    });
});
