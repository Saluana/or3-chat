import { describe, it, expect, beforeEach, vi } from 'vitest';
import { migrateFromLegacy } from '../migrate-legacy-settings';

const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
        getItem: (key: string) => store[key] || null,
        setItem: (key: string, value: string) => {
            store[key] = value;
        },
        removeItem: (key: string) => {
            delete store[key];
        },
        clear: () => {
            store = {};
        },
    };
})();

describe('migrateFromLegacy', () => {
    beforeEach(() => {
        Object.defineProperty(global, 'window', {
            value: {},
            writable: true,
        });
        Object.defineProperty(global, 'localStorage', {
            value: localStorageMock,
            writable: true,
        });
        localStorageMock.clear();
    });

    it('migration converts ThemeSettings → UserThemeOverrides correctly', () => {
        const legacyData = {
            paletteEnabled: true,
            palettePrimary: '#ff0000',
            paletteSecondary: '#00ff00',
            customBgColorsEnabled: true,
            contentBg1: '/bg.webp',
            contentBg1Opacity: 0.5,
            contentBg1SizePx: 150,
            contentBg1Fit: false,
            contentBg1Repeat: 'repeat',
            contentBg1Color: '#ffffff',
            baseFontPx: 22,
            useSystemFont: true,
            reducePatternsInHighContrast: true,
        };

        localStorageMock.setItem(
            'or3:theme-settings:light',
            JSON.stringify(legacyData)
        );

        const { lightOverrides } = migrateFromLegacy();

        expect(lightOverrides).toBeDefined();
        expect(lightOverrides?.colors?.enabled).toBe(true);
        expect(lightOverrides?.colors?.primary).toBe('#ff0000');
        expect(lightOverrides?.colors?.secondary).toBe('#00ff00');
        expect(lightOverrides?.backgrounds?.enabled).toBe(true);
        expect(lightOverrides?.backgrounds?.content?.base?.url).toBe(
            '/bg.webp'
        );
        expect(lightOverrides?.backgrounds?.content?.base?.opacity).toBe(0.5);
        expect(lightOverrides?.backgrounds?.content?.base?.sizePx).toBe(150);
        expect(lightOverrides?.backgrounds?.content?.base?.fit).toBe(false);
        expect(lightOverrides?.backgrounds?.content?.base?.repeat).toBe(
            'repeat'
        );
        expect(lightOverrides?.backgrounds?.content?.base?.color).toBe(
            '#ffffff'
        );
        expect(lightOverrides?.typography?.baseFontPx).toBe(22);
        expect(lightOverrides?.typography?.useSystemFont).toBe(true);
        expect(lightOverrides?.ui?.reducePatternsInHighContrast).toBe(true);
    });

    it('migration deletes legacy keys after success', () => {
        const legacyData = { paletteEnabled: false };
        localStorageMock.setItem(
            'or3:theme-settings:light',
            JSON.stringify(legacyData)
        );
        localStorageMock.setItem(
            'or3:theme-settings:dark',
            JSON.stringify(legacyData)
        );
        localStorageMock.setItem(
            'or3:theme-settings',
            JSON.stringify(legacyData)
        );

        migrateFromLegacy();

        expect(localStorageMock.getItem('or3:theme-settings:light')).toBeNull();
        expect(localStorageMock.getItem('or3:theme-settings:dark')).toBeNull();
        expect(localStorageMock.getItem('or3:theme-settings')).toBeNull();
    });

    it('migration skips if new format exists', () => {
        const newData = { colors: { enabled: true } };
        localStorageMock.setItem(
            'or3:user-theme-overrides:light',
            JSON.stringify(newData)
        );

        const legacyData = { paletteEnabled: false };
        localStorageMock.setItem(
            'or3:theme-settings:light',
            JSON.stringify(legacyData)
        );

        const { lightOverrides, darkOverrides } = migrateFromLegacy();

        expect(lightOverrides).toBeNull();
        expect(darkOverrides).toBeNull();

        // Legacy key should still exist (not deleted)
        expect(
            localStorageMock.getItem('or3:theme-settings:light')
        ).toBeTruthy();
    });

    it('migration handles missing legacy keys gracefully', () => {
        const { lightOverrides, darkOverrides } = migrateFromLegacy();

        expect(lightOverrides).toBeNull();
        expect(darkOverrides).toBeNull();
    });

    it('all field mappings convert correctly', () => {
        const comprehensiveLegacy = {
            // Colors
            paletteEnabled: true,
            palettePrimary: '#primary',
            paletteSecondary: '#secondary',
            paletteError: '#error',
            paletteSurfaceVariant: '#surfaceVariant',
            paletteBorder: '#border',
            paletteSurface: '#surface',

            // Backgrounds
            customBgColorsEnabled: true,
            contentBg1: '/bg1.png',
            contentBg1Opacity: 0.1,
            contentBg1SizePx: 100,
            contentBg1Fit: true,
            contentBg1Repeat: 'no-repeat',
            contentBg1Color: '#bg1color',

            contentBg2: '/bg2.png',
            contentBg2Opacity: 0.2,
            contentBg2SizePx: 200,
            contentBg2Fit: false,
            contentBg2Repeat: 'repeat',
            contentBg2Color: '#bg2color',

            sidebarBg: '/sidebar.png',
            sidebarBgOpacity: 0.3,
            sidebarBgSizePx: 300,
            sidebarBgFit: true,
            sidebarRepeat: 'repeat',
            sidebarBgColor: '#sidebarcolor',

            // Gradients
            showHeaderGradient: true,
            showBottomBarGradient: false,

            // Typography
            baseFontPx: 18,
            useSystemFont: false,

            // UI
            reducePatternsInHighContrast: true,
        };

        localStorageMock.setItem(
            'or3:theme-settings:light',
            JSON.stringify(comprehensiveLegacy)
        );

        const { lightOverrides } = migrateFromLegacy();

        // Verify all fields mapped
        expect(lightOverrides?.colors).toMatchObject({
            enabled: true,
            primary: '#primary',
            secondary: '#secondary',
            error: '#error',
            surfaceVariant: '#surfaceVariant',
            border: '#border',
            surface: '#surface',
        });

        expect(lightOverrides?.backgrounds?.enabled).toBe(true);

        expect(lightOverrides?.backgrounds?.content?.base).toMatchObject({
            url: '/bg1.png',
            opacity: 0.1,
            sizePx: 100,
            fit: true,
            repeat: 'no-repeat',
            color: '#bg1color',
        });

        expect(lightOverrides?.backgrounds?.content?.overlay).toMatchObject({
            url: '/bg2.png',
            opacity: 0.2,
            sizePx: 200,
            fit: false,
            repeat: 'repeat',
            color: '#bg2color',
        });

        expect(lightOverrides?.backgrounds?.sidebar).toMatchObject({
            url: '/sidebar.png',
            opacity: 0.3,
            sizePx: 300,
            fit: true,
            repeat: 'repeat',
            color: '#sidebarcolor',
        });

        expect(lightOverrides?.backgrounds?.headerGradient?.enabled).toBe(true);
        expect(lightOverrides?.backgrounds?.bottomNavGradient?.enabled).toBe(
            false
        );

        expect(lightOverrides?.typography).toMatchObject({
            baseFontPx: 18,
            useSystemFont: false,
        });

        expect(lightOverrides?.ui?.reducePatternsInHighContrast).toBe(true);
    });

    it('handles both light and dark legacy data', () => {
        const lightLegacy = { paletteEnabled: true, palettePrimary: '#light' };
        const darkLegacy = { paletteEnabled: false, palettePrimary: '#dark' };

        localStorageMock.setItem(
            'or3:theme-settings:light',
            JSON.stringify(lightLegacy)
        );
        localStorageMock.setItem(
            'or3:theme-settings:dark',
            JSON.stringify(darkLegacy)
        );

        const { lightOverrides, darkOverrides } = migrateFromLegacy();

        expect(lightOverrides?.colors?.enabled).toBe(true);
        expect(lightOverrides?.colors?.primary).toBe('#light');

        expect(darkOverrides?.colors?.enabled).toBe(false);
        expect(darkOverrides?.colors?.primary).toBe('#dark');
    });

    it('handles corrupted legacy data gracefully', () => {
        const consoleInfo = vi
            .spyOn(console, 'info')
            .mockImplementation(() => {});

        localStorageMock.setItem(
            'or3:theme-settings:light',
            'corrupted json {'
        );

        const { lightOverrides, darkOverrides } = migrateFromLegacy();

        expect(lightOverrides).toBeNull();
        expect(darkOverrides).toBeNull();
        // Migration should log info about attempting migration but return null on error

        consoleInfo.mockRestore();
    });
});
