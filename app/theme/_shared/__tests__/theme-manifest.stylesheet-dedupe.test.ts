import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
    deactivateThemeStylesheets,
    loadThemeStylesheets,
    type ThemeManifestEntry,
} from '../theme-manifest';

describe('loadThemeStylesheets dedupe', () => {
    beforeEach(() => {
        document.head.innerHTML = '';
    });

    it('dedupes concurrent stylesheet loads for same theme and href', async () => {
        const appendSpy = vi.spyOn(document.head, 'appendChild');

        const entry: ThemeManifestEntry = {
            name: 'retro',
            dirName: 'retro',
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

    it('re-enables an already parsed inactive stylesheet', async () => {
        const entry: ThemeManifestEntry = {
            name: 'retro',
            dirName: 'retro',
            loader: async () => ({
                default: {
                    name: 'retro',
                    colors: {
                        primary: '#000',
                        secondary: '#111',
                        surface: '#fff',
                    },
                },
            }),
            stylesheets: ['/themes/retro.css'],
            isDefault: false,
            hasCssSelectorStyles: false,
        };

        const firstLoad = loadThemeStylesheets(entry, ['/themes/retro.css']);
        await Promise.resolve();
        const link = document.head.querySelector(
            'link[data-theme-stylesheet="retro"]'
        ) as HTMLLinkElement;
        link.dispatchEvent(new Event('load'));
        await firstLoad;

        deactivateThemeStylesheets('retro');
        expect(link.disabled).toBe(true);
        await loadThemeStylesheets(entry, ['/themes/retro.css']);

        expect(link.disabled).toBe(false);
        expect(
            document.head.querySelectorAll(
                'link[data-theme-stylesheet="retro"]'
            )
        ).toHaveLength(1);
    });
});
