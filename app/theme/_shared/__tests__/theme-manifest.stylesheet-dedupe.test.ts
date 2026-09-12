import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
    __resetThemeStylesheetCachesForTests,
    deactivateThemeStylesheets,
    loadThemeStylesheets,
    type ThemeManifestEntry,
} from '../theme-manifest';

describe('loadThemeStylesheets dedupe', () => {
    beforeEach(() => {
        document.head.innerHTML = '';
        __resetThemeStylesheetCachesForTests();
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

    it('rejects required stylesheet failures and removes the failed link', async () => {
        const entry: ThemeManifestEntry = {
            name: 'broken',
            dirName: 'broken',
            loader: async () => ({
                default: {
                    name: 'broken',
                    colors: { primary: '#000', secondary: '#111', surface: '#fff' },
                },
            }),
            stylesheets: ['/themes/broken.css'],
            isDefault: false,
            hasCssSelectorStyles: false,
        };

        const pending = loadThemeStylesheets(entry, ['/themes/broken.css']);
        await Promise.resolve();
        const link = document.head.querySelector(
            'link[data-theme-stylesheet="broken"]'
        ) as HTMLLinkElement;
        expect(link).toBeTruthy();
        link.dispatchEvent(new Event('error'));

        await expect(pending).rejects.toThrow('Failed to load stylesheet');
        expect(
            document.head.querySelector(
                'link[data-theme-stylesheet="broken"]'
            )
        ).toBeNull();
    });

    it('retries with a fresh request after a failure instead of trusting link existence', async () => {
        const entry: ThemeManifestEntry = {
            name: 'flaky',
            dirName: 'flaky',
            loader: async () => ({
                default: {
                    name: 'flaky',
                    colors: { primary: '#000', secondary: '#111', surface: '#fff' },
                },
            }),
            stylesheets: ['/themes/flaky.css'],
            isDefault: false,
            hasCssSelectorStyles: false,
        };

        const first = loadThemeStylesheets(entry, ['/themes/flaky.css']);
        await Promise.resolve();
        const failedLink = document.head.querySelector(
            'link[data-theme-stylesheet="flaky"]'
        ) as HTMLLinkElement;
        failedLink.dispatchEvent(new Event('error'));
        await expect(first).rejects.toThrow('Failed to load stylesheet');

        // A stale failed tag left behind (e.g. by an older version) must not
        // be treated as a successful load.
        const stale = document.createElement('link');
        stale.rel = 'stylesheet';
        stale.setAttribute('href', '/themes/flaky.css');
        stale.setAttribute('data-theme-stylesheet', 'flaky');
        document.head.appendChild(stale);

        const appendSpy = vi.spyOn(document.head, 'appendChild');
        const second = loadThemeStylesheets(entry, ['/themes/flaky.css']);
        await Promise.resolve();
        expect(
            document.head.querySelectorAll(
                'link[data-theme-stylesheet="flaky"]'
            )
        ).toHaveLength(1);
        expect(appendSpy).toHaveBeenCalled();
        const retryLink = document.head.querySelector(
            'link[data-theme-stylesheet="flaky"]'
        ) as HTMLLinkElement;
        expect(retryLink).not.toBe(stale);
        retryLink.dispatchEvent(new Event('load'));
        await expect(second).resolves.toBeUndefined();
    });
});
