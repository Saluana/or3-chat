import { describe, it, expect, beforeEach } from 'vitest';
import {
    sanitize,
    detectModeFromHtml,
} from '../../core/theme/useThemeSettings';
import * as ThemeDefs from '../../core/theme/theme-defaults';
import type { ThemeSettings } from '../../core/theme/theme-types';

// Helper to clone defaults
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('theme settings internals', () => {
    beforeEach(() => {
        document.documentElement.className = '';
    });

    describe('sanitize()', () => {
        it('clamps font size and opacities within bounds', () => {
            const d = ThemeDefs.DEFAULT_THEME_SETTINGS_LIGHT;
            const dirty: ThemeSettings = {
                ...clone(d),
                baseFontPx: 2 as any,
                contentBg1Opacity: -1 as any,
                contentBg2Opacity: 2 as any,
                sidebarBgOpacity: 999 as any,
            } as any;
            const s = sanitize(dirty, d);
            expect(s.baseFontPx).toBe(14);
            expect(s.contentBg1Opacity).toBe(0);
            expect(s.contentBg2Opacity).toBe(1);
            expect(s.sidebarBgOpacity).toBe(1);
        });

        it('coerces repeats and fits; validates images', () => {
            const d = ThemeDefs.DEFAULT_THEME_SETTINGS_LIGHT;
            const dirty: ThemeSettings = {
                ...clone(d),
                contentBg1: 'not-a-url',
                contentBg2: 'internal-file://abc',
                sidebarBg: 'data:image/png;base64,xxx',
                contentBg1Repeat: 'nope' as any,
                contentBg2Repeat: 'repeat',
                sidebarRepeat: 'no-repeat',
                contentRepeat: 'nope' as any,
                contentBg1Fit: 'true' as any,
                contentBg2Fit: 1 as any,
            } as any;
            const s = sanitize(dirty, d);
            expect(s.contentBg1).toBe(d.contentBg1); // invalid reset
            expect(s.contentBg2).toBe('internal-file://abc');
            expect(s.sidebarBg).toBeTruthy();
            expect((s.sidebarBg as string).startsWith('data:image/')).toBe(
                true
            );
            expect(s.contentBg1Repeat).toBe('repeat');
            expect(s.contentBg2Repeat).toBe('repeat');
            expect(s.sidebarRepeat).toBe('no-repeat');
            expect(s.contentRepeat).toBe('repeat');
            expect(typeof s.contentBg1Fit).toBe('boolean');
            expect(typeof s.contentBg2Fit).toBe('boolean');
        });

        it('ensures palette colors are valid and migrates legacy border->surfaceVariant', () => {
            const d = ThemeDefs.DEFAULT_THEME_SETTINGS_LIGHT as any;
            const dirty: any = {
                ...clone(d),
                paletteEnabled: true,
                palettePrimary: 'nope',
                paletteSecondary: 'nope',
                paletteError: 'nope',
                paletteSurface: 'nope',
                paletteBorder: '#00ff00', // legacy-only set
            };
            // Simulate legacy object that didn't include paletteSurfaceVariant at all
            delete dirty.paletteSurfaceVariant;
            const s = sanitize(dirty, d);
            expect(s.palettePrimary).toBe(d.palettePrimary);
            expect(s.paletteSecondary).toBe(d.paletteSecondary);
            expect(s.paletteError).toBe(d.paletteError);
            expect(s.paletteSurface).toBe(d.paletteSurface);
            // migrated surfaceVariant should pick paletteBorder then reset border to default
            expect(s.paletteSurfaceVariant).toBe('#00ff00');
            expect(s.paletteBorder).toBe(d.paletteBorder);
        });
    });

    describe('detectModeFromHtml()', () => {
        it('returns light by default', () => {
            document.documentElement.className = '';
            expect(detectModeFromHtml()).toBe('light');
        });
        it('detects dark when class .dark is present', () => {
            document.documentElement.className = 'dark';
            expect(detectModeFromHtml()).toBe('dark');
        });
        it('detects dark when any dark-* token exists', () => {
            document.documentElement.className = 'foo dark-high-contrast bar';
            expect(detectModeFromHtml()).toBe('dark');
        });
        it('ignores partial tokens like .darkish', () => {
            document.documentElement.className = 'darkish';
            expect(detectModeFromHtml()).toBe('light');
        });
    });
});
