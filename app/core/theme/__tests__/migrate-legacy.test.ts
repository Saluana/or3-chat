import { describe, it, expect, beforeEach } from 'vitest';
import { migrateFromLegacy } from '../migrate-legacy-settings';

describe('migrateFromLegacy', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('should convert ThemeSettings to UserThemeOverrides', () => {
        const legacyData = {
            paletteEnabled: true,
            palettePrimary: '#ff0000',
            paletteSecondary: '#00ff00',
            customBgColorsEnabled: true,
            contentBg1: '/image1.png',
            contentBg1Opacity: 0.5,
            contentBg1SizePx: 300,
            contentBg1Fit: true,
            contentBg1Repeat: 'no-repeat',
            contentBg1Color: '#ffffff',
            baseFontPx: 18,
            useSystemFont: true,
            showHeaderGradient: false,
            reducePatternsInHighContrast: true,
        };

        localStorage.setItem(
            'or3:theme-settings:light',
            JSON.stringify(legacyData)
        );

        const { lightOverrides, darkOverrides } = migrateFromLegacy();

        expect(lightOverrides).toBeTruthy();
        expect(lightOverrides!.colors?.enabled).toBe(true);
        expect(lightOverrides!.colors?.primary).toBe('#ff0000');
        expect(lightOverrides!.backgrounds?.enabled).toBe(true);
        expect(lightOverrides!.backgrounds?.content?.base?.url).toBe(
            '/image1.png'
        );
        expect(lightOverrides!.backgrounds?.content?.base?.opacity).toBe(0.5);
        expect(lightOverrides!.backgrounds?.content?.base?.fit).toBe(true);
        expect(lightOverrides!.typography?.baseFontPx).toBe(18);
        expect(lightOverrides!.typography?.useSystemFont).toBe(true);
        expect(lightOverrides!.backgrounds?.headerGradient?.enabled).toBe(
            false
        );
        expect(lightOverrides!.ui?.reducePatternsInHighContrast).toBe(true);
    });

    it('should delete legacy keys after successful migration', () => {
        const legacyData = { paletteEnabled: true };

        localStorage.setItem(
            'or3:theme-settings:light',
            JSON.stringify(legacyData)
        );
        localStorage.setItem(
            'or3:theme-settings:dark',
            JSON.stringify(legacyData)
        );
        localStorage.setItem('or3:theme-settings', JSON.stringify(legacyData));

        migrateFromLegacy();

        expect(localStorage.getItem('or3:theme-settings:light')).toBeNull();
        expect(localStorage.getItem('or3:theme-settings:dark')).toBeNull();
        expect(localStorage.getItem('or3:theme-settings')).toBeNull();
    });

    it('should skip migration if new format exists', () => {
        const legacyData = { paletteEnabled: true };
        const newData = { colors: { enabled: false } };

        localStorage.setItem(
            'or3:theme-settings:light',
            JSON.stringify(legacyData)
        );
        localStorage.setItem(
            'or3:user-theme-overrides:light',
            JSON.stringify(newData)
        );

        const { lightOverrides, darkOverrides } = migrateFromLegacy();

        expect(lightOverrides).toBeNull();
        expect(darkOverrides).toBeNull();
        // Legacy keys should NOT be deleted if migration is skipped
        expect(localStorage.getItem('or3:theme-settings:light')).toBeTruthy();
    });

    it('should handle missing legacy keys gracefully', () => {
        const { lightOverrides, darkOverrides } = migrateFromLegacy();

        expect(lightOverrides).toBeNull();
        expect(darkOverrides).toBeNull();
    });

    it('should preserve opacity value of 0 (not treat as falsy)', () => {
        const legacyData = {
            contentBg1: '/image.png',
            contentBg1Opacity: 0, // valid value, should not be replaced
        };

        localStorage.setItem(
            'or3:theme-settings:light',
            JSON.stringify(legacyData)
        );

        const { lightOverrides } = migrateFromLegacy();

        expect(lightOverrides!.backgrounds?.content?.base?.opacity).toBe(0);
    });

    it('should apply correct defaults for missing fields', () => {
        const legacyData = {
            paletteEnabled: true,
            // Missing: palettePrimary, contentBg1SizePx, etc.
        };

        localStorage.setItem(
            'or3:theme-settings:light',
            JSON.stringify(legacyData)
        );

        const { lightOverrides } = migrateFromLegacy();

        // Colors enabled but no specific colors set
        expect(lightOverrides!.colors?.enabled).toBe(true);
        expect(lightOverrides!.colors?.primary).toBeUndefined();

        // Background size defaults to 240
        expect(lightOverrides!.backgrounds?.content?.base?.sizePx).toBe(240);
        expect(lightOverrides!.backgrounds?.content?.base?.repeat).toBe(
            'repeat'
        );
        expect(lightOverrides!.backgrounds?.content?.base?.fit).toBe(false);
    });

    it('should handle boolean fields correctly', () => {
        const legacyData = {
            paletteEnabled: false,
            useSystemFont: false,
            contentBg1Fit: false,
            reducePatternsInHighContrast: false,
        };

        localStorage.setItem(
            'or3:theme-settings:light',
            JSON.stringify(legacyData)
        );

        const { lightOverrides } = migrateFromLegacy();

        expect(lightOverrides!.colors?.enabled).toBe(false);
        expect(lightOverrides!.typography?.useSystemFont).toBe(false);
        expect(lightOverrides!.backgrounds?.content?.base?.fit).toBe(false);
        expect(lightOverrides!.ui?.reducePatternsInHighContrast).toBe(false);
    });
});
