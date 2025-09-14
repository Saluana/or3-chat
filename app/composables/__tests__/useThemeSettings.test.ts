import { describe, it, expect, beforeEach } from 'vitest';
import {
    useThemeSettings,
    DEFAULT_THEME_SETTINGS,
    THEME_SETTINGS_STORAGE_KEY,
} from '../useThemeSettings';

// jsdom environment assumed by vitest config

describe('useThemeSettings', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('loads defaults initially', () => {
        const { settings } = useThemeSettings();
        expect(settings.value!.baseFontPx).toBe(
            DEFAULT_THEME_SETTINGS.baseFontPx
        );
    });

    it('clamps font size', () => {
        const { set, settings } = useThemeSettings();
        set({ baseFontPx: 5 });
        expect(settings.value!.baseFontPx).toBe(14);
        set({ baseFontPx: 400 });
        expect(settings.value!.baseFontPx).toBe(24);
    });

    it('persists to localStorage', () => {
        const { set } = useThemeSettings();
        set({ baseFontPx: 22 });
        const raw = localStorage.getItem(THEME_SETTINGS_STORAGE_KEY)!;
        const parsed = JSON.parse(raw);
        expect(parsed.baseFontPx).toBe(22);
    });

    it('high contrast clamp logic (simulation)', () => {
        document.documentElement.classList.add('light-high-contrast');
        const { set, settings, reapply } = useThemeSettings();
        set({
            contentBg1Opacity: 0.5,
            contentBg2Opacity: 0.5,
            sidebarBgOpacity: 0.5,
        });
        reapply();
        // After reapply with high contrast active + reduction enabled, CSS vars should be clamped <=0.04
        const style = getComputedStyle(document.documentElement);
        expect(
            parseFloat(style.getPropertyValue('--app-content-bg-1-opacity'))
        ).toBeLessThanOrEqual(0.04);
        expect(
            parseFloat(style.getPropertyValue('--app-sidebar-bg-1-opacity'))
        ).toBeLessThanOrEqual(0.04);
        document.documentElement.classList.remove('light-high-contrast');
    });
});
